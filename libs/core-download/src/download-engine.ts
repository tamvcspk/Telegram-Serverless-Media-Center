// Scheduler tải chunk cho slice Playback (F4) — ADR-0005/0006, phần "vertical
// slice tối thiểu": MỘT sub-chunk tại một thời điểm (không AIMD/đa kết nối,
// chờ SPIKE-04 đo số liệu thật trước khi mở rộng). Node-testable (không đụng
// Cache Storage/ReadableStream — đó là việc của sw/sw.ts) — xem test-fakes.ts.
import type { DownloadGateway, PlaybackDocumentRef } from './gateway-port';

/**
 * 512 KB — bội số 4096 VÀ ước của 1 MB (`architecture.md` §C3: ràng buộc
 * `upload.getFile`). Luôn dùng ĐÚNG giá trị này cho mọi sub-chunk (kể cả gần
 * cuối file) — Telegram trả buffer NGẮN HƠN `limit` để báo hết file, không
 * co `limit` lại theo dung lượng còn thiếu (`limit` phải luôn là một giá trị
 * hợp lệ, không phải "phần còn lại").
 *
 * Bất biến của module này: mọi `offset` truyền vào `fetchWindow` PHẢI là bội
 * số của hằng số này (do sw/sw.ts chọn cửa sổ theo đúng lưới — xem ADR-0005
 * §"Đường đi của một byte": "chuẩn hoá offset về lưới 1 MB / 512 KB").
 * Không validate lại ở đây — đây là hợp đồng NỘI BỘ giữa sw.ts và Core
 * Worker (cả hai phía đều do repo này viết), không phải biên với input
 * ngoài tầm kiểm soát.
 */
export const SUB_CHUNK_SIZE = 512 * 1024;

export class CancelledError extends Error {
  constructor() {
    super('Yêu cầu tải đã bị huỷ.');
    this.name = 'CancelledError';
  }
}

export class DocumentNotFoundError extends Error {
  constructor() {
    super('Không tìm thấy document cho message này (có thể đã bị xoá, hoặc không phải file video).');
    this.name = 'DocumentNotFoundError';
  }
}

function isFileReferenceExpired(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as Error).name === 'FileReferenceExpiredError';
}

export interface DownloadEngine {
  /**
   * Trả về đúng `min(windowSize, size - offset)` byte bắt đầu từ `offset`.
   * Bên trong lặp fetch sub-chunk `SUB_CHUNK_SIZE` cho tới khi đủ cửa sổ
   * hoặc hết file; tự làm mới `file_reference` một lần nếu gateway báo hết
   * hạn (ADR-0006 §5 — "không phải lỗi", phải trong suốt với tầng gọi).
   *
   * Huỷ (`cancel(correlationId)`) chỉ chặn round-trip TIẾP THEO — round-trip
   * đang bay lúc gọi cancel() vẫn hoàn tất bình thường (giới hạn đã biết của
   * slice tối thiểu này, xem plan đóng slice).
   */
  fetchWindow(channelId: string, msgId: number, offset: number, windowSize: number, correlationId: string): Promise<ArrayBuffer>;
  cancel(correlationId: string): void;
  /**
   * `size`/`mimeType` THẬT từ Telegram (không phải catalog cục bộ — catalog-
   * spec.md không lưu mimeType gốc, xem sw/sw.ts). Phát hiện thật: hardcode
   * Content-Type 'video/mp4' làm trình duyệt từ chối phát (`MEDIA_ERR_SRC_NOT_SUPPORTED`)
   * với file không phải mp4 (mkv/avi cộng đồng rất phổ biến) dù tải bytes
   * đúng. Dùng CHUNG cache `PlaybackDocumentRef` với fetchWindow (không resolve 2 lần).
   */
  getInfo(channelId: string, msgId: number): Promise<{ size: number; mimeType: string }>;
}

const CANCELLED_SET_CAP = 256;

export function createDownloadEngine(gateway: DownloadGateway): DownloadEngine {
  const refCache = new Map<string, PlaybackDocumentRef>();
  const cancelled = new Set<string>();

  function cacheKey(channelId: string, msgId: number): string {
    return `${channelId}:${msgId}`;
  }

  async function resolveRef(channelId: string, msgId: number, forceRefresh: boolean): Promise<PlaybackDocumentRef> {
    const key = cacheKey(channelId, msgId);
    if (!forceRefresh) {
      const cached = refCache.get(key);
      if (cached) {
        return cached;
      }
    }
    const fresh = await gateway.getPlaybackDocument(channelId, msgId);
    if (!fresh) {
      throw new DocumentNotFoundError();
    }
    refCache.set(key, fresh);
    return fresh;
  }

  function checkCancelled(correlationId: string): void {
    if (cancelled.has(correlationId)) {
      throw new CancelledError();
    }
  }

  return {
    async fetchWindow(channelId, msgId, offset, windowSize, correlationId) {
      checkCancelled(correlationId);
      let ref = await resolveRef(channelId, msgId, false);

      const end = Math.min(offset + windowSize, ref.size);
      const parts: Uint8Array[] = [];
      let cursor = offset;
      let refreshedOnce = false;

      while (cursor < end) {
        checkCancelled(correlationId);
        try {
          const buf = await gateway.fetchFileChunk(ref, cursor, SUB_CHUNK_SIZE);
          const bytes = new Uint8Array(buf);
          parts.push(bytes);
          cursor += SUB_CHUNK_SIZE;
          if (bytes.length < SUB_CHUNK_SIZE) {
            break;
          }
        } catch (err) {
          if (!refreshedOnce && isFileReferenceExpired(err)) {
            refreshedOnce = true;
            ref = await resolveRef(channelId, msgId, true);
            continue;
          }
          throw err;
        }
      }

      checkCancelled(correlationId);

      const total = parts.reduce((sum, part) => sum + part.length, 0);
      const capped = Math.min(total, end - offset);
      const merged = new Uint8Array(capped);
      let writeOffset = 0;
      for (const part of parts) {
        if (writeOffset >= capped) {
          break;
        }
        const take = Math.min(part.length, capped - writeOffset);
        merged.set(take === part.length ? part : part.subarray(0, take), writeOffset);
        writeOffset += take;
      }
      return merged.buffer;
    },

    cancel(correlationId) {
      cancelled.add(correlationId);
      if (cancelled.size > CANCELLED_SET_CAP) {
        const oldest = cancelled.values().next().value;
        if (oldest !== undefined) {
          cancelled.delete(oldest);
        }
      }
    },

    async getInfo(channelId, msgId) {
      const ref = await resolveRef(channelId, msgId, false);
      return { size: ref.size, mimeType: ref.mimeType };
    }
  };
}
