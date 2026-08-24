// Mặt tiền công khai của slice Sync & Hydration (F1.2/F1.3) — nối
// hydrate/outbox/compaction/leader lại với nhau. worker-host/core-worker.ts
// là nơi DUY NHẤT gọi createSyncEngine() với gateway/storage thật.
import type { StateChannelResolutionCallbacks, SyncEventInput, SyncState } from '@tsmc/shared-models';
import { ensureDeviceId } from './device-id';
import type { SyncGateway } from './gateway-port';
import { hydrate } from './hydrate';
import { createLeaderController, type LeaderController } from './leader';
import { createOutboxController, type OutboxController } from './outbox';
import { maybeCompact } from './compaction';
import type { SyncStoragePort } from './storage-port';

const AUTO_FLUSH_INTERVAL_MS = 10_000;
const COMPACTION_CHECK_INTERVAL_MS = 60_000;
// Web Locks cấp lock bất đồng bộ — ifAvailable:true trả lời gần như ngay
// (vài microtask) khi không tranh chấp. 500ms đủ rộng để không nhầm "chưa
// kịp trả lời" thành "tab khác đang giữ lock", nhưng đủ hẹp để init() không
// treo lâu khi thực sự có tranh chấp (trường hợp đó CHỜ vô thời hạn mới là
// sai — tab kia có thể mở hàng giờ).
const LEADER_DECISION_TIMEOUT_MS = 500;

export interface SyncStatus {
  isLeader: boolean;
  stateChannelId?: string;
  pendingOutboxCount: number;
  lastSyncAt?: number;
  lastError?: string;
}

export interface SyncEngine {
  /** Dò/tạo kênh state + hydrate. Idempotent theo nghĩa gọi lại chỉ hydrate lại. */
  init(callbacks: StateChannelResolutionCallbacks): Promise<SyncState>;
  mutate(input: SyncEventInput): Promise<void>;
  forceFlush(): Promise<void>;
  getStatus(): Promise<SyncStatus>;
  stop(): void;
}

export interface SyncEngineOptions {
  leader?: LeaderController;
  /** Test hook — mặc định LEADER_DECISION_TIMEOUT_MS. */
  leaderDecisionTimeoutMs?: number;
}

export function createSyncEngine(gateway: SyncGateway, storage: SyncStoragePort, options: SyncEngineOptions = {}): SyncEngine {
  const leader = options.leader ?? createLeaderController();
  const leaderDecisionTimeoutMs = options.leaderDecisionTimeoutMs ?? LEADER_DECISION_TIMEOUT_MS;
  let channelId: string | undefined;
  let outbox: OutboxController | undefined;
  let compactionTimer: ReturnType<typeof setInterval> | undefined;

  function stopCompactionLoop(): void {
    if (compactionTimer !== undefined) {
      clearInterval(compactionTimer);
      compactionTimer = undefined;
    }
  }

  function startCompactionLoop(): void {
    stopCompactionLoop();
    compactionTimer = setInterval(() => {
      if (leader.isLeader() && channelId) {
        void maybeCompact(gateway, storage, channelId).catch((err: unknown) => {
          void storage.putSyncMeta({ lastError: err instanceof Error ? err.message : String(err) });
        });
      }
    }, COMPACTION_CHECK_INTERVAL_MS);
  }

  async function init(callbacks: StateChannelResolutionCallbacks): Promise<SyncState> {
    const deviceId = await ensureDeviceId(storage);
    outbox = createOutboxController({ gateway, storage, leader, deviceId, getChannelId: () => channelId });

    async function hydrateAsLeader(): Promise<SyncState> {
      try {
        const result = await hydrate(gateway, storage, callbacks);
        channelId = result.channel.channelId;
        outbox?.startAutoFlush(AUTO_FLUSH_INTERVAL_MS);
        startCompactionLoop();
        return result.state;
      } catch (err) {
        await storage.putSyncMeta({ lastError: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    }

    let hydratedOnce = false;
    // Đăng ký NGAY (không chỉ trong nhánh "đã là leader") — nếu tab này
    // được thăng làm leader MUỘN (tab đang giữ lock đóng), tự hydrate lúc
    // đó dù init() đã trả kết quả từ lâu; UI thấy state mới qua liveQuery.
    const becameLeader = new Promise<SyncState>((resolve, reject) => {
      leader.onLeaderChange((isLeader) => {
        if (!isLeader || hydratedOnce) {
          return;
        }
        hydratedOnce = true;
        hydrateAsLeader().then(resolve, reject);
      });
    });

    // becameLeader có thể reject SAU KHI notLeaderYet đã thắng race (hydrate
    // lỗi lúc thăng leader muộn) — đã ghi lastError ở trên, chỉ cần tránh
    // unhandled rejection ở đây, không cần xử lý gì thêm.
    becameLeader.catch(() => {});

    const notLeaderYet = new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), leaderDecisionTimeoutMs);
    });

    const winner = await Promise.race([becameLeader, notLeaderYet]);
    if (winner !== undefined) {
      return winner;
    }
    // Không tranh được leadership trong thời gian chờ ngắn — tab khác đang
    // giữ. KHÔNG chặn caller vô thời hạn; trả state cục bộ hiện có (đã được
    // tab leader trước đó ghi vào cùng IndexedDB — ADR-0007). mutate() vẫn
    // hoạt động qua forward; becameLeader vẫn chạy nền chờ lượt.
    return storage.getSyncState();
  }

  return {
    init,
    async mutate(input) {
      if (!outbox) {
        throw new Error('SyncEngine.mutate() gọi trước init()');
      }
      await outbox.mutate(input);
    },
    async forceFlush() {
      await outbox?.forceFlush();
    },
    async getStatus() {
      const meta = await storage.getSyncMeta();
      return {
        isLeader: leader.isLeader(),
        stateChannelId: meta.stateChannelId,
        pendingOutboxCount: await storage.countOutbox(),
        lastSyncAt: meta.lastSyncAt,
        lastError: meta.lastError
      };
    },
    stop() {
      outbox?.stopAutoFlush();
      stopCompactionLoop();
      leader.stop();
    }
  };
}
