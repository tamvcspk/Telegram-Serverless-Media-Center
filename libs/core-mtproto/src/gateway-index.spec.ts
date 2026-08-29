import { beforeEach, describe, expect, it, vi } from 'vitest';

// createIndexGatewayMethods() nhận `getClient` qua tham số, cùng quy ước với
// gateway-sync.spec.ts — không cần dựng lại luồng login/session.
const mocks = vi.hoisted(() => ({
  getEntity: vi.fn(),
  getDialogs: vi.fn(),
  invoke: vi.fn(),
  getMessages: vi.fn(),
  downloadMedia: vi.fn(),
  sendFile: vi.fn(),
  pinMessage: vi.fn(),
  deleteMessages: vi.fn()
}));

vi.mock('big-integer', () => ({
  default: (n: number) => ({ value: n, toString: () => String(n) })
}));

vi.mock('telegram', () => {
  class FakeChannel {
    id: { toString(): string };
    accessHash?: { toString(): string };
    title: string;
    creator?: boolean;
    broadcast?: boolean;
    left?: boolean;
    forum?: boolean;
    constructor(
      data: { id: number | string; accessHash?: string; title: string; creator?: boolean; broadcast?: boolean; left?: boolean; forum?: boolean }
    ) {
      this.id = { toString: () => String(data.id) };
      this.accessHash = data.accessHash !== undefined ? { toString: () => data.accessHash as string } : undefined;
      this.title = data.title;
      this.creator = data.creator;
      this.broadcast = data.broadcast;
      this.left = data.left;
      this.forum = data.forum;
    }
  }
  class FakeUser {
    constructor(public id: number) {}
  }
  class FakeChannelFull {
    pinnedMsgId?: number;
    constructor(data: { pinnedMsgId?: number }) {
      this.pinnedMsgId = data.pinnedMsgId;
    }
  }
  class FakeDocumentAttributeFilename {
    fileName: string;
    constructor(data: { fileName: string }) {
      this.fileName = data.fileName;
    }
  }
  class FakeDocumentAttributeVideo {
    w: number;
    h: number;
    duration: number;
    constructor(data: { w: number; h: number; duration: number }) {
      this.w = data.w;
      this.h = data.h;
      this.duration = data.duration;
    }
  }
  class FakeDocument {
    mimeType: string;
    size: { toJSNumber(): number };
    attributes: unknown[];
    constructor(data: { mimeType: string; size: number; attributes: unknown[] }) {
      this.mimeType = data.mimeType;
      this.size = { toJSNumber: () => data.size };
      this.attributes = data.attributes;
    }
  }
  class FakeMessageMediaDocument {
    document: unknown;
    constructor(data: { document: unknown }) {
      this.document = data.document;
    }
  }
  class FakeMessageMediaPhoto {}
  class FakeGetFullChannel {
    channel: unknown;
    constructor(data: { channel: unknown }) {
      this.channel = data.channel;
    }
  }
  class FakeGetParticipants {
    channel: unknown;
    filter: unknown;
    constructor(data: { channel: unknown; filter: unknown }) {
      this.channel = data.channel;
      this.filter = data.filter;
    }
  }
  class FakeChannelParticipantsAdmins {}
  class FakeChannelParticipants {
    participants: unknown[];
    constructor(data: { participants: unknown[] }) {
      this.participants = data.participants;
    }
  }
  class FakeGetParticipant {
    channel: unknown;
    participant: unknown;
    constructor(data: { channel: unknown; participant: unknown }) {
      this.channel = data.channel;
      this.participant = data.participant;
    }
  }
  class FakeChannelParticipantSingle {
    participant: unknown;
    constructor(data: { participant: unknown }) {
      this.participant = data.participant;
    }
  }
  class FakeChannelParticipantAdmin {}
  class FakeChannelParticipantCreator {}
  class FakeChannelParticipantPlain {}
  class FakeMessageEntityHashtag {
    offset: number;
    length: number;
    constructor(data: { offset: number; length: number }) {
      this.offset = data.offset;
      this.length = data.length;
    }
  }
  class FakeMessageReplyHeader {
    forumTopic?: boolean;
    replyToMsgId?: number;
    replyToTopId?: number;
    constructor(data: { forumTopic?: boolean; replyToMsgId?: number; replyToTopId?: number }) {
      this.forumTopic = data.forumTopic;
      this.replyToMsgId = data.replyToMsgId;
      this.replyToTopId = data.replyToTopId;
    }
  }
  class FakeForumTopic {
    id: number;
    title: string;
    constructor(data: { id: number; title: string }) {
      this.id = data.id;
      this.title = data.title;
    }
  }
  class FakeGetForumTopics {
    channel: unknown;
    constructor(data: { channel: unknown }) {
      this.channel = data.channel;
    }
  }
  class FakeCustomFile {
    constructor(
      public name: string,
      public size: number,
      public path: string,
      public buffer: unknown
    ) {}
  }
  class FakeTelegramClient {
    getEntity = mocks.getEntity;
    getDialogs = mocks.getDialogs;
    invoke = mocks.invoke;
    getMessages = mocks.getMessages;
    downloadMedia = mocks.downloadMedia;
    sendFile = mocks.sendFile;
    pinMessage = mocks.pinMessage;
    deleteMessages = mocks.deleteMessages;
  }
  return {
    client: { uploads: { CustomFile: FakeCustomFile } },
    Api: {
      Channel: FakeChannel,
      User: FakeUser,
      ChannelFull: FakeChannelFull,
      Document: FakeDocument,
      MessageMediaDocument: FakeMessageMediaDocument,
      MessageMediaPhoto: FakeMessageMediaPhoto,
      DocumentAttributeFilename: FakeDocumentAttributeFilename,
      DocumentAttributeVideo: FakeDocumentAttributeVideo,
      ChannelParticipantsAdmins: FakeChannelParticipantsAdmins,
      ChannelParticipantAdmin: FakeChannelParticipantAdmin,
      ChannelParticipantCreator: FakeChannelParticipantCreator,
      ChannelParticipant: FakeChannelParticipantPlain,
      MessageEntityHashtag: FakeMessageEntityHashtag,
      MessageReplyHeader: FakeMessageReplyHeader,
      ForumTopic: FakeForumTopic,
      channels: {
        GetFullChannel: FakeGetFullChannel,
        GetParticipants: FakeGetParticipants,
        ChannelParticipants: FakeChannelParticipants,
        GetParticipant: FakeGetParticipant,
        ChannelParticipant: FakeChannelParticipantSingle,
        GetForumTopics: FakeGetForumTopics
      }
    },
    TelegramClient: FakeTelegramClient
  };
});

const { Api } = await import('telegram');
const { createIndexGatewayMethods } = await import('./gateway-index');

function makeChannel(
  overrides: Partial<{ id: number; accessHash: string; title: string; creator: boolean; broadcast: boolean; left: boolean; forum: boolean }> = {}
) {
  return new Api.Channel({ id: 1, accessHash: 'hash-1', title: 'Kho Phim', creator: false, ...overrides } as never);
}

async function makeClient() {
  return new (await import('telegram')).TelegramClient('' as never, 0, '', {} as never);
}

describe('@tsmc/core-mtproto createIndexGatewayMethods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listMemberChannels(): trả mọi channel/supergroup còn là thành viên, bỏ qua channel đã rời và entity không phải Channel', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);

    mocks.getDialogs.mockResolvedValueOnce([
      { entity: makeChannel({ id: 1, title: 'Kênh cộng đồng', broadcast: true }) },
      { entity: makeChannel({ id: 2, title: 'Nhóm chat', broadcast: false }) },
      { entity: makeChannel({ id: 3, title: 'Đã rời', left: true }) },
      { entity: new Api.User(5 as never) },
      { entity: undefined }
    ]);

    const result = await methods.listMemberChannels();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: '1', title: 'Kênh cộng đồng', isBroadcast: true });
    expect(result[1]).toMatchObject({ id: '2', title: 'Nhóm chat', isBroadcast: false });
  });

  it('resolveIndexChannel(): trả isOwn=true khi creator, isOwn=false khi không', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);

    mocks.getEntity.mockResolvedValueOnce(makeChannel({ creator: true }));
    expect(await methods.resolveIndexChannel('@my_channel')).toMatchObject({ isOwn: true, id: '1' });

    mocks.getEntity.mockResolvedValueOnce(makeChannel({ creator: false }));
    expect(await methods.resolveIndexChannel('@community_channel')).toMatchObject({ isOwn: false });
  });

  it('resolveIndexChannel(): chuyển link mời kiểu t.me/+HASH về dạng joinchat/HASH cũ trước khi gọi GramJS (regex parseUsername() của telegram@2.26.22 không nhận dạng +HASH — phát hiện thật từ thiết bị thật)', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);

    mocks.getEntity.mockResolvedValueOnce(makeChannel({ creator: true }));
    await methods.resolveIndexChannel('https://t.me/+xLY5Z61O4rM0Zjg9');
    expect(mocks.getEntity).toHaveBeenCalledWith('https://t.me/joinchat/xLY5Z61O4rM0Zjg9');

    mocks.getEntity.mockResolvedValueOnce(makeChannel({ creator: true }));
    await methods.resolveIndexChannel('+xLY5Z61O4rM0Zjg9');
    expect(mocks.getEntity).toHaveBeenCalledWith('https://t.me/joinchat/xLY5Z61O4rM0Zjg9');
  });

  it('resolveIndexChannel(): ref không phải invite link (username thường) → truyền nguyên văn, không đụng vào', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);

    mocks.getEntity.mockResolvedValueOnce(makeChannel({ creator: true }));
    await methods.resolveIndexChannel('@my_channel');
    expect(mocks.getEntity).toHaveBeenCalledWith('@my_channel');
  });

  it('resolveIndexChannel(): link nội bộ t.me/c/<id> → resolve qua dialog list của CHÍNH tài khoản đang đăng nhập, không gọi getEntity', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);

    const ownChannel = makeChannel({ id: 2426752557, title: 'Kênh riêng tư của tôi' });
    mocks.getDialogs.mockResolvedValueOnce([{ entity: makeChannel({ id: 1, title: 'Kênh khác' }) }, { entity: ownChannel }]);

    const result = await methods.resolveIndexChannel('https://t.me/c/2426752557');
    expect(result).toMatchObject({ id: '2426752557', title: 'Kênh riêng tư của tôi' });
    expect(mocks.getEntity).not.toHaveBeenCalled();
  });

  it('resolveIndexChannel(): link nội bộ có /msgId ở cuối (link tới một tin nhắn cụ thể) vẫn parse đúng id', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);

    mocks.getDialogs.mockResolvedValueOnce([{ entity: makeChannel({ id: 2426752557 }) }]);
    expect(await methods.resolveIndexChannel('https://t.me/c/2426752557/123')).toMatchObject({ id: '2426752557' });
  });

  it('resolveIndexChannel(): link nội bộ t.me/c/<id> KHÔNG có trong dialog list (không phải thành viên từ tài khoản này) → throw lỗi rõ ràng', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);

    mocks.getDialogs.mockResolvedValueOnce([{ entity: makeChannel({ id: 999 }) }]);
    await expect(methods.resolveIndexChannel('https://t.me/c/2426752557')).rejects.toThrow(/Không tìm thấy kênh/);
    expect(mocks.getEntity).not.toHaveBeenCalled();
  });

  it('resolveIndexChannel(): id t.me/c/<id> đã cache từ lần resolve trước → KHÔNG gọi lại getDialogs', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);

    mocks.getDialogs.mockResolvedValueOnce([{ entity: makeChannel({ id: 2426752557 }) }]);
    await methods.resolveIndexChannel('https://t.me/c/2426752557');
    await methods.resolveIndexChannel('https://t.me/c/2426752557');

    expect(mocks.getDialogs).toHaveBeenCalledTimes(1);
  });

  it('resolveIndexChannel(): entity không phải channel → null', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);

    mocks.getEntity.mockResolvedValueOnce(new Api.User(5 as never));
    expect(await methods.resolveIndexChannel('@a_user')).toBeNull();
  });

  it('resolveIndexChannel(): lỗi resolve KHÔNG bị nuốt — nổi nguyên message gốc lên tầng trên', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);

    mocks.getEntity.mockRejectedValueOnce(new Error('USERNAME_NOT_OCCUPIED'));
    await expect(methods.resolveIndexChannel('@khong_ton_tai')).rejects.toThrow('USERNAME_NOT_OCCUPIED');
  });

  it('getPinnedCatalogDocument(): không có pinnedMsgId → null', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    mocks.invoke.mockResolvedValueOnce({ fullChat: new Api.ChannelFull({} as never) });
    expect(await methods.getPinnedCatalogDocument('1')).toBeNull();
  });

  it('getPinnedCatalogDocument(): pinned message không phải catalog.v1*.json → null', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    mocks.invoke.mockResolvedValueOnce({ fullChat: new Api.ChannelFull({ pinnedMsgId: 77 } as never) });
    const doc = new Api.Document({ mimeType: 'application/json', size: 10, attributes: [new Api.DocumentAttributeFilename({ fileName: 'readme.json' } as never)] } as never);
    mocks.getMessages.mockResolvedValueOnce([{ id: 77, media: new Api.MessageMediaDocument({ document: doc } as never), senderId: { toString: () => '9' } }]);
    expect(await methods.getPinnedCatalogDocument('1')).toBeNull();
  });

  it('getPinnedCatalogDocument(): tìm thấy catalog.v1.json → tải + decode', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    mocks.invoke.mockResolvedValueOnce({ fullChat: new Api.ChannelFull({ pinnedMsgId: 77 } as never) });
    const doc = new Api.Document({ mimeType: 'application/json', size: 10, attributes: [new Api.DocumentAttributeFilename({ fileName: 'catalog.v1.json' } as never)] } as never);
    mocks.getMessages.mockResolvedValueOnce([{ id: 77, media: new Api.MessageMediaDocument({ document: doc } as never), senderId: { toString: () => '9' } }]);
    mocks.downloadMedia.mockResolvedValueOnce(new TextEncoder().encode('{"spec":"tsmc-catalog/1"}'));

    const result = await methods.getPinnedCatalogDocument('1');
    expect(result).toEqual({ msgId: 77, publisherId: '9', raw: '{"spec":"tsmc-catalog/1"}' });
  });

  it('fetchHistorySince(): lọc bỏ message không có document, giữ metadata video khi có', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    const doc = new Api.Document({
      mimeType: 'video/mp4',
      size: 1000,
      attributes: [new Api.DocumentAttributeFilename({ fileName: 'Movie.2024.1080p.mkv' } as never), new Api.DocumentAttributeVideo({ w: 1920, h: 1080, duration: 3600 } as never)]
    } as never);
    mocks.getMessages.mockResolvedValueOnce([
      { id: 1, media: new Api.MessageMediaDocument({ document: doc } as never), senderId: { toString: () => '9' }, date: 1000 },
      { id: 2, media: undefined, senderId: { toString: () => '9' }, date: 1001 }
    ]);

    const items = await methods.fetchHistorySince('1', 0, 100);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ msgId: 1, fileName: 'Movie.2024.1080p.mkv', size: 1000, video: { w: 1920, h: 1080, durationSec: 3600 } });
    expect(mocks.getMessages).toHaveBeenCalledWith(expect.anything(), { minId: 0, limit: 100, reverse: true });
  });

  it('fetchHistorySince(): suy ra topicId bằng replyToTopId ?? replyToMsgId khi forumTopic (SPIKE-07)', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    const doc = new Api.Document({ mimeType: 'video/mp4', size: 1000, attributes: [new Api.DocumentAttributeFilename({ fileName: 'A.mkv' } as never)] } as never);
    mocks.getMessages.mockResolvedValueOnce([
      // Reply sâu bên trong topic — có cả replyToTopId lẫn replyToMsgId, topicId phải lấy replyToTopId.
      {
        id: 1,
        media: new Api.MessageMediaDocument({ document: doc } as never),
        senderId: { toString: () => '9' },
        replyTo: new Api.MessageReplyHeader({ forumTopic: true, replyToTopId: 5, replyToMsgId: 42 } as never)
      },
      // Message gửi THẲNG vào topic — chỉ có replyToMsgId (= chính id topic).
      {
        id: 2,
        media: new Api.MessageMediaDocument({ document: doc } as never),
        senderId: { toString: () => '9' },
        replyTo: new Api.MessageReplyHeader({ forumTopic: true, replyToMsgId: 5 } as never)
      },
      // forumTopic không set (reply thường, không phải Forum) → topicId undefined dù có replyToMsgId.
      {
        id: 3,
        media: new Api.MessageMediaDocument({ document: doc } as never),
        senderId: { toString: () => '9' },
        replyTo: new Api.MessageReplyHeader({ replyToMsgId: 5 } as never)
      },
      // Không thuộc topic nào — replyTo hoàn toàn undefined.
      { id: 4, media: new Api.MessageMediaDocument({ document: doc } as never), senderId: { toString: () => '9' }, replyTo: undefined }
    ]);

    const items = await methods.fetchHistorySince('1', 0, 100);
    expect(items.find((i) => i.msgId === 1)?.topicId).toBe('5');
    expect(items.find((i) => i.msgId === 2)?.topicId).toBe('5');
    expect(items.find((i) => i.msgId === 3)?.topicId).toBeUndefined();
    expect(items.find((i) => i.msgId === 4)?.topicId).toBeUndefined();
  });

  it('fetchHistorySince(): tách hashtag từ message.entities theo offset/length, không regex caption thô', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    const doc = new Api.Document({ mimeType: 'video/mp4', size: 1000, attributes: [new Api.DocumentAttributeFilename({ fileName: 'A.mkv' } as never)] } as never);
    const text = 'Dune Part Two #S01E02 #scifi';
    mocks.getMessages.mockResolvedValueOnce([
      {
        id: 1,
        media: new Api.MessageMediaDocument({ document: doc } as never),
        senderId: { toString: () => '9' },
        message: text,
        entities: [new Api.MessageEntityHashtag({ offset: 14, length: 7 } as never), new Api.MessageEntityHashtag({ offset: 22, length: 6 } as never)]
      },
      // Không có entities → hashtags undefined, không throw.
      { id: 2, media: new Api.MessageMediaDocument({ document: doc } as never), senderId: { toString: () => '9' }, message: 'no tags here', entities: [] }
    ]);

    const items = await methods.fetchHistorySince('1', 0, 100);
    expect(items.find((i) => i.msgId === 1)?.hashtags).toEqual(['#S01E02', '#scifi']);
    expect(items.find((i) => i.msgId === 2)?.hashtags).toBeUndefined();
  });

  it("fetchHistorySince(): direction 'desc' lấy message MỚI NHẤT, bỏ qua minId/reverse (phát hiện thật — xem comment ở source)", async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());
    mocks.getMessages.mockResolvedValueOnce([]);

    await methods.fetchHistorySince('1', 999, 2000, 'desc');
    expect(mocks.getMessages).toHaveBeenCalledWith(expect.anything(), { limit: 2000 });
  });

  it('getChannelAdmins(): map participants có userId, bỏ qua kết quả không phải ChannelParticipants', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    mocks.invoke.mockResolvedValueOnce(
      new Api.channels.ChannelParticipants({ participants: [{ userId: { toString: () => '111' } }, { userId: { toString: () => '222' } }] } as never)
    );
    expect(await methods.getChannelAdmins('1')).toEqual(['111', '222']);

    mocks.invoke.mockResolvedValueOnce({ notAChannelParticipants: true });
    expect(await methods.getChannelAdmins('1')).toEqual([]);
  });

  it('getChannelAdmins(): CHAT_ADMIN_REQUIRED (Telegram từ chối tiết lộ admin cho thành viên thường) → null, không throw', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    mocks.invoke.mockRejectedValueOnce({ errorMessage: 'CHAT_ADMIN_REQUIRED', message: '400: CHAT_ADMIN_REQUIRED (caused by channels.GetParticipants)' });
    expect(await methods.getChannelAdmins('1')).toBeNull();
  });

  it('getChannelAdmins(): lỗi khác CHAT_ADMIN_REQUIRED (FLOOD_WAIT, mất mạng...) vẫn ném nguyên văn', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    mocks.invoke.mockRejectedValueOnce(new Error('FLOOD_WAIT_120'));
    await expect(methods.getChannelAdmins('1')).rejects.toThrow('FLOOD_WAIT_120');
  });

  it('checkPublisherIsAdmin(): participant là Admin hoặc Creator → true', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    mocks.invoke.mockResolvedValueOnce(new Api.channels.ChannelParticipant({ participant: new Api.ChannelParticipantAdmin({} as never) } as never));
    expect(await methods.checkPublisherIsAdmin('1', 'u1')).toBe(true);

    mocks.invoke.mockResolvedValueOnce(new Api.channels.ChannelParticipant({ participant: new Api.ChannelParticipantCreator({} as never) } as never));
    expect(await methods.checkPublisherIsAdmin('1', 'u2')).toBe(true);
  });

  it('checkPublisherIsAdmin(): participant là thành viên thường → false', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    mocks.invoke.mockResolvedValueOnce(new Api.channels.ChannelParticipant({ participant: new Api.ChannelParticipant({} as never) } as never));
    expect(await methods.checkPublisherIsAdmin('1', 'u3')).toBe(false);
  });

  it('checkPublisherIsAdmin(): USER_NOT_PARTICIPANT (không còn/chưa từng là thành viên) → false, không throw', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    mocks.invoke.mockRejectedValueOnce({ errorMessage: 'USER_NOT_PARTICIPANT' });
    expect(await methods.checkPublisherIsAdmin('1', 'u4')).toBe(false);
  });

  it('checkPublisherIsAdmin(): CHAT_ADMIN_REQUIRED (Telegram từ chối kể cả tra cứu một người) → null, không throw', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    mocks.invoke.mockRejectedValueOnce({ errorMessage: 'CHAT_ADMIN_REQUIRED' });
    expect(await methods.checkPublisherIsAdmin('1', 'u5')).toBeNull();
  });

  it('checkPublisherIsAdmin(): lỗi khác (FLOOD_WAIT...) vẫn ném nguyên văn', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    mocks.invoke.mockRejectedValueOnce(new Error('FLOOD_WAIT_60'));
    await expect(methods.checkPublisherIsAdmin('1', 'u6')).rejects.toThrow('FLOOD_WAIT_60');
  });

  it('listForumTopics(): kênh không phải Forum → null, KHÔNG gọi invoke (channel.forum lấy free từ entity đã resolve)', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValueOnce(makeChannel({ forum: false }));

    expect(await methods.listForumTopics('1')).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('listForumTopics(): kênh Forum → gọi channels.GetForumTopics, map id/title, bỏ qua entry không phải ForumTopic', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValueOnce(makeChannel({ forum: true }));

    mocks.invoke.mockResolvedValueOnce({
      topics: [new Api.ForumTopic({ id: 1, title: 'General' } as never), new Api.ForumTopic({ id: 5, title: 'Phim bộ' } as never), { notATopic: true }]
    });

    const result = await methods.listForumTopics('1');
    expect(result).toEqual([
      { id: '1', title: 'General' },
      { id: '5', title: 'Phim bộ' }
    ]);
  });

  it('diagnoseChannel(): phân loại đúng document (có/không filename, video attr), photo, media khác, và message không có media — KHÔNG lọc gì cả', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValue(makeChannel());

    const docWithFileName = new Api.Document({
      mimeType: 'video/mp4',
      size: 1000,
      attributes: [new Api.DocumentAttributeFilename({ fileName: 'Movie.mkv' } as never)]
    } as never);
    const docVideoNoFileName = new Api.Document({
      mimeType: 'video/mp4',
      size: 2000,
      attributes: [new Api.DocumentAttributeVideo({ w: 1920, h: 1080, duration: 100 } as never)]
    } as never);

    mocks.getMessages.mockResolvedValueOnce([
      { id: 1, senderId: { toString: () => 'u1' }, media: new Api.MessageMediaDocument({ document: docWithFileName } as never) },
      { id: 2, senderId: { toString: () => 'u2' }, media: new Api.MessageMediaDocument({ document: docVideoNoFileName } as never) },
      { id: 3, senderId: { toString: () => 'u3' }, media: new Api.MessageMediaPhoto({} as never) },
      { id: 4, senderId: { toString: () => 'u4' }, media: { somethingElse: true } },
      { id: 5, senderId: { toString: () => 'u5' }, media: undefined }
    ]);

    const result = await methods.diagnoseChannel('@my_channel', 100);
    expect(result).toEqual([
      { msgId: 1, publisherId: 'u1', mediaKind: 'document', mimeType: 'video/mp4', fileName: 'Movie.mkv', hasVideoAttrNoFilename: false, size: 1000 },
      { msgId: 2, publisherId: 'u2', mediaKind: 'document', mimeType: 'video/mp4', fileName: undefined, hasVideoAttrNoFilename: true, size: 2000 },
      { msgId: 3, publisherId: 'u3', mediaKind: 'photo', hasVideoAttrNoFilename: false },
      { msgId: 4, publisherId: 'u4', mediaKind: 'other', hasVideoAttrNoFilename: false },
      { msgId: 5, publisherId: 'u5', mediaKind: 'none', hasVideoAttrNoFilename: false }
    ]);
    expect(mocks.getMessages).toHaveBeenCalledWith(expect.anything(), { limit: 100 });
  });

  it('diagnoseChannel(): ref không resolve được kênh → throw, không gọi getMessages', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValueOnce(new Api.User(5 as never));

    await expect(methods.diagnoseChannel('@a_user', 100)).rejects.toThrow(/không phải kênh/);
    expect(mocks.getMessages).not.toHaveBeenCalled();
  });

  it('publishCatalogDocument(): sendFile → pinMessage → deleteMessages, ĐÚNG THỨ TỰ (ghim trước, xoá catalog cũ sau) — cùng khuôn publishSnapshot()', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValueOnce(makeChannel({ id: 1 }));

    const order: string[] = [];
    mocks.sendFile.mockImplementationOnce(async () => {
      order.push('sendFile');
      return { id: 55 };
    });
    mocks.pinMessage.mockImplementationOnce(async () => {
      order.push('pinMessage');
    });
    mocks.deleteMessages.mockImplementationOnce(async () => {
      order.push('deleteMessages');
    });

    const result = await methods.publishCatalogDocument('1', '{"spec":"tsmc-catalog/1"}', 42);

    expect(result).toEqual({ msgId: 55 });
    expect(order).toEqual(['sendFile', 'pinMessage', 'deleteMessages']);
    expect(mocks.pinMessage).toHaveBeenCalledWith(expect.anything(), 55, { notify: false });
    expect(mocks.deleteMessages).toHaveBeenCalledWith(expect.anything(), [42], { revoke: true });
  });

  it('publishCatalogDocument(): previousMsgId rỗng (nguồn chưa từng có catalog) → KHÔNG gọi deleteMessages', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValueOnce(makeChannel({ id: 1 }));
    mocks.sendFile.mockResolvedValueOnce({ id: 1 });

    await methods.publishCatalogDocument('1', '{}');

    expect(mocks.deleteMessages).not.toHaveBeenCalled();
  });

  it('publishCatalogDocument(): tên file khớp CATALOG_FILENAME_RE (catalog.v1.json) — để lượt đọc kế tiếp nhận ra đây là catalog', async () => {
    const client = await makeClient();
    const methods = createIndexGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValueOnce(makeChannel({ id: 1 }));
    mocks.sendFile.mockResolvedValueOnce({ id: 1 });

    await methods.publishCatalogDocument('1', '{}');

    const call = mocks.sendFile.mock.calls[0][1] as { file: { name: string }; forceDocument: boolean };
    expect(call.file.name).toBe('catalog.v1.json');
    expect(call.forceDocument).toBe(true);
  });
});
