import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  countMediaBySource,
  deleteMediaBySource,
  deleteMediaItem,
  getIndexMeta,
  getMediaItem,
  getPublisherTrust,
  listAllMedia,
  listMediaBySource,
  putIndexMeta,
  putPublisherTrust,
  replaceMediaItems,
  updateMediaItemTrust,
  upsertMediaItems,
  type MediaItemInput
} from './media-store';

const itemA: MediaItemInput = { msgId: 1, title: 'Phim A', trust: 'owner' };
const itemB: MediaItemInput = { msgId: 2, title: 'Phim B', trust: 'owner' };

describe('@tsmc/core-storage media store', () => {
  it('getIndexMeta(): trả về mặc định khi chưa có bản ghi', async () => {
    expect(await getIndexMeta('src-empty')).toEqual({ sourceId: 'src-empty' });
  });

  it('putIndexMeta(): merge từng phần thay vì ghi đè toàn bộ', async () => {
    await putIndexMeta('src-1', { tier: 'delta', lastIndexedMsgId: 5 });
    await putIndexMeta('src-1', { lastIndexedMsgId: 9 });

    const meta = await getIndexMeta('src-1');
    expect(meta.tier).toBe('delta');
    expect(meta.lastIndexedMsgId).toBe(9);
  });

  it('replaceMediaItems(): thay TOÀN BỘ item của nguồn, không ảnh hưởng nguồn khác', async () => {
    await upsertMediaItems('src-other', [itemA]);
    await replaceMediaItems('src-2', [itemA, itemB]);
    expect(await countMediaBySource('src-2')).toBe(2);

    await replaceMediaItems('src-2', [itemB]);
    const items = await listMediaBySource('src-2');
    expect(items).toHaveLength(1);
    expect(items[0]?.msgId).toBe(2);

    // Nguồn khác không bị đụng tới bởi replace của src-2.
    expect(await countMediaBySource('src-other')).toBe(1);

    await deleteMediaBySource('src-2');
    await deleteMediaBySource('src-other');
  });

  it('upsertMediaItems(): cộng dồn theo [sourceId+msgId], ghi đè nếu trùng msgId', async () => {
    await upsertMediaItems('src-3', [itemA]);
    await upsertMediaItems('src-3', [{ ...itemA, title: 'Phim A (sửa)' }, itemB]);

    const items = await listMediaBySource('src-3');
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.msgId === 1)?.title).toBe('Phim A (sửa)');

    await deleteMediaBySource('src-3');
  });

  it('deleteMediaBySource(): xoá hết item của một nguồn', async () => {
    await upsertMediaItems('src-4', [itemA, itemB]);
    expect(await countMediaBySource('src-4')).toBe(2);

    await deleteMediaBySource('src-4');
    expect(await countMediaBySource('src-4')).toBe(0);
  });

  it('getMediaItem()/updateMediaItemTrust()/deleteMediaItem() — cho resolvePublisherTrust() lúc truy cập (eventual correctness)', async () => {
    await upsertMediaItems('src-5', [{ ...itemA, trust: 'pending', publisherId: 'u1' }]);

    const item = await getMediaItem('src-5', 1);
    expect(item).toMatchObject({ trust: 'pending', publisherId: 'u1' });

    await updateMediaItemTrust('src-5', 1, 'verified-admin');
    expect((await getMediaItem('src-5', 1))?.trust).toBe('verified-admin');

    await deleteMediaItem('src-5', 1);
    expect(await getMediaItem('src-5', 1)).toBeUndefined();
  });

  it('listAllMedia(): gộp item của MỌI nguồn — slice Browse (F3)', async () => {
    await replaceMediaItems('src-8a', [itemA]);
    await replaceMediaItems('src-8b', [itemB]);

    const all = await listAllMedia();
    expect(all.some((i) => i.sourceId === 'src-8a' && i.msgId === 1)).toBe(true);
    expect(all.some((i) => i.sourceId === 'src-8b' && i.msgId === 2)).toBe(true);

    await deleteMediaBySource('src-8a');
    await deleteMediaBySource('src-8b');
  });

  it('getPublisherTrust()/putPublisherTrust() — cache theo [sourceId+publisherId], độc lập giữa các nguồn', async () => {
    expect(await getPublisherTrust('src-6', 'u1')).toBeUndefined();

    await putPublisherTrust('src-6', 'u1', true, 1000);
    expect(await getPublisherTrust('src-6', 'u1')).toEqual({ sourceId: 'src-6', publisherId: 'u1', isAdmin: true, fetchedAt: 1000 });

    // Cùng publisherId nhưng khác source → cache riêng, không lẫn.
    expect(await getPublisherTrust('src-7', 'u1')).toBeUndefined();
  });
});
