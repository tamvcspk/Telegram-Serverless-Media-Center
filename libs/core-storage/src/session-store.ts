import Dexie, { type Table } from 'dexie';
import type { SyncEvent, SyncState } from '@tsmc/shared-models';

// Bản ghi session mã hoá (ADR-0011). Mã hoá/giải mã thuộc về core-mtproto —
// package này chỉ lưu/đọc bytes thuần, không chứa logic crypto.
export interface SessionRecord {
  id: 'default';
  apiId: number;
  apiHash: string;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  cryptoKey: CryptoKey;
}

// Con trỏ + trạng thái đồng bộ (ADR-0009/0014) — một bản ghi 'default'/tab.
export interface SyncMetaRecord {
  id: 'default';
  deviceId: string;
  stateChannelId?: string;
  stateChannelAccessHash?: string;
  lastSeenMsgId: number;
  lastSnapshotMsgId?: number;
  lastSnapshotAt?: number;
  lastSyncAt?: number;
  lastError?: string;
}

// SyncState đã vật chất hoá — kết quả replay(snapshot, events), ADR-0009.
export interface SyncStateRecord {
  id: 'default';
  state: SyncState;
}

// Event chưa đẩy lên kênh state — ADR-0009 "Đường ghi".
export interface OutboxRecord {
  localId?: number;
  event: SyncEvent;
  createdAt: number;
}

class TsmcDatabase extends Dexie {
  session!: Table<SessionRecord, string>;
  syncMeta!: Table<SyncMetaRecord, string>;
  syncState!: Table<SyncStateRecord, string>;
  outbox!: Table<OutboxRecord, number>;

  constructor() {
    super('tsmc');
    // Version 1 — chỉ store `session` (slice F1.1).
    this.version(1).stores({
      session: 'id'
    });
    // Version 2 — state riêng tư (slice Sync F1.2/F1.3, ADR-0007/0009).
    // `syncState` giữ đúng một bản ghi 'default' chứa SyncState đã vật chất
    // hoá (progress/collections/sources/settings) — không tách bảng theo
    // từng loại vì UI đọc nguyên khối qua liveQuery, không cần index truy
    // vấn con. `media`/`fileRefs`/`searchIndex` (metadata toàn cục, cache kỹ
    // thuật) vẫn để dành cho slice Index (F2), không thuộc phạm vi ADR-0009.
    this.version(2).stores({
      session: 'id',
      syncMeta: 'id',
      syncState: 'id',
      outbox: '++localId'
    });
  }
}

let db: TsmcDatabase | undefined;

export function getDb(): TsmcDatabase {
  db ??= new TsmcDatabase();
  return db;
}

export async function getSessionRecord(): Promise<SessionRecord | undefined> {
  return getDb().session.get('default');
}

export async function putSessionRecord(record: SessionRecord): Promise<void> {
  await getDb().session.put(record);
}

export async function deleteSessionRecord(): Promise<void> {
  await getDb().session.delete('default');
}
