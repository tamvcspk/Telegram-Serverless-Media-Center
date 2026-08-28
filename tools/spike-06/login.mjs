// SPIKE-06, bước 1/2 — ĐĂNG NHẬP.
//
// ⚠️ CHẠY FILE NÀY TRONG TERMINAL CỦA CHÍNH BẠN, KHÔNG PHẢI QUA CLAUDE.
// Số điện thoại + mã OTP là thông tin đăng nhập Telegram thật của bạn.
// Session sinh ra sau bước này tương đương TOÀN QUYỀN tài khoản Telegram
// (đọc tin nhắn, gửi tin, xoá tài khoản...) — xem ADR-0011. Nó chỉ được ghi
// vào file cục bộ `.session.local` (đã có trong .gitignore), không bao giờ
// in ra terminal, không bao giờ dán vào chat với Claude.
//
// Chuẩn bị trước:
//   1. Lấy API_ID/API_HASH tại https://my.telegram.org (mục "API development tools")
//   2. cd tools/spike-06 && npm install
//   3. TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx npm run login
//      (Windows PowerShell: $env:TSMC_API_ID="..."; $env:TSMC_API_HASH="..."; npm run login)
//
// Có thể dùng LẠI session từ tools/spike-02/spike-04 nếu bạn còn giữ file
// .session.local của spike đó (copy sang đây) — không bắt buộc đăng nhập
// lại nếu đã có session hợp lệ gần đây.

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input'; // GramJS đã kéo theo sẵn qua deps, dùng cho prompt terminal
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(ROOT, '.session.local');

const apiId = Number(process.env.TSMC_API_ID);
const apiHash = process.env.TSMC_API_HASH;

if (!apiId || !apiHash) {
  console.error('Thiếu TSMC_API_ID / TSMC_API_HASH. Lấy tại https://my.telegram.org rồi set biến môi trường trước khi chạy.');
  process.exit(1);
}

if (fs.existsSync(SESSION_FILE)) {
  console.log(`Đã có session tại ${SESSION_FILE} — xoá file này trước nếu muốn đăng nhập lại.`);
  process.exit(0);
}

const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

await client.start({
  phoneNumber: async () => await input.text('Số điện thoại (dạng +84...): '),
  phoneCode: async () => await input.text('Mã OTP Telegram vừa gửi: '),
  onError: (err) => console.error('Lỗi đăng nhập:', err)
});

fs.writeFileSync(SESSION_FILE, client.session.save(), { mode: 0o600 });
console.log(`\nĐăng nhập xong. Session đã lưu cục bộ tại ${SESSION_FILE} (không commit, không chia sẻ).`);
console.log('Bước tiếp theo: node test.mjs');
console.log('(gọi "node test.mjs" trực tiếp — "npm run test --" nuốt mất --flag trên nhiều shell Windows)');
await client.disconnect();
process.exit(0);
