// SPIKE-03: build bundle browser cho GramJS / teleproto và đo kích thước.
// Chạy: node tools/spike-03/build.mjs
import { build } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

async function bundle(entry, outfile, label) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    minify: true,
    outfile,
    plugins: [polyfillNode({ globals: { process: true, buffer: true } })],
    // fs/net không có polyfill browser có nghĩa — GramJS chỉ chạm chúng trên
    // nhánh code dành cho Node (session lưu file, transport TCP thô);
    // stub rỗng để xác nhận nhánh browser (WebSocket) không thực sự gọi tới.
    alias: { fs: path.join(ROOT, 'stub-empty.js'), net: path.join(ROOT, 'stub-empty.js'), tls: path.join(ROOT, 'stub-empty.js') },
    metafile: true,
    logLevel: 'warning',
  }).catch((err) => {
    console.log(`\n✗ ${label}: BUNDLE THẤT BẠI`);
    console.log(err.message.split('\n').slice(0, 8).join('\n'));
    return null;
  });

  if (!result) return null;

  const raw = readFileSync(outfile);
  const gz = gzipSync(raw, { level: 9 });
  const br = brotliCompressSync(raw);
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';

  console.log(`\n${label}`);
  console.log(`  raw     : ${kb(raw.length)}`);
  console.log(`  gzip    : ${kb(gz.length)}`);
  console.log(`  brotli  : ${kb(br.length)}`);
  return { raw: raw.length, gzip: gz.length, brotli: br.length };
}

const gramjs = await bundle(path.join(ROOT, 'entry-gramjs.js'), path.join(ROOT, 'dist-gramjs.js'), 'GramJS (telegram@latest)');
const teleprotoEntry = path.join(ROOT, '../spike-03-teleproto/entry-teleproto.js');
const teleproto = await bundle(teleprotoEntry, path.join(ROOT, '../spike-03-teleproto/dist-teleproto.js'), 'teleproto (fork đang bảo trì)');

console.log('\n--- Tóm tắt (brotli, so với ngưỡng app-shell 300 KB ở ADR SPIKE-03) ---');
if (gramjs) console.log(`GramJS   : ${(gramjs.brotli / 1024).toFixed(1)} KB`);
if (teleproto) console.log(`teleproto: ${(teleproto.brotli / 1024).toFixed(1)} KB`);
