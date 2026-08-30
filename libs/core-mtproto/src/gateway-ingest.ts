// Upload video cục bộ lên kênh media — CLI `tsmc-ingest` (ADR-0013 mục 1).
// Tách khỏi gateway-index.ts (mối quan tâm khác: TẠO document mới từ file
// trên đĩa của máy admin, không phải đọc/patch metadata của document đã có
// sẵn) nhưng vẫn nằm trong core-mtproto vì CLAUDE.md bất biến #3: chỉ
// package này được import `telegram`. Không type nào của GramJS/`Api.*` rò
// ra ngoài — khớp interface IngestGateway (libs/core-ingest/src/gateway-port.ts).
//
// KHÔNG khai `declare const Buffer` như gateway-download.ts — `sendFile()`
// nhận thẳng đường dẫn file (string), GramJS tự đọc/stream từ đĩa, không cần
// nạp toàn bộ file vào bộ nhớ tiến trình Node trước.
import { Api, type TelegramClient } from 'telegram';

export interface VideoUploadInput {
  filePath: string;
  fileName: string;
  mimeType?: string;
  video: { w: number; h: number; durationSec: number };
  /** Đường dẫn ảnh thumbnail cục bộ (JPEG) — tuỳ chọn, ADR-0013 mục 1 "sinh thumbnail". */
  thumbnailPath?: string;
  caption?: string;
}

export interface UploadedVideoRef {
  msgId: number;
}

export interface SubtitleUploadInput {
  filePath: string;
  /** Tên hiển thị trong Telegram, vd `"Movie.vi.srt"` — khác `filePath` (đường dẫn tmp cục bộ). */
  fileName: string;
}

/**
 * Nhóm RPC upload — cùng quy ước `getClient` (không tự giữ `client`) với
 * gateway-index.ts/gateway-sync.ts: dùng chung đúng một session với
 * gateway.ts, chỉ tồn tại sau login()/restoreSession() thành công.
 */
export function createIngestGatewayMethods(getClient: () => TelegramClient) {
  return {
    /**
     * `forceDocument: false` (mặc định GramJS) — PHẢI để Telegram xử lý như
     * video, không phải file đính kèm thô, để `DocumentAttributeVideo` +
     * `supportsStreaming: true` có tác dụng (khác `publishCatalogDocument()`
     * ở gateway-index.ts, nơi `catalog.v1.json` cố tình ép `forceDocument:
     * true` vì đó là JSON, không phải media). `supportsStreaming: true` +
     * `+faststart` (do CLI remux trước khi gọi tới đây, không phải việc của
     * hàm này) là điều kiện để playback qua HTTP Range (ADR-0005) không phải
     * tải hết file mới phát được khung hình đầu.
     */
    async uploadVideoDocument(channelId: string, input: VideoUploadInput): Promise<UploadedVideoRef> {
      const client = getClient();
      const channel = await client.getEntity(Number(channelId));

      const attributes = [
        new Api.DocumentAttributeVideo({
          w: input.video.w,
          h: input.video.h,
          duration: input.video.durationSec,
          supportsStreaming: true
        }),
        new Api.DocumentAttributeFilename({ fileName: input.fileName })
      ];

      const message = await client.sendFile(channel, {
        file: input.filePath,
        thumb: input.thumbnailPath,
        attributes,
        caption: input.caption,
        forceDocument: false
      });

      return { msgId: message.id };
    },

    /**
     * Phụ đề text (`.srt`) rút bằng `extractSubtitles()` — khác
     * `uploadVideoDocument()`: `forceDocument: true` (đây là file phụ trợ,
     * không phải media cần `DocumentAttributeVideo`/streaming), cùng cách
     * `publishCatalogDocument()` (`gateway-index.ts`) xử lý `catalog.v1.json`.
     * Không gán `caption` — phụ đề không cần mô tả riêng, item trong catalog
     * đã tham chiếu qua `subs[].msgId`.
     */
    async uploadSubtitleDocument(channelId: string, input: SubtitleUploadInput): Promise<UploadedVideoRef> {
      const client = getClient();
      const channel = await client.getEntity(Number(channelId));

      const message = await client.sendFile(channel, {
        file: input.filePath,
        attributes: [new Api.DocumentAttributeFilename({ fileName: input.fileName })],
        forceDocument: true
      });

      return { msgId: message.id };
    }
  };
}
