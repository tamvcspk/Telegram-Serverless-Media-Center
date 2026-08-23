// SPIKE-03: đo thời gian nạp module + khởi tạo TelegramClient trên Chrome thật
// (không phải Node — engine V8 nhưng chi phí parse/eval module trong browser
// khác Node do khác pipeline compile). Dùng lại Chrome đã cài từ SPIKE-01.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 5211;

const targets = [
  { name: 'GramJS (telegram)', dir: ROOT, bundle: 'dist-gramjs.js' },
  { name: 'teleproto', dir: path.join(ROOT, '../spike-03-teleproto'), bundle: 'dist-teleproto.js' },
];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file;
  if (rel.startsWith('/harness')) file = path.join(ROOT, 'harness.html');
  else if (rel.startsWith('/gramjs/')) file = path.join(ROOT, rel.replace('/gramjs/', ''));
  else if (rel.startsWith('/teleproto/')) file = path.join(ROOT, '../spike-03-teleproto', rel.replace('/teleproto/', ''));
  else return res.writeHead(404).end();
  if (!fs.existsSync(file)) return res.writeHead(404).end('not found: ' + file);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

console.log('Đo trên Chrome thật (V8 + pipeline compile module của trình duyệt, không phải Node):\n');

for (const t of targets) {
  if (!fs.existsSync(path.join(t.dir, t.bundle))) {
    console.log(`${t.name.padEnd(20)}: bỏ qua — chưa build (${t.bundle} không tồn tại)`);
    continue;
  }
  const page = await browser.newPage();
  page.on('console', (m) => console.log('  [console]', m.text()));
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  const prefix = t.name.startsWith('GramJS') ? 'gramjs' : 'teleproto';
  await page.goto(`http://localhost:${PORT}/harness?bundle=/${prefix}/${t.bundle}`, { waitUntil: 'networkidle0' });
  let result;
  try {
    await page.waitForFunction(() => window.__result !== undefined, { timeout: 8000 });
    result = await page.evaluate(() => window.__result);
  } catch {
    console.log(`${t.name.padEnd(20)}: THẤT BẠI — xem lỗi ở trên`);
    await page.close();
    continue;
  }
  console.log(`${t.name.padEnd(20)}: nạp module ${String(result.importMs).padStart(6)} ms  ·  new TelegramClient() ${String(result.constructMs).padStart(6)} ms  ·  tổng ${(result.importMs + result.constructMs).toFixed(1)} ms`);
  await page.close();
}

await browser.close();
server.close();
