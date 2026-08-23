import * as Comlink from 'comlink';
import type { CoreWorkerApi } from './core-worker';

export const LIB_NAME = '@tsmc/worker-host' as const;

// apps/web KHÔNG được import core-mtproto/core-download trực tiếp — chỉ qua
// hàm này (ADR-0012 §2, CLAUDE.md bất biến #4). Mỗi lời gọi tạo một Core
// Worker riêng cho tab hiện tại.
//
// '/core-worker.js' là file TĨNH được build.mjs bundle riêng (esbuild +
// polyfill Node cho GramJS — xem README), KHÔNG phải qua
// `new URL('./core-worker.ts', import.meta.url)` như slice nền workspace
// ban đầu: Angular esbuild builder không có hook chèn plugin polyfill cần
// thiết. Đặt trong apps/web/public/ để cả `ng serve` lẫn `ng build` đều
// phục vụ được — xem ADR-0012 addendum.
export function createCoreWorkerClient(): Comlink.Remote<CoreWorkerApi> {
  const worker = new Worker('/core-worker.js', { type: 'module' });
  return Comlink.wrap<CoreWorkerApi>(worker);
}
