// Bắt tín hiệu debug toàn cục (F4) — window error/unhandledrejection + trạng
// thái Service Worker — ghi vào debug-log.ts, KHÔNG tự chèn DOM (xem
// debug-log.ts: log giờ hiển thị NGAY TRONG trang play, không phải overlay
// rời có thể bị <video> fullscreen gốc của iOS che mất — phát hiện thật).
import { debugLog, isDebugEnabled } from './debug-log';

/** Gọi một lần lúc bootstrap (main.ts) — tự no-op nếu không có `?debug=1`. */
export function initDebugCapture(): void {
  if (!isDebugEnabled()) {
    return;
  }

  debugLog('debug capture bật (?debug=1)');

  window.addEventListener('error', (event) => {
    debugLog(`window error: ${event.message} @ ${event.filename}:${event.lineno}`);
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    debugLog(`unhandled rejection: ${String(event.reason)}`);
  });

  if (!('serviceWorker' in navigator)) {
    debugLog('navigator.serviceWorker KHÔNG tồn tại trên trình duyệt này (ADR-0005 §Hệ quả).');
    return;
  }

  debugLog(`SW controller lúc tải trang: ${navigator.serviceWorker.controller ? 'CÓ' : 'KHÔNG (bình thường nếu vừa clients.claim() xong, sẽ đổi ngay sau đó)'}`);
  navigator.serviceWorker.ready
    .then((reg) => debugLog(`SW ready — scope=${reg.scope}, active.state=${reg.active ? reg.active.state : 'none'}`))
    .catch((err: unknown) => debugLog(`SW ready lỗi: ${err instanceof Error ? err.message : String(err)}`));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    debugLog('SW controllerchange — tab vừa được (một) SW nhận điều khiển.');
  });
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null || !('type' in data)) {
      return;
    }
    const typed = data as { type: string; correlationId?: string; msgId?: number; offset?: number; limit?: number };
    debugLog(`SW→tab ${typed.type}: msgId=${typed.msgId ?? ''} offset=${typed.offset ?? ''} limit=${typed.limit ?? ''} corr=${typed.correlationId?.slice(0, 8) ?? ''}`);
  });
}
