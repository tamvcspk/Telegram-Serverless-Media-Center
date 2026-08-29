import { describe, expect, it, vi } from 'vitest';
import { ensureForumTopicsCached, lookupTopicTitle } from './forum-topics';
import { createFakeGateway, createFakeStorage, makeChannel } from './test-fakes';

describe('ensureForumTopicsCached', () => {
  it('kênh không phải Forum → bỏ qua hẳn, KHÔNG gọi listForumTopics', async () => {
    const listForumTopics = vi.fn(async () => null);
    const gateway = createFakeGateway({ listForumTopics });
    const storage = createFakeStorage();

    await ensureForumTopicsCached(gateway, storage, 'src1', makeChannel({ isForum: false }));
    expect(listForumTopics).not.toHaveBeenCalled();
  });

  it('kênh Forum, chưa cache → gọi listForumTopics, sanitize title rồi lưu map theo id', async () => {
    const gateway = createFakeGateway({ listForumTopics: async () => [{ id: '1', title: 'Phim lẻ' }, { id: '2', title: 'Phim bộ' }] });
    const storage = createFakeStorage();

    await ensureForumTopicsCached(gateway, storage, 'src1', makeChannel({ isForum: true }));
    const meta = await storage.getIndexMeta('src1');
    expect(meta.forumTopics).toEqual({ '1': 'Phim lẻ', '2': 'Phim bộ' });
    expect(meta.forumTopicsFetchedAt).toBeDefined();
  });

  it('listForumTopics() trả null (Telegram xác nhận không phải Forum dù isForum lỡ true) → lưu null, không phải rỗng', async () => {
    const gateway = createFakeGateway({ listForumTopics: async () => null });
    const storage = createFakeStorage();

    await ensureForumTopicsCached(gateway, storage, 'src1', makeChannel({ isForum: true }));
    expect((await storage.getIndexMeta('src1')).forumTopics).toBeNull();
  });

  it('cache còn tươi (đã fetch gần đây) → KHÔNG gọi lại listForumTopics', async () => {
    const listForumTopics = vi.fn(async () => [{ id: '1', title: 'X' }]);
    const gateway = createFakeGateway({ listForumTopics });
    const storage = createFakeStorage();
    await storage.putIndexMeta('src1', { forumTopics: { '1': 'X' }, forumTopicsFetchedAt: Date.now() });

    await ensureForumTopicsCached(gateway, storage, 'src1', makeChannel({ isForum: true }));
    expect(listForumTopics).not.toHaveBeenCalled();
  });
});

describe('lookupTopicTitle', () => {
  it('topicId undefined → undefined, không đọc storage', async () => {
    const storage = createFakeStorage();
    expect(await lookupTopicTitle(storage, 'src1', undefined)).toBeUndefined();
  });

  it('topicId có trong cache → trả title đã sanitize', async () => {
    const storage = createFakeStorage();
    await storage.putIndexMeta('src1', { forumTopics: { '5': 'Anime' }, forumTopicsFetchedAt: Date.now() });
    expect(await lookupTopicTitle(storage, 'src1', '5')).toBe('Anime');
  });

  it('topicId không có trong cache (topic mới, chưa refresh) → undefined', async () => {
    const storage = createFakeStorage();
    await storage.putIndexMeta('src1', { forumTopics: { '5': 'Anime' }, forumTopicsFetchedAt: Date.now() });
    expect(await lookupTopicTitle(storage, 'src1', '999')).toBeUndefined();
  });
});
