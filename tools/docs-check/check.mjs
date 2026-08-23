/**
 * TSMC docs-check — kiểm tra tính toàn vẹn của tài liệu.
 *
 *   node tools/docs-check/check.mjs
 *
 * Tài liệu là sản phẩm chính của giai đoạn kiến trúc này, nên nó cần được
 * kiểm bằng máy giống như code. Bốn nhóm lỗi dưới đây đều là lỗi ĐÃ THỰC SỰ
 * XẢY RA khi soạn bộ ADR/spike, chứ không phải phòng xa lý thuyết:
 *
 *   1. LINK   — liên kết .md trỏ tới file không tồn tại
 *   2. ANCHOR — liên kết #anchor trỏ tới heading không tồn tại
 *               (anchor tiếng Việt có dấu + em-dash rất dễ sai: "—" biến
 *                thành HAI dấu gạch nối trong slug của GitHub)
 *   3. TABLE  — dòng trong bảng markdown mất dấu "|" đầu dòng, hoặc lệch số cột
 *   4. SYNC   — ADR có file nhưng thiếu dòng trong index; spike có mục
 *               nhưng thiếu dòng trong bảng tổng quan (và ngược lại)
 *
 * Exit code 1 nếu có lỗi — cắm được thẳng vào CI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const problems = [];
const stats = { files: 0, links: 0, anchors: 0, tables: 0 };

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/**
 * Đọc file và chuẩn hoá xuống dòng về "\n".
 * Repo đang lẫn CRLF và LF. Nếu không chuẩn hoá, ký tự "\r" còn sót lại sẽ
 * khiến regex heading /^#{1,6}\s+(.*)$/ không khớp — vì trong JS "." không
 * match "\r" — làm MỌI anchor trong file CRLF bị báo hỏng oan.
 * Chính checker này đã mắc đúng lỗi đó ở lần chạy đầu tiên.
 */
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');

function fail(file, line, kind, msg) {
  problems.push({ file: rel(file), line, kind, msg });
}

// ---------- thu thập file markdown ----------

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

const mdFiles = walk(ROOT);
stats.files = mdFiles.length;

// ---------- slug kiểu GitHub (giữ nguyên chữ có dấu) ----------

/**
 * GitHub: lowercase → bỏ dấu câu (giữ chữ/số/khoảng trắng/_/-) → khoảng
 * trắng thành "-". Em-dash bao quanh bởi khoảng trắng vì thế để lại HAI
 * gạch nối liên tiếp — nguồn sai anchor phổ biến nhất trong repo này.
 */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Map: đường dẫn file -> Set các anchor hợp lệ */
const anchorsByFile = new Map();
for (const f of mdFiles) {
  const set = new Set();
  let inFence = false;
  for (const line of read(f).split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) set.add(slugify(m[2]));
  }
  anchorsByFile.set(f, set);
}

// ---------- 1 + 2: liên kết & anchor ----------

for (const f of mdFiles) {
  const lines = read(f).split('\n');
  let inFence = false;

  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) return;

    for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) {
        // liên kết anchor nội bộ trong cùng file
        if (target.startsWith('#')) {
          stats.anchors++;
          const anchor = decodeURIComponent(target.slice(1));
          if (!anchorsByFile.get(f).has(anchor)) {
            fail(f, i + 1, 'ANCHOR', `anchor nội bộ "#${anchor}" không khớp heading nào trong chính file này`);
          }
        }
        continue;
      }

      const [filePart, anchorPart] = target.split('#');
      if (!filePart.endsWith('.md')) continue;

      stats.links++;
      const resolved = path.resolve(path.dirname(f), decodeURIComponent(filePart));
      if (!fs.existsSync(resolved)) {
        fail(f, i + 1, 'LINK', `trỏ tới file không tồn tại: ${filePart}`);
        continue;
      }
      if (anchorPart) {
        stats.anchors++;
        const anchor = decodeURIComponent(anchorPart);
        const set = anchorsByFile.get(resolved);
        if (set && !set.has(anchor)) {
          fail(f, i + 1, 'ANCHOR', `"${filePart}#${anchor}" — file có nhưng không có heading nào cho anchor này`);
        }
      }
    }
  });
}

// ---------- 3: toàn vẹn bảng markdown ----------

/** Đếm số ô, bỏ qua "\|" đã escape và "|" nằm trong `inline code`. */
function cellCount(row) {
  const sanitized = row.replace(/`[^`]*`/g, 'X').replace(/\\\|/g, 'X');
  return sanitized.split('|').length - 1;
}

for (const f of mdFiles) {
  const lines = read(f).split('\n');
  let inFence = false;
  let tableStart = -1;
  let expected = 0;

  const endTable = () => { tableStart = -1; expected = 0; };

  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; endTable(); return; }
    if (inFence) return;

    const isRow = /^\s*\|/.test(line);

    if (isRow) {
      if (tableStart === -1) { tableStart = i; expected = cellCount(line); stats.tables++; }
      else if (cellCount(line) !== expected && !/^\s*\|[\s|:-]+\|\s*$/.test(line)) {
        fail(f, i + 1, 'TABLE', `lệch số cột (${cellCount(line)} vs ${expected} của dòng đầu bảng)`);
      }
      return;
    }

    // Đúng lỗi đã từng mắc: dòng bảng bị mất dấu "|" đầu dòng.
    if (tableStart !== -1 && line.trim() !== '' && (line.match(/\|/g) || []).length >= 2) {
      fail(f, i + 1, 'TABLE', 'có vẻ là dòng của bảng nhưng THIẾU dấu "|" ở đầu dòng');
    }
    if (line.trim() === '') endTable();
  });
}

// ---------- 4: đồng bộ index ADR ----------

const adrDir = path.join(ROOT, 'docs/adr');
if (fs.existsSync(adrDir)) {
  const adrFiles = fs.readdirSync(adrDir).filter((n) => /^\d{4}-.*\.md$/.test(n));
  const readmePath = path.join(adrDir, 'README.md');
  const readme = fs.existsSync(readmePath) ? read(readmePath) : '';

  for (const name of adrFiles) {
    if (!readme.includes(`(./${name})`)) {
      fail(readmePath, 0, 'SYNC', `ADR "${name}" có file nhưng THIẾU dòng trong bảng index`);
    }
  }
  for (const m of readme.matchAll(/\(\.\/(\d{4}-[^)]+\.md)\)/g)) {
    if (!adrFiles.includes(m[1])) {
      fail(readmePath, 0, 'SYNC', `index trỏ tới ADR không tồn tại: ${m[1]}`);
    }
  }
}

// ---------- 4b: đồng bộ bảng tổng quan spike ----------

const spikeReadme = path.join(ROOT, 'docs/spikes/README.md');
if (fs.existsSync(spikeReadme)) {
  const src = read(spikeReadme);
  const sections = [...src.matchAll(/^##\s+(SPIKE-\d+)\s*$/gm)].map((m) => m[1]);
  const rows = [...src.matchAll(/\[(SPIKE-\d+)\]\(#spike-\d+\)/g)].map((m) => m[1]);

  for (const s of sections) {
    if (!rows.includes(s)) fail(spikeReadme, 0, 'SYNC', `"${s}" có mục riêng nhưng THIẾU dòng trong bảng tổng quan đầu file`);
  }
  for (const r of rows) {
    if (!sections.includes(r)) fail(spikeReadme, 0, 'SYNC', `bảng tổng quan có "${r}" nhưng không có mục "## ${r}" tương ứng`);
  }
}

// ---------- báo cáo ----------

console.log(`docs-check · ${stats.files} file .md · ${stats.links} liên kết · ${stats.anchors} anchor · ${stats.tables} bảng\n`);

if (problems.length === 0) {
  console.log('✅ Không phát hiện vấn đề.');
  process.exit(0);
}

const byKind = {};
for (const p of problems) (byKind[p.kind] ??= []).push(p);

for (const [kind, list] of Object.entries(byKind)) {
  console.log(`${kind} (${list.length}):`);
  for (const p of list) console.log(`  ${p.file}${p.line ? ':' + p.line : ''} — ${p.msg}`);
  console.log();
}
console.log(`❌ ${problems.length} vấn đề.`);
process.exit(1);
