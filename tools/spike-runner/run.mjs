/**
 * SPIKE-01 runner — chạy bàn thử nghiệm tự động trên Chrome/Edge cài sẵn.
 *
 *   node tools/spike-runner/run.mjs "<đường dẫn file video>" [--browser=chrome|edge] [--headful]
 *
 * Chỉ phủ được desktop Chromium. Safari/iOS bắt buộc phải chạy tay trên thiết bị thật —
 * xem docs/spikes/README.md.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SPIKE_DIR = path.join(ROOT, 'spike');
const PORT = 5199;

const BROWSERS = {
  chrome: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  edge: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
};

const args = process.argv.slice(2);
const videoPath = args.find((a) => !a.startsWith('--'));
const browserKey = (args.find((a) => a.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
const headful = args.includes('--headful');

if (!videoPath || !fs.existsSync(videoPath)) {
  console.error('Cần đường dẫn tới một file video có thật.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(SPIKE_DIR, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(SPIKE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // /_stream/* phải do Service Worker trả lời. Nếu request tới được đây,
    // nghĩa là SW KHÔNG chặn được — chính là kịch bản hỏng của SPIKE-01.
    if (rel.includes('/_stream/')) console.log('  ⚠ server nhận /_stream — Service Worker đã KHÔNG chặn request này');
    res.writeHead(404).end('not found');
    return;
  }
  const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
  if (rel === '/sw.js') headers['Service-Worker-Allowed'] = '/';
  res.writeHead(200, headers).end(fs.readFileSync(file));
});

await new Promise((r) => server.listen(PORT, r));
console.log(`Server: http://localhost:${PORT}`);
console.log(`Video : ${videoPath} (${(fs.statSync(videoPath).size / 1048576).toFixed(1)} MB)`);
console.log(`Trình duyệt: ${browserKey}\n`);

const browser = await puppeteer.launch({
  executablePath: BROWSERS[browserKey],
  headless: headful ? false : 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => console.log('  ✗ lỗi trang:', e.message));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });
console.log('Service Worker đã kiểm soát trang.\n');

const input = await page.$('#file');
await input.uploadFile(path.resolve(videoPath));
await new Promise((r) => setTimeout(r, 300));

const verdict = (id) => page.$eval('#' + id, (el) => el.textContent);

// A — baseline fetch() + Range
await page.click('#btn-fetch');
await page.waitForFunction(() => !document.getElementById('v-fetch').className.includes('pending'), { timeout: 15000 });
console.log('A  fetch()+Range      :', await verdict('v-fetch'));

// B — <video> qua Service Worker
await page.click('#btn-play');
try {
  await page.waitForFunction(
    () => !document.getElementById('v-play').className.includes('pending'),
    { timeout: 30000 }
  );
} catch {
  console.log('   (hết thời gian chờ khung hình đầu tiên)');
}
console.log('B1 media qua SW      :', await verdict('v-intercept'));
console.log('B2 phát được         :', await verdict('v-play'));

// C — tua tới 80%
await page.click('#btn-seek');
try {
  await page.waitForFunction(
    () => !document.getElementById('v-seek').className.includes('pending'),
    { timeout: 30000 }
  );
} catch {
  console.log('   (hết thời gian chờ seeked)');
}
console.log('C  tua               :', await verdict('v-seek'));

// D — chịu độ trễ 500 ms mỗi chunk
await page.$eval('#latency', (el) => {
  el.value = '500';
  el.dispatchEvent(new Event('input'));
});
await page.click('#btn-play');
let d = 'FAIL — hết thời gian chờ';
try {
  await page.waitForFunction(
    () => document.getElementById('v-play').className.includes('pass'),
    { timeout: 45000 }
  );
  d = await verdict('v-play');
} catch {}
console.log('D  độ trễ 500ms/chunk:', d);

console.log('\n--- nhật ký trang ---');
console.log(await page.$eval('#log', (el) => el.innerText));
console.log('UA:', await page.evaluate(() => navigator.userAgent));

await browser.close();
server.close();
