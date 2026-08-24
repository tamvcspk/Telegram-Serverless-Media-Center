// Bầu tab leader qua Web Locks (ADR-0004 `tsmc-leader`) + chuyển tiếp ghi từ
// tab không phải leader qua BroadcastChannel (ADR-0007: "Chỉ Core Worker của
// tab leader được ghi" — áp dụng cho MỌI ghi IndexedDB, không riêng sync).
// Nhận locks/BroadcastChannel qua tham số (mặc định lấy từ globalThis) để
// test được bằng fake thuần Node, không cần trình duyệt thật.
//
// Web Locks cấp lock BẤT ĐỒNG BỘ — nếu chỉ `request()` kiểu queue thông
// thường, tab duy nhất/đầu tiên vẫn phải CHỜ (dù không ai tranh chấp) trước
// khi biết mình là leader, và code gọi isLeader() ngay sau khi khởi tạo
// (trường hợp phổ biến nhất: chỉ có một tab) sẽ luôn thấy false. Vì vậy
// dùng hai pha: thử `ifAvailable:true` trước (cấp ngay nếu rảnh, đúng
// trường hợp một tab); nếu không rảnh (tab khác đang giữ), xếp hàng
// `request()` thường ở nền để được cấp SAU khi tab kia đóng — leadership có
// thể chuyển giao muộn, onLeaderChange() báo cho sync-engine.ts biết để
// hydrate() lúc đó, không chỉ lúc khởi tạo.
import type { SyncEventInput } from '@tsmc/shared-models';

export interface LockManagerLike {
  request(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => Promise<void>): Promise<void>;
  request(name: string, callback: () => Promise<void>): Promise<void>;
}

export interface BroadcastMessage {
  input: SyncEventInput;
}

export interface BroadcastChannelLike {
  postMessage(data: BroadcastMessage): void;
  addEventListener(type: 'message', listener: (ev: { data: BroadcastMessage }) => void): void;
  close(): void;
}

export interface LeaderControllerOptions {
  lockName?: string;
  channelName?: string;
  /** `false` = ép buộc coi như môi trường không có Web Locks (test); bỏ
   * qua (undefined) = tự dò `navigator.locks` — LƯU Ý: Node 22+ đã có sẵn
   * một `navigator.locks` thật (không phải trình duyệt), nên test muốn mô
   * phỏng "không có Web Locks" phải dùng `false`, không phải `undefined`. */
  locks?: LockManagerLike | false;
  createBroadcastChannel?: (name: string) => BroadcastChannelLike;
}

export interface LeaderController {
  isLeader(): boolean;
  /** Gọi handler mỗi khi trạng thái leader đổi — kể cả lần đầu trở thành
   * leader (có thể xảy ra ngay lúc khởi tạo HOẶC muộn hơn, khi tab đang giữ
   * lock đóng). sync-engine.ts dùng để biết KHI NÀO nên hydrate(). */
  onLeaderChange(handler: (isLeader: boolean) => void): void;
  /** Chỉ leader nên gọi — đăng ký nơi nhận các mutate() bị chuyển tiếp từ tab khác. */
  onForwardedMutation(handler: (input: SyncEventInput) => void): void;
  /** Non-leader gọi để chuyển tiếp một mutate() sang tab leader — leader tự
   * gán ts/dev lúc ghi, nên chỉ cần gửi phần input thô. */
  forwardMutation(input: SyncEventInput): void;
  stop(): void;
}

function defaultLocks(): LockManagerLike | undefined {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
  return nav?.locks;
}

function defaultCreateBroadcastChannel(): ((name: string) => BroadcastChannelLike) | undefined {
  const Ctor = (globalThis as { BroadcastChannel?: new (name: string) => BroadcastChannelLike }).BroadcastChannel;
  return Ctor ? (name: string) => new Ctor(name) : undefined;
}

export function createLeaderController(options: LeaderControllerOptions = {}): LeaderController {
  const lockName = options.lockName ?? 'tsmc-leader';
  const channelName = options.channelName ?? 'tsmc-sync-writes';
  const locks = options.locks === false ? undefined : (options.locks ?? defaultLocks());
  const createChannel = options.createBroadcastChannel ?? defaultCreateBroadcastChannel();

  let leader = false;
  let forwardedHandler: ((input: SyncEventInput) => void) | undefined;
  let leaderChangeHandler: ((isLeader: boolean) => void) | undefined;
  let releaseLock: (() => void) | undefined;
  const channel = createChannel?.(channelName);

  channel?.addEventListener('message', (ev) => {
    if (leader) {
      forwardedHandler?.(ev.data.input);
    }
  });

  function becomeLeader(): Promise<void> {
    leader = true;
    leaderChangeHandler?.(true);
    return new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
  }

  if (locks) {
    void locks.request(lockName, { ifAvailable: true }, async (lock) => {
      if (lock) {
        await becomeLeader();
        return;
      }
      // Tab khác đang giữ lock — xếp hàng ở nền, không chặn init() của tab
      // này. Nếu tab kia đóng, request() thường sẽ được cấp và ta trở
      // thành leader muộn — onLeaderChange() báo lại lúc đó.
      void locks.request(lockName, becomeLeader);
    });
  } else {
    // Không có Web Locks (ví dụ test thuần Node không inject fake) — coi
    // đây là tab duy nhất, an toàn hơn là không bao giờ ghi được gì.
    leader = true;
  }

  return {
    isLeader: () => leader,
    onLeaderChange(handler) {
      leaderChangeHandler = handler;
      if (leader) {
        handler(true);
      }
    },
    onForwardedMutation(handler) {
      forwardedHandler = handler;
    },
    forwardMutation(input) {
      channel?.postMessage({ input });
    },
    stop() {
      releaseLock?.();
      channel?.close();
    }
  };
}
