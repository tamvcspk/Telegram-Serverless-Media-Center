// State riêng tư đã vật chất hoá — kết quả của replay(snapshot, events) ở
// core-sync. Đây KHÔNG phải schema lưu trong Dexie (đó là việc của
// core-storage) và KHÔNG phải metadata toàn cục (đó là catalog.json).

export interface ProgressEntry {
  /** k = "src:<sourceId>/msg:<msgId>" — xem ADR-0009. */
  k: string;
  /** Vắng mặt khi `cleared: true` (tombstone — xem reducer.ts). */
  p?: number;
  ts: number;
  dev: string;
  /**
   * Tombstone cho progress.clear. Cần giữ ts/dev thay vì xoá thẳng khỏi
   * state: một sự kiện progress.set với ts CŨ hơn có thể được replay SAU sự
   * kiện clear (log là total order theo message_id, không theo ts) — không
   * có tombstone thì LWW-theo-ts sẽ sai, event set cũ sẽ "thắng" chỉ vì nó
   * được áp dụng sau.
   */
  cleared?: boolean;
}

export interface Collection {
  id: string;
  name: string;
  /** ts/dev của lần rename gần nhất — dùng để hoà giải LWW. */
  ts: number;
  dev: string;
  /** Thành viên collection — add-wins, không mang ts riêng theo item. */
  items: string[];
  deleted?: boolean;
}

export interface SourceRef {
  id: string;
  ref: string;
  ts: number;
  dev: string;
  patch?: Record<string, unknown>;
  removed?: boolean;
}

export interface SettingValue {
  val: unknown;
  ts: number;
  dev: string;
}

export interface SyncState {
  progress: Record<string, ProgressEntry>;
  collections: Record<string, Collection>;
  sources: Record<string, SourceRef>;
  settings: Record<string, SettingValue>;
}

export function createEmptySyncState(): SyncState {
  return { progress: {}, collections: {}, sources: {}, settings: {} };
}

/** Snapshot đã ghim trong kênh state — SyncState + con trỏ message gốc. */
export interface SnapshotV1 {
  v: 1;
  state: SyncState;
  /** message_id của event cuối cùng đã được nén vào snapshot này. */
  baseMsgId: number;
}
