// Nén snapshot — ADR-0009 "Compaction". Chỉ tab leader gọi (sync-engine.ts
// gate qua leader trước khi gọi maybeCompact).
import type { SnapshotV1 } from '@tsmc/shared-models';
import type { SyncGateway } from './gateway-port';
import type { SyncStoragePort } from './storage-port';

const COMPACTION_EVENT_THRESHOLD = 200;
const COMPACTION_MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CompactionDecision {
  shouldCompact: boolean;
  reason?: 'event-count' | 'snapshot-age';
}

/** Quyết định thuần tuý, test được không cần gateway/storage. */
export function decideCompaction(eventCountSinceSnapshot: number, snapshotAgeMs: number | undefined): CompactionDecision {
  if (eventCountSinceSnapshot > COMPACTION_EVENT_THRESHOLD) {
    return { shouldCompact: true, reason: 'event-count' };
  }
  if (snapshotAgeMs !== undefined && snapshotAgeMs > COMPACTION_MAX_SNAPSHOT_AGE_MS) {
    return { shouldCompact: true, reason: 'snapshot-age' };
  }
  return { shouldCompact: false };
}

/**
 * Đọc event kể từ snapshot hiện tại, quyết định có nén không, và nếu có thì
 * đăng snapshot mới (ghim trước) rồi xoá event đã nén — thứ tự này khớp
 * ADR-0009 "ghim trước, xoá sau" (nằm trong hợp đồng
 * gateway.publishSnapshot: pin rồi mới delete). Trả về true nếu đã nén.
 */
export async function maybeCompact(gateway: SyncGateway, storage: SyncStoragePort, channelId: string): Promise<boolean> {
  const meta = await storage.getSyncMeta();
  const baseMsgId = meta.lastSnapshotMsgId ?? 0;

  const events = await gateway.fetchEventsSince(channelId, baseMsgId);
  const snapshotAgeMs = meta.lastSnapshotAt !== undefined ? Date.now() - meta.lastSnapshotAt : undefined;
  const decision = decideCompaction(events.length, snapshotAgeMs);

  if (!decision.shouldCompact || events.length === 0) {
    return false;
  }

  const state = await storage.getSyncState();
  const highestMsgId = Math.max(baseMsgId, ...events.map((e) => e.msgId));
  const snapshot: SnapshotV1 = { v: 1, state, baseMsgId: highestMsgId };

  const published = await gateway.publishSnapshot(
    channelId,
    snapshot,
    events.map((e) => e.msgId)
  );

  await storage.putSyncMeta({
    lastSnapshotMsgId: published.msgId,
    lastSnapshotAt: Date.now(),
    lastSeenMsgId: published.msgId
  });
  return true;
}
