import { describe, expect, it, vi } from 'vitest';
import { NotChannelOwnerError, publishCatalogMetadata } from './publish-catalog';
import { createFakeGateway, createFakeStorage, makeChannel } from './test-fakes';
import type { StoredMediaItem } from './storage-port';

const ITEM_A: StoredMediaItem = { msgId: 1, title: 'Phim A', year: 2020, trust: 'owner' };
const ITEM_B: StoredMediaItem = { msgId: 2, title: 'Phim B', trust: 'owner', publisherId: 'me' };

describe('publishCatalogMetadata', () => {
  it('kênh không phải của mình (isOwn=false) → NotChannelOwnerError, KHÔNG gọi publishCatalogDocument', async () => {
    const publishCatalogDocument = vi.fn();
    const gateway = createFakeGateway({ publishCatalogDocument });
    const storage = createFakeStorage();

    await expect(publishCatalogMetadata(gateway, storage, 'src1', makeChannel({ isOwn: false }), 1, { title: 'X' })).rejects.toBeInstanceOf(
      NotChannelOwnerError
    );
    expect(publishCatalogDocument).not.toHaveBeenCalled();
  });

  it('đóng gói TOÀN BỘ item của nguồn (không chỉ item vừa sửa), áp patch đúng item theo msgId', async () => {
    const storage = createFakeStorage();
    await storage.replaceMediaItems('src1', [ITEM_A, ITEM_B]);
    let publishedJson = '';
    const gateway = createFakeGateway({
      publishCatalogDocument: async (_channelId, json) => {
        publishedJson = json;
        return { msgId: 99 };
      }
    });

    await publishCatalogMetadata(gateway, storage, 'src1', makeChannel({ id: 'c1', title: 'Kho Phim', isOwn: true }), 1, {
      title: 'Phim A (sửa)',
      year: 2021
    });

    const envelope = JSON.parse(publishedJson);
    expect(envelope.spec).toBe('tsmc-catalog/1');
    expect(envelope.channel).toEqual({ id: 'c1', title: 'Kho Phim' });
    expect(envelope.items).toHaveLength(2);
    expect(envelope.items.find((i: { msgId: number }) => i.msgId === 1)).toMatchObject({ title: 'Phim A (sửa)', year: 2021 });
    // Item KHÔNG bị sửa giữ nguyên — không mang theo trust/publisherId (bookkeeping nội bộ).
    expect(envelope.items.find((i: { msgId: number }) => i.msgId === 2)).toEqual({ msgId: 2, title: 'Phim B' });
  });

  it('ghim đè lên catalog cũ — truyền đúng previousMsgId từ getPinnedCatalogDocument hiện tại', async () => {
    const storage = createFakeStorage();
    await storage.replaceMediaItems('src1', [ITEM_A]);
    const publishCatalogDocument = vi.fn(async () => ({ msgId: 100 }));
    const gateway = createFakeGateway({
      getPinnedCatalogDocument: async () => ({ msgId: 42, publisherId: 'me', raw: '{}' }),
      publishCatalogDocument
    });

    await publishCatalogMetadata(gateway, storage, 'src1', makeChannel({ id: 'c1', isOwn: true }), 1, { title: 'Đổi tên' });

    expect(publishCatalogDocument).toHaveBeenCalledWith('c1', expect.any(String), 42);
  });

  it('nguồn CHƯA từng có catalog.json (previousMsgId undefined) — vẫn publish được, không truyền previousMsgId', async () => {
    const storage = createFakeStorage();
    await storage.replaceMediaItems('src1', [ITEM_A]);
    const publishCatalogDocument = vi.fn(async () => ({ msgId: 1 }));
    const gateway = createFakeGateway({ getPinnedCatalogDocument: async () => null, publishCatalogDocument });

    await publishCatalogMetadata(gateway, storage, 'src1', makeChannel({ id: 'c1', isOwn: true }), 1, { title: 'Lần đầu' });

    expect(publishCatalogDocument).toHaveBeenCalledWith('c1', expect.any(String), undefined);
  });

  it('item hỏng schema (msgId sai kiểu, lỡ lọt vào Dexie) bị loại khỏi catalog xuất bản, không làm hỏng cả JSON', async () => {
    const storage = createFakeStorage();
    await storage.replaceMediaItems('src1', [ITEM_A, { msgId: 'not-a-number' as unknown as number, trust: 'owner' }]);
    let publishedJson = '';
    const gateway = createFakeGateway({
      publishCatalogDocument: async (_channelId, json) => {
        publishedJson = json;
        return { msgId: 1 };
      }
    });

    await publishCatalogMetadata(gateway, storage, 'src1', makeChannel({ isOwn: true }), 1, { title: 'A' });

    const envelope = JSON.parse(publishedJson);
    expect(envelope.items).toHaveLength(1);
  });
});
