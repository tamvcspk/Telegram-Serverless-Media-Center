/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import type { PrecacheEntry } from 'workbox-precaching';
import { SUB_CHUNK_SIZE } from '@tsmc/core-download';
import type {
  StreamChunkRequestMessage,
  StreamChunkCancelMessage,
  StreamChunkResponseMessage,
  StreamInfoRequestMessage,
  StreamInfoResponseMessage
} from '@tsmc/shared-models';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

// Build riêng bằng esbuild + workbox-build injectManifest, KHÔNG dùng
// @angular/service-worker (ngsw không cho fetch handler tuỳ biến) — ADR-0012 §1.
precacheAndRoute(self.__WB_MANIFEST);

// `clients.claim()` — KHÔNG phải `skipWaiting()` (giữ nguyên quyết định
// ADR-0012 §5: không cắt ngang bản ĐANG chạy khi có bản mới). Nhưng thiếu
// dòng này, LẦN ĐẦU TIÊN một tab mở app, SW dù đã activate xong vẫn KHÔNG
// điều khiển tab đó cho tới khi user tự reload lần hai — mọi fetch `/_stream/*`
// đi thẳng ra mạng (404/SPA fallback), player im lặng không phát được, không
// lỗi rõ ràng (phát hiện thật — đúng triệu chứng "không nhấn play được, không
// hiện lỗi"). `clients.claim()` chỉ ảnh hưởng "worker đã active có nhận điều
// khiển tab đang mở hay không", không ảnh hưởng thời điểm activate — an toàn
// với quyết định không skipWaiting() ở trên.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ADR-0005. Cửa sổ 4 MB (= 8 × SUB_CHUNK_SIZE) — bằng đề xuất gốc của
// ADR-0005, tăng từ 1 MB của slice F4 tối thiểu (1 kết nối tuần tự, cửa sổ
// nhỏ hơn giảm độ trễ byte-đầu-tiên khi không có gì để song song hoá). Từ
// slice hardening (ADR-0006 §3, AIMD): trần độ song song mặc định là 4, có
// thể nâng tới 8 (libs/core-download/src/download-engine.ts) — cửa sổ 1 MB
// cũ chỉ đủ 2 sub-chunk, AIMD ramp lên 4 sẽ không còn gì để tận dụng. 4 MB
// cho đủ chỗ (8 sub-chunk) để độ song song thật sự phát huy tác dụng ở cả
// trần mặc định lẫn trần nâng cấp.
const WINDOW_SIZE = 8 * SUB_CHUNK_SIZE;
const CHUNK_CACHE_NAME = 'tsmc-chunks-v1';
const BRIDGE_TIMEOUT_MS = 20_000;

// size/mimeType THẬT từ Telegram, lấy qua bridge (tsmc-stream-info-request)
// — catalog cục bộ (MediaRecord) không lưu mimeType gốc của document, xem
// download-engine.ts getInfo(). Phát hiện thật: hardcode Content-Type
// 'video/mp4' làm trình duyệt từ chối phát (MEDIA_ERR_SRC_NOT_SUPPORTED) với
// file không phải mp4 (mkv/avi cộng đồng rất phổ biến), dù tải bytes đúng.
// Cache trong bộ nhớ SW theo (sourceId,msgId) — HEAD rồi GET Range liên tiếp
// (browser hay làm) không cần hỏi lại Core Worker mỗi lần.
const streamInfoCache = new Map<string, { size: number; mimeType: string }>();

const STREAM_PATH_RE = /^\/_stream\/([^/]+)\/(\d+)$/;

function parseStreamPath(pathname: string): { sourceId: string; msgId: number } | null {
  const match = STREAM_PATH_RE.exec(pathname);
  if (!match) {
    return null;
  }
  return { sourceId: decodeURIComponent(match[1]), msgId: Number(match[2]) };
}

function alignDown(offset: number, grid: number): number {
  return Math.floor(offset / grid) * grid;
}

/**
 * Chỉ hỗ trợ `bytes=N-` / `bytes=N-M` (dạng player thực sự gửi) — không hỗ
 * trợ suffix range `bytes=-N`. Giữ lại `end` tường minh (nếu có) — phát hiện
 * thật: bỏ qua `end` và LUÔN trả đủ `WINDOW_SIZE` khiến probe nhỏ (Safari
 * gửi `bytes=0-1` để dò tổng dung lượng trước — xem SPIKE-01) nhận về 1 MB
 * thay vì đúng 2 byte đã hỏi, có thể khiến trình duyệt không thực hiện bước
 * dò tiếp theo (tìm `moov` cuối file với file thiếu +faststart).
 */
function parseRange(header: string | null): { start: number; end?: number } | null {
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) {
    return null;
  }
  return { start: Number(match[1]), end: match[2] ? Number(match[2]) : undefined };
}

async function findOwningClient(event: FetchEvent): Promise<WindowClient | undefined> {
  if (event.clientId) {
    const direct = await self.clients.get(event.clientId);
    if (direct && direct.type === 'window') {
      return direct as WindowClient;
    }
  }
  // Fallback: request không mang clientId đáng tin (một số trình duyệt/chế
  // độ) — lấy tab window đầu tiên đang mở app (ADR-0004 §"Nhiều tab": tab
  // nào cũng có Core Worker riêng, mọi tab đều tải chunk được).
  const all = await self.clients.matchAll({ type: 'window' });
  return all[0] as WindowClient | undefined;
}

/**
 * Xin cửa sổ [offset, offset+limit) từ Core Worker qua bridge ở main thread
 * — SW KHÔNG BAO GIỜ tự mở kết nối MTProto (ADR-0004 §3/CLAUDE.md bất biến
 * #2). MessageChannel riêng cho MỖI request — không cần bookkeeping cổng
 * lâu dài phía SW, main thread chỉ cần đúng một listener `message` đăng ký
 * một lần lúc bootstrap (xem apps/web/src/app/player/stream-bridge.ts).
 */
async function requestChunkFromClient(
  client: WindowClient,
  sourceId: string,
  msgId: number,
  offset: number,
  limit: number,
  signal: AbortSignal
): Promise<ArrayBuffer> {
  const correlationId = crypto.randomUUID();
  const channel = new MessageChannel();

  const resultPromise = new Promise<StreamChunkResponseMessage>((resolve) => {
    channel.port1.onmessage = (event: MessageEvent<StreamChunkResponseMessage>) => resolve(event.data);
  });

  const request: StreamChunkRequestMessage = { type: 'tsmc-stream-chunk-request', correlationId, sourceId, msgId, offset, limit };
  client.postMessage(request, [channel.port2]);

  const onAbort = () => {
    // Best-effort — chỉ chặn round-trip TIẾP THEO ở Core Worker, không abort
    // round-trip đang bay (giới hạn đã biết của slice tối thiểu, xem
    // download-engine.ts CancelledError).
    const cancel: StreamChunkCancelMessage = { type: 'tsmc-stream-chunk-cancel', correlationId };
    client.postMessage(cancel);
  };
  signal.addEventListener('abort', onAbort, { once: true });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Hết thời gian chờ phản hồi từ tab — tab có thể đã đóng, hãy mở lại phim.')), BRIDGE_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([resultPromise, timeoutPromise]);
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result.buffer;
  } finally {
    signal.removeEventListener('abort', onAbort);
    channel.port1.close();
  }
}

/**
 * Xin `size`/`mimeType` THẬT từ Core Worker qua bridge (cùng cơ chế
 * MessageChannel với requestChunkFromClient) — cache trong bộ nhớ SW để
 * HEAD/GET liên tiếp cho cùng file không phải hỏi lại (xem streamInfoCache).
 */
async function requestStreamInfo(client: WindowClient, sourceId: string, msgId: number): Promise<{ size: number; mimeType: string }> {
  const cacheKey = `${sourceId}:${msgId}`;
  const cached = streamInfoCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const correlationId = crypto.randomUUID();
  const channel = new MessageChannel();
  const resultPromise = new Promise<StreamInfoResponseMessage>((resolve) => {
    channel.port1.onmessage = (event: MessageEvent<StreamInfoResponseMessage>) => resolve(event.data);
  });

  const request: StreamInfoRequestMessage = { type: 'tsmc-stream-info-request', correlationId, sourceId, msgId };
  client.postMessage(request, [channel.port2]);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Hết thời gian chờ thông tin file từ tab.')), BRIDGE_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([resultPromise, timeoutPromise]);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const info = { size: result.size, mimeType: result.mimeType };
    streamInfoCache.set(cacheKey, info);
    return info;
  } finally {
    channel.port1.close();
  }
}

async function handleStreamRequest(event: FetchEvent, sourceId: string, msgId: number): Promise<Response> {
  const client = await findOwningClient(event);
  if (!client) {
    return new Response('Không tìm thấy tab đang mở app — hãy mở lại phim.', { status: 503 });
  }

  let size: number;
  let mimeType: string;
  try {
    ({ size, mimeType } = await requestStreamInfo(client, sourceId, msgId));
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'Không lấy được thông tin file.', { status: 404 });
  }

  // HEAD — body rỗng LUÔN đúng chuẩn HTTP dù Content-Length khai bao nhiêu
  // (HEAD không bao giờ có body). Đây là nhánh DUY NHẤT được phép trả body
  // rỗng — phát hiện thật: từng áp dụng nhầm cả cho GET không kèm Range,
  // khiến trình duyệt nhận 200 kèm Content-Length > 0 nhưng body THỰC SỰ
  // rỗng → coi là dữ liệu hỏng, `<video>` báo lỗi ngay (MEDIA_ERR_SRC_NOT_SUPPORTED)
  // mà không hề thử xin thêm dữ liệu.
  if (event.request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(size), 'Content-Type': mimeType }
    });
  }

  // GET không kèm Range — coi như `bytes=0-` (server media thật cũng làm
  // vậy): LUÔN trả 206 kèm cửa sổ dữ liệu THẬT khớp Content-Length, không
  // bao giờ trả 200 "hứa" Content-Length mà không có body tương ứng.
  const range = parseRange(event.request.headers.get('Range')) ?? { start: 0 };
  if (range.start >= size) {
    return new Response('Range không hợp lệ.', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  // Chuẩn hoá offset về lưới SUB_CHUNK_SIZE (512 KB) — ADR-0005 §"Đường đi
  // của một byte", và đúng bất biến của core-download/download-engine.ts
  // (offset truyền vào fetchWindow phải là bội số hằng số này). Luôn TẢI đủ
  // một cửa sổ WINDOW_SIZE từ đây (kể cả khi trình duyệt chỉ hỏi vài byte —
  // Telegram không cho tải ít hơn một sub-chunk), nhưng CHỈ TRẢ VỀ đúng phần
  // trình duyệt yêu cầu (xem cắt `sliceStart/sliceEnd` bên dưới) — tôn trọng
  // `end` tường minh thay vì luôn ép về WINDOW_SIZE (xem comment parseRange).
  const alignedStart = alignDown(range.start, SUB_CHUNK_SIZE);
  const cache = await caches.open(CHUNK_CACHE_NAME);
  // Key rút gọn: {sourceId}:{msgId} thay vì hash access_hash như ADR-0005 đề
  // xuất — access_hash/id không đổi dù file_reference hết hạn, đủ ổn định
  // cho slice này (không có LRU chủ động, dựa vào eviction tự nhiên của
  // Cache Storage — giới hạn đã biết, xem plan đóng slice).
  const cacheKey = `/_chunk/${sourceId}:${msgId}/${alignedStart}`;

  const cached = await cache.match(cacheKey);
  let windowBuffer = cached ? await cached.arrayBuffer() : undefined;

  if (!windowBuffer) {
    windowBuffer = await requestChunkFromClient(client, sourceId, msgId, alignedStart, WINDOW_SIZE, event.request.signal);
    await cache.put(cacheKey, new Response(windowBuffer, { headers: { 'Content-Type': 'application/octet-stream' } }));
  }

  const windowEndExclusive = alignedStart + windowBuffer.byteLength;
  const responseEndExclusive = range.end !== undefined ? Math.min(range.end + 1, size, windowEndExclusive) : windowEndExclusive;
  const sliceStart = range.start - alignedStart;
  const sliceEnd = responseEndExclusive - alignedStart;
  const body = windowBuffer.slice(sliceStart, sliceEnd);

  return new Response(body, {
    status: 206,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${range.start}-${responseEndExclusive - 1}/${size}`,
      'Content-Length': String(body.byteLength),
      'Content-Type': mimeType
    }
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const parsed = parseStreamPath(url.pathname);
  if (!parsed) {
    return;
  }

  event.respondWith(
    handleStreamRequest(event, parsed.sourceId, parsed.msgId).catch(
      (err) => new Response(err instanceof Error ? err.message : 'Lỗi không xác định.', { status: 502 })
    )
  );
});

// KHÔNG tự skipWaiting() — chiến lược cập nhật ADR-0012 §5: chờ người dùng
// xác nhận "Có bản mới, tải lại" thay vì cắt ngang luồng đang phát.
