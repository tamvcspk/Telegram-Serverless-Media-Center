// Tải chunk cho slice Playback (F4) + hardening (AIMD/circuit breaker/CDN
// redirect, ADR-0006 §3/§4/§6). Tách khỏi gateway.ts/gateway-sync.ts/
// gateway-index.ts (mối quan tâm khác: đọc BYTE nhị phân của một document đã
// biết, không phải state riêng tư hay metadata catalog) nhưng vẫn nằm trong
// core-mtproto vì CLAUDE.md bất biến #3: chỉ package này được import
// `telegram`. `PlaybackDocumentRef` là DTO thuần (không `Api.*` rò ra ngoài)
// — cố ý KHÔNG đưa type này lên @tsmc/shared-models, cùng quy ước "type
// riêng của port ở lại cạnh gateway" đã ghi trong core-index/gateway-port.ts.
import bigInt from 'big-integer';
import { Api, errors, type TelegramClient } from 'telegram';

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

/** Worker global scope thật (khai riêng — package này không bật lib "webworker" trong tsconfig, xem browser-shim.ts cho cùng quy ước). */
declare const crypto: {
  subtle: {
    importKey(format: 'raw', keyData: Uint8Array, algorithm: { name: string }, extractable: boolean, usages: string[]): Promise<unknown>;
    decrypt(algorithm: { name: string; counter: Uint8Array; length: number }, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  };
};

export interface PlaybackDocumentRef {
  id: string;
  accessHash: string;
  /** Base64 — `Api.Document.fileReference` là Buffer, không rò kiểu GramJS ra ngoài package này. */
  fileReference: string;
  dcId: number;
  size: number;
  mimeType: string;
}

/**
 * FLOOD_WAIT vượt ngưỡng tự chờ của GramJS (`floodSleepThreshold: 60`, xem
 * gateway.ts) — GramJS TỰ chờ và retry trong suốt cho mọi FLOOD_WAIT ≤
 * ngưỡng đó TRƯỚC KHI lỗi có cơ hội nổi lên tới đây (xem `client/users.js`
 * của GramJS: `invoke()` — hàm `invokeWithSender` gọi xuống dùng chung —
 * bọc sẵn `if (e.seconds <= client.floodSleepThreshold) { sleep; retry; }
 * else { throw; }`). Nói cách khác: lớp này KHÔNG BAO GIỜ thấy một
 * FloodWaitError ≤ 60s — mọi lỗi bắt được ở đây chắc chắn đã vượt ngưỡng.
 * Vì vậy không cần (và không còn) tự chờ ở tầng này nữa — ném thẳng cho
 * download-engine.ts quyết định AIMD/circuit-breaker (ADR-0006 §3/§4).
 */
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

/**
 * `upload.getCdnFileHashes`/`FileCdnRedirect.fileHashes` không khớp dữ liệu
 * đã giải mã, hoặc không đủ hash để xác minh trọn vẹn phần đã tải — ADR-0006
 * §6: "Không được bỏ qua bước xác minh hash". Ném lỗi thay vì trả bytes
 * không xác minh được — CDN của Telegram là bên thứ ba không đáng tin theo
 * chính thiết kế giao thức.
 */
export class CdnHashMismatchError extends Error {
  constructor() {
    super('Dữ liệu tải qua CDN không khớp hash xác minh — từ chối phát để an toàn.');
    this.name = 'CdnHashMismatchError';
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
 * Cộng `offset / 16` (số khối AES 16-byte) vào 4 byte CUỐI của
 * `encryptionIv`, big-endian, có tràn số (mod 2^32) — đúng định nghĩa
 * counter của Telegram cho CDN: "12 byte đầu giữ nguyên làm nonce, 4 byte
 * cuối là bộ đếm khối tăng dần". `offset` LUÔN là bội số của
 * `SUB_CHUNK_SIZE` (bội số 16) nên phép chia này luôn tròn — không có phần
 * dư cần xử lý. `length: 32` truyền cho `crypto.subtle.decrypt` bên dưới
 * chính là khai báo "chỉ 4 byte cuối là counter" này với WebCrypto.
 */
function computeCdnCounter(iv: Uint8Array, offset: number): Uint8Array {
  const counter = new Uint8Array(iv);
  const view = new DataView(counter.buffer, counter.byteOffset, counter.byteLength);
  const blockIndex = offset / 16;
  const original = view.getUint32(12, false);
  view.setUint32(12, (original + blockIndex) >>> 0, false);
  return counter;
}

interface CdnHashEntry {
  offset: number;
  limit: number;
  hash: Uint8Array;
}

function toCdnHashEntries(hashes: readonly Api.TypeFileHash[]): CdnHashEntry[] {
  return hashes.map((h) => ({ offset: h.offset.toJSNumber(), limit: h.limit, hash: new Uint8Array(h.hash) }));
}

/**
 * Xác minh TOÀN BỘ `plain` (đã giải mã, ứng với `[offset, offset+plain.length)`)
 * được phủ kín bởi các đoạn hash trong `hashes` — mỗi đoạn hash phải nằm
 * TRỌN VẸN trong `plain` (không chấp nhận đoạn vắt ra ngoài, không đủ dữ
 * liệu để so khớp). Có khoảng trống không đoạn hash nào phủ tới, hoặc một
 * đoạn không khớp SHA-256, đều ném `CdnHashMismatchError` — "chưa xác minh
 * được" và "sai" được coi là cùng một rủi ro ở đây (ADR-0006 §6).
 */
async function verifyCdnPlaintext(hashes: CdnHashEntry[], offset: number, plain: Uint8Array): Promise<void> {
  const end = offset + plain.length;
  const covered: Array<[number, number]> = [];
  for (const h of hashes) {
    const segStart = h.offset;
    const segEnd = h.offset + h.limit;
    if (segStart < offset || segEnd > end) {
      continue;
    }
    const slice = plain.subarray(segStart - offset, segEnd - offset);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', slice));
    if (digest.length !== h.hash.length || !digest.every((b, i) => b === h.hash[i])) {
      throw new CdnHashMismatchError();
    }
    covered.push([segStart, segEnd]);
  }
  covered.sort((a, b) => a[0] - b[0]);
  let cursor = offset;
  for (const [segStart, segEnd] of covered) {
    if (segStart > cursor) {
      throw new CdnHashMismatchError();
    }
    cursor = Math.max(cursor, segEnd);
  }
  if (cursor < end) {
    throw new CdnHashMismatchError();
  }
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
  // Cache CryptoKey đã import theo fileToken (base64) — mỗi lần bị redirect
  // CDN, Telegram phát một fileToken/key/iv riêng; không giả định key sống
  // lâu hơn một fileToken cụ thể.
  const cdnKeyCache = new Map<string, unknown>();

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

  /**
   * Xử lý một `FileCdnRedirect` cho đúng MỘT sub-chunk — ADR-0006 §6.
   * KHÔNG cache trạng thái redirect giữa các lần gọi `fetchFileChunk` khác
   * nhau (mỗi sub-chunk tự xin lại redirect từ DC gốc) — đơn giản hơn một
   * cache phiên CDN đúng nghĩa, đổi lấy một round-trip dư mỗi sub-chunk CDN.
   * Chấp nhận được: SPIKE-02 ghi nhận 0/250 lần gặp CDN_REDIRECT thật trên
   * use-case chính của TSMC — đường này gần như không bao giờ chạy tới.
   *
   * LƯU Ý VỀ ĐỘ TIN CẬY: nhánh này viết theo đặc tả TL
   * (`upload.GetCdnFile`/`GetCdnFileHashes`/`ReuploadCdnFile`,
   * `upload.FileCdnRedirect`) và ngữ nghĩa AES-CTR-với-counter-theo-offset
   * mà giao thức Telegram mô tả cho CDN, KHÔNG PHẢI đã kiểm chứng bằng traffic
   * CDN thật (không có traffic thật để kiểm — cùng giới hạn SPIKE-02 đã ghi
   * nhận). Xem addendum ADR-0006.
   */
  async function fetchViaCdn(
    originSender: Awaited<ReturnType<TelegramClient['getSender']>>,
    redirect: Api.upload.FileCdnRedirect,
    offset: number,
    limit: number
  ): Promise<ArrayBuffer> {
    const client = getClient();
    const cdnSender = await client.getSender(redirect.dcId);
    const fileTokenKey = bytesToBase64(new Uint8Array(redirect.fileToken));

    let cdnResult = await client.invokeWithSender(
      new Api.upload.GetCdnFile({ fileToken: redirect.fileToken, offset: bigInt(offset), limit }),
      cdnSender
    );

    if (cdnResult instanceof Api.upload.CdnFileReuploadNeeded) {
      // Yêu cầu DC gốc đẩy lại file lên node CDN — gọi trên sender GỐC
      // (không phải cdnSender), rồi thử lại GetCdnFile đúng MỘT lần.
      await client.invokeWithSender(
        new Api.upload.ReuploadCdnFile({ fileToken: redirect.fileToken, requestToken: cdnResult.requestToken }),
        originSender
      );
      cdnResult = await client.invokeWithSender(
        new Api.upload.GetCdnFile({ fileToken: redirect.fileToken, offset: bigInt(offset), limit }),
        cdnSender
      );
      if (cdnResult instanceof Api.upload.CdnFileReuploadNeeded) {
        throw new Error('CDN yêu cầu reupload liên tiếp — không tải được sau khi đã thử lại.');
      }
    }

    const ciphertext = new Uint8Array(cdnResult.bytes);
    const encryptionKey = new Uint8Array(redirect.encryptionKey);
    const encryptionIv = new Uint8Array(redirect.encryptionIv);

    let key = cdnKeyCache.get(fileTokenKey);
    if (!key) {
      key = await crypto.subtle.importKey('raw', encryptionKey, { name: 'AES-CTR' }, false, ['decrypt']);
      cdnKeyCache.set(fileTokenKey, key);
    }
    const counter = computeCdnCounter(encryptionIv, offset);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: 32 }, key, ciphertext);
    const plain = new Uint8Array(plainBuf);

    let hashEntries = toCdnHashEntries(redirect.fileHashes ?? []);
    const coversRequest = hashEntries.some((h) => h.offset <= offset && h.offset + h.limit >= offset + plain.length);
    if (!coversRequest) {
      const fetchedHashes = await client.invokeWithSender(
        new Api.upload.GetCdnFileHashes({ fileToken: redirect.fileToken, offset: bigInt(offset) }),
        originSender
      );
      hashEntries = toCdnHashEntries(fetchedHashes);
    }
    await verifyCdnPlaintext(hashEntries, offset, plain);

    return plain.buffer;
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
     * làm cửa sổ/windowing/độ song song — đó là việc của
     * core-download/download-engine.ts (AIMD + circuit breaker, ADR-0006
     * §3/§4, Node-testable qua FakeTransport).
     *
     * Xử lý tại chỗ (không cần channelId/msgId, chỉ cần `ref`):
     * FileMigrateError (đổi DC), FLOOD_WAIT (ném `FloodWaitTooLongError`
     * — GramJS đã tự chờ mọi FLOOD_WAIT ≤ 60s trong suốt, xem comment lớp
     * đó — TUYỆT ĐỐI không tự chờ thêm ở đây), CDN redirect
     * (`fetchViaCdn`). File reference hết hạn ném `FileReferenceExpiredError`
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

      // Tối đa 3 lần thử lại (FileMigrateError đổi DC) — vòng lặp thay vì đệ
      // quy để không phình call stack khi lỗi xảy ra liên tiếp trong một lần
      // tải hiếm gặp.
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await client.invokeWithSender(request, sender);
          if (result instanceof Api.upload.FileCdnRedirect) {
            return await fetchViaCdn(sender, result, offset, limit);
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
            // Xem comment lớp FloodWaitTooLongError: chỉ tới được đây khi đã
            // vượt ngưỡng floodSleepThreshold của GramJS — không retry ngầm.
            throw new FloodWaitTooLongError(err.seconds);
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
