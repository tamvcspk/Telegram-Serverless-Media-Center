// Giao thức message xuyên 3 ngữ cảnh cho slice Playback (F4, ADR-0004/0005):
// Service Worker (không mở kết nối MTProto) → main thread (stream-bridge.ts,
// chỉ chuyển tiếp) → Core Worker (tải chunk thật qua @tsmc/core-mtproto).
// Đặt ở đây (không phải core-download/core-mtproto) vì đây là type dùng
// chung giữa `sw/` và `apps/web`, không phải type riêng của một gateway-port
// nào — khác PlaybackDocumentRef (ở lại trong core-mtproto/core-download,
// cùng quy ước "không đưa type riêng của port lên shared-models" đã ghi ở
// core-index/gateway-port.ts).
//
// Mọi message có `correlationId` — bắt buộc theo CLAUDE.md ("debug xuyên 3
// ngữ cảnh không có nó là bất khả thi").
export interface StreamChunkRequestMessage {
  type: 'tsmc-stream-chunk-request';
  correlationId: string;
  sourceId: string;
  msgId: number;
  offset: number;
  limit: number;
}

export interface StreamChunkCancelMessage {
  type: 'tsmc-stream-chunk-cancel';
  correlationId: string;
}

/** Trả qua MessagePort riêng của request đó — không cần `type` (port chỉ phục vụ đúng một request). */
export type StreamChunkResponseMessage = { ok: true; buffer: ArrayBuffer } | { ok: false; error: string };

/**
 * `size`/`mimeType` THẬT từ Telegram (không phải catalog cục bộ — catalog-
 * spec.md không lưu mimeType gốc của document, xem sw/sw.ts). SW gọi trước
 * khi trả 200 (HEAD/no-Range) hoặc 206 (Range) — cần cho Content-Length
 * đúng và Content-Type đúng container thật (mp4/mkv/webm/...), tránh trình
 * duyệt từ chối phát dù bytes tải đúng (`MEDIA_ERR_SRC_NOT_SUPPORTED`).
 */
export interface StreamInfoRequestMessage {
  type: 'tsmc-stream-info-request';
  correlationId: string;
  sourceId: string;
  msgId: number;
}

export type StreamInfoResponseMessage = { ok: true; size: number; mimeType: string } | { ok: false; error: string };
