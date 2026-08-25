import MiniSearch, { type SearchResult } from 'minisearch';

// Tìm kiếm client-side — ADR-0008. Chạy trong Core Worker (worker-host nối
// dây lúc khởi động + sau mỗi lần quét, xem core-worker.ts), index giữ
// trong RAM ở đây, serialize xuống IndexedDB là việc của worker-host (package
// này không tự biết Dexie tồn tại — thuần tính toán, dễ test bằng Node).
//
// PHÁT HIỆN lúc dựng slice F3: ADR-0008 §Cấu hình liệt kê `fileName` là field
// cần index, nhưng CatalogItemV1 (catalog-spec.md, đã Accepted) không có
// field này — item chỉ có title/originalTitle/cast/director/genres. Index
// đúng những field THẬT có; addendum ADR-0008 ghi lại phát hiện này lúc
// doc-sync đóng slice.
export interface SearchDocument {
  sourceId: string;
  msgId: number;
  title?: string;
  originalTitle?: string;
  cast?: string[];
  director?: string;
  genres?: string[];
}

export interface SearchHit {
  sourceId: string;
  msgId: number;
}

export interface SearchOptions {
  sourceId?: string;
  limit?: number;
}

export interface SearchEngine {
  /** Thay TOÀN BỘ doc của một nguồn — dùng cho cả catalog-replace lẫn delta-upsert (idempotent, không cần biết đây là item mới hay đã có). */
  reindexSource(sourceId: string, docs: SearchDocument[]): void;
  /** Xoá đúng 1 doc — dùng khi resolveItemTrust() xác nhận item đã bị xoá khỏi index (F2). */
  discardItem(sourceId: string, msgId: number): void;
  removeSource(sourceId: string): void;
  search(query: string, opts?: SearchOptions): SearchHit[];
  /** JSON string — worker-host ghi xuống bảng `searchIndex` (debounce). */
  serialize(): string;
}

// Chuẩn hoá tiếng Việt (ADR-0008 §Chuẩn hoá tiếng Việt — bắt buộc, áp dụng
// CẢ lúc index lẫn lúc query nên phải là MỘT hàm dùng chung, không viết lại
// ở hai chỗ): lowercase → NFD → bỏ dấu thanh (U+0300–U+036F) → đ/Đ thành d.
// Dải mã điểm viết bằng \uXXXX thay vì dán thẳng ký tự tổ hợp vào mã nguồn —
// cùng quy ước với shared-models/catalog.ts (không ai review được ký tự vô
// hình nằm trong file .ts). U+0300–U+036F = combining diacritical marks.
const VIETNAMESE_TONE_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizeVietnamese(term: string): string {
  return term.toLowerCase().normalize('NFD').replace(VIETNAMESE_TONE_MARKS, '').replace(/đ/g, 'd');
}

const FIELDS = ['title', 'originalTitle', 'cast', 'director', 'genres'] as const;
const STORE_FIELDS = ['sourceId', 'msgId'] as const;

function docId(sourceId: string, msgId: number): string {
  return `${sourceId}:${msgId}`;
}

function toIndexed(doc: SearchDocument): Record<string, unknown> {
  return { id: docId(doc.sourceId, doc.msgId), ...doc };
}

function createMiniSearch(): MiniSearch {
  return new MiniSearch({
    idField: 'id',
    fields: [...FIELDS],
    storeFields: [...STORE_FIELDS],
    processTerm: normalizeVietnamese,
    searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 3 } }
  });
}

// Wrapper lưu xuống: MiniSearch không có API liệt kê lại doc đã nạp theo
// storeFields, nên bookkeeping idsBySource (dùng để discard đúng tập lúc
// reindexSource()/removeSource()) phải tự serialize kèm theo, KHÔNG suy ra
// lại được từ mỗi `mini.toJSON()`.
interface SerializedEnvelope {
  mini: unknown;
  idsBySource: [string, string[]][];
}

/**
 * @param serialized Chuỗi JSON từ `serialize()` của lần chạy trước (bảng
 * `searchIndex`, ADR-0008 §Vòng đời điểm 1) — nạp lại nhanh hơn index lại từ
 * đầu. Bỏ trống nếu chưa có (worker-host tự backfill từ IndexedDB media khi
 * đó, xem core-worker.ts).
 */
export function createSearchEngine(serialized?: string): SearchEngine {
  const envelope = serialized ? (JSON.parse(serialized) as SerializedEnvelope) : undefined;
  const mini = envelope
    ? MiniSearch.loadJSON(JSON.stringify(envelope.mini), {
        idField: 'id',
        fields: [...FIELDS],
        storeFields: [...STORE_FIELDS],
        processTerm: normalizeVietnamese
      })
    : createMiniSearch();

  // MiniSearch không hỗ trợ "xoá theo filter" — phải tự nhớ id nào thuộc
  // nguồn nào để reindexSource()/removeSource() biết discard đúng tập.
  const idsBySource = new Map<string, Set<string>>(envelope?.idsBySource.map(([sourceId, ids]) => [sourceId, new Set(ids)]));

  function trackId(sourceId: string, id: string): void {
    let set = idsBySource.get(sourceId);
    if (!set) {
      set = new Set();
      idsBySource.set(sourceId, set);
    }
    set.add(id);
  }

  function reindexSource(sourceId: string, docs: SearchDocument[]): void {
    const previous = idsBySource.get(sourceId);
    if (previous) {
      for (const id of previous) {
        if (mini.has(id)) {
          mini.discard(id);
        }
      }
    }
    idsBySource.set(sourceId, new Set());
    mini.addAll(docs.map(toIndexed));
    for (const doc of docs) {
      trackId(sourceId, docId(doc.sourceId, doc.msgId));
    }
  }

  function discardItem(sourceId: string, msgId: number): void {
    const id = docId(sourceId, msgId);
    if (mini.has(id)) {
      mini.discard(id);
    }
    idsBySource.get(sourceId)?.delete(id);
  }

  function removeSource(sourceId: string): void {
    const ids = idsBySource.get(sourceId);
    if (!ids) {
      return;
    }
    for (const id of ids) {
      if (mini.has(id)) {
        mini.discard(id);
      }
    }
    idsBySource.delete(sourceId);
  }

  function search(query: string, opts?: SearchOptions): SearchHit[] {
    const sourceId = opts?.sourceId;
    const results: SearchResult[] = mini.search(query, {
      filter: sourceId ? (result) => result['sourceId'] === sourceId : undefined
    });
    const limited = opts?.limit ? results.slice(0, opts.limit) : results;
    return limited.map((r) => ({ sourceId: r['sourceId'] as string, msgId: r['msgId'] as number }));
  }

  function serialize(): string {
    const envelope: SerializedEnvelope = {
      mini: mini.toJSON(),
      idsBySource: [...idsBySource.entries()].map(([sourceId, ids]) => [sourceId, [...ids]])
    };
    return JSON.stringify(envelope);
  }

  return { reindexSource, discardItem, removeSource, search, serialize };
}
