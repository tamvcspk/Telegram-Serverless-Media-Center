// Download scheduler, DC pool, chunk cache — ADR-0006.
// Chạy trong Core Worker; apps/web KHÔNG được import package này trực tiếp (ADR-0012 §2).
export const LIB_NAME = '@tsmc/core-download' as const;

// Playback (F4) + hardening (AIMD/circuit breaker, ADR-0006 §3/§4). Xem download-engine.ts.
export type { DownloadGateway, PlaybackDocumentRef, FloodWaitTooLongLike } from './gateway-port';
export {
  createDownloadEngine,
  CancelledError,
  DocumentNotFoundError,
  FloodWaitTooLongError,
  SUB_CHUNK_SIZE,
  type DownloadEngine,
  type DownloadEngineOptions
} from './download-engine';
