// Tải chunk cho slice Playback (F4) — ADR-0005/0006. Tách khỏi gateway.ts/
// gateway-sync.ts/gateway-index.ts (mối quan tâm khác: đọc BYTE nhị phân của
// một document đã biết, không phải state riêng tư hay metadata catalog)
// nhưng vẫn nằm trong core-mtproto vì CLAUDE.md bất biến #3: chỉ package
// này được import `telegram`. `PlaybackDocumentRef` là DTO thuần (không
// `Api.*` rò ra ngoài) — cố ý KHÔNG đưa type này lên @tsmc/shared-models,
// cùng quy ước "type riêng của port ở lại cạnh gateway" đã ghi trong
// core-index/gateway-port.ts.
import bigInt from 'big-integer';
import { Api, errors, helpers, type TelegramClient } from 'telegram';

/** Ngưỡng ADR-0006 §4: FLOOD_WAIT ≤ ngưỡng này thì tự chờ, quá thì báo UI thay vì âm thầm treo. */
const FLOOD_WAIT_AUTOSLEEP_THRESHOLD_SECONDS = 60;

/**
 * Khai type TỐI THIỂU cho `Buffer` — KHÔNG kéo @types/node vào compile graph
 * (ADR-0012 §2: project này có thể xuyên tới apps/web qua CoreWorkerApi).
 * Đây là AMBIENT DECLARE (không sinh mã runtime, chỉ cho TS biết hình dạng),
 * scope theo MODULE này (file có import/export) nên không rò ra file khác.
 *
 * Ở JS đầu ra, đây vẫn là identifier tự do `Buffer` — ĐÚNG thứ mà
 * `esbuild-plugin-polyfill-node` (libs/worker-host/build.mjs, đã bật
 * `globals.buffer: true`) tự động `inject` import thật từ package `buffer`.
 * Phát hiện thật (CastError trên Windows khi phát video): lúc đầu tưởng
 * lấy qua `globalThis.Buffer` là đủ — SAI, plugin này không gán
 * `globalThis.Buffer`, nó chỉ inject import cho identifier TỰ DO `Buffer`
 * xuất hiện literal trong source. Phải viết đúng identifier `Buffer` (như
 * dưới đây) thì esbuild mới thay bằng CÙNG MỘT instance Buffer mà GramJS tự
 * dùng nội bộ — chỉ Buffer THẬT đó mới qua được `Buffer.isBuffer()` mà TL
 * serializer của GramJS tự kiểm tra khi dựng `InputDocumentFileLocation`.
 */
declare const Buffer: { from(input: Uint8Array): Uint8Array };

export interface PlaybackDocumentRef {
  id: string;
  accessHash: string;
  /** Base64 — `Api.Document.fileReference` là Buffer, không rò kiểu GramJS ra ngoài package này. */
  fileReference: string;
  dcId: number;
  size: number;
  mimeType: string;
}

/** FLOOD_WAIT vượt ngưỡng tự chờ — ADR-0006 §4: phải hiện cho user, không retry ngầm. */
export class FloodWaitTooLongError extends Error {
  constructor(public readonly seconds: number) {
    super(`Telegram đang giới hạn tốc độ, thử lại sau ${seconds} giây.`);
    this.name = 'FloodWaitTooLongError';
  }
}

/**
 * `file_reference` đã hết hạn/bị Telegram từ chối — ADR-0006 §5: "không
 * phải lỗi" mà là đường đi bình thường. Method này KHÔNG tự làm mới (không
 * giữ channelId/msgId gốc) — tầng gọi (core-download/download-engine.ts,
 * nơi giữ cache PlaybackDocumentRef theo channelId+msgId) bắt lỗi này, gọi
 * lại getPlaybackDocument() lấy reference mới, rồi retry.
 */
export class FileReferenceExpiredError extends Error {
  constructor() {
    super('file_reference đã hết hạn, cần làm mới từ message gốc.');
    this.name = 'FileReferenceExpiredError';
  }
}

/** SPIKE-02: 0/250 lần gặp CDN_REDIRECT trên số liệu thật — chấp nhận rủi ro, chưa xây hỗ trợ CDN. */
export class CdnNotSupportedError extends Error {
  constructor() {
    super('File này được Telegram chuyển hướng qua CDN — chưa hỗ trợ trong slice này.');
    this.name = 'CdnNotSupportedError';
  }
}

function isFileReferenceError(err: unknown): boolean {
  const message = typeof err === 'object' && err !== null ? (err as { errorMessage?: unknown }).errorMessage : undefined;
  return typeof message === 'string' && (message.startsWith('FILE_REFERENCE') || message === 'FILEREF_UPGRADE_NEEDED');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Trả về Buffer THẬT (xem comment `declare const Buffer` phía trên) — bắt buộc cho field `fileReference`, không phải Uint8Array thường. */
function base64ToRuntimeBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return Buffer.from(bytes);
}

function toDocumentRef(document: Api.Document): PlaybackDocumentRef {
  return {
    id: document.id.toString(),
    accessHash: document.accessHash.toString(),
    fileReference: bytesToBase64(new Uint8Array(document.fileReference)),
    dcId: document.dcId,
    size: document.size.toJSNumber(),
    mimeType: document.mimeType
  };
}

/**
 * Nhóm RPC lấy document + tải chunk cho playback — nhận `getClient` thay vì
 * tự giữ `client`, cùng quy ước với gateway-sync.ts/gateway-index.ts.
 */
export function createDownloadGatewayMethods(getClient: () => TelegramClient) {
  // Cache entity riêng của nhóm này — KHÔNG dùng chung channelCache của
  // gateway-index.ts (kênh khác mối quan tâm, cùng lý do tách cache đã ghi
  // ở đó: "không có lý do dùng chung").
  const channelCache = new Map<string, Api.Channel>();

  async function resolveChannelEntity(channelId: string): Promise<Api.Channel> {
    const cached = channelCache.get(channelId);
    if (cached) {
      return cached;
    }
    const entity = await getClient().getEntity(Number(channelId));
    if (!(entity instanceof Api.Channel)) {
      throw new Error(`Entity ${channelId} không phải channel`);
    }
    channelCache.set(channelId, entity);
    return entity;
  }

  return {
    async getPlaybackDocument(channelId: string, msgId: number): Promise<PlaybackDocumentRef | null> {
      const client = getClient();
      const channel = await resolveChannelEntity(channelId);
      const [message] = await client.getMessages(channel, { ids: [msgId] });
      const document = message?.media instanceof Api.MessageMediaDocument ? message.media.document : undefined;
      if (!message || !(document instanceof Api.Document)) {
        return null;
      }
      return toDocumentRef(document);
    },

    /**
     * Tải ĐÚNG MỘT sub-chunk đã aligned (bội số 4096, không vắt ranh giới
     * 1 MB — ràng buộc `upload.getFile`, xem architecture.md §C3). Không tự
     * làm cửa sổ/windowing — đó là việc của core-download/download-engine.ts
     * (Node-testable, xem ADR-0006 "cần bộ test riêng với FakeTransport").
     *
     * Xử lý tại chỗ (không cần channelId/msgId, chỉ cần `ref`):
     * FileMigrateError (đổi DC), FLOOD_WAIT (chờ nếu ≤60s, ném lỗi rõ nếu
     * hơn — TUYỆT ĐỐI không retry ngầm, ADR-0006 §4), CDN redirect (chưa hỗ
     * trợ, SPIKE-02). File reference hết hạn ném FileReferenceExpiredError
     * để tầng trên tự làm mới (cần channelId/msgId mà hàm này không giữ).
     */
    async fetchFileChunk(ref: PlaybackDocumentRef, offset: number, limit: number): Promise<ArrayBuffer> {
      const client = getClient();
      let sender = await client.getSender(ref.dcId);
      const location = new Api.InputDocumentFileLocation({
        id: bigInt(ref.id),
        accessHash: bigInt(ref.accessHash),
        fileReference: base64ToRuntimeBuffer(ref.fileReference) as never,
        thumbSize: ''
      });
      const request = new Api.upload.GetFile({ location, offset: bigInt(offset), limit });

      // Tối đa 3 lần thử lại (FileMigrateError đổi DC HOẶC FLOOD_WAIT chờ
      // xong) — vòng lặp thay vì đệ quy để không phình call stack khi cả
      // hai loại lỗi cùng xảy ra liên tiếp trong một lần tải hiếm gặp.
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await client.invokeWithSender(request, sender);
          if (result instanceof Api.upload.FileCdnRedirect) {
            throw new CdnNotSupportedError();
          }
          return new Uint8Array(result.bytes).buffer;
        } catch (err) {
          if (err instanceof errors.FileMigrateError) {
            sender = await client.getSender(err.newDc);
            if (attempt < 3) {
              continue;
            }
            throw err;
          }
          if (err instanceof errors.FloodWaitError) {
            if (err.seconds > FLOOD_WAIT_AUTOSLEEP_THRESHOLD_SECONDS) {
              throw new FloodWaitTooLongError(err.seconds);
            }
            await helpers.sleep(err.seconds * 1000);
            if (attempt < 3) {
              continue;
            }
            throw err;
          }
          if (isFileReferenceError(err)) {
            throw new FileReferenceExpiredError();
          }
          throw err;
        }
      }
    }
  };
}
