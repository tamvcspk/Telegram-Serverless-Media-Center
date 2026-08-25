import { describe, expect, it } from 'vitest';
import { tryCatalogTier } from './catalog-tier';
import { createFakeGateway, createFakeStorage, makeCatalogDocument, makeChannel } from './test-fakes';

describe('tryCatalogTier', () => {
  it('không có pinned catalog → null', async () => {
    const gateway = createFakeGateway({ getPinnedCatalogDocument: async () => null });
    const storage = createFakeStorage();
    expect(await tryCatalogTier(gateway, storage, 'src1', makeChannel({ isOwn: true }))).toBeNull();
  });

  it('kênh cộng đồng, publisher KHÔNG phải admin → bỏ TOÀN BỘ catalog (không chỉ item)', async () => {
    const gateway = createFakeGateway({
      getPinnedCatalogDocument: async () => makeCatalogDocument({ publisherId: 'random-member' }),
      getChannelAdmins: async () => ['admin-1']
    });
    const storage = createFakeStorage();
    expect(await tryCatalogTier(gateway, storage, 'src1', makeChannel({ isOwn: false }))).toBeNull();
  });

  it('kênh isOwn=true, publisher bất kỳ → tin, parse envelope + items', async () => {
    const raw = JSON.stringify({
      spec: 'tsmc-catalog/1',
      generatedAt: '2026-08-24T00:00:00Z',
      items: [{ msgId: 1, title: 'Phim A' }, { msgId: 2, title: 'Phim B' }]
    });
    const gateway = createFakeGateway({ getPinnedCatalogDocument: async () => makeCatalogDocument({ raw, publisherId: 'me' }) });
    const storage = createFakeStorage();

    const result = await tryCatalogTier(gateway, storage, 'src1', makeChannel({ isOwn: true }));
    expect(result?.generatedAt).toBe('2026-08-24T00:00:00Z');
    expect(result?.items).toHaveLength(2);
  });

  it('item sai kiểu trong catalog bị loại riêng, không làm hỏng cả catalog', async () => {
    const raw = JSON.stringify({
      spec: 'tsmc-catalog/1',
      generatedAt: '2026-08-24T00:00:00Z',
      items: [{ msgId: 1, title: 'Hợp lệ' }, { title: 'Thiếu msgId' }, { msgId: 'không phải số' }]
    });
    const gateway = createFakeGateway({ getPinnedCatalogDocument: async () => makeCatalogDocument({ raw, publisherId: 'me' }) });
    const storage = createFakeStorage();

    const result = await tryCatalogTier(gateway, storage, 'src1', makeChannel({ isOwn: true }));
    expect(result?.items).toEqual([{ msgId: 1, title: 'Hợp lệ', trust: 'catalog' }]);
  });

  it('kênh cộng đồng, publisher chưa xác định được (list CHAT_ADMIN_REQUIRED → pending) → bỏ TOÀN BỘ catalog, KHÔNG chấp nhận "chưa biết" cho tier thay-toàn-bộ này', async () => {
    const gateway = createFakeGateway({
      getPinnedCatalogDocument: async () => makeCatalogDocument({ publisherId: 'unknown-publisher' }),
      getChannelAdmins: async () => null
    });
    const storage = createFakeStorage();
    expect(await tryCatalogTier(gateway, storage, 'src1', makeChannel({ isOwn: false }))).toBeNull();
  });

  it('spec sai (major version lạ) → null, không cố đoán', async () => {
    const raw = JSON.stringify({ spec: 'tsmc-catalog/2', generatedAt: '2026-08-24T00:00:00Z', items: [{ msgId: 1 }] });
    const gateway = createFakeGateway({ getPinnedCatalogDocument: async () => makeCatalogDocument({ raw, publisherId: 'me' }) });
    const storage = createFakeStorage();
    expect(await tryCatalogTier(gateway, storage, 'src1', makeChannel({ isOwn: true }))).toBeNull();
  });

  it('JSON hỏng → null, không throw', async () => {
    const gateway = createFakeGateway({ getPinnedCatalogDocument: async () => makeCatalogDocument({ raw: 'not json{{', publisherId: 'me' }) });
    const storage = createFakeStorage();
    await expect(tryCatalogTier(gateway, storage, 'src1', makeChannel({ isOwn: true }))).resolves.toBeNull();
  });
});
