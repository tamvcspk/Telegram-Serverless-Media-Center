#!/usr/bin/env node
// Bộ đo chất lượng re-encode Hạng D (ADR-0023 § 4c.1) — chạy ffmpeg CLI + libvmaf
// trên một clip tham chiếu, in dung lượng/bitrate, VMAF (trung bình, điều hoà, p5, p1),
// tốc độ; và bitrate theo cửa sổ để xem encoder có chia bit theo độ khó cảnh không.
//
// KHÔNG phải một phần của app: chỉ để mọi slice 4c đo cùng một cách. ffmpeg CLI phải là bản
// "full" có `libx264` + `libvmaf` (không phải bản vcpkg đóng gói cùng app).
//
//   node tools/encode-bench/encode-bench.mjs ref   --source <phim> --out <thư-mục> [--at 1800,5400,9000] [--len 20] [--fps 30000/1001]
//   node tools/encode-bench/encode-bench.mjs run   --ref <ref.mkv> [--out <thư-mục>] [--matrix <tên|file.json>] [--only a,b] [--kbps 1450]
//   node tools/encode-bench/encode-bench.mjs trace --dir <thư-mục> --complexity <tên> --names a,b,c
//
// ffmpeg: `--ffmpeg <đường-dẫn-ffmpeg.exe>` hoặc biến môi trường TSMC_BENCH_FFMPEG, mặc định `ffmpeg` trên PATH.
// ffprobe lấy cùng thư mục với ffmpeg (hoặc `--ffprobe`).
//
// Lưu ý Windows (CLAUDE.md): `npm run` nuốt `--flag` — gọi thẳng `node`.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

// ───────────────────────── tham số dòng lệnh ─────────────────────────

const [, , command, ...rest] = process.argv;
const args = new Map();
for (let i = 0; i < rest.length; i += 2) {
  if (!rest[i]?.startsWith('--')) {
    fail(`Tham số lạ: ${rest[i]}`);
  }
  args.set(rest[i].slice(2), rest[i + 1]);
}
const opt = (name, fallback) => args.get(name) ?? fallback;
const need = (name) => opt(name) ?? fail(`Thiếu --${name}`);

const FFMPEG = opt('ffmpeg', process.env.TSMC_BENCH_FFMPEG ?? 'ffmpeg');
const FFPROBE = opt('ffprobe', FFMPEG.replace(/ffmpeg(\.exe)?$/i, (_, ext) => `ffprobe${ext ?? ''}`));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(bin, binArgs, cwd) {
  const r = spawnSync(bin, binArgs, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error) {
    fail(`Không chạy được ${bin}: ${r.error.message}`);
  }
  return r;
}

// ───────────────────────── ma trận cấu hình ─────────────────────────

/** Ngân sách mẫu: 1450k là mức ~2 GB / 3 giờ — ca Hạng D vượt trần điển hình (ADR-0023). */
function builtinMatrix(kbps) {
  const b = `${kbps}k`;
  const max = `${kbps * 2}k`;
  const buf = `${kbps * 4}k`;
  const vbv = `-maxrate ${max} -bufsize ${buf}`;
  return {
    // Hiện trạng trước ADR-0023 — mốc so sánh.
    mf_abr: { video: `-c:v h264_mf -b:v ${b}` },
    // Mặc định mới: preset "Fast" của HandBrake. CRF + trần VBV; 2-pass khi không vừa trần.
    x264_fast_crf22_cap: { video: `-c:v libx264 -preset fast -profile:v high -crf 22 ${vbv}` },
    x264_fast_crf26_cap: { video: `-c:v libx264 -preset fast -profile:v high -crf 26 ${vbv}` },
    x264_fast_2pass: { twoPass: true, video: `-c:v libx264 -preset fast -profile:v high -b:v ${b} ${vbv}` },
    x264_veryfast_2pass: { twoPass: true, video: `-c:v libx264 -preset veryfast -profile:v high -b:v ${b} ${vbv}` },
    x264_medium_2pass: { twoPass: true, video: `-c:v libx264 -preset medium -profile:v high -b:v ${b} ${vbv}` },
    // Một chỗ chỉnh mỗi lần so với x264_fast_2pass — để biết nút nào đáng giá (ADR-0023: gần như không nút nào).
    x264_fast_2pass_aq3: { twoPass: true, video: `-c:v libx264 -preset fast -profile:v high -b:v ${b} ${vbv} -x264-params aq-mode=3` },
    x264_fast_2pass_nombtree: { twoPass: true, video: `-c:v libx264 -preset fast -profile:v high -b:v ${b} ${vbv} -x264-params mbtree=0` }
  };
}

function loadMatrix() {
  const spec = opt('matrix', 'builtin');
  if (spec === 'builtin') {
    return builtinMatrix(Number(opt('kbps', '1450')));
  }
  return JSON.parse(readFileSync(resolve(spec), 'utf8'));
}

// ───────────────────────── ref: dựng clip tham chiếu ─────────────────────────

function cmdRef() {
  const source = resolve(need('source'));
  const outDir = resolve(need('out'));
  const positions = opt('at', '1800,5400,9000').split(',').map(Number);
  const len = Number(opt('len', '20'));
  const fps = opt('fps', '30000/1001');
  mkdirSync(outDir, { recursive: true });

  const lines = [];
  positions.forEach((ss, i) => {
    const seg = join(outDir, `seg${i}.mkv`);
    // FFV1 lossless để mọi encoder thử cùng nhìn một tham chiếu; ép fps/yuv420p như pipeline thật.
    const r = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(ss), '-i', source, '-t', String(len), '-an', '-vf', `fps=${fps},format=yuv420p`, '-c:v', 'ffv1', '-level', '3', seg]);
    if (r.status !== 0) {
      fail(`Dựng đoạn ${i} lỗi: ${r.stderr}`);
    }
    lines.push(`file '${seg.replace(/\\/g, '/')}'`);
  });
  const list = join(outDir, 'segs.txt');
  writeFileSync(list, `${lines.join('\n')}\n`);
  const ref = join(outDir, 'ref.mkv');
  const r = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', ref]);
  if (r.status !== 0) {
    fail(`Ghép tham chiếu lỗi: ${r.stderr}`);
  }
  console.log(`${ref} — ${positions.length} đoạn × ${len}s (${(statSync(ref).size / 1e6).toFixed(0)} MB)`);
}

// ───────────────────────── run: ma trận encode + VMAF ─────────────────────────

function splitArgs(text) {
  return text.split(/\s+/).filter(Boolean);
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** `[rộng, cao]` của video đầu tiên, hoặc `null` nếu không đọc được. */
function videoSize(path) {
  const r = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path]);
  const [w, h] = r.stdout.trim().split(',').map(Number);
  return Number.isFinite(w) && Number.isFinite(h) ? [w, h] : null;
}

function refDurationSec(ref) {
  const r = run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ref]);
  return Number(r.stdout.trim());
}

function cmdRun() {
  const ref = resolve(need('ref'));
  const outDir = resolve(opt('out', dirname(ref)));
  const only = opt('only')?.split(',');
  const matrix = loadMatrix();
  const duration = refDurationSec(ref);
  const refSize = videoSize(ref);
  mkdirSync(outDir, { recursive: true });
  const results = [];

  for (const [name, cfg] of Object.entries(matrix)) {
    if (only && !only.includes(name)) {
      continue;
    }
    const out = join(outDir, `${name}.mp4`);
    const logName = `${name}.vmaf.json`;
    const passLog = join(outDir, `${name}-pass`);
    const began = process.hrtime.bigint();
    if (cfg.twoPass) {
      const p1 = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', ref, ...splitArgs(cfg.video), '-pass', '1', '-passlogfile', passLog, '-an', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null']);
      if (p1.status !== 0) {
        results.push({ name, error: `pass 1: ${p1.stderr.trim().split('\n').pop()}` });
        continue;
      }
    }
    const passArgs = cfg.twoPass ? ['-pass', '2', '-passlogfile', passLog] : [];
    const enc = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', ref, ...splitArgs(cfg.video), ...passArgs, '-an', out]);
    const encSec = Number(process.hrtime.bigint() - began) / 1e9;
    if (enc.status !== 0 || !existsSync(out)) {
      results.push({ name, error: enc.stderr.trim().split('\n').pop() || `exit ${enc.status}` });
      continue;
    }

    // `setpts=N/FRAME_RATE/TB` ép khớp khung theo CHỈ SỐ (cùng cách ADR-0017) — encoder đổi pts không làm lệch cặp.
    // Ghi log bằng đường dẫn tương đối (cwd = outDir) để khỏi escape `C:` của filter graph trên Windows.
    // Bản ra khác kích thước tham chiếu (cấu hình hạ độ phân giải) → phóng về kích thước tham chiếu bằng bicubic
    // trước khi đo, đúng cách người xem thấy (player phóng to). `libvmaf` đòi hai nhánh cùng kích thước.
    const outSize = videoSize(out);
    const upscale = refSize && outSize && (refSize[0] !== outSize[0] || refSize[1] !== outSize[1]) ? `scale=${refSize[0]}:${refSize[1]}:flags=bicubic,` : '';
    const lavfi = `[0:v]${upscale}setpts=N/FRAME_RATE/TB[d];[1:v]setpts=N/FRAME_RATE/TB[r];[d][r]libvmaf=n_threads=${opt('threads', '16')}:log_fmt=json:log_path=${logName}`;
    const v = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', out, '-i', ref, '-lavfi', lavfi, '-f', 'null', '-'], outDir);
    if (v.status !== 0) {
      results.push({ name, error: `VMAF: ${v.stderr.trim().split('\n').pop()}` });
      continue;
    }
    const log = JSON.parse(readFileSync(join(outDir, logName), 'utf8'));
    const frames = log.frames.map((f) => f.metrics.vmaf).sort((a, b) => a - b);
    const bytes = statSync(out).size;
    results.push({
      name,
      size: outSize ? `${outSize[0]}x${outSize[1]}` : '?',
      kbps: Math.round((bytes * 8) / duration / 1000),
      vmaf: round1(log.pooled_metrics.vmaf.mean),
      hmean: round1(log.pooled_metrics.vmaf.harmonic_mean),
      p5: round1(percentile(frames, 0.05)),
      p1: round1(percentile(frames, 0.01)),
      encSec: round1(encSec),
      speedX: round1(duration / encSec)
    });
  }

  console.table(results);
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
}

const round1 = (n) => Math.round(n * 10) / 10;

// ───────────────────────── trace: bitrate + VMAF theo cửa sổ ─────────────────────────

function cmdTrace() {
  const dir = resolve(need('dir'));
  const complexity = need('complexity');
  const names = need('names').split(',');
  const win = Number(opt('window', '3'));
  const fps = Number(opt('fps', String(30000 / 1001)));
  const first = join(dir, `${complexity}.mp4`);
  const total = Math.floor(refDurationSec(first) / win);

  const rates = (name) => {
    const r = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,size', '-of', 'csv=p=0', join(dir, `${name}.mp4`)]);
    const bins = new Array(total).fill(0);
    for (const line of r.stdout.split(/\s+/).filter(Boolean)) {
      const [t, size] = line.split(',');
      const i = Math.floor(Number(t) / win);
      if (Number.isFinite(i) && i >= 0 && i < total) {
        bins[i] += Number(size);
      }
    }
    return bins.map((b) => (b * 8) / win / 1000);
  };
  const vmafWindows = (name) => {
    const path = join(dir, `${name}.vmaf.json`);
    if (!existsSync(path)) {
      return null;
    }
    const v = JSON.parse(readFileSync(path, 'utf8')).frames.map((f) => f.metrics.vmaf);
    const n = Math.round(win * fps);
    return Array.from({ length: total }, (_, i) => mean(v.slice(i * n, (i + 1) * n)));
  };

  // Độ khó cảnh = bitrate của encoder CRF không trần (`complexity`): CRF giữ chất lượng đều nên bitrate ~ độ khó.
  const cx = rates(complexity);
  console.log(`cửa sổ ${win}s · độ khó theo bitrate của "${complexity}"`);
  for (const name of names) {
    const r = rates(name);
    const vw = vmafWindows(name);
    console.log(`${basename(name).padEnd(28)} mean ${mean(r).toFixed(0).padStart(6)} kbps · max/min ${(Math.max(...r) / Math.max(Math.min(...r), 1)).toFixed(1).padStart(5)} · tương quan với độ khó ${correlation(r, cx).toFixed(2)}${vw ? ` · VMAF cửa sổ tệ nhất ${Math.min(...vw).toFixed(1)}` : ''}`);
  }
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

function correlation(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

// ───────────────────────── điều phối ─────────────────────────

switch (command) {
  case 'ref':
    cmdRef();
    break;
  case 'run':
    cmdRun();
    break;
  case 'trace':
    cmdTrace();
    break;
  default:
    fail('Dùng: encode-bench.mjs <ref|run|trace> — xem đầu file.');
}
