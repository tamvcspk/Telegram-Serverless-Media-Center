import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Build CLI cho Node THẬT — NGƯỢC với libs/worker-host/build.mjs (bundle cho
// browser, phải polyfill/stub fs/net/tls/crypto vì GramJS không được chạm
// nhánh Node của nó ở đó). Ở đây ngược lại: platform 'node' để esbuild giữ
// nguyên các module Node thật (fs/net/tls/crypto) mà GramJS cần — đây CHÍNH
// LÀ môi trường gốc GramJS nhắm tới, không cần vá gì cả (xem browser-shim.ts:
// chỉ patch globalThis.window khi có `self` mà không có `window`, tức Worker
// global scope thật — tiến trình Node của CLI không có cả hai nên không bị
// patch, GramJS tự nhận đúng "đang chạy Node").
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(__dirname, 'dist', 'cli.js');

await build({
  entryPoints: [path.join(__dirname, 'src', 'cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile,
  // KHÔNG dùng `banner: { js: '#!/usr/bin/env node' }` — cli.ts đã tự có
  // shebang ở dòng đầu, esbuild TỰ hoist shebang có sẵn trong entry point lên
  // đầu output. Thêm banner nữa sẽ tạo HAI dòng shebang (dòng thứ hai không
  // được Node bỏ qua — chỉ dòng ĐẦU TIÊN của file mới được coi là shebang —
  // và `#` không phải cú pháp JS hợp lệ, vỡ ngay khi chạy). Phát hiện thật
  // lúc smoke-test build lần đầu.
  //
  // Bundle @tsmc/* workspace packages (bắt buộc — chỉ là TS thô, main:
  // "src/index.ts", Node không tự chạy được nếu để external). `telegram`/
  // `big-integer` để EXTERNAL — phát hiện thật lúc smoke-test: `telegram`
  // (CJS) có nhánh `require(bienDong)` nội bộ (vd inspect.js require('util')
  // qua biến, không phải string literal tĩnh) mà esbuild không phân tích
  // tĩnh được khi bundle cho platform 'node' — sinh ra "Dynamic require of
  // ... is not supported" lúc CHẠY. Để external, hai package này resolve
  // bình thường qua node_modules thật lúc chạy (đã khai làm dependency trực
  // tiếp của package.json này để pnpm đặt đúng symlink cạnh dist/cli.js).
  external: ['telegram', 'big-integer'],
  logLevel: 'warning'
});

// Node cần quyền thực thi để `tsmc-ingest` (bin) chạy trực tiếp không cần gõ
// `node dist/cli.js`. Không có tác dụng trên Windows (không có bit x thật)
// nhưng vô hại — chạy trên máy admin Windows vẫn qua `node dist/cli.js`.
await chmod(outfile, 0o755);

console.log(`tsmc-ingest: đã build ${outfile}`);
