import { createCoreWorkerClient } from '@tsmc/worker-host';
import type {
  StreamChunkRequestMessage,
  StreamChunkCancelMessage,
  StreamChunkResponseMessage,
  StreamInfoRequestMessage,
  StreamInfoResponseMessage
} from '@tsmc/shared-models';
import { debugLog, isDebugEnabled } from '../debug/debug-log';
import { describeTopLevelBoxes } from '../debug/mp4-sniff';
import { reportFloodWait } from './flood-wait-notice';

function isStreamChunkRequest(data: unknown): data is StreamChunkRequestMessage {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'tsmc-stream-chunk-request';
}

function isStreamChunkCancel(data: unknown): data is StreamChunkCancelMessage {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'tsmc-stream-chunk-cancel';
}

function isStreamInfoRequest(data: unknown): data is StreamInfoRequestMessage {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'tsmc-stream-info-request';
}

/**
 * Chuyển tiếp request tải chunk từ Service Worker sang Core Worker —
 * ADR-0004 §3: SW không bao giờ tự mở kết nối MTProto, phải hỏi Core Worker
 * (nơi giữ instance GramJS duy nhất) qua MessageChannel bắc cầu qua main
 * thread này. Gọi ĐÚNG MỘT LẦN lúc bootstrap (từ main.ts) — không phải
 * APP_INITIALIZER, không cần chờ Angular khởi động xong mới lắng nghe.
 *
 * `createCoreWorkerClient()` là singleton cấp module (worker-host/index.ts)
 * — gọi lại ở đây KHÔNG tạo Core Worker thứ hai, chỉ lấy lại cùng một
 * instance mà Login/component khác cũng đang dùng (bài học ADR-0004 addendum
 * về singleton, xem core-worker.ts).
 */
export function initStreamBridge(): void {
  if (!('serviceWorker' in navigator)) {
    // Firefox Private Mode / trình duyệt không hỗ trợ SW — ADR-0005 §Hệ quả:
    // chấp nhận, fallback A (tải cả file) thuộc phạm vi slice sau.
    return;
  }

  navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
    console.error('Không đăng ký được Service Worker — streaming sẽ không hoạt động:', err);
  });

  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data: unknown = event.data;

    if (isStreamChunkCancel(data)) {
      createCoreWorkerClient().cancelChunk(data.correlationId);
      return;
    }

    const port = event.ports[0];

    if (isStreamInfoRequest(data) && port) {
      createCoreWorkerClient()
        .getStreamInfo(data.sourceId, data.msgId)
        .then(({ size, mimeType }: { size: number; mimeType: string }) => {
          debugLog(`getStreamInfo OK msgId=${data.msgId} size=${size} mimeType=${mimeType}`);
          const response: StreamInfoResponseMessage = { ok: true, size, mimeType };
          port.postMessage(response);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Lỗi không xác định khi lấy thông tin file.';
          debugLog(`getStreamInfo ERROR msgId=${data.msgId}: ${message}`);
          const response: StreamInfoResponseMessage = { ok: false, error: message };
          port.postMessage(response);
        });
      return;
    }

    if (!isStreamChunkRequest(data) || !port) {
      return;
    }

    createCoreWorkerClient()
      .fetchChunk(data.sourceId, data.msgId, data.offset, data.limit, data.correlationId)
      .then((buffer: ArrayBuffer) => {
        debugLog(`fetchChunk OK msgId=${data.msgId} offset=${data.offset} got=${buffer.byteLength}B corr=${data.correlationId.slice(0, 8)}`);
        // Chẩn đoán "thiếu +faststart" (SPIKE-01) — CHỈ quét box của cửa sổ
        // ĐẦU file (offset 0), và CHỈ khi debug: cần đọc buffer TRƯỚC khi
        // transfer (postMessage kèm transfer list sẽ detach nó ngay sau đây).
        if (data.offset === 0 && isDebugEnabled()) {
          debugLog(`mp4 top-level boxes (1MB đầu): ${describeTopLevelBoxes(buffer)}`);
        }
        const response: StreamChunkResponseMessage = { ok: true, buffer };
        port.postMessage(response, [buffer]);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Lỗi không xác định khi tải chunk.';
        debugLog(`fetchChunk ERROR msgId=${data.msgId} offset=${data.offset} corr=${data.correlationId.slice(0, 8)}: ${message}`);
        // `.name` sống sót qua Comlink (transferHandler throw của comlink@4
        // copy message/name/stack, xem node_modules/comlink) — `.seconds`
        // riêng của FloodWaitTooLongError thì KHÔNG, nhưng message đã là câu
        // hoàn chỉnh cho user (download-engine.ts), không cần số giây riêng.
        if (err instanceof Error && err.name === 'FloodWaitTooLongError') {
          reportFloodWait(message);
        }
        const response: StreamChunkResponseMessage = { ok: false, error: message };
        port.postMessage(response);
      });
  });
}
