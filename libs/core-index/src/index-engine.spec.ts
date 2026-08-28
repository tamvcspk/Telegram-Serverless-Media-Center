import { describe, expect, it, vi } from 'vitest';
import { createIndexEngine } from './index-engine';
import { createFakeGateway, createFakeStorage, makeCatalogDocument, makeChannel, makeHistoryMessage } from './test-fakes';

describe('createIndexEngine.scanSource', () => {
  it('không resolve được kênh → tier none kèm error, ghi lastError vào storage', async () => {
    const gateway = createFakeGateway({ resolveIndexChannel: async () => null });
    const storage = createFakeStorage();
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.scanSource('src1', '@khong_ton_tai');
    expect(result.tier).toBe('none');
    expect(result.error).toBeDefined();
    expect((await storage.getIndexMeta('src1')).lastError).toBeDefined();
  });

  it('resolveIndexChannel() throw (FLOOD_WAIT, username sai...) → error thật nổi lên lastError, KHÔNG bị nuốt thành câu chung chung', async () => {
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => {
        throw new Error('FLOOD_WAIT_30');
      }
    });
    const storage = createFakeStorage();
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.scanSource('src1', '@channel');
    expect(result.tier).toBe('none');
    expect(result.error).toBe('FLOOD_WAIT_30');
  });

  it('có catalog ghim, publisher tin cậy → tier catalog, replace toàn bộ media', async () => {
    const raw = JSON.stringify({
      spec: 'tsmc-catalog/1',
      generatedAt: '2026-08-24T00:00:00Z',
      items: [{ msgId: 1, title: 'Phim A' }]
    });
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => makeChannel({ isOwn: true }),
      getPinnedCatalogDocument: async () => makeCatalogDocument({ raw, publisherId: 'me' })
    });
    const storage = createFakeStorage();
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.scanSource('src1', '@my_channel');
    expect(result).toEqual({ tier: 'catalog', itemCount: 1 });
    expect(storage.mediaBySource.get('src1')).toEqual([{ msgId: 1, title: 'Phim A', trust: 'catalog' }]);
    expect((await storage.getIndexMeta('src1')).catalogGeneratedAt).toBe('2026-08-24T00:00:00Z');
  });

  it('không có catalog, CHƯA từng quét, không yêu cầu full → tier none + needsFullScanConfirmation, KHÔNG gọi fetchHistorySince', async () => {
    const fetchHistorySince = vi.fn(async () => []);
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => makeChannel({ isOwn: false }),
      getPinnedCatalogDocument: async () => null,
      fetchHistorySince
    });
    const storage = createFakeStorage();
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.scanSource('src1', '@community');
    expect(result).toEqual({ tier: 'none', itemCount: 0, needsFullScanConfirmation: true });
    expect(fetchHistorySince).not.toHaveBeenCalled();
  });

  it('không có catalog, opts.tier=full → quét bounded, direction desc (ưu tiên message MỚI NHẤT, không bò từ đầu kênh), tier full', async () => {
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => makeChannel({ isOwn: true }),
      getPinnedCatalogDocument: async () => null,
      fetchHistorySince: async (_channelId, minId, _limit, direction) => {
        expect(direction).toBe('desc');
        expect(minId).toBe(0);
        return [makeHistoryMessage({ msgId: 5, fileName: 'Movie.2024.1080p.mkv' })];
      }
    });
    const storage = createFakeStorage();
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.scanSource('src1', '@my_channel', { tier: 'full' });
    expect(result.tier).toBe('full');
    expect(result.itemCount).toBe(1);
    const meta = await storage.getIndexMeta('src1');
    expect(meta.lastIndexedMsgId).toBe(5);
    expect(meta.tier).toBe('full');
  });

  it('không có catalog, ĐÃ từng quét (lastIndexedMsgId có giá trị) → tự chạy tier delta từ msgId đó', async () => {
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => makeChannel({ isOwn: true }),
      getPinnedCatalogDocument: async () => null,
      fetchHistorySince: async (_channelId, minId, _limit, direction) => {
        expect(direction).toBe('asc');
        expect(minId).toBe(100);
        return [makeHistoryMessage({ msgId: 101, fileName: 'New.Episode.S02E05.mkv' })];
      }
    });
    const storage = createFakeStorage();
    await storage.putIndexMeta('src1', { lastIndexedMsgId: 100, itemCount: 3 });
    // itemCount đọc lại từ storage thật (countMediaItems), không tự cộng
    // dồn thủ công — seed 3 item đã có sẵn để phản ánh đúng "đã từng quét".
    await storage.upsertMediaItems('src1', [
      { msgId: 1, trust: 'owner' },
      { msgId: 2, trust: 'owner' },
      { msgId: 3, trust: 'owner' }
    ]);
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.scanSource('src1', '@my_channel');
    expect(result.tier).toBe('delta');
    expect(result.itemCount).toBe(4); // 3 cũ + 1 mới
    const meta = await storage.getIndexMeta('src1');
    expect(meta.lastIndexedMsgId).toBe(101);
  });

  it('bỏ qua item không có fileName VÀ không có video attribute (không phải file/video media thật)', async () => {
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => makeChannel({ isOwn: true }),
      getPinnedCatalogDocument: async () => null,
      fetchHistorySince: async () => [makeHistoryMessage({ msgId: 1, fileName: undefined })]
    });
    const storage = createFakeStorage();
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.scanSource('src1', '@my_channel', { tier: 'full' });
    expect(result.itemCount).toBe(0);
  });

  it('video gửi "as video" (không fileName, CÓ video attribute) vẫn được nhận — dùng caption làm title, hoặc placeholder theo msgId nếu không có caption (phát hiện thật: kênh 174 video kiểu này luôn ra 0 item trước khi sửa)', async () => {
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => makeChannel({ isOwn: true }),
      getPinnedCatalogDocument: async () => null,
      fetchHistorySince: async () => [
        makeHistoryMessage({ msgId: 1, fileName: undefined, caption: 'Dune Part Two (2024) 1080p', video: { w: 1920, h: 1080, durationSec: 60 } }),
        makeHistoryMessage({ msgId: 2, fileName: undefined, caption: undefined, video: { w: 1920, h: 1080, durationSec: 60 } })
      ]
    });
    const storage = createFakeStorage();
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.scanSource('src1', '@my_channel', { tier: 'full' });
    expect(result.itemCount).toBe(2);
    const items = storage.mediaBySource.get('src1');
    expect(items?.find((i) => i.msgId === 1)).toMatchObject({ title: 'Dune Part Two', year: 2024 });
    expect(items?.find((i) => i.msgId === 2)).toMatchObject({ title: 'Video 2' });
  });

  it('kênh cộng đồng: item quét từ lịch sử của publisher KHÔNG phải admin KHÔNG bị loại — vẫn lưu, gắn nhãn not-admin (phát hiện thật: loại cứng ở đây tạo nghịch lý so với pending — xem trust.ts)', async () => {
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => makeChannel({ isOwn: false }),
      getPinnedCatalogDocument: async () => null,
      getChannelAdmins: async () => ['admin-1'],
      fetchHistorySince: async () => [
        makeHistoryMessage({ msgId: 1, publisherId: 'admin-1', fileName: 'Admin.File.2024.mkv' }),
        makeHistoryMessage({ msgId: 2, publisherId: 'random-member', fileName: 'Fake.File.2024.mkv' })
      ]
    });
    const storage = createFakeStorage();
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.scanSource('src1', '@community', { tier: 'full' });
    expect(result.itemCount).toBe(2);
    const items = storage.mediaBySource.get('src1');
    expect(items?.find((i) => i.msgId === 1)?.trust).toBe('verified-admin');
    expect(items?.find((i) => i.msgId === 2)?.trust).toBe('not-admin');
  });

  it('kênh cộng đồng: admin list KHÔNG xác định được (CHAT_ADMIN_REQUIRED) lúc quét → item vẫn được lưu, gắn nhãn pending — KHÔNG gọi checkPublisherIsAdmin hàng loạt (eventual correctness: đúng dần lúc truy cập, không lúc quét)', async () => {
    const checkPublisherIsAdmin = vi.fn(async () => true);
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => makeChannel({ isOwn: false }),
      getPinnedCatalogDocument: async () => null,
      getChannelAdmins: async () => null,
      checkPublisherIsAdmin,
      fetchHistorySince: async () => [
        makeHistoryMessage({ msgId: 1, publisherId: 'member-a', fileName: 'A.2024.mkv' }),
        makeHistoryMessage({ msgId: 2, publisherId: 'member-b', fileName: 'B.2024.mkv' })
      ]
    });
    const storage = createFakeStorage();
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.scanSource('src1', '@community', { tier: 'full' });
    expect(result.itemCount).toBe(2);
    const items = storage.mediaBySource.get('src1');
    expect(items?.every((i) => i.trust === 'pending')).toBe(true);
    expect(checkPublisherIsAdmin).not.toHaveBeenCalled();
  });

  it('gateway throw giữa chừng → tier none + error, không làm crash caller', async () => {
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => makeChannel({ isOwn: true }),
      getPinnedCatalogDocument: async () => {
        throw new Error('FLOOD_WAIT_120');
      }
    });
    const storage = createFakeStorage();
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.scanSource('src1', '@my_channel');
    expect(result.tier).toBe('none');
    expect(result.error).toContain('FLOOD_WAIT_120');
  });
});

describe('createIndexEngine.resolveItemTrust — lúc TRUY CẬP, chỉ 1 item/lần', () => {
  it('item không tồn tại → not-found', async () => {
    const gateway = createFakeGateway();
    const storage = createFakeStorage();
    const engine = createIndexEngine(gateway, storage);

    expect(await engine.resolveItemTrust('src1', '@c', 999)).toEqual({ trust: 'not-found' });
  });

  it('item đã resolve từ trước (không phải pending) → trả thẳng, KHÔNG gọi resolveIndexChannel/checkPublisherIsAdmin', async () => {
    const resolveIndexChannel = vi.fn(async () => makeChannel({ isOwn: false }));
    const checkPublisherIsAdmin = vi.fn(async () => true);
    const gateway = createFakeGateway({ resolveIndexChannel, checkPublisherIsAdmin });
    const storage = createFakeStorage();
    await storage.upsertMediaItems('src1', [{ msgId: 1, trust: 'owner' }]);
    const engine = createIndexEngine(gateway, storage);

    expect(await engine.resolveItemTrust('src1', '@c', 1)).toEqual({ trust: 'owner' });
    expect(resolveIndexChannel).not.toHaveBeenCalled();
    expect(checkPublisherIsAdmin).not.toHaveBeenCalled();
  });

  it('pending, checkPublisherIsAdmin xác nhận admin → cập nhật trust thành verified-admin', async () => {
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => makeChannel({ isOwn: false, id: 'c1' }),
      checkPublisherIsAdmin: async () => true
    });
    const storage = createFakeStorage();
    await storage.upsertMediaItems('src1', [{ msgId: 1, trust: 'pending', publisherId: 'u1' }]);
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.resolveItemTrust('src1', '@c', 1);
    expect(result).toEqual({ trust: 'verified-admin' });
    expect((await storage.getMediaItem('src1', 1))?.trust).toBe('verified-admin');
  });

  it('pending, checkPublisherIsAdmin xác nhận KHÔNG phải admin → cập nhật trust thành not-admin, KHÔNG xoá item (không loại cứng — xem trust.ts)', async () => {
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => makeChannel({ isOwn: false, id: 'c1' }),
      checkPublisherIsAdmin: async () => false
    });
    const storage = createFakeStorage();
    await storage.upsertMediaItems('src1', [{ msgId: 1, trust: 'pending', publisherId: 'u1' }]);
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.resolveItemTrust('src1', '@c', 1);
    expect(result).toEqual({ trust: 'not-admin' });
    expect((await storage.getMediaItem('src1', 1))?.trust).toBe('not-admin');
  });

  it('pending, checkPublisherIsAdmin vẫn không xác định được (null) → giữ nguyên pending, không throw', async () => {
    const gateway = createFakeGateway({
      resolveIndexChannel: async () => makeChannel({ isOwn: false, id: 'c1' }),
      checkPublisherIsAdmin: async () => null
    });
    const storage = createFakeStorage();
    await storage.upsertMediaItems('src1', [{ msgId: 1, trust: 'pending', publisherId: 'u1' }]);
    const engine = createIndexEngine(gateway, storage);

    const result = await engine.resolveItemTrust('src1', '@c', 1);
    expect(result).toEqual({ trust: 'pending' });
    expect((await storage.getMediaItem('src1', 1))?.trust).toBe('pending');
  });

  it('resolveIndexChannel() trả null (kênh không resolve được) → giữ nguyên pending, không throw', async () => {
    const gateway = createFakeGateway({ resolveIndexChannel: async () => null });
    const storage = createFakeStorage();
    await storage.upsertMediaItems('src1', [{ msgId: 1, trust: 'pending', publisherId: 'u1' }]);
    const engine = createIndexEngine(gateway, storage);

    expect(await engine.resolveItemTrust('src1', '@c', 1)).toEqual({ trust: 'pending' });
  });

  it('item catalog (pending nhưng KHÔNG có publisherId — không thể xảy ra thật nhưng an toàn) → trả thẳng, không gọi gateway', async () => {
    const resolveIndexChannel = vi.fn(async () => makeChannel({ isOwn: false }));
    const gateway = createFakeGateway({ resolveIndexChannel });
    const storage = createFakeStorage();
    await storage.upsertMediaItems('src1', [{ msgId: 1, trust: 'pending' }]);
    const engine = createIndexEngine(gateway, storage);

    expect(await engine.resolveItemTrust('src1', '@c', 1)).toEqual({ trust: 'pending' });
    expect(resolveIndexChannel).not.toHaveBeenCalled();
  });
});

describe('createIndexEngine.checkWritable / publishCatalogMetadata — Ingest Editor (Màn hình 6)', () => {
  it('checkWritable(): isOwn=true → true, isOwn=false → false, không resolve được → false', async () => {
    const storage = createFakeStorage();
    expect(await createIndexEngine(createFakeGateway({ resolveIndexChannel: async () => makeChannel({ isOwn: true }) }), storage).checkWritable('@c')).toBe(
      true
    );
    expect(
      await createIndexEngine(createFakeGateway({ resolveIndexChannel: async () => makeChannel({ isOwn: false }) }), storage).checkWritable('@c')
    ).toBe(false);
    expect(await createIndexEngine(createFakeGateway({ resolveIndexChannel: async () => null }), storage).checkWritable('@c')).toBe(false);
  });

  it('publishCatalogMetadata(): resolve kênh thành công, isOwn → gọi publishCatalogDocument', async () => {
    const storage = createFakeStorage();
    await storage.replaceMediaItems('src1', [{ msgId: 1, title: 'A', trust: 'owner' }]);
    const publishCatalogDocument = vi.fn(async () => ({ msgId: 1 }));
    const gateway = createFakeGateway({ resolveIndexChannel: async () => makeChannel({ id: 'c1', isOwn: true }), publishCatalogDocument });
    const engine = createIndexEngine(gateway, storage);

    await engine.publishCatalogMetadata('src1', '@c', 1, { title: 'A (sửa)' });
    expect(publishCatalogDocument).toHaveBeenCalledOnce();
  });

  it('publishCatalogMetadata(): không phải chủ kênh → NotChannelOwnerError nổi lên nguyên vẹn, KHÔNG bị nuốt', async () => {
    const storage = createFakeStorage();
    const gateway = createFakeGateway({ resolveIndexChannel: async () => makeChannel({ isOwn: false }) });
    const engine = createIndexEngine(gateway, storage);

    await expect(engine.publishCatalogMetadata('src1', '@c', 1, { title: 'X' })).rejects.toMatchObject({ name: 'NotChannelOwnerError' });
  });

  it('publishCatalogMetadata(): không resolve được kênh → lỗi rõ ràng, không phải NotChannelOwnerError', async () => {
    const storage = createFakeStorage();
    const gateway = createFakeGateway({ resolveIndexChannel: async () => null });
    const engine = createIndexEngine(gateway, storage);

    await expect(engine.publishCatalogMetadata('src1', '@khong_ton_tai', 1, { title: 'X' })).rejects.toThrow(/không phải kênh/);
  });
});
