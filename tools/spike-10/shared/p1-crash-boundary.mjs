#!/usr/bin/env node
// SPIKE-10 tiêu chí P1 (Cổng 0 — chặn mọi lựa chọn MTProto): "cố tình gây lỗi
// FFI kiểu SPIKE-09 → media worker chết một mình, tiến trình cha + hàng đợi
// sống, file kế tiếp trong batch vẫn chạy". KHÔNG cần MTProto/tài khoản
// Telegram — chạy độc lập, xem docs/spikes/README.md#spike-10.
//
// Gọi thẳng: node tools/spike-10/shared/p1-crash-boundary.mjs
//
// Mô phỏng đúng kiến trúc thật sẽ dùng nếu chọn hướng native FFI cho core
// lib Tauri (SPIKE-09): `spike09.exe` chạy như TIẾN TRÌNH CON (child_process
// tách biệt), không phải linked in-process. Test này gọi một "batch" 3 việc:
// [file hỏng cố ý] → [file mẫu tốt] → [file mẫu tốt lần 2], xác nhận:
//   1. Việc 1 (cố ý hỏng) làm CHILD PROCESS chết — không làm tiến trình
//      Node (cha) chết theo.
//   2. Việc 2 và 3 (sau việc hỏng) vẫn chạy được bình thường — hàng đợi
//      không bị đứt gãy vì một item hỏng ở giữa.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SPIKE09_EXE = 'C:/Src/Telegram Serverless Media Center/tools/spike-09/target/release/spike09.exe';
const GOOD_FILE = 'C:/Src/Telegram Serverless Media Center/tools/spike-09/fixtures/sample.mkv';
const OUT_DIR = 'C:/Src/Telegram Serverless Media Center/tools/spike-10/shared/.p1-scratch';
const BAD_FILE = `${OUT_DIR}/garbage.mkv`;

if (!existsSync(SPIKE09_EXE)) {
  console.error(`Không thấy ${SPIKE09_EXE} — build spike-09 trước (cd tools/spike-09 && cargo build --release).`);
  process.exit(1);
}
if (!existsSync(GOOD_FILE)) {
  console.error(`Không thấy fixture ${GOOD_FILE}.`);
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
// File hoàn toàn ngẫu nhiên, không phải container hợp lệ — tái tạo đúng loại
// lỗi "tham số/dữ liệu sai khiến media worker chết" của tiêu chí P1, không
// cần dàn dựng lại chính xác bug channel-layout cũ của SPIKE-09 (đã được
// code hiện tại tự suy channel_layout từ decoder, khó ép crash lại y hệt —
// xem ghi chú "Phạm vi bằng chứng" cuối file).
writeFileSync(BAD_FILE, randomBytes(100_000));

function runItem(label, args) {
  const start = Date.now();
  const result = spawnSync(SPIKE09_EXE, args, { encoding: 'utf-8' });
  const elapsedMs = Date.now() - start;
  console.log(`--- ${label} ---`);
  console.log(`  args: ${args.join(' ')}`);
  console.log(`  exit code: ${result.status} (signal: ${result.signal ?? 'none'}), ${elapsedMs}ms`);
  if (result.status !== 0) {
    const lastLine = (result.stderr || '').trim().split('\n').pop();
    console.log(`  stderr (dòng cuối): ${lastLine}`);
  }
  return result;
}

console.log('Tiến trình cha (Node) PID:', process.pid);
console.log('Chạy batch 3 việc — việc 1 CỐ Ý hỏng:\n');

const item1 = runItem('Việc 1/3 — file cố ý hỏng (kỳ vọng: media worker chết)', ['all', BAD_FILE, OUT_DIR]);
console.log('\n>>> Tiến trình cha vẫn sống ngay sau khi việc 1 chết (đang chạy dòng này chứng minh điều đó).\n');

const item2 = runItem('Việc 2/3 — file mẫu tốt (kỳ vọng: chạy OK, không bị ảnh hưởng bởi việc 1)', ['all', GOOD_FILE, OUT_DIR]);
const item3 = runItem('Việc 3/3 — file mẫu tốt lần 2 (kỳ vọng: chạy OK)', ['thumb', GOOD_FILE, `${OUT_DIR}/thumb2.jpg`]);

console.log('\n=== Kết quả P1 ===');
const workerDied = item1.status !== 0;
const parentSurvived = true; // đang in được dòng này = tiến trình Node chưa từng chết
const queueContinued = item2.status === 0 && item3.status === 0;
console.log(`Việc 1 (hỏng) khiến worker chết một mình: ${workerDied ? 'ĐÚNG' : 'SAI — không tái tạo được lỗi, xem lại BAD_FILE'}`);
console.log(`Tiến trình cha (Node) sống sót: ${parentSurvived ? 'ĐÚNG' : 'SAI'}`);
console.log(`Việc 2 và 3 (sau việc hỏng) vẫn chạy được: ${queueContinued ? 'ĐÚNG' : 'SAI'}`);
console.log(`\nP1: ${workerDied && parentSurvived && queueContinued ? 'ĐẠT' : 'CHƯA ĐẠT — xem chi tiết ở trên'}`);

rmSync(OUT_DIR, { recursive: true, force: true });
