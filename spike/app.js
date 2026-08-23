/**
 * TSMC Spike Testbed — phía tab.
 * Giữ File cục bộ, trả byte cho Service Worker khi được hỏi (mô phỏng Core Worker).
 */

const $ = (id) => document.getElementById(id);
const logEl = $('log');
const state = {
  file: null,
  token: null,
  latencyMs: 0,
  chunkCount: 0,
  bytesServed: 0,
  firstFrameAt: null,
  playRequestedAt: null,
  seekRequestedAt: null,
  swIntercepted: false,
};

function ts() {
  return new Date().toLocaleTimeString('vi-VN', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0');
}

function log(msg, cls = '') {
  const line = document.createElement('div');
  line.className = 'line ' + cls;
  line.textContent = `[${ts()}] ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setVerdict(id, ok, text) {
  const el = $(id);
  el.textContent = text;
  el.className = 'verdict ' + (ok === null ? 'pending' : ok ? 'pass' : 'fail');
}

// ---------- Đăng ký Service Worker ----------

async function registerSW() {
  if (!('serviceWorker' in navigator)) {
    setVerdict('v-sw', false, 'Trình duyệt không hỗ trợ Service Worker');
    log('KHÔNG hỗ trợ Service Worker', 'err');
    return;
  }
  if (!window.isSecureContext) {
    setVerdict('v-sw', false, 'Không phải secure context (cần HTTPS)');
    log('Không phải secure context — Service Worker sẽ không đăng ký được', 'err');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    log(`Service Worker đã đăng ký, scope = ${reg.scope}`, 'ok');
    setVerdict('v-sw', true, 'Đăng ký OK — ' + reg.scope);
  } catch (err) {
    setVerdict('v-sw', false, 'Đăng ký thất bại: ' + err);
    log('Đăng ký SW thất bại: ' + err, 'err');
  }
}

navigator.serviceWorker?.addEventListener('message', async (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'sw-log') {
    const e = msg.entry;
    if (e.kind === 'request') {
      state.swIntercepted = true;
      if (e.destination === 'video' || e.destination === 'audio') {
        setVerdict('v-intercept', true, `CÓ — destination="${e.destination}", Range: ${e.range}`);
      }
      log(`SW nhận request  ${e.method}  destination=${e.destination || '(rỗng)'}  Range: ${e.range}`, 'sw');
    } else if (e.kind === 'served') {
      log(`SW trả ${e.status}  ${e.contentRange || ''}  ${e.bytes} bytes  (${e.ms} ms)`, 'sw');
    } else if (e.kind === 'error') {
      log('SW lỗi: ' + e.msg, 'err');
    }
    return;
  }

  if (msg.type === 'need-chunk') {
    await serveChunk(msg);
  }
});

/** Đây chính là vai của Core Worker trong kiến trúc thật. */
async function serveChunk({ reqId, token, start, end }) {
  const sw = navigator.serviceWorker.controller || (await navigator.serviceWorker.ready).active;
  try {
    if (!state.file || token !== state.token) throw new Error('UNKNOWN_TOKEN');

    // Giả lập độ trễ MTProto (round-trip tới DC Telegram).
    if (state.latencyMs > 0) await new Promise((r) => setTimeout(r, state.latencyMs));

    const buf = await state.file.slice(start, end).arrayBuffer();
    state.chunkCount++;
    state.bytesServed += buf.byteLength;
    $('stats').textContent = `${state.chunkCount} chunk · ${(state.bytesServed / 1048576).toFixed(1)} MB đã phục vụ`;
    sw.postMessage({ type: 'chunk-response', reqId, buffer: buf }, [buf]);
  } catch (err) {
    sw.postMessage({ type: 'chunk-response', reqId, error: String(err) });
  }
}

// ---------- Test 1: baseline fetch() có Range ----------

async function testFetchRange() {
  if (!state.file) return log('Hãy chọn file trước', 'err');
  const url = streamUrl();
  log('— Test baseline: fetch() với Range: bytes=1000-1999 —');
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=1000-1999' } });
    const buf = await res.arrayBuffer();
    const ok = res.status === 206 && buf.byteLength === 1000;
    log(`fetch → status ${res.status}, Content-Range: ${res.headers.get('content-range')}, ${buf.byteLength} bytes`, ok ? 'ok' : 'err');
    setVerdict('v-fetch', ok, ok ? 'PASS — SW trả đúng 206 cho fetch()' : `FAIL — status ${res.status}, ${buf.byteLength} bytes`);
  } catch (err) {
    setVerdict('v-fetch', false, 'FAIL — ' + err);
    log('fetch lỗi: ' + err, 'err');
  }
}

// ---------- Test 2: <video> qua Service Worker (câu hỏi chính của SPIKE-01) ----------

function streamUrl() {
  const p = new URLSearchParams({
    size: String(state.file.size),
    mime: state.file.type || 'video/mp4',
    win: String(Number($('win').value) * 1024 * 1024),
  });
  return `./_stream/${state.token}?${p}`;
}

function startPlayback() {
  if (!state.file) return log('Hãy chọn file trước', 'err');
  const video = $('video');
  // Token mới mỗi lần chạy: nếu dùng lại URL cũ, media element sẽ phục vụ từ cache
  // và phép đo (nhất là test độ trễ) trở nên vô nghĩa.
  state.token = 'test-' + Math.random().toString(36).slice(2, 8);
  state.playRequestedAt = performance.now();
  state.firstFrameAt = null;
  state.swIntercepted = false;
  setVerdict('v-intercept', null, 'đang chờ request đầu tiên từ media element…');
  setVerdict('v-play', null, 'đang chờ khung hình đầu tiên…');
  log(`— Test <video> qua SW · file ${state.file.name} · ${(state.file.size / 1048576).toFixed(1)} MB · độ trễ giả lập ${state.latencyMs} ms —`);
  video.src = streamUrl();
  video.load();
  video.play().catch((e) => log('play() bị chặn hoặc lỗi: ' + e, 'err'));
}

function wireVideo() {
  const video = $('video');

  video.addEventListener('loadedmetadata', () => {
    log(`video: loadedmetadata — thời lượng ${video.duration.toFixed(1)}s`, 'ok');
  });

  video.addEventListener('loadeddata', () => {
    if (state.firstFrameAt === null) {
      state.firstFrameAt = performance.now();
      const ttff = Math.round(state.firstFrameAt - state.playRequestedAt);
      log(`video: khung hình đầu tiên sau ${ttff} ms`, 'ok');
      setVerdict('v-play', true, `PASS — phát được, khung đầu sau ${ttff} ms`);
    }
  });

  video.addEventListener('seeked', () => {
    if (state.seekRequestedAt) {
      const ms = Math.round(performance.now() - state.seekRequestedAt);
      log(`video: seek xong sau ${ms} ms (tới ${video.currentTime.toFixed(1)}s)`, 'ok');
      setVerdict('v-seek', true, `PASS — seek mất ${ms} ms`);
      state.seekRequestedAt = null;
    }
  });

  video.addEventListener('error', () => {
    const err = video.error;
    const code = err ? err.code : '?';
    const detail = err ? err.message : '';
    log(`video: LỖI code=${code} ${detail}`, 'err');
    if (!state.swIntercepted) {
      setVerdict('v-intercept', false, 'KHÔNG — media element không đi qua Service Worker (đây là kịch bản hỏng của SPIKE-01)');
    }
    setVerdict('v-play', false, `FAIL — MediaError code ${code}`);
  });

  video.addEventListener('stalled', () => log('video: stalled', 'warn'));
  video.addEventListener('waiting', () => log('video: waiting (hết buffer)', 'warn'));
}

function doSeek() {
  const video = $('video');
  if (!video.duration || !isFinite(video.duration)) return log('Chưa có duration để seek', 'err');
  const target = video.duration * 0.8;
  state.seekRequestedAt = performance.now();
  setVerdict('v-seek', null, 'đang seek…');
  log(`— Test seek tới ${target.toFixed(1)}s (80% thời lượng) —`);
  video.currentTime = target;
}

// ---------- Khởi động ----------

function init() {
  $('env').textContent = navigator.userAgent;
  wireVideo();
  registerSW();

  $('file').addEventListener('change', (e) => {
    state.file = e.target.files[0] || null;
    state.token = 'test-' + Math.random().toString(36).slice(2, 8);
    if (state.file) {
      log(`Đã chọn: ${state.file.name} · ${(state.file.size / 1048576).toFixed(1)} MB · type="${state.file.type || '(trống)'}"`, 'ok');
      if (!/^video\/(mp4|webm)$/.test(state.file.type)) {
        log(`Cảnh báo: type="${state.file.type}" nhiều khả năng trình duyệt không giải mã được (xem ADR-0013). Kết quả FAIL có thể do codec chứ không phải do Service Worker.`, 'warn');
      }
    }
  });

  $('latency').addEventListener('input', (e) => {
    state.latencyMs = Number(e.target.value);
    $('latency-val').textContent = state.latencyMs + ' ms';
  });

  $('btn-fetch').addEventListener('click', testFetchRange);
  $('btn-play').addEventListener('click', startPlayback);
  $('btn-seek').addEventListener('click', doSeek);
  $('btn-copy').addEventListener('click', () => {
    const report = [
      'TSMC SPIKE-01 report',
      'UA: ' + navigator.userAgent,
      'URL: ' + location.href,
      'secureContext: ' + window.isSecureContext,
      ...['v-sw', 'v-fetch', 'v-intercept', 'v-play', 'v-seek'].map((id) => `${id}: ${$(id).textContent}`),
      '--- log ---',
      logEl.innerText,
    ].join('\n');
    navigator.clipboard.writeText(report).then(
      () => log('Đã copy báo cáo vào clipboard', 'ok'),
      () => log('Không copy được, hãy bôi đen log để copy thủ công', 'err')
    );
  });
}

init();
