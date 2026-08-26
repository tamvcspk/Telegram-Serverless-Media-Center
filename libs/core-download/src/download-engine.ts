// Scheduler tải chunk cho Playback (F4) + hardening (AIMD/circuit breaker,
// ADR-0006 §3/§4). Node-testable (không đụng Cache Storage/ReadableStream —
// đó là việc của sw/sw.ts) — xem test-fakes.ts.
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
 * §"Đường đi của một byte"). Không validate lại ở đây — đây là hợp đồng NỘI
 * BỘ giữa sw.ts và Core Worker (cả hai phía đều do repo này viết), không
 * phải biên với input ngoài tầm kiểm soát.
 */
export const SUB_CHUNK_SIZE = 512 * 1024;

/** ADR-0006 §3: "Bắt đầu từ 2 request đồng thời/DC". */
const AIMD_START_CONCURRENCY = 2;
/** ADR-0006 §3: "Trần cứng mặc định là 4". */
const DEFAULT_MAX_CONCURRENCY = 4;
/** ADR-0006 §3: "cho phép user nâng lên 8" — trần cứng tuyệt đối bất kể `opts.maxConcurrency` truyền gì. */
const HARD_CEILING_CONCURRENCY = 8;
/** ADR-0006 §4: "cho DC đó nghỉ theo backoff luỹ thừa" sau 3 lần FLOOD liên tiếp — bắt đầu 2s, nhân đôi, trần 60s (cùng ngưỡng "phải hiện cho user"). */
const CIRCUIT_BREAKER_TRIP_THRESHOLD = 3;
const CIRCUIT_BREAKER_INITIAL_BACKOFF_MS = 2_000;
const CIRCUIT_BREAKER_MAX_BACKOFF_MS = 60_000;

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

/**
 * Circuit breaker (ADR-0006 §4) đang cho DC này "nghỉ" sau 3 lần FLOOD_WAIT
 * nghiêm trọng liên tiếp (xem `isFloodWaitTooLong` — chỉ những lần đã vượt
 * ngưỡng tự chờ 60s của GramJS mới tính). Cố tình dùng CÙNG `.name` với
 * `FloodWaitTooLongError` của core-mtproto/gateway-download.ts — cả hai đều
 * là "báo UI rõ ràng, không âm thầm treo" theo đúng nghĩa ADR-0006 §4; tầng
 * gọi (sw.ts qua Comlink) chỉ cần khớp theo `.name`/`.message`, không
 * `instanceof` xuyên biên worker. KHÔNG import class thật từ core-mtproto —
 * core-download không phụ thuộc core-mtproto (CLAUDE.md bất biến #3), đây là
 * type/name độc lập, đã khớp cấu trúc với `FloodWaitTooLongLike` ở
 * gateway-port.ts.
 */
export class FloodWaitTooLongError extends Error {
  constructor(public readonly seconds: number) {
    super(`Telegram đang giới hạn tốc độ, thử lại sau ${seconds} giây.`);
    this.name = 'FloodWaitTooLongError';
  }
}

function isFileReferenceExpired(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as Error).name === 'FileReferenceExpiredError';
}

/**
 * `gateway-download.ts` chỉ ném lỗi này khi FLOOD_WAIT đã VƯỢT
 * `floodSleepThreshold` của GramJS (60s) — GramJS tự chờ trong suốt mọi
 * FLOOD_WAIT ngắn hơn trước khi lỗi có cơ hội nổi lên tới đây. Vì vậy đây là
 * tín hiệu "flood NGHIÊM TRỌNG" duy nhất mà tầng này quan sát được, không
 * phải "flood bất kỳ" — AIMD/circuit breaker dưới đây phản ứng đúng với tín
 * hiệu đó, không phải với định nghĩa "mọi FLOOD_WAIT" theo nghĩa đen của
 * ADR-0006 §3 (xem addendum ADR-0006 giải thích khác biệt này).
 */
function isFloodWaitTooLong(err: unknown): err is { seconds: number } {
  return typeof err === 'object' && err !== null && (err as Error).name === 'FloodWaitTooLongError' && typeof (err as { seconds?: unknown }).seconds === 'number';
}

export interface DownloadEngineOptions {
  /** Trần độ song song mặc định cho AIMD, mỗi DC — hard-clamped ≤ 8 (ADR-0006 §3) bất kể truyền gì lớn hơn. Mặc định 4 — chưa có Settings UI để user tự nâng lên 8, xem ADR-0006 addendum. */
  maxConcurrency?: number;
}

interface DcState {
  concurrency: number;
  consecutiveOk: number;
  consecutiveFloods: number;
  /** epoch ms; 0 = không nghỉ. */
  restUntil: number;
  /** Backoff SẼ áp dụng nếu circuit breaker trip LẦN TIẾP THEO (nhân đôi mỗi lần trip). */
  nextBackoffMs: number;
}

export interface DownloadEngine {
  /**
   * Trả về đúng `min(windowSize, size - offset)` byte bắt đầu từ `offset`.
   * Bên trong tải song song các sub-chunk `SUB_CHUNK_SIZE` (độ song song
   * thích ứng theo DC — AIMD, ADR-0006 §3) cho tới khi đủ cửa sổ hoặc hết
   * file; tự làm mới `file_reference` một lần nếu gateway báo hết hạn
   * (ADR-0006 §5 — "không phải lỗi", phải trong suốt với tầng gọi).
   *
   * Huỷ (`cancel(correlationId)`) chặn round-trip TIẾP THEO — round-trip
   * đang bay lúc gọi cancel() vẫn hoàn tất bình thường (giới hạn đã biết,
   * không đổi so với slice tối thiểu F4).
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

export function createDownloadEngine(gateway: DownloadGateway, opts: DownloadEngineOptions = {}): DownloadEngine {
  const maxConcurrency = Math.max(1, Math.min(HARD_CEILING_CONCURRENCY, opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY));
  const refCache = new Map<string, PlaybackDocumentRef>();
  const cancelled = new Set<string>();
  const dcStates = new Map<number, DcState>();

  function cacheKey(channelId: string, msgId: number): string {
    return `${channelId}:${msgId}`;
  }

  function getDcState(dcId: number): DcState {
    let state = dcStates.get(dcId);
    if (!state) {
      state = { concurrency: AIMD_START_CONCURRENCY, consecutiveOk: 0, consecutiveFloods: 0, restUntil: 0, nextBackoffMs: CIRCUIT_BREAKER_INITIAL_BACKOFF_MS };
      dcStates.set(dcId, state);
    }
    return state;
  }

  function onChunkSuccess(state: DcState): void {
    state.consecutiveFloods = 0;
    state.consecutiveOk++;
    if (state.consecutiveOk >= state.concurrency && state.concurrency < maxConcurrency) {
      state.concurrency++;
      state.consecutiveOk = 0;
    }
  }

  /** Trả về số giây circuit breaker vừa mở (nếu trip lần này), để lộ ra cho UI qua FloodWaitTooLongError. */
  function onChunkFlood(state: DcState): number | null {
    state.concurrency = Math.max(1, Math.floor(state.concurrency / 2));
    state.consecutiveOk = 0;
    state.consecutiveFloods++;
    if (state.consecutiveFloods >= CIRCUIT_BREAKER_TRIP_THRESHOLD) {
      const backoffMs = state.nextBackoffMs;
      state.restUntil = Date.now() + backoffMs;
      state.nextBackoffMs = Math.min(CIRCUIT_BREAKER_MAX_BACKOFF_MS, backoffMs * 2);
      state.consecutiveFloods = 0;
      return Math.ceil(backoffMs / 1000);
    }
    return null;
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
      const dcState = getDcState(ref.dcId);

      if (dcState.restUntil > Date.now()) {
        throw new FloodWaitTooLongError(Math.ceil((dcState.restUntil - Date.now()) / 1000));
      }

      const end = Math.min(offset + windowSize, ref.size);
      const offsets: number[] = [];
      for (let o = offset; o < end; o += SUB_CHUNK_SIZE) {
        offsets.push(o);
      }
      const results: Array<Uint8Array | undefined> = new Array(offsets.length);

      // Làm mới `file_reference` ĐÚNG MỘT LẦN cho cả cửa sổ (một round-trip
      // `getPlaybackDocument` tốn kém, không phải mỗi sub-chunk một lần) —
      // nhưng MỌI offset đang chờ (không chỉ offset đầu tiên chạm lỗi) đều
      // được retry với bản mới, vì nhiều worker chạy song song có thể cùng
      // chạm `file_reference` cũ gần như đồng thời (ADR-0006 §5: "phải trong
      // suốt với tầng gọi" — một cửa sổ không được thất bại chỉ vì 2 sub-chunk
      // cùng lúc gặp reference cũ trong lúc worker khác đang làm mới nó).
      // `??=` đảm bảo chỉ một promise `resolveRef(forceRefresh)` được tạo dù
      // nhiều worker gọi hàm này gần như đồng thời.
      let refreshPromise: Promise<PlaybackDocumentRef> | null = null;
      function ensureRefRefreshed(): Promise<PlaybackDocumentRef> {
        refreshPromise ??= resolveRef(channelId, msgId, true).then((fresh) => {
          ref = fresh;
          return fresh;
        });
        return refreshPromise;
      }

      let nextIndex = 0;
      async function worker(): Promise<void> {
        for (;;) {
          checkCancelled(correlationId);
          const i = nextIndex++;
          if (i >= offsets.length) {
            return;
          }
          const chunkOffset = offsets[i];
          // Riêng của MỖI offset — offset nào cũng được đúng một lần retry
          // sau khi ref làm mới, bất kể offset khác đã dùng "lượt làm mới
          // chung" đó hay chưa.
          let retriedAfterRefresh = false;
          for (;;) {
            try {
              const buf = await gateway.fetchFileChunk(ref, chunkOffset, SUB_CHUNK_SIZE);
              results[i] = new Uint8Array(buf);
              onChunkSuccess(dcState);
              break;
            } catch (err) {
              if (isFileReferenceExpired(err) && !retriedAfterRefresh) {
                retriedAfterRefresh = true;
                await ensureRefRefreshed();
                continue;
              }
              if (isFloodWaitTooLong(err)) {
                const trippedSeconds = onChunkFlood(dcState);
                // Flood nghiêm trọng LUÔN dừng cả cửa sổ ngay lập tức (ADR-0006
                // §4: "dừng pipeline, hiện thông báo... không âm thầm treo") —
                // không retry-tại-chỗ như file-reference-expiry. Nếu vừa trip
                // circuit breaker, thông báo thời gian nghỉ MỚI (dài hơn) thay
                // vì thời gian FLOOD_WAIT gốc — đó mới là lý do thực sự user
                // phải chờ tiếp theo.
                throw trippedSeconds !== null ? new FloodWaitTooLongError(trippedSeconds) : err;
              }
              throw err;
            }
          }
        }
      }

      const poolSize = Math.max(1, Math.min(dcState.concurrency, offsets.length));
      await Promise.all(Array.from({ length: poolSize }, () => worker()));

      checkCancelled(correlationId);

      const total = results.reduce((sum, part) => sum + (part?.length ?? 0), 0);
      const capped = Math.min(total, end - offset);
      const merged = new Uint8Array(capped);
      let writeOffset = 0;
      for (const part of results) {
        if (!part || writeOffset >= capped) {
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
