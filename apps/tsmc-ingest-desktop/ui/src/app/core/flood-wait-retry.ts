import { toIngestRpcError } from './ingest-rpc';

/** `FLOOD_WAIT` không có cách né hợp lệ (CLAUDE.md) — chờ ĐÚNG số giây
 * Telegram yêu cầu rồi tự thử lại `fn()`, lặp tới khi thành công hoặc gặp
 * lỗi KHÁC FloodWait (ném lại cho caller). `onTick(null)` báo hết chờ.
 * Tách ra đây (trước ở `workspace.ts`) khi Trình quản lý catalog trở thành
 * lần dùng thứ hai — tránh hai bản logic đếm ngược lệch nhau theo thời gian. */
export async function withFloodWaitRetry<T>(onTick: (secondsLeft: number | null) => void, fn: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const rpcErr = toIngestRpcError(err);
      if (rpcErr.kind !== 'FloodWait') {
        throw rpcErr;
      }
      await countdown(onTick, rpcErr.detail.seconds);
    }
  }
}

function countdown(onTick: (secondsLeft: number | null) => void, totalSeconds: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = totalSeconds;
    onTick(remaining);
    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(interval);
        onTick(null);
        resolve();
        return;
      }
      onTick(remaining);
    }, 1000);
  });
}
