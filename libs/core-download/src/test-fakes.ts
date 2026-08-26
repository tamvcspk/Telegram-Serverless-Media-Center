// Fake dùng chung cho *.spec.ts trong package này — KHÔNG phải file test
// (không khớp include pattern */src/**/*.spec.ts của libs/vitest.config.ts).
// ADR-0006: "Cần bộ test riêng cho scheduler với một FakeTransport mô phỏng
// độ trễ, FLOOD_WAIT, migrate và reference hết hạn."
import type { DownloadGateway, PlaybackDocumentRef } from './gateway-port';

export function makeRef(overrides: Partial<PlaybackDocumentRef> = {}): PlaybackDocumentRef {
  return { id: '1', accessHash: 'hash', fileReference: 'ref-v1', dcId: 2, size: 2 * 1024 * 1024, mimeType: 'video/mp4', ...overrides };
}

export class FakeFloodWaitTooLongError extends Error {
  constructor(public readonly seconds: number) {
    super(`FLOOD_WAIT ${seconds}s`);
    this.name = 'FloodWaitTooLongError';
  }
}

export class FakeFileReferenceExpiredError extends Error {
  constructor() {
    super('file_reference hết hạn');
    this.name = 'FileReferenceExpiredError';
  }
}

export interface FakeGatewayScript {
  /** file trả về cho getPlaybackDocument — đổi bằng `setRef()` để mô phỏng làm mới sau khi hết hạn. */
  ref: PlaybackDocumentRef;
  /**
   * Kịch bản lỗi theo TỪNG lần gọi fetchFileChunk (0-based) — dùng để mô
   * phỏng "lần đầu ném FileReferenceExpiredError, lần sau (với ref mới)
   * thành công" hay "FLOOD_WAIT vượt ngưỡng". `undefined` = không lỗi.
   */
  errorAtCall?: Map<number, () => Error>;
}

/**
 * Fake tối thiểu: mỗi sub-chunk trả về đúng `limit` byte (giá trị = byte thứ
 * tự trong file, để test dễ assert nội dung ghép đúng thứ tự), trừ chunk
 * cuối cùng (gần `ref.size`) trả NGẮN HƠN để báo hết file — đúng ngữ nghĩa
 * `upload.getFile` thật (xem gateway-download.ts).
 */
export function createFakeDownloadGateway(script: Partial<FakeGatewayScript> = {}): DownloadGateway & { calls: Array<{ offset: number; limit: number }>; setRef(next: PlaybackDocumentRef): void } {
  let ref = script.ref ?? makeRef();
  const errorAtCall = script.errorAtCall ?? new Map<number, () => Error>();
  const calls: Array<{ offset: number; limit: number }> = [];
  let callIndex = 0;

  return {
    calls,
    setRef(next: PlaybackDocumentRef) {
      ref = next;
    },
    async getPlaybackDocument() {
      return ref;
    },
    async fetchFileChunk(currentRef: PlaybackDocumentRef, offset: number, limit: number): Promise<ArrayBuffer> {
      const index = callIndex++;
      calls.push({ offset, limit });
      const makeError = errorAtCall.get(index);
      if (makeError) {
        throw makeError();
      }
      const remaining = Math.max(0, currentRef.size - offset);
      const length = Math.min(limit, remaining);
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        bytes[i] = (offset + i) % 256;
      }
      return bytes.buffer;
    }
  };
}
