// Tìm kiếm client-side (MiniSearch, ADR-0008). Chạy trong Core Worker,
// worker-host/core-worker.ts nạp/lưu chuỗi serialize từ @tsmc/core-storage —
// package này không tự biết Dexie tồn tại (thuần tính toán, test bằng Node).
export const LIB_NAME = '@tsmc/core-search' as const;

export { createSearchEngine } from './search-engine';
export type { SearchEngine, SearchDocument, SearchHit, SearchOptions } from './search-engine';
