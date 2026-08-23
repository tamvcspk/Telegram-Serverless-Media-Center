/**
 * TSMC Spike Testbed — Service Worker "Stream Proxy"
 *
 * Mô phỏng đúng cơ chế của ADR-0004 + ADR-0005 nhưng KHÔNG cần Telegram:
 *   <video> --HTTP Range--> SW --postMessage--> tab (File.slice) --ArrayBuffer--> SW --206--> <video>
 *
 * Mục đích: trả lời SPIKE-01 — trình duyệt (đặc biệt Safari/iOS) có thực sự
 * cho request của media element đi qua Service Worker hay không.
 *
 * Không có bước build. Sửa file này là deploy được ngay.
 */

const STREAM_PREFIX = '/_stream/';
const SW_VERSION = 'spike-1';

/** reqId -> {resolve, reject, timer} cho các yêu cầu chunk đang chờ tab trả lời */
const pending = new Map();
let reqSeq = 0;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'chunk-response') {
    const entry = pending.get(msg.reqId);
    if (!entry) return; // đã timeout
    pending.delete(msg.reqId);
    clearTimeout(entry.timer);
    if (msg.error) entry.reject(new Error(msg.error));
    else entry.resolve(msg.buffer);
  }

  if (msg.type === 'ping') {
    event.source?.postMessage({ type: 'pong', version: SW_VERSION });
  }
});

/** Gửi log về mọi tab để hiển thị trên UI. */
async function log(entry) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of all) c.postMessage({ type: 'sw-log', entry: { ...entry, t: Date.now() } });
}

/** Hỏi tab đang giữ File để lấy [start, end) — đúng mô hình "SW không tự nói chuyện mạng". */
async function requestChunk(token, start, end) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.length === 0) throw new Error('NO_CLIENT');

  const reqId = ++reqSeq;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error('CHUNK_TIMEOUT'));
    }, 30000);
    pending.set(reqId, { resolve, reject, timer });
  });

  for (const c of clients) c.postMessage({ type: 'need-chunk', reqId, token, start, end });
  return promise;
}

/** Parse "bytes=start-end" -> {start, end|null}. Trả null nếu không có/không hợp lệ. */
function parseRange(header) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  if (m[1] === '' && m[2] === '') return null;
  if (m[1] === '') return { suffixLength: parseInt(m[2], 10) }; // bytes=-500 (đuôi file)
  return { start: parseInt(m[1], 10), end: m[2] === '' ? null : parseInt(m[2], 10) };
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf(STREAM_PREFIX) === -1) return;

  event.respondWith(handleStream(event));
});

async function handleStream(event) {
  const req = event.request;
  const url = new URL(req.url);
  const token = url.pathname.slice(url.pathname.indexOf(STREAM_PREFIX) + STREAM_PREFIX.length);
  const size = Number(url.searchParams.get('size') || 0);
  const mime = url.searchParams.get('mime') || 'video/mp4';
  const windowSize = Number(url.searchParams.get('win') || 2 * 1024 * 1024);
  const started = Date.now();

  const rangeHeader = req.headers.get('range');
  await log({
    kind: 'request',
    method: req.method,
    range: rangeHeader || '(không có Range)',
    mode: req.mode,
    destination: req.destination, // 'video' => media element ĐÃ đi qua SW
  });

  if (!size) {
    await log({ kind: 'error', msg: 'thiếu ?size trong URL' });
    return new Response('missing size', { status: 400 });
  }

  const baseHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': mime,
    'Cache-Control': 'no-store',
  };

  if (req.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(size) },
    });
  }

  const range = parseRange(rangeHeader);

  // Không có Range: trả 200 kèm toàn bộ Content-Length nhưng chỉ phục vụ 1 cửa sổ.
  // (Chrome/Firefox sẽ tự chuyển sang dùng Range ngay sau đó.)
  if (!range) {
    try {
      const end = Math.min(size, windowSize);
      const buf = await requestChunk(token, 0, end);
      await log({ kind: 'served', status: 200, bytes: buf.byteLength, ms: Date.now() - started });
      return new Response(buf, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(buf.byteLength) },
      });
    } catch (err) {
      await log({ kind: 'error', msg: String(err) });
      return new Response(String(err), { status: 503 });
    }
  }

  let start, endExclusive;
  if ('suffixLength' in range) {
    start = Math.max(0, size - range.suffixLength);
    endExclusive = size;
  } else {
    start = range.start;
    // Cửa sổ giới hạn — đúng chiến lược của ADR-0005: để player tự xin tiếp.
    const requestedEnd = range.end === null ? size - 1 : Math.min(range.end, size - 1);
    endExclusive = Math.min(requestedEnd + 1, start + windowSize);
  }

  if (start >= size || start < 0) {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` },
    });
  }

  try {
    const buf = await requestChunk(token, start, endExclusive);
    const actualEnd = start + buf.byteLength - 1;
    await log({
      kind: 'served',
      status: 206,
      contentRange: `bytes ${start}-${actualEnd}/${size}`,
      bytes: buf.byteLength,
      ms: Date.now() - started,
    });
    return new Response(buf, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${actualEnd}/${size}`,
        'Content-Length': String(buf.byteLength),
      },
    });
  } catch (err) {
    await log({ kind: 'error', msg: String(err), start, endExclusive });
    return new Response(String(err), { status: 503 });
  }
}
