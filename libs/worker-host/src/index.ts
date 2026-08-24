import * as Comlink from 'comlink';
import type { CoreWorkerApi } from './core-worker';

export const LIB_NAME = '@tsmc/worker-host' as const;

// apps/web KHÔNG được import core-mtproto/core-download trực tiếp — chỉ qua
// hàm này (ADR-0012 §2, CLAUDE.md bất biến #4).
//
// '/core-worker.js' là file TĨNH được build.mjs bundle riêng (esbuild +
// polyfill Node cho GramJS — xem README), KHÔNG phải qua
// `new URL('./core-worker.ts', import.meta.url)` như slice nền workspace
// ban đầu: Angular esbuild builder không có hook chèn plugin polyfill cần
// thiết. Đặt trong apps/web/public/ để cả `ng serve` lẫn `ng build` đều
// phục vụ được — xem ADR-0012 addendum.
//
// Singleton cấp module — ĐÚNG MỘT Core Worker cho cả tab (ADR-0004: "Core
// Worker (Dedicated Worker) thuộc sở hữu của tab", số ít). Bug thật đã xảy
// ra khi bỏ singleton này: Login và SyncStatus mỗi component tự gọi hàm
// này trong field initializer riêng, tạo ra HAI Worker độc lập — Login đăng
// nhập + initSync() trên worker A, còn SyncStatus.setSetting()/forceFlush()
// gọi vào worker B chưa từng init() (outbox rỗng) → mutate() ném lỗi bị
// nuốt, forceFlush() no-op qua optional chaining, không có triệu chứng lỗi
// nào lộ ra ngoài ngoài "sự kiện chờ gửi luôn = 0". Bản đọc (liveQuery) vẫn
// đúng vì nó đọc thẳng IndexedDB từ main thread, không qua RPC — đó là lý
// do "channel đã được tạo" hiện đúng trong khi ghi lại im lặng thất bại.
let client: Comlink.Remote<CoreWorkerApi> | undefined;

export function createCoreWorkerClient(): Comlink.Remote<CoreWorkerApi> {
  client ??= Comlink.wrap<CoreWorkerApi>(new Worker('/core-worker.js', { type: 'module' }));
  return client;
}
