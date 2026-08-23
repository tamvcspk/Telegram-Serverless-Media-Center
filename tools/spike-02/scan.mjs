// SPIKE-02, bước 2/2 — QUÉT CDN_REDIRECT.
//
// ⚠️ Cũng chạy trong terminal của chính bạn. Đọc session cục bộ (đã đăng
// nhập bằng login.mjs), không hỏi lại OTP.
//
//   node scan.mjs --peer <username_kenh> [--limit 60] [--minSizeMb 500]
//
// LƯU Ý: dùng "node scan.mjs ..." trực tiếp, KHÔNG dùng "npm run scan -- ...".
// Trên PowerShell (và một số shell khác), npm tự nuốt mất mọi --flag đứng sau
// dấu -- khi chạy qua "npm run", coi chúng là cấu hình riêng của npm thay vì
// chuyển vào script — kể cả dạng --flag=value. Gọi node trực tiếp thì không bị.
//
// Việc script làm: tìm vài file lớn trong kênh, gọi trực tiếp
// upload.getFile ở tầng thấp (bỏ qua downloadMedia của GramJS) tại nhiều
// offset rải khắp file, đếm xem bao nhiêu lần Telegram trả về
// upload.FileCdnRedirect thay vì upload.File — đó chính là câu hỏi của
// ADR-0003/ADR-0006. Sau đó thử lại bằng client.downloadMedia() cấp cao để
// xem GramJS có tự âm thầm xử lý redirect đó không.
//
// Kết quả ghi ra docs/spikes/spike-02-result.local.json (đã gitignore) —
// CHỈ chứa số liệu tổng hợp (kích thước file, số lần redirect), không chứa
// session, không chứa số điện thoại. File này an toàn để dán nội dung vào
// chat cho Claude đọc và viết lại docs/spikes/README.md.

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(ROOT, '.session.local');
const OUT_FILE = path.join(ROOT, '../../docs/spikes/spike-02-result.local.json');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
}

const peerRef = arg('peer');
const limit = Number(arg('limit', 60));
const minSizeMb = Number(arg('minSizeMb', 500));
const CHUNK = 1024 * 1024; // 1 MB — trần cứng của upload.getFile, xem architecture.md C3

if (!peerRef) {
  console.error('Cần --peer <username_kenh_hoac_id>. Nên chọn kênh public đông người tải để có cơ hội gặp CDN_REDIRECT.');
  process.exit(1);
}
if (!fs.existsSync(SESSION_FILE)) {
  console.error(`Chưa có session. Chạy "npm run login" trước (file mong đợi tại ${SESSION_FILE}).`);
  process.exit(1);
}

const apiId = Number(process.env.TSMC_API_ID);
const apiHash = process.env.TSMC_API_HASH;
if (!apiId || !apiHash) {
  console.error('Thiếu TSMC_API_ID / TSMC_API_HASH trong biến môi trường (giống lúc login).');
  process.exit(1);
}

const sessionStr = fs.readFileSync(SESSION_FILE, 'utf8').trim();
const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, { connectionRetries: 5 });
await client.connect();
console.log('Đã kết nối bằng session có sẵn.\n');

// --peer có thể tới dưới nhiều hình dạng: username, id số thuần, link
// t.me/c/<id>/<msg>, id kiểu bot-API có tiền tố "-100"/"100", hoặc một chuỗi
// "<id>_<msg>" bị dính (đúng trường hợp gặp phải ở đây). Thay vì đoán đúng
// một dạng, sinh ra mọi cách hiểu hợp lý rồi thử lần lượt — cách hiểu nào
// resolve được thì dùng cách đó.
function peerCandidates(raw) {
  const seen = new Set();
  const add = (v) => v && seen.add(v);

  let s = raw.trim().replace(/^https?:\/\//, '').replace(/^t(elegram)?\.me\//, '');
  add(s);

  const cLink = /^c\/(\d+)(?:\/\d+)?/.exec(s); // t.me/c/<id>/<msg>
  if (cLink) add(cLink[1]);

  const joined = /^(-?\d+)_(\d+)$/.exec(s); // "<id>_<msg>" bị dính, như "1002127468876_3909"
  if (joined) add(joined[1]);

  for (const v of [...seen]) {
    if (!/^-?\d+$/.test(v)) continue;
    if (/^-100\d+$/.test(v)) add(v.slice(4)); // -100xxxxxxxxxx (bot-API) -> id thô
    if (/^100\d{9,}$/.test(v)) add(v.slice(3)); // 100xxxxxxxxxx (thiếu dấu -) -> id thô
    add('-100' + v.replace(/^-?100/, '')); // id thô -> thử dạng bot-API
  }
  return [...seen];
}

async function resolveEntity(raw) {
  const tried = [];
  for (const cand of peerCandidates(raw)) {
    const arg = /^-?\d+$/.test(cand) ? BigInt(cand) : cand;
    try {
      return { entity: await client.getEntity(arg), matched: cand };
    } catch (err) {
      tried.push({ cand, err: err.message });
    }
  }
  return { tried };
}

let { entity, tried, matched } = await resolveEntity(peerRef);
if (!entity) {
  console.log(`Không resolve trực tiếp được "${peerRef}" (đã thử ${tried.length} cách hiểu). Nạp danh sách dialog để cache entity rồi thử lại...`);
  await client.getDialogs({ limit: 200 }); // nạp entity cache — cần thiết nếu channel chưa từng "xuất hiện" trong session này
  ({ entity, tried, matched } = await resolveEntity(peerRef));
}
if (!entity) {
  console.error(`Vẫn không tìm được channel từ "${peerRef}". Đã thử các cách hiểu sau:`);
  for (const { cand, err } of tried) console.error(`  - "${cand}": ${err}`);
  console.error('Thử dùng username công khai (--peer tenkenh) hoặc nguyên link t.me/c/<id>/<msg>, và đảm bảo tài khoản đang dùng đã là thành viên của kênh này.');
  await client.disconnect();
  process.exit(1);
}
console.log(`Kênh: ${entity.title || entity.username || peerRef}${matched !== peerRef ? ` (khớp qua cách hiểu "${matched}")` : ''}`);

const candidates = [];
for await (const msg of client.iterMessages(entity, { limit: 500 })) {
  const doc = msg.media?.document;
  if (!doc) continue;
  const sizeMb = Number(doc.size) / 1048576;
  if (sizeMb >= minSizeMb) candidates.push({ msg, doc, sizeMb });
  if (candidates.length >= 5) break;
}

if (candidates.length === 0) {
  console.error(`Không tìm thấy file nào >= ${minSizeMb} MB trong 500 message gần nhất. Thử kênh khác hoặc hạ --minSizeMb.`);
  await client.disconnect();
  process.exit(1);
}

console.log(`Tìm thấy ${candidates.length} file lớn để test.\n`);

const report = { peer: entity.title || entity.username || String(peerRef), testedAt: new Date().toISOString(), files: [] };

for (const { msg, doc, sizeMb } of candidates) {
  console.log(`— File ${doc.id} · ${sizeMb.toFixed(0)} MB —`);
  const loc = new Api.InputDocumentFileLocation({
    id: doc.id,
    accessHash: doc.accessHash,
    fileReference: doc.fileReference,
    thumbSize: '',
  });

  const totalChunks = Math.floor(Number(doc.size) / CHUNK);
  const probes = Math.min(limit, totalChunks);
  const step = Math.max(1, Math.floor(totalChunks / probes));

  let normal = 0, cdnRedirect = 0, errors = 0;
  let firstRedirectDc = null;

  for (let i = 0; i < probes; i++) {
    const offset = BigInt(i * step) * BigInt(CHUNK);
    try {
      const result = await client.invoke(new Api.upload.GetFile({ location: loc, offset, limit: CHUNK }));
      if (result instanceof Api.upload.FileCdnRedirect) {
        cdnRedirect++;
        if (firstRedirectDc === null) firstRedirectDc = result.dcId;
      } else {
        normal++;
      }
    } catch (err) {
      errors++;
      if (i === 0) console.log(`  lỗi ở chunk đầu tiên: ${err.message}`);
    }
    process.stdout.write(`\r  đã thử ${i + 1}/${probes} chunk — bình thường ${normal}, CDN_REDIRECT ${cdnRedirect}, lỗi ${errors}   `);
  }
  console.log();

  // Thử API cấp cao — xem GramJS có tự âm thầm xử lý redirect không.
  let highLevelOk = null;
  try {
    const buf = await client.downloadMedia(msg, {});
    highLevelOk = buf && buf.length === Number(doc.size);
    console.log(`  downloadMedia() cấp cao: ${highLevelOk ? 'OK, đúng kích thước' : `LỆCH kích thước (nhận ${buf?.length ?? 0}, kỳ vọng ${doc.size})`}`);
  } catch (err) {
    highLevelOk = false;
    console.log(`  downloadMedia() cấp cao: LỖI — ${err.message}`);
  }

  report.files.push({
    sizeMb: Math.round(sizeMb),
    chunksProbed: probes,
    normal,
    cdnRedirect,
    errors,
    firstRedirectDc,
    highLevelDownloadMatchedSize: highLevelOk,
  });
  console.log();
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
console.log(`Đã ghi kết quả (không chứa dữ liệu nhạy cảm) vào ${OUT_FILE}`);
console.log('Dán nội dung file JSON này vào chat để Claude cập nhật docs/spikes/README.md.');

await client.disconnect();
process.exit(0);
