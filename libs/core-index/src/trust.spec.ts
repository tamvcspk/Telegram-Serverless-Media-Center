import { describe, expect, it, vi } from 'vitest';
import { createFakeGateway, createFakeStorage, makeChannel } from './test-fakes';
import { classifyFromCache, ensureChannelAdminListCached, resolvePublisherTrust } from './trust';

describe('classifyFromCache — CHỈ dữ liệu đã có, không gọi mạng', () => {
  it('kênh isOwn=true → owner', async () => {
    const storage = createFakeStorage();

    expect(await classifyFromCache(storage, 'src1', makeChannel({ isOwn: true }), 'anyone')).toBe('owner');
  });

  it('publisherId === channel.id (post kênh không bật Sign Messages) → channel-post', async () => {
    const storage = createFakeStorage();
    const channel = makeChannel({ isOwn: false, id: 'c1' });

    expect(await classifyFromCache(storage, 'src1', channel, 'c1')).toBe('channel-post');
  });

  it('admin list đã cache fresh → verified-admin / not-admin theo có nằm trong list hay không', async () => {
    const storage = createFakeStorage();
    const channel = makeChannel({ isOwn: false });
    await storage.putIndexMeta('src1', { trustedAdmins: ['admin-1'], trustedAdminsFetchedAt: Date.now() });

    expect(await classifyFromCache(storage, 'src1', channel, 'admin-1')).toBe('verified-admin');
    expect(await classifyFromCache(storage, 'src1', channel, 'member-99')).toBe('not-admin');
  });

  it('admin list cache hết hạn → pending (không tự coi là đáng tin hay không)', async () => {
    const storage = createFakeStorage();
    const channel = makeChannel({ isOwn: false });
    await storage.putIndexMeta('src1', { trustedAdmins: ['admin-1'], trustedAdminsFetchedAt: Date.now() - 2 * 60 * 60 * 1000 });

    expect(await classifyFromCache(storage, 'src1', channel, 'admin-1')).toBe('pending');
  });

  it('publisher-trust cache riêng (từ lần resolve trước) fresh → verified-admin / not-admin', async () => {
    const storage = createFakeStorage();
    const channel = makeChannel({ isOwn: false });
    await storage.putPublisherTrust('src1', 'u1', true, Date.now());
    await storage.putPublisherTrust('src1', 'u2', false, Date.now());

    expect(await classifyFromCache(storage, 'src1', channel, 'u1')).toBe('verified-admin');
    expect(await classifyFromCache(storage, 'src1', channel, 'u2')).toBe('not-admin');
  });

  it('không có tín hiệu nào → pending, KHÔNG gọi bất kỳ hàm gateway nào', async () => {
    const getChannelAdmins = vi.fn(async () => []);
    const checkPublisherIsAdmin = vi.fn(async () => true);
    createFakeGateway({ getChannelAdmins, checkPublisherIsAdmin }); // gateway không truyền vào classifyFromCache — hàm này không nhận gateway
    const storage = createFakeStorage();

    expect(await classifyFromCache(storage, 'src1', makeChannel({ isOwn: false }), 'stranger')).toBe('pending');
    expect(getChannelAdmins).not.toHaveBeenCalled();
    expect(checkPublisherIsAdmin).not.toHaveBeenCalled();
  });
});

describe('ensureChannelAdminListCached — MỘT cuộc gọi/kênh, không phải theo từng publisher', () => {
  it('kênh isOwn=true → không gọi getChannelAdmins', async () => {
    const getChannelAdmins = vi.fn(async () => []);
    const gateway = createFakeGateway({ getChannelAdmins });
    const storage = createFakeStorage();

    await ensureChannelAdminListCached(gateway, storage, 'src1', makeChannel({ isOwn: true }));
    expect(getChannelAdmins).not.toHaveBeenCalled();
  });

  it('gọi 1 lần, ghi vào indexMeta, gọi lại trong TTL KHÔNG hit mạng nữa', async () => {
    const getChannelAdmins = vi.fn(async () => ['admin-1']);
    const gateway = createFakeGateway({ getChannelAdmins });
    const storage = createFakeStorage();
    const channel = makeChannel({ isOwn: false });

    await ensureChannelAdminListCached(gateway, storage, 'src1', channel);
    await ensureChannelAdminListCached(gateway, storage, 'src1', channel);

    expect(getChannelAdmins).toHaveBeenCalledTimes(1);
    const meta = await storage.getIndexMeta('src1');
    expect(meta.trustedAdmins).toEqual(['admin-1']);
  });

  it('getChannelAdmins() trả null (CHAT_ADMIN_REQUIRED) → vẫn ghi cache (null), không throw, không retry ngay', async () => {
    const getChannelAdmins = vi.fn(async () => null);
    const gateway = createFakeGateway({ getChannelAdmins });
    const storage = createFakeStorage();
    const channel = makeChannel({ isOwn: false });

    await ensureChannelAdminListCached(gateway, storage, 'src1', channel);
    await ensureChannelAdminListCached(gateway, storage, 'src1', channel);

    expect(getChannelAdmins).toHaveBeenCalledTimes(1);
  });
});

describe('resolvePublisherTrust — lúc TRUY CẬP, chỉ 1 publisher/lần, cache lại', () => {
  it('classifyFromCache() đã resolve được (owner/channel-post/list) → trả thẳng, KHÔNG gọi checkPublisherIsAdmin', async () => {
    const checkPublisherIsAdmin = vi.fn(async () => true);
    const gateway = createFakeGateway({ checkPublisherIsAdmin });
    const storage = createFakeStorage();

    expect(await resolvePublisherTrust(gateway, storage, 'src1', makeChannel({ isOwn: true }), 'anyone')).toBe('owner');
    expect(checkPublisherIsAdmin).not.toHaveBeenCalled();
  });

  it('pending → tra cứu ĐÚNG publisher đó qua checkPublisherIsAdmin, cache lại kết quả', async () => {
    const checkPublisherIsAdmin = vi.fn(async () => true);
    const gateway = createFakeGateway({ checkPublisherIsAdmin });
    const storage = createFakeStorage();
    const channel = makeChannel({ isOwn: false });

    const result = await resolvePublisherTrust(gateway, storage, 'src1', channel, 'u1');
    expect(result).toBe('verified-admin');
    expect(checkPublisherIsAdmin).toHaveBeenCalledWith(channel.id, 'u1');

    const cached = await storage.getPublisherTrust('src1', 'u1');
    expect(cached).toMatchObject({ isAdmin: true });
  });

  it('checkPublisherIsAdmin() → false (không phải admin) → not-admin, cache lại (isAdmin: false)', async () => {
    const gateway = createFakeGateway({ checkPublisherIsAdmin: async () => false });
    const storage = createFakeStorage();
    const channel = makeChannel({ isOwn: false });

    expect(await resolvePublisherTrust(gateway, storage, 'src1', channel, 'u2')).toBe('not-admin');
    expect((await storage.getPublisherTrust('src1', 'u2'))?.isAdmin).toBe(false);
  });

  it('checkPublisherIsAdmin() → null (Telegram vẫn từ chối dù hỏi 1 người) → pending, KHÔNG cache (thử lại lần truy cập sau)', async () => {
    const gateway = createFakeGateway({ checkPublisherIsAdmin: async () => null });
    const storage = createFakeStorage();
    const channel = makeChannel({ isOwn: false });

    expect(await resolvePublisherTrust(gateway, storage, 'src1', channel, 'u3')).toBe('pending');
    expect(await storage.getPublisherTrust('src1', 'u3')).toBeUndefined();
  });

  it('resolve 2 item CÙNG publisher → chỉ 1 cuộc gọi checkPublisherIsAdmin (cache theo publisherId ăn theo)', async () => {
    const checkPublisherIsAdmin = vi.fn(async () => true);
    const gateway = createFakeGateway({ checkPublisherIsAdmin });
    const storage = createFakeStorage();
    const channel = makeChannel({ isOwn: false });

    await resolvePublisherTrust(gateway, storage, 'src1', channel, 'u1');
    await resolvePublisherTrust(gateway, storage, 'src1', channel, 'u1');

    expect(checkPublisherIsAdmin).toHaveBeenCalledTimes(1);
  });
});
