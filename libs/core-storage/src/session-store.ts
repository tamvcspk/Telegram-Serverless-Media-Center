import Dexie, { type Table } from 'dexie';
import type { CatalogItemV1, SyncEvent, SyncState } from '@tsmc/shared-models';

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

// Nhãn tin cậy của một item — gán "rẻ" lúc quét (owner/channel-post/list đã
// cache), KHÔNG BAO GIỜ tốn RPC theo từng publisher lúc quét (kênh nhiều
// publisher × RPC riêng lẻ là con đường tới FLOOD_WAIT — ADR-0006). Xác minh
// thật cho publisher CHƯA rõ chỉ xảy ra LÚC ITEM ĐÓ ĐƯỢC TRUY CẬP
// (core-index/trust.ts resolvePublisherTrust) — "eventual correctness":
// đúng dần khi được dùng tới, không đúng ngay từ lúc quét.
// `not-admin` là nhãn lưu trữ hợp lệ, không phải chỉ trạng thái tạm — không
// loại cứng item ở tầng index nữa (tầng hiển thị quyết định ẩn/hiện theo
// trust), xem comment ở core-index/storage-port.ts.
export type TrustLabel = 'owner' | 'channel-post' | 'catalog' | 'verified-admin' | 'not-admin' | 'pending';

// Item media phát hiện được từ một nguồn (kênh) — slice Index (F2), ADR-0010.
// Metadata TOÀN CỤC (không phải state riêng tư — architecture.md §3), khoá
// tự nhiên [sourceId+msgId] vì cùng msgId có thể lặp lại giữa các nguồn
// khác nhau. `sourceId` khớp `id` trong SyncState.sources (shared-models).
export interface MediaRecord extends CatalogItemV1 {
  sourceId: string;
  indexedAt: number;
  trust: TrustLabel;
  /** Chỉ có ở item quét từ lịch sử (T2/T3) — cần để resolvePublisherTrust() sau này. Item catalog (T1) tin cậy ở mức document, không có publisher riêng. */
  publisherId?: string;
}

// Cache "publisher X có phải admin của kênh Y không" — CHỈ ghi khi đã thật
// sự tra cứu (checkPublisherIsAdmin, lúc truy cập), không ghi hàng loạt lúc
// quét. Khoá tự nhiên [sourceId+publisherId] — trust là thuộc tính của
// publisher TRONG một kênh cụ thể, không phải toàn cục.
export interface PublisherTrustRecord {
  sourceId: string;
  publisherId: string;
  isAdmin: boolean;
  fetchedAt: number;
}

// Trạng thái quét mỗi nguồn — ADR-0010. Một bản ghi/`sourceId`.
export interface IndexMetaRecord {
  sourceId: string;
  tier?: 'catalog' | 'delta' | 'full';
  lastIndexedMsgId?: number;
  catalogGeneratedAt?: string;
  /** `null` = Telegram từ chối tiết lộ (CHAT_ADMIN_REQUIRED) — core-index/trust.ts coi là "tin mọi publisher". */
  trustedAdmins?: string[] | null;
  trustedAdminsFetchedAt?: number;
  lastScanAt?: number;
  lastError?: string;
  itemCount?: number;
}

class TsmcDatabase extends Dexie {
  session!: Table<SessionRecord, string>;
  syncMeta!: Table<SyncMetaRecord, string>;
  syncState!: Table<SyncStateRecord, string>;
  outbox!: Table<OutboxRecord, number>;
  media!: Table<MediaRecord, [string, number]>;
  indexMeta!: Table<IndexMetaRecord, string>;
  publisherTrust!: Table<PublisherTrustRecord, [string, string]>;

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
    // Version 3 — metadata toàn cục cho slice Index (F2, ADR-0010). `media`
    // khoá tự nhiên [sourceId+msgId] (một item = một msgId trong MỘT nguồn),
    // index phụ theo `sourceId` để liệt/xoá theo nguồn. `indexMeta` một bản
    // ghi/nguồn — bookkeeping tier/lastIndexedMsgId/cache admin, KHÔNG phải
    // state riêng tư (architecture.md §3: metadata toàn cục không đi vào
    // kênh state, và ngược lại — hai bảng này không bao giờ được đọc/ghi bởi
    // core-sync).
    this.version(3).stores({
      session: 'id',
      syncMeta: 'id',
      syncState: 'id',
      outbox: '++localId',
      media: '[sourceId+msgId], sourceId',
      indexMeta: 'sourceId'
    });
    // Version 4 — trust "eventual correctness" (slice Index F2, brainstorm
    // sau phát hiện thật: gán trust hàng loạt lúc quét dễ đụng FLOOD_WAIT
    // hoặc đoán sai). `media` thêm field `trust`/`publisherId` (không cần
    // khai index mới, Dexie chỉ cần khai PK/field được QUERY qua .where()).
    // `publisherTrust` là cache "publisher X có phải admin kênh Y" — CHỈ ghi
    // khi đã tra cứu thật lúc một item được truy cập, không ghi hàng loạt.
    this.version(4).stores({
      session: 'id',
      syncMeta: 'id',
      syncState: 'id',
      outbox: '++localId',
      media: '[sourceId+msgId], sourceId',
      indexMeta: 'sourceId',
      publisherTrust: '[sourceId+publisherId]'
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
