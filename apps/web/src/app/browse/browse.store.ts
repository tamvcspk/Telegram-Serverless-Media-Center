import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

export type BrowseSort = 'title' | 'year';

interface BrowseState {
  sourceId: string | null;
  query: string;
  sort: BrowseSort;
  columns: number;
}

const initialState: BrowseState = { sourceId: null, query: '', sort: 'title', columns: 2 };

// SignalStore F3 (ADR-0002) — CHỈ giữ truy vấn (nguồn đang lọc, chuỗi tìm
// kiếm, cách sắp xếp) + `columns` (số cột grid hiện tại), KHÔNG giữ mảng
// phim. Dữ liệu phim đọc từ IndexedDB qua resource-style signal ở browse.ts
// — giữ 30k object phim trong store sẽ ngốn RAM và biến mọi filter thành
// một lần copy toàn bộ mảng (ADR-0002). `columns` nằm ở đây (không phải
// signal() trần trong component) vì cả template (grid-template-columns) lẫn
// computed() chunk-theo-hàng đều cần đọc cùng một giá trị.
export const BrowseStore = signalStore(
  withState(initialState),
  withMethods((store) => ({
    setSourceId(sourceId: string | null): void {
      patchState(store, { sourceId });
    },
    setQuery(query: string): void {
      patchState(store, { query });
    },
    setSort(sort: BrowseSort): void {
      patchState(store, { sort });
    },
    setColumns(columns: number): void {
      patchState(store, { columns });
    }
  }))
);
