#!/usr/bin/env node
// SPIKE-10 bước 1 ("Cách chạy" — docs/spikes/README.md#spike-10): sinh file
// mẫu tổng hợp ≥2 GB bằng ffmpeg (testsrc2 + sine), KHÔNG dùng phim thật —
// vừa tránh commit media (CLAUDE.md), vừa tránh đẩy nội dung có bản quyền
// lên kênh test. Cùng nguyên tắc file mẫu tổng hợp đã dùng ở SPIKE-09
// (tools/spike-09/fixtures) và ADR-0013 § verify Hạng C.
//
// Gọi thẳng: node tools/spike-10/shared/generate-sample.mjs [--seconds N] [--out PATH]
// KHÔNG dùng "npm run ... -- --flag" (PowerShell nuốt mất --flag, xem CLAUDE.md).

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

function parseArgs(argv) {
  const out = { seconds: 1600, out: 'sample-2gb.mp4' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seconds') out.seconds = Number(argv[++i]);
    else if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}

const { seconds, out } = parseArgs(process.argv.slice(2));

// PHÁT HIỆN THẬT (2026-09-06): `-b:v 20M -maxrate 20M -minrate 20M` KHÔNG ép
// được libx264 ra đúng 20 Mbps — nội dung testsrc2 (test pattern tĩnh) quá
// dễ nén, và libx264 không tự thêm filler bits để độn cho đủ CBR danh
// nghĩa. Đo thật hai lần độc lập (chạy 900s và 5s) đều ra ~11.85 Mbps thật,
// bất kể đặt `-b:v` bao nhiêu trong khoảng thử — coi đây là tốc độ nén thật
// của nội dung này ở preset `veryfast`, không cố ép bitrate nữa. Bù lại
// bằng THỜI LƯỢNG: 900s thật đo được 1.31 GiB → mặc định 1600s để chắc chắn
// vượt 2 GiB (~2.33 GiB dự kiến, còn dư biên độ an toàn). Khi đổi
// `--seconds`, ước lượng nhanh: size_GiB ≈ seconds × 1.31 / 900.
const args = [
  '-y',
  '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=25:duration=${seconds}`,
  '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
  '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '20M', '-maxrate', '20M', '-bufsize', '40M',
  '-c:a', 'aac', '-b:a', '128k',
  '-movflags', '+faststart',
  '-pix_fmt', 'yuv420p',
  out
];

console.log(`ffmpeg ${args.join(' ')}`);
const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('ffmpeg thất bại — cần ffmpeg trên PATH (kiểm tra: ffmpeg -version).');
  process.exit(result.status ?? 1);
}

if (!existsSync(out)) {
  console.error(`Không thấy file output ${out} sau khi ffmpeg chạy xong.`);
  process.exit(1);
}
const { size } = statSync(out);
console.log(`Xong: ${out} — ${(size / 1024 / 1024).toFixed(1)} MiB (${size} byte).`);
if (size < 2 * 1024 * 1024 * 1024) {
  console.warn('CẢNH BÁO: file nhỏ hơn 2 GiB (tiêu chí M2/M3/M7 cần ≥2 GB) — tăng --seconds và chạy lại.');
}
