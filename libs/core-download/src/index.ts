// Download scheduler, DC pool, chunk cache — ADR-0006.
// Chạy trong Core Worker; apps/web KHÔNG được import package này trực tiếp (ADR-0012 §2).
export const LIB_NAME = '@tsmc/core-download' as const;

// Slice Playback (F4) — vertical slice tối thiểu: 1 sub-chunk/lần, không
// AIMD/đa kết nối (chờ SPIKE-04). Xem download-engine.ts.
export type { DownloadGateway, PlaybackDocumentRef, FloodWaitTooLongLike } from './gateway-port';
export { createDownloadEngine, CancelledError, DocumentNotFoundError, SUB_CHUNK_SIZE, type DownloadEngine } from './download-engine';
