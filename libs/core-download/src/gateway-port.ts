// Cổng hẹp mà core-download cần từ core-mtproto — KHÔNG import
// @tsmc/core-mtproto trực tiếp (CLAUDE.md bất biến #3: chỉ core-mtproto
// được import `telegram`). worker-host/core-worker.ts nối một implementation
// thật (createTelegramGateway(), ADR-0005/0006) vào interface này; test
// trong core-download chỉ cần một fake khớp shape (test-fakes.ts), không
// cần mock 'telegram'.
//
// `PlaybackDocumentRef` là type riêng của port này — KHÔNG đưa lên
// @tsmc/shared-models, cùng quy ước với core-index/gateway-port.ts.

export interface PlaybackDocumentRef {
  id: string;
  accessHash: string;
  /** Base64 — file_reference đổi theo thời gian, KHÔNG dùng làm cache key ổn định (xem ADR-0005 §Cache chunk). */
  fileReference: string;
  dcId: number;
  size: number;
  mimeType: string;
}

/** Ném khi FLOOD_WAIT vượt ngưỡng tự chờ (ADR-0006 §4) — tầng trên (Core Worker RPC) phải để lỗi này nổi nguyên văn cho UI, không nuốt. */
export interface FloodWaitTooLongLike extends Error {
  seconds: number;
}

export interface DownloadGateway {
  getPlaybackDocument(channelId: string, msgId: number): Promise<PlaybackDocumentRef | null>;
  /** Tải một sub-chunk ĐÃ ALIGNED (bội số 4096, không vắt ranh giới 1 MB — xem architecture.md §C3). Không tự windowing. */
  fetchFileChunk(ref: PlaybackDocumentRef, offset: number, limit: number): Promise<ArrayBuffer>;
}
