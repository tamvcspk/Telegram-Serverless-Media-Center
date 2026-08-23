import { build } from 'esbuild';
import { injectManifest } from 'workbox-build';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import path from 'node:path';

// Build SW riêng khỏi app — ADR-0012 §1. Chạy SAU `ng build` (browserDir phải
// đã tồn tại để injectManifest quét được các asset cần precache).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const browserDir = path.join(root, 'apps', 'web', 'dist', 'web', 'browser');
const swBundle = path.join(browserDir, 'sw.bundle.js');
const swDest = path.join(browserDir, 'sw.js');

await build({
  entryPoints: [path.join(__dirname, 'sw.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: swBundle
});

const { count, size, warnings } = await injectManifest({
  swSrc: swBundle,
  swDest,
  globDirectory: browserDir,
  // Tên file (ngoài sw.js) do build của app tự hash, an toàn để precache toàn bộ.
  globPatterns: ['**/*.{js,css,html}'],
  globIgnores: ['sw.bundle.js', 'sw.js']
});

await rm(swBundle);

for (const warning of warnings) {
  console.warn(warning);
}
console.log(`sw.js: đã bơm precache manifest cho ${count} file (~${(size / 1024).toFixed(1)} KB).`);
