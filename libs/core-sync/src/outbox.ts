// Đường ghi optimistic + flush theo lô — ADR-0009 "Đường ghi". Ghi cục bộ
// TRƯỚC (state + outbox), UI thấy ngay; một tiến trình nền gộp lô đẩy lên
// kênh state mỗi 10s hoặc khi bị gọi forceFlush() (visibilitychange→hidden,
// forward từ main thread — Worker không có `document`).
import type { SyncEvent, SyncEventInput } from '@tsmc/shared-models';
import type { SyncGateway } from './gateway-port';
import { applyEvent } from './reducer';
import type { SyncStoragePort } from './storage-port';
import type { LeaderController } from './leader';

export interface OutboxController {
  mutate(input: SyncEventInput): Promise<void>;
  forceFlush(): Promise<void>;
  startAutoFlush(intervalMs?: number): void;
  stopAutoFlush(): void;
}

export interface OutboxDeps {
  gateway: SyncGateway;
  storage: SyncStoragePort;
  leader: LeaderController;
  deviceId: string;
  /** undefined khi chưa hydrate xong (chưa biết kênh state) — flush là no-op. */
  getChannelId: () => string | undefined;
}

const DEFAULT_FLUSH_INTERVAL_MS = 10_000;

export function createOutboxController(deps: OutboxDeps): OutboxController {
  const { gateway, storage, leader, deviceId, getChannelId } = deps;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function persistLocally(input: SyncEventInput): Promise<void> {
    const event = { ...input, v: 1, ts: gateway.serverNow(), dev: deviceId } as SyncEvent;
    const state = await storage.getSyncState();
    await storage.putSyncState(applyEvent(state, event));
    await storage.appendOutbox(event);
  }

  // Chỉ leader gọi persistLocally — hoặc trực tiếp từ mutate() của chính
  // nó, hoặc gián tiếp từ tab khác chuyển tiếp qua BroadcastChannel.
  leader.onForwardedMutation((input) => {
    void persistLocally(input);
  });

  async function mutate(input: SyncEventInput): Promise<void> {
    if (!leader.isLeader()) {
      leader.forwardMutation(input);
      return;
    }
    await persistLocally(input);
  }

  async function forceFlush(): Promise<void> {
    if (!leader.isLeader()) {
      return;
    }
    const channelId = getChannelId();
    if (!channelId) {
      return;
    }
    const pending = await storage.listOutbox();
    if (pending.length === 0) {
      return;
    }

    const sentLocalIds: number[] = [];
    try {
      for (const entry of pending) {
        await gateway.sendEvent(channelId, entry.event);
        sentLocalIds.push(entry.localId);
      }
    } finally {
      if (sentLocalIds.length > 0) {
        await storage.removeOutbox(sentLocalIds);
      }
    }

    await storage.putSyncMeta({ lastSyncAt: Date.now(), lastError: undefined });
  }

  function startAutoFlush(intervalMs = DEFAULT_FLUSH_INTERVAL_MS): void {
    stopAutoFlush();
    timer = setInterval(() => {
      forceFlush().catch((err: unknown) => {
        void storage.putSyncMeta({ lastError: err instanceof Error ? err.message : String(err) });
      });
    }, intervalMs);
  }

  function stopAutoFlush(): void {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  return { mutate, forceFlush, startAutoFlush, stopAutoFlush };
}
