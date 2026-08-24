// Sự kiện đồng bộ cho state riêng tư — ADR-0009. Message text trong kênh
// state, giới hạn 4096 ký tự nên khoá viết tắt (dev/k/p/id...). KHÔNG áp
// dụng cho metadata toàn cục (catalog.json) — xem architecture.md §3.

export interface SyncEventBase {
  v: 1;
  ts: number;
  dev: string;
}

export interface ProgressSetEvent extends SyncEventBase {
  op: 'progress.set';
  k: string;
  p: number;
}

export interface ProgressClearEvent extends SyncEventBase {
  op: 'progress.clear';
  k: string;
}

export interface CollectionCreateEvent extends SyncEventBase {
  op: 'collection.create';
  id: string;
  name: string;
}

export interface CollectionRenameEvent extends SyncEventBase {
  op: 'collection.rename';
  id: string;
  name: string;
}

export interface CollectionDeleteEvent extends SyncEventBase {
  op: 'collection.delete';
  id: string;
}

export interface CollectionAddEvent extends SyncEventBase {
  op: 'collection.add';
  id: string;
  item: string;
}

export interface CollectionRemoveEvent extends SyncEventBase {
  op: 'collection.remove';
  id: string;
  item: string;
}

export interface SourceAddEvent extends SyncEventBase {
  op: 'source.add';
  id: string;
  ref: string;
}

export interface SourceRemoveEvent extends SyncEventBase {
  op: 'source.remove';
  id: string;
}

export interface SourceConfigureEvent extends SyncEventBase {
  op: 'source.configure';
  id: string;
  patch: Record<string, unknown>;
}

export interface SettingsSetEvent extends SyncEventBase {
  op: 'settings.set';
  k: string;
  val: unknown;
}

export type SyncEvent =
  | ProgressSetEvent
  | ProgressClearEvent
  | CollectionCreateEvent
  | CollectionRenameEvent
  | CollectionDeleteEvent
  | CollectionAddEvent
  | CollectionRemoveEvent
  | SourceAddEvent
  | SourceRemoveEvent
  | SourceConfigureEvent
  | SettingsSetEvent;

// `Omit<Union, K>` KHÔNG tự phân phối qua từng nhánh của union — `keyof`
// một union chỉ trả về các khoá CHUNG cho mọi nhánh, nên Omit thẳng sẽ sụp
// SyncEvent về mỗi `{ op }`, mất hết field riêng (k/p/id/name/...). Điều
// kiện phân phối `T extends unknown ? ... : never` buộc TS áp Omit lên
// TỪNG nhánh riêng rồi mới hợp lại thành union.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Phần payload người gọi cung cấp — `v`/`ts`/`dev` do sync engine tự điền. */
export type SyncEventInput = DistributiveOmit<SyncEvent, keyof SyncEventBase>;

const SYNC_EVENT_OPS: ReadonlySet<SyncEvent['op']> = new Set([
  'progress.set',
  'progress.clear',
  'collection.create',
  'collection.rename',
  'collection.delete',
  'collection.add',
  'collection.remove',
  'source.add',
  'source.remove',
  'source.configure',
  'settings.set'
]);

/**
 * Message trong kênh state là biên ngoài (dù tự mình ghi) — có thể hỏng do
 * bug/migration cũ/thiết bị khác chạy version mới hơn. Sự kiện không nhận
 * dạng được thì bỏ qua thay vì làm vỡ toàn bộ replay (tương thích xuôi).
 */
export function isSyncEvent(value: unknown): value is SyncEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate['v'] === 1 &&
    typeof candidate['ts'] === 'number' &&
    typeof candidate['dev'] === 'string' &&
    typeof candidate['op'] === 'string' &&
    SYNC_EVENT_OPS.has(candidate['op'] as SyncEvent['op'])
  );
}
