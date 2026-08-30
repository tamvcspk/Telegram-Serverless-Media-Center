// Cổng hẹp mà core-ingest cần từ core-mtproto — KHÔNG import @tsmc/core-mtproto
// trực tiếp (CLAUDE.md bất biến #3: chỉ core-mtproto được import `telegram`).
// apps/tsmc-ingest nối một implementation thật (createTelegramGateway(), mở
// rộng bằng gateway-ingest.ts) vào interface này; test trong core-ingest chỉ
// cần một fake khớp shape, không cần mock 'telegram' — cùng quy ước với
// libs/core-index/src/gateway-port.ts.

export interface IngestResolvedChannel {
  id: string;
  title: string;
  /** `creator === true` — ADR-0014 §4: chỉ Kho Cá Nhân (kênh do chính admin tạo) mới ghi được. */
  isOwn: boolean;
}

export interface IngestPinnedCatalog {
  msgId: number;
  raw: string;
}

export interface IngestVideoUploadInput {
  filePath: string;
  fileName: string;
  mimeType?: string;
  video: { w: number; h: number; durationSec: number };
  /** Ảnh thumbnail cục bộ (JPEG) — ADR-0013 mục 1 "sinh thumbnail". */
  thumbnailPath?: string;
  caption?: string;
}

export interface IngestSubtitleUploadInput {
  filePath: string;
  fileName: string;
}

export interface IngestGateway {
  resolveIndexChannel(ref: string): Promise<IngestResolvedChannel | null>;
  getPinnedCatalogDocument(channelId: string): Promise<IngestPinnedCatalog | null>;
  /** Upload MỘT file video cục bộ thành document mới — việc thật sự mới của CLI (libs/core-mtproto/src/gateway-ingest.ts). */
  uploadVideoDocument(channelId: string, input: IngestVideoUploadInput): Promise<{ msgId: number }>;
  /** Upload MỘT file phụ đề text (`.srt`) cục bộ thành document rời — `subs[].msgId` trong catalog trỏ tới đây. */
  uploadSubtitleDocument(channelId: string, input: IngestSubtitleUploadInput): Promise<{ msgId: number }>;
  /** Đã có sẵn từ slice Ingest Editor (libs/core-mtproto/src/gateway-index.ts) — CLI tái dùng nguyên vẹn, không sửa. */
  publishCatalogDocument(channelId: string, json: string, previousMsgId?: number): Promise<{ msgId: number }>;
}
