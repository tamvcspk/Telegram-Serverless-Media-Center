import { build } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';
import { brotliCompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Build Core Worker riêng khỏi Angular CLI — ADR-0012 addendum. GramJS cần
// polyfill fs/net/tls không có trong esbuild builder của Angular; cấu hình
// dưới đây tái dùng NGUYÊN XI cấu hình đã kiểm chứng thật ở SPIKE-03
// (236 KB brotli, ~110ms init trên Chrome thật) — không đoán lại.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(__dirname, '..', '..', 'apps', 'web', 'public', 'core-worker.js');

await build({
  entryPoints: [path.join(__dirname, 'src', 'core-worker.ts')],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  outfile,
  plugins: [polyfillNode({ globals: { process: true, buffer: true } })],
  // fs/net không có polyfill browser có nghĩa — GramJS chỉ chạm chúng trên
  // nhánh code dành cho Node (session lưu file, transport TCP thô); stub
  // rỗng để xác nhận nhánh browser (WebSocket) không thực sự gọi tới.
  alias: {
    fs: path.join(__dirname, 'stub-empty.js'),
    net: path.join(__dirname, 'stub-empty.js'),
    tls: path.join(__dirname, 'stub-empty.js')
  },
  logLevel: 'warning'
});

const raw = readFileSync(outfile);
const brotli = brotliCompressSync(raw);
console.log(`core-worker.js: ${(raw.length / 1024).toFixed(1)} KB raw, ${(brotli.length / 1024).toFixed(1)} KB brotli.`);
