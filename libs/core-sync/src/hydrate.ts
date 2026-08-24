// Dò/tạo kênh state (ADR-0014 mục "Tạo và tìm lại kênh") rồi hydrate state
// riêng tư từ snapshot ghim + event log (ADR-0009 mục "Hydration (F1.3)").
import { createEmptySyncState, type StateChannelResolutionCallbacks, type SyncState } from '@tsmc/shared-models';
import type { SyncGateway } from './gateway-port';
import { applySnapshot, mergeStates, replay } from './reducer';
import type { SyncStoragePort } from './storage-port';

export interface ResolvedChannel {
  channelId: string;
  accessHash: string;
}

export type ChannelResolution =
  | ({ kind: 'single' } & ResolvedChannel)
  | { kind: 'merge'; targetChannelId: string; allChannelIds: string[] };

/** ADR-0014 bước 1-5: cache cục bộ → xác thực → dò → 0/1/N → tạo mới. */
export async function resolveStateChannel(
  gateway: SyncGateway,
  storage: SyncStoragePort,
  callbacks: StateChannelResolutionCallbacks
): Promise<ChannelResolution> {
  const meta = await storage.getSyncMeta();
  if (meta.stateChannelId && meta.stateChannelAccessHash) {
    const validated = await gateway.getChannelById(meta.stateChannelId);
    if (validated) {
      return { kind: 'single', channelId: validated.id, accessHash: validated.accessHash };
    }
    // Cache cũ không còn dùng được (user tự xoá kênh trong Telegram?) — xoá
    // cache, dò lại từ đầu thay vì âm thầm coi như chưa từng có kênh.
    await storage.putSyncMeta({ stateChannelId: undefined, stateChannelAccessHash: undefined });
  }

  const candidates = await gateway.listOwnStateChannelCandidates();
  if (candidates.length === 1) {
    const only = candidates[0];
    if (!only) {
      throw new Error('unreachable: candidates.length === 1');
    }
    return { kind: 'single', channelId: only.id, accessHash: only.accessHash };
  }
  if (candidates.length > 1) {
    const choice = await callbacks.chooseCandidate(candidates);
    if (choice.kind === 'use') {
      const picked = candidates.find((c) => c.id === choice.channelId);
      if (!picked) {
        throw new Error(`chooseCandidate trả về channelId không nằm trong danh sách: ${choice.channelId}`);
      }
      return { kind: 'single', channelId: picked.id, accessHash: picked.accessHash };
    }
    if (choice.kind === 'link') {
      const linked = await resolveChannelFromLink(gateway, choice.link);
      return { kind: 'single', ...linked };
    }
    // 'merge' — không tự đoán kênh đích, dùng đúng danh sách user chọn.
    if (choice.channelIds.length === 0) {
      throw new Error('chooseCandidate trả về merge với danh sách channelIds rỗng');
    }
    return { kind: 'merge', targetChannelId: choice.channelIds[0] as string, allChannelIds: choice.channelIds };
  }

  const created = await gateway.createStateChannel();
  return { kind: 'single', channelId: created.id, accessHash: created.accessHash };
}

/** ADR-0014: link dạng t.me/c/<id>/... — kênh riêng tư không username/invite
 * link, chỉ deep-link nội bộ dùng được khi tài khoản đã là thành viên. */
export async function resolveChannelFromLink(gateway: SyncGateway, link: string): Promise<ResolvedChannel> {
  const match = /t\.me\/c\/(\d+)/.exec(link);
  if (!match) {
    throw new Error('Link kênh state không hợp lệ — cần dạng t.me/c/<id>/...');
  }
  const id = match[1] as string;
  const found = await gateway.getChannelById(id);
  if (!found) {
    throw new Error('Không tìm thấy kênh — tài khoản hiện tại có phải thành viên của kênh này không?');
  }
  return { channelId: found.id, accessHash: found.accessHash };
}

export interface HydrationResult {
  channel: ResolvedChannel;
  state: SyncState;
  lastSeenMsgId: number;
}

async function hydrateSingleChannel(gateway: SyncGateway, storage: SyncStoragePort, channel: ResolvedChannel): Promise<HydrationResult> {
  const snapshot = await gateway.fetchPinnedSnapshot(channel.channelId);
  let state = applySnapshot(snapshot ?? undefined);
  const baseMsgId = snapshot?.baseMsgId ?? 0;

  const fetched = await gateway.fetchEventsSince(channel.channelId, baseMsgId);
  const sorted = [...fetched].sort((a, b) => a.msgId - b.msgId);
  state = replay(
    state,
    sorted.map((f) => f.event)
  );

  const lastSeenMsgId = sorted.length > 0 ? (sorted[sorted.length - 1] as (typeof sorted)[number]).msgId : baseMsgId;

  await storage.putSyncState(state);
  await storage.putSyncMeta({
    stateChannelId: channel.channelId,
    stateChannelAccessHash: channel.accessHash,
    lastSeenMsgId,
    lastSnapshotMsgId: baseMsgId
  });

  return { channel, state, lastSeenMsgId };
}

/**
 * ADR-0014 "gộp": đọc đầy đủ từng kênh ứng viên (snapshot + toàn bộ event
 * của riêng nó), hoà bằng mergeStates, rồi ghi snapshot đã gộp lên kênh đích
 * để lần hydrate() sau — trên chính thiết bị này hay thiết bị khác — thấy
 * đúng state đã gộp, không chỉ cache cục bộ.
 * Kênh thua không bị xoá/không bị ghi — hành động huỷ kênh để lại cho user
 * tự làm trong Telegram; ta chỉ nén (ghim + xoá event đã đọc) đúng kênh đích.
 */
export async function hydrateWithMerge(
  gateway: SyncGateway,
  storage: SyncStoragePort,
  targetChannelId: string,
  allChannelIds: string[]
): Promise<HydrationResult> {
  const target = await gateway.getChannelById(targetChannelId);
  if (!target) {
    throw new Error(`Không tìm thấy kênh đích để gộp: ${targetChannelId}`);
  }

  let merged = createEmptySyncState();
  let targetOwnEventMsgIds: number[] = [];
  let targetHighestMsgId = 0;

  for (const channelId of allChannelIds) {
    const snapshot = await gateway.fetchPinnedSnapshot(channelId);
    const base = applySnapshot(snapshot ?? undefined);
    const events = await gateway.fetchEventsSince(channelId, snapshot?.baseMsgId ?? 0);
    const sorted = [...events].sort((a, b) => a.msgId - b.msgId);
    const channelState = replay(
      base,
      sorted.map((f) => f.event)
    );
    merged = mergeStates(merged, channelState);

    if (channelId === targetChannelId) {
      targetOwnEventMsgIds = sorted.map((f) => f.msgId);
      targetHighestMsgId = Math.max(snapshot?.baseMsgId ?? 0, ...targetOwnEventMsgIds, 0);
    }
  }

  const published = await gateway.publishSnapshot(
    target.id,
    { v: 1, state: merged, baseMsgId: targetHighestMsgId },
    targetOwnEventMsgIds
  );

  await storage.putSyncState(merged);
  await storage.putSyncMeta({
    stateChannelId: target.id,
    stateChannelAccessHash: target.accessHash,
    lastSeenMsgId: published.msgId,
    lastSnapshotMsgId: published.msgId
  });

  return { channel: { channelId: target.id, accessHash: target.accessHash }, state: merged, lastSeenMsgId: published.msgId };
}

/**
 * ADR-0009 "Hydration": dò/tạo kênh (ADR-0014), rồi snapshot ghim → replay
 * event sau baseMsgId → ghi IndexedDB → lưu lastSeenMsgId. Khi user chọn
 * "gộp" ở bước dò kênh, dispatch sang hydrateWithMerge thay vì hydrate đơn
 * kênh thông thường — cùng một lệnh gọi, người dùng sync-engine.ts không
 * cần biết chọn nhánh nào.
 */
export async function hydrate(
  gateway: SyncGateway,
  storage: SyncStoragePort,
  callbacks: StateChannelResolutionCallbacks
): Promise<HydrationResult> {
  const resolution = await resolveStateChannel(gateway, storage, callbacks);
  if (resolution.kind === 'merge') {
    return hydrateWithMerge(gateway, storage, resolution.targetChannelId, resolution.allChannelIds);
  }
  return hydrateSingleChannel(gateway, storage, { channelId: resolution.channelId, accessHash: resolution.accessHash });
}
