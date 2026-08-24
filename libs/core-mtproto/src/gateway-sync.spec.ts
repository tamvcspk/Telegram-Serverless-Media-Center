import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotV1, SyncEvent } from '@tsmc/shared-models';

// createSyncGatewayMethods() nhận `getClient` qua tham số (không tự giữ
// client — dùng chung session với gateway.ts, xem comment trong file đó),
// nên test ở đây không cần dựng lại toàn bộ luồng login/session như
// gateway.spec.ts — chỉ cần một FakeTelegramClient đứng thẳng.
const mocks = vi.hoisted(() => ({
  getDialogs: vi.fn(),
  getEntity: vi.fn(),
  invoke: vi.fn(),
  sendMessage: vi.fn(),
  getMessages: vi.fn(),
  sendFile: vi.fn(),
  pinMessage: vi.fn(),
  deleteMessages: vi.fn(),
  downloadMedia: vi.fn()
}));

vi.mock('telegram', () => {
  class FakeChannel {
    id: { toString(): string };
    accessHash?: { toString(): string };
    title: string;
    broadcast?: boolean;
    creator?: boolean;
    constructor(data: { id: number | string; accessHash?: string; title: string; broadcast?: boolean; creator?: boolean }) {
      this.id = { toString: () => String(data.id) };
      this.accessHash = data.accessHash !== undefined ? { toString: () => data.accessHash as string } : undefined;
      this.title = data.title;
      this.broadcast = data.broadcast;
      this.creator = data.creator;
    }
  }
  class FakeChannelFull {
    about?: string;
    pinnedMsgId?: number;
    constructor(data: { about?: string; pinnedMsgId?: number }) {
      this.about = data.about;
      this.pinnedMsgId = data.pinnedMsgId;
    }
  }
  class FakeGetFullChannel {
    channel: unknown;
    constructor(data: { channel: unknown }) {
      this.channel = data.channel;
    }
  }
  class FakeCreateChannel {
    title: string;
    about: string;
    constructor(data: { title: string; about: string }) {
      this.title = data.title;
      this.about = data.about;
    }
  }
  class FakeCustomFile {
    name: string;
    size: number;
    path: string;
    buffer?: Uint8Array;
    constructor(name: string, size: number, path: string, buffer?: Uint8Array) {
      this.name = name;
      this.size = size;
      this.path = path;
      this.buffer = buffer;
    }
  }
  class FakeTelegramClient {
    getDialogs = mocks.getDialogs;
    getEntity = mocks.getEntity;
    invoke = mocks.invoke;
    sendMessage = mocks.sendMessage;
    getMessages = mocks.getMessages;
    sendFile = mocks.sendFile;
    pinMessage = mocks.pinMessage;
    deleteMessages = mocks.deleteMessages;
    downloadMedia = mocks.downloadMedia;
    uploads = { CustomFile: FakeCustomFile };
  }
  return {
    Api: {
      Channel: FakeChannel,
      ChannelFull: FakeChannelFull,
      channels: { GetFullChannel: FakeGetFullChannel, CreateChannel: FakeCreateChannel }
    },
    client: { uploads: { CustomFile: FakeCustomFile } },
    TelegramClient: FakeTelegramClient
  };
});

const { Api } = await import('telegram');
const { createSyncGatewayMethods } = await import('./gateway-sync');

function makeChannel(overrides: Partial<{ id: number; accessHash: string; title: string; broadcast: boolean; creator: boolean }> = {}) {
  return new Api.Channel({ id: 1, accessHash: 'hash-1', title: 'TSMC State', broadcast: true, creator: true, ...overrides } as never);
}

describe('@tsmc/core-mtproto createSyncGatewayMethods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listOwnStateChannelCandidates(): chỉ nhận channel do MÌNH tạo, broadcast, about khớp tiền tố tsmc-state/1', async () => {
    const ownStateChannel = makeChannel({ id: 1, title: 'TSMC State' });
    const someoneElseChannel = makeChannel({ id: 2, title: 'Không phải của mình', creator: false });
    const ownUnrelatedChannel = makeChannel({ id: 3, title: 'Kênh cá nhân khác' });

    mocks.getDialogs.mockResolvedValue([
      { entity: ownStateChannel, date: 1000 },
      { entity: someoneElseChannel, date: 1000 },
      { entity: ownUnrelatedChannel, date: 1000 }
    ]);
    mocks.invoke.mockImplementation(async (req: { channel: unknown }) => {
      const about = req.channel === ownStateChannel ? 'tsmc-state/1 · Đừng xoá' : 'kênh phim gì đó';
      return { fullChat: new Api.ChannelFull({ about } as never) };
    });

    const client = new (await import('telegram')).TelegramClient('' as never, 0, '', {} as never);
    const methods = createSyncGatewayMethods(() => client);

    const candidates = await methods.listOwnStateChannelCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ id: '1', accessHash: 'hash-1', title: 'TSMC State' });
    expect(mocks.getDialogs).toHaveBeenCalledTimes(1);
  });

  it('getChannelById(): tìm thấy → trả về id/accessHash; không tìm thấy/lỗi → null', async () => {
    const client = new (await import('telegram')).TelegramClient('' as never, 0, '', {} as never);
    const methods = createSyncGatewayMethods(() => client);

    mocks.getEntity.mockResolvedValueOnce(makeChannel({ id: 42, accessHash: 'hash-42' }));
    const found = await methods.getChannelById('42');
    expect(found).toEqual({ id: '42', accessHash: 'hash-42' });

    mocks.getEntity.mockRejectedValueOnce(new Error('CHANNEL_INVALID'));
    const notFound = await methods.getChannelById('999');
    expect(notFound).toBeNull();
  });

  it('getChannelById(): dùng lại cache trong bộ nhớ, KHÔNG gọi lại getEntity() cho cùng id', async () => {
    const client = new (await import('telegram')).TelegramClient('' as never, 0, '', {} as never);
    const methods = createSyncGatewayMethods(() => client);

    mocks.getEntity.mockResolvedValue(makeChannel({ id: 7, accessHash: 'hash-7' }));
    mocks.sendMessage.mockResolvedValue({ id: 1 });
    await methods.getChannelById('7');
    await methods.sendEvent('7', { v: 1, op: 'settings.set', ts: 1, dev: 'a', k: 'x', val: 1 });

    expect(mocks.getEntity).toHaveBeenCalledTimes(1);
  });

  it('createStateChannel(): gọi channels.CreateChannel với title/about đúng, trả channel từ Updates.chats', async () => {
    const client = new (await import('telegram')).TelegramClient('' as never, 0, '', {} as never);
    const methods = createSyncGatewayMethods(() => client);

    const created = makeChannel({ id: 99, accessHash: 'hash-99' });
    mocks.invoke.mockResolvedValueOnce({ chats: [created] });

    const result = await methods.createStateChannel();
    expect(result).toEqual({ id: '99', accessHash: 'hash-99' });
    const request = mocks.invoke.mock.calls[0]?.[0] as { title: string; about: string };
    expect(request.title).toBe('TSMC State');
    expect(request.about).toContain('tsmc-state/1');
  });

  it('sendEvent(): gửi đúng JSON, ném lỗi rõ ràng nếu vượt 4096 ký tự', async () => {
    const client = new (await import('telegram')).TelegramClient('' as never, 0, '', {} as never);
    const methods = createSyncGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel({ id: 1 }));

    mocks.sendMessage.mockResolvedValueOnce({ id: 55 });
    const event: SyncEvent = { v: 1, op: 'settings.set', ts: 1, dev: 'a', k: 'theme', val: 'dark' };
    const result = await methods.sendEvent('1', event);
    expect(result).toEqual({ msgId: 55 });
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.anything(), { message: JSON.stringify(event) });

    const hugeEvent: SyncEvent = { v: 1, op: 'settings.set', ts: 1, dev: 'a', k: 'x'.repeat(4100), val: 1 };
    await expect(methods.sendEvent('1', hugeEvent)).rejects.toThrow(/4096/);
  });

  it('fetchEventsSince(): parse JSON hợp lệ, bỏ qua message không phải JSON/không đúng shape SyncEvent', async () => {
    const client = new (await import('telegram')).TelegramClient('' as never, 0, '', {} as never);
    const methods = createSyncGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel({ id: 1 }));

    mocks.getMessages.mockResolvedValueOnce([
      { id: 10, message: JSON.stringify({ v: 1, op: 'settings.set', ts: 1, dev: 'a', k: 'x', val: 1 }) },
      { id: 11, message: 'không phải JSON' },
      { id: 12, message: JSON.stringify({ foo: 'bar' }) },
      { id: 13, message: '' }
    ]);

    const events = await methods.fetchEventsSince('1', 0);
    expect(events).toEqual([{ msgId: 10, event: { v: 1, op: 'settings.set', ts: 1, dev: 'a', k: 'x', val: 1 } }]);
  });

  it('fetchPinnedSnapshot(): không có pinnedMsgId → null; có → tải + parse JSON', async () => {
    const client = new (await import('telegram')).TelegramClient('' as never, 0, '', {} as never);
    const methods = createSyncGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel({ id: 1 }));

    mocks.invoke.mockResolvedValueOnce({ fullChat: new Api.ChannelFull({} as never) });
    expect(await methods.fetchPinnedSnapshot('1')).toBeNull();

    const snapshot: SnapshotV1 = { v: 1, state: { progress: {}, collections: {}, sources: {}, settings: {} }, baseMsgId: 5 };
    mocks.invoke.mockResolvedValueOnce({ fullChat: new Api.ChannelFull({ pinnedMsgId: 77 } as never) });
    mocks.getMessages.mockResolvedValueOnce([{ id: 77, media: {} }]);
    mocks.downloadMedia.mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(snapshot)));

    const result = await methods.fetchPinnedSnapshot('1');
    expect(result).toEqual(snapshot);
  });

  it('publishSnapshot(): sendFile → pinMessage → deleteMessages, ĐÚNG THỨ TỰ (ghim trước, xoá sau)', async () => {
    const client = new (await import('telegram')).TelegramClient('' as never, 0, '', {} as never);
    const methods = createSyncGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel({ id: 1 }));

    const order: string[] = [];
    mocks.sendFile.mockImplementationOnce(async () => {
      order.push('sendFile');
      return { id: 200 };
    });
    mocks.pinMessage.mockImplementationOnce(async () => {
      order.push('pinMessage');
    });
    mocks.deleteMessages.mockImplementationOnce(async () => {
      order.push('deleteMessages');
    });

    const snapshot: SnapshotV1 = { v: 1, state: { progress: {}, collections: {}, sources: {}, settings: {} }, baseMsgId: 10 };
    const result = await methods.publishSnapshot('1', snapshot, [8, 9, 10]);

    expect(result).toEqual({ msgId: 200 });
    expect(order).toEqual(['sendFile', 'pinMessage', 'deleteMessages']);
    expect(mocks.deleteMessages).toHaveBeenCalledWith(expect.anything(), [8, 9, 10], { revoke: true });
  });

  it('publishSnapshot(): compactedMsgIds rỗng → KHÔNG gọi deleteMessages', async () => {
    const client = new (await import('telegram')).TelegramClient('' as never, 0, '', {} as never);
    const methods = createSyncGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel({ id: 1 }));
    mocks.sendFile.mockResolvedValueOnce({ id: 1 });

    const snapshot: SnapshotV1 = { v: 1, state: { progress: {}, collections: {}, sources: {}, settings: {} }, baseMsgId: 0 };
    await methods.publishSnapshot('1', snapshot, []);
    expect(mocks.deleteMessages).not.toHaveBeenCalled();
  });
});
