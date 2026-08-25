import type { CatalogItemV1 } from '@tsmc/shared-models';
import { getDb, type IndexMetaRecord, type MediaRecord, type PublisherTrustRecord } from './session-store';

// Item đầu vào để lưu — CatalogItemV1 (spec công khai) + trust/publisherId
// (bookkeeping nội bộ, KHÔNG thuộc catalog-spec.md). Tách khỏi MediaRecord vì
// MediaRecord còn có sourceId/indexedAt do chính hàm lưu gán, caller không tự cung cấp.
export type MediaItemInput = CatalogItemV1 & Pick<MediaRecord, 'trust'> & Partial<Pick<MediaRecord, 'publisherId'>>;

export async function getIndexMeta(sourceId: string): Promise<IndexMetaRecord> {
  const record = await getDb().indexMeta.get(sourceId);
  return record ?? { sourceId };
}

export async function putIndexMeta(sourceId: string, patch: Partial<Omit<IndexMetaRecord, 'sourceId'>>): Promise<IndexMetaRecord> {
  const current = await getIndexMeta(sourceId);
  const next: IndexMetaRecord = { ...current, ...patch, sourceId };
  await getDb().indexMeta.put(next);
  return next;
}

/** Tier catalog — thay TOÀN BỘ item của nguồn trong một transaction (catalog luôn là ảnh chụp đầy đủ mới nhất). */
export async function replaceMediaItems(sourceId: string, items: MediaItemInput[]): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.media, async () => {
    await db.media.where('sourceId').equals(sourceId).delete();
    const now = Date.now();
    await db.media.bulkPut(items.map((item): MediaRecord => ({ ...item, sourceId, indexedAt: now })));
  });
}

/** Tier delta/full — cộng dồn theo [sourceId+msgId]. */
export async function upsertMediaItems(sourceId: string, items: MediaItemInput[]): Promise<void> {
  const now = Date.now();
  await getDb().media.bulkPut(items.map((item): MediaRecord => ({ ...item, sourceId, indexedAt: now })));
}

export async function deleteMediaBySource(sourceId: string): Promise<void> {
  await getDb().media.where('sourceId').equals(sourceId).delete();
}

export async function countMediaBySource(sourceId: string): Promise<number> {
  return getDb().media.where('sourceId').equals(sourceId).count();
}

export async function listMediaBySource(sourceId: string): Promise<MediaRecord[]> {
  return getDb().media.where('sourceId').equals(sourceId).toArray();
}

export async function getMediaItem(sourceId: string, msgId: number): Promise<MediaRecord | undefined> {
  return getDb().media.get([sourceId, msgId]);
}

/** Sửa CHỈ field trust của một item đã có — dùng khi resolvePublisherTrust() xác minh xong lúc truy cập. */
export async function updateMediaItemTrust(sourceId: string, msgId: number, trust: MediaRecord['trust']): Promise<void> {
  await getDb().media.update([sourceId, msgId], { trust });
}

/** Item bị xác nhận KHÔNG phải admin sau khi truy cập — xoá khỏi index thay vì giữ lại gắn nhãn xấu (ADR-0010 §3: không để nội dung không đáng tin lẫn vào thư viện chung). */
export async function deleteMediaItem(sourceId: string, msgId: number): Promise<void> {
  await getDb().media.delete([sourceId, msgId]);
}

export async function getPublisherTrust(sourceId: string, publisherId: string): Promise<PublisherTrustRecord | undefined> {
  return getDb().publisherTrust.get([sourceId, publisherId]);
}

export async function putPublisherTrust(sourceId: string, publisherId: string, isAdmin: boolean, fetchedAt: number): Promise<void> {
  await getDb().publisherTrust.put({ sourceId, publisherId, isAdmin, fetchedAt });
}
