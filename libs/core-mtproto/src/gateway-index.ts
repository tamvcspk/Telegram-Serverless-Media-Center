// Kênh/tin nhắn cho slice Index (F2) — ADR-0010, docs/catalog-spec.md. Tách
// khỏi gateway.ts/gateway-sync.ts (mối quan tâm khác: đọc metadata toàn cục
// từ kênh media, không phải state riêng tư) nhưng vẫn nằm trong core-mtproto
// vì CLAUDE.md bất biến #3: chỉ package này được import `telegram`. Không
// type nào của GramJS/`Api.*` rò ra ngoài — mọi hàm trả DTO khớp interface
// IndexGateway (libs/core-index/src/gateway-port.ts), không import type đó
// ở đây (cùng quy ước với gateway-sync.ts).
import bigInt from 'big-integer';
import { Api, client as gramjsClientNs, type TelegramClient } from 'telegram';

// Tên file catalog theo catalog-spec.md §"Đặt ở đâu": `catalog.v1.json`,
// hoặc mảnh `catalog.v1.part1.json`/`catalog.v1.index.json` — MVP slice này
// chỉ đọc file đơn (không mảnh), nhận diện bằng tiền tố `catalog.v1`.
const CATALOG_FILENAME_RE = /^catalog\.v1.*\.json$/i;

// telegram@2.26.22 (ghim cứng — CLAUDE.md bất biến #9, package đã archive)
// có regex parseUsername() chỉ nhận dạng invite link kiểu CŨ
// `t.me/joinchat/HASH`, KHÔNG nhận `t.me/+HASH` (định dạng Telegram đổi
// sang từ lâu) — phát hiện thật khi user thêm nguồn bằng link `t.me/+...`,
// getEntity() ném "Cannot find any entity corresponding to ...". Chuyển về
// dạng joinchat/ cũ trước khi gọi GramJS để né lỗi thư viện, không có cách
// nào vá regex nội bộ của package mà không fork nó.
const PLUS_INVITE_RE = /^(?:(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/)?\+([A-Za-z0-9_-]+)\/?$/i;

// `t.me/c/<id>[/<msgId>]` là deep-link NỘI BỘ của Telegram, nhúng thẳng
// channel id thô — GramJS không tự resolve được bằng contacts.ResolveUsername
// hay CheckChatInvite (không phải username/invite hash). Nhưng id thô KHÔNG
// vô dụng: nếu tài khoản ĐANG ĐĂNG NHẬP là thành viên của kênh đó, id này đã
// nằm sẵn trong dialog list của chính tài khoản đó (access_hash cục bộ, per
// account — CLAUDE.md bất biến #10 nói đúng điều này: access_hash khác nhau
// theo từng tài khoản, nên chỉ resolve qua dialog CỦA TÀI KHOẢN ĐANG DÙNG,
// không bao giờ coi id này là định danh chia sẻ được cho tài khoản khác).
// Vì vậy: MỌI thành viên (không riêng admin) tự thêm được kênh bằng link này
// từ chính tài khoản của họ, miễn đã là thành viên — không phải hạn chế
// quyền, chỉ là "phải tự resolve bằng dialog của mình, không dùng lại được
// id từ tài khoản khác" (phát hiện thật khi user thử thêm nguồn bằng link
// t.me/c/...).
const INTERNAL_C_LINK_RE = /^(?:https?:\/\/)?(?:www\.)?t\.me\/c\/(\d+)(?:\/\d+)?\/?$/i;

interface NormalizedRef {
  kind: 'ref' | 'ownDialogId';
  value: string;
}

function normalizeChannelRef(ref: string): NormalizedRef {
  const trimmed = ref.trim();

  const cLinkMatch = trimmed.match(INTERNAL_C_LINK_RE);
  if (cLinkMatch) {
    return { kind: 'ownDialogId', value: cLinkMatch[1] };
  }

  const plusMatch = trimmed.match(PLUS_INVITE_RE);
  if (plusMatch) {
    return { kind: 'ref', value: `https://t.me/joinchat/${plusMatch[1]}` };
  }

  return { kind: 'ref', value: trimmed };
}

export interface ResolvedIndexChannel {
  id: string;
  accessHash: string;
  title: string;
  /** `creator === true` — ADR-0010 §3: kênh private của user tin toàn bộ. */
  isOwn: boolean;
  /** `channel.forum === true` (SPIKE-07) — field có sẵn từ resolve kênh, không cần RPC riêng. */
  isForum: boolean;
}

export interface MemberChannelSummary extends ResolvedIndexChannel {
  /** true = channel/broadcast, false = supergroup — chỉ để hiển thị, không ảnh hưởng logic trust. */
  isBroadcast: boolean;
}

export interface PinnedCatalogDocument {
  msgId: number;
  publisherId: string;
  raw: string;
}

export interface IndexHistoryMessage {
  msgId: number;
  publisherId: string;
  date: number;
  fileName?: string;
  /** Text/caption của message — nguồn title dự phòng khi video gửi "as video" không có fileName (phát hiện thật, xem index-engine.ts). */
  caption?: string;
  mimeType?: string;
  size?: number;
  video?: { w: number; h: number; durationSec: number };
  /** Forum Topic message này thuộc về — `replyToTopId ?? replyToMsgId` khi `forumTopic` (SPIKE-07). */
  topicId?: string;
  /** Hashtag tách từ `message.entities` (MessageEntityHashtag) — không regex lại caption thô. */
  hashtags?: string[];
}

/**
 * CHẨN ĐOÁN — KHÔNG lọc gì cả (không media-type, không fileName-required,
 * không trust). Trả nguyên trạng từng message trong `limit` message mới nhất
 * để trả lời "kênh này thật ra có gì" trước khi chỉnh filter thật. Chỉ để
 * debug UI gọi trực tiếp qua RPC — KHÔNG dùng trong index-engine.ts.
 */
export interface ChannelDiagnosticMessage {
  msgId: number;
  publisherId: string;
  /** 'none' = message không có media (text/system message...). */
  mediaKind: 'document' | 'photo' | 'other' | 'none';
  mimeType?: string;
  fileName?: string;
  /** Document có DocumentAttributeVideo nhưng KHÔNG có DocumentAttributeFilename — nghi vấn chính (gửi "as video" thay vì "as file"). */
  hasVideoAttrNoFilename: boolean;
  size?: number;
}

function extractFileName(document: Api.Document): string | undefined {
  const attr = document.attributes.find((a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename);
  return attr?.fileName;
}

function extractVideoAttributes(document: Api.Document): IndexHistoryMessage['video'] {
  const attr = document.attributes.find((a): a is Api.DocumentAttributeVideo => a instanceof Api.DocumentAttributeVideo);
  if (!attr) {
    return undefined;
  }
  return { w: attr.w, h: attr.h, durationSec: attr.duration };
}

/**
 * SPIKE-07: Telegram chỉ set `replyToTopId` cho reply SÂU bên trong topic —
 * message gửi THẲNG vào topic chỉ có `replyToMsgId` (= chính id topic). Đọc
 * một field đơn lẻ theo trực giác ban đầu cho kết quả sai (đã verify thật).
 * Message không thuộc topic nào: `replyTo` hoàn toàn `undefined`.
 */
function extractTopicId(message: Api.Message): string | undefined {
  const replyTo = message.replyTo;
  if (!(replyTo instanceof Api.MessageReplyHeader) || replyTo.forumTopic !== true) {
    return undefined;
  }
  const topicId = replyTo.replyToTopId ?? replyTo.replyToMsgId;
  return topicId !== undefined ? topicId.toString() : undefined;
}

/**
 * `MessageEntityHashtag.offset/length` đã cắt sẵn ranh giới hashtag trong
 * `message.message` (text/caption) — đáng tin hơn tự đoán bằng regex trên
 * caption thô (ADR-0010 § Cập nhật 2026-08-29 mục B).
 */
function extractHashtags(message: Api.Message): string[] | undefined {
  const text = message.message;
  const entities = message.entities;
  if (!text || !entities || entities.length === 0) {
    return undefined;
  }
  const tags: string[] = [];
  for (const entity of entities) {
    if (entity instanceof Api.MessageEntityHashtag) {
      const tag = text.slice(entity.offset, entity.offset + entity.length);
      if (tag) {
        tags.push(tag);
      }
    }
  }
  return tags.length > 0 ? tags : undefined;
}

/**
 * Nhóm các RPC channel/message cho index — nhận `getClient` thay vì tự giữ
 * `client` để dùng chung đúng một session với gateway.ts (client chỉ tồn
 * tại sau login/restoreSession thành công), cùng quy ước với gateway-sync.ts.
 */
export function createIndexGatewayMethods(getClient: () => TelegramClient) {
  // Cache entity trong bộ nhớ của phiên Worker này, tách khỏi cache của
  // gateway-sync.ts (kênh khác nhau, không có lý do dùng chung).
  const channelCache = new Map<string, Api.Channel>();

  function cache(channel: Api.Channel): ResolvedIndexChannel {
    const id = channel.id.toString();
    channelCache.set(id, channel);
    return { id, accessHash: channel.accessHash?.toString() ?? '', title: channel.title, isOwn: channel.creator === true, isForum: channel.forum === true };
  }

  async function resolveChannelEntity(channelId: string): Promise<Api.Channel> {
    const cached = channelCache.get(channelId);
    if (cached) {
      return cached;
    }
    const entity = await getClient().getEntity(Number(channelId));
    if (!(entity instanceof Api.Channel)) {
      throw new Error(`Entity ${channelId} không phải channel`);
    }
    channelCache.set(channelId, entity);
    return entity;
  }

  /**
   * `ref` là username/invite link do user nhập (CLAUDE.md bất biến #10 —
   * không bao giờ CHIA SẺ id thô CHO NGƯỜI KHÁC), hoặc link nội bộ
   * t.me/c/<id> mà chính tài khoản đang đăng nhập tự resolve qua dialog list
   * của MÌNH (xem comment ở normalizeChannelRef). Tách thành hàm riêng để
   * `resolveIndexChannel` (public API) và `diagnoseChannel` (debug) dùng
   * chung, không lặp logic.
   *
   * KHÔNG nuốt lỗi ở đây — resolve thất bại (username sai, FLOOD_WAIT, chưa
   * join kênh private, v.v.) phải nổi lên nguyên message gốc của GramJS cho
   * tầng trên (index-engine.ts) ghi vào lastError, chứ không rơi hết vào
   * một câu chung chung không debug được.
   */
  async function resolveByRef(ref: string): Promise<ResolvedIndexChannel | null> {
    const normalized = normalizeChannelRef(ref);

    if (normalized.kind === 'ownDialogId') {
      const cached = channelCache.get(normalized.value);
      if (cached) {
        return cache(cached);
      }
      // t.me/c/<id> không resolve được qua ResolveUsername/CheckChatInvite
      // — chỉ tìm được nếu chính tài khoản đang đăng nhập đã có kênh này
      // trong dialog list (đã là thành viên). getDialogs({}) populate lại
      // cache entity của GramJS, cùng cách listOwnStateChannelCandidates()
      // (gateway-sync.ts) đã dùng.
      const dialogs = await getClient().getDialogs({});
      const found = dialogs
        .map((d) => d.entity)
        .find((entity): entity is Api.Channel => entity instanceof Api.Channel && entity.id.toString() === normalized.value);
      if (!found) {
        throw new Error(
          `Không tìm thấy kênh (id ${normalized.value}) trong danh sách chat của tài khoản đang đăng nhập — cần là thành viên của kênh này. Nếu vừa tham gia, thử lại; nếu không, dùng link mời (t.me/+...) hoặc username công khai thay thế.`
        );
      }
      return cache(found);
    }

    const entity = await getClient().getEntity(normalized.value);
    if (!(entity instanceof Api.Channel)) {
      return null;
    }
    return cache(entity);
  }

  return {
    /**
     * Liệt kê toàn bộ channel/supergroup mà tài khoản đang đăng nhập ĐÃ LÀ
     * thành viên — thay cho việc bắt user tự gõ/dán username hay invite
     * link (nguồn lỗi thật: sai định dạng link, link t.me/c/ không phải
     * thành viên, kênh ẩn danh sách admin...). Chọn thẳng từ đây loại bỏ
     * toàn bộ bước resolve ref, vì entity ở đây đã có sẵn access_hash đúng.
     * KHÔNG lọc theo quyền admin — mọi channel/supergroup đã tham gia đều
     * hiện ra, kể cả những cái user chỉ là thành viên thường.
     */
    async listMemberChannels(): Promise<MemberChannelSummary[]> {
      const dialogs = await getClient().getDialogs({});
      const result: MemberChannelSummary[] = [];
      for (const dialog of dialogs) {
        const entity = dialog.entity;
        if (entity instanceof Api.Channel && !entity.left) {
          result.push({ ...cache(entity), isBroadcast: entity.broadcast === true });
        }
      }
      return result;
    },

    resolveIndexChannel: resolveByRef,

    /**
     * Không lọc gì cả (xem comment ở ChannelDiagnosticMessage) — trả nguyên
     * trạng `limit` message mới nhất để so sánh với những gì scanSource()
     * thực sự giữ lại, tìm đúng tầng đang loại bỏ nội dung.
     */
    async diagnoseChannel(ref: string, limit: number): Promise<ChannelDiagnosticMessage[]> {
      const channel = await resolveByRef(ref);
      if (!channel) {
        throw new Error(`"${ref}" không phải kênh (có thể là user/group thường).`);
      }
      const entity = await resolveChannelEntity(channel.id);
      const messages = await getClient().getMessages(entity, { limit });

      return messages.map((message): ChannelDiagnosticMessage => {
        const publisherId = message.senderId?.toString() ?? '';
        const media = message.media;

        if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
          const document = media.document;
          const fileName = extractFileName(document);
          const hasVideoAttr = document.attributes.some((a) => a instanceof Api.DocumentAttributeVideo);
          return {
            msgId: message.id,
            publisherId,
            mediaKind: 'document',
            mimeType: document.mimeType,
            fileName,
            hasVideoAttrNoFilename: hasVideoAttr && !fileName,
            size: document.size.toJSNumber()
          };
        }
        if (media instanceof Api.MessageMediaPhoto) {
          return { msgId: message.id, publisherId, mediaKind: 'photo', hasVideoAttrNoFilename: false };
        }
        if (media) {
          return { msgId: message.id, publisherId, mediaKind: 'other', hasVideoAttrNoFilename: false };
        }
        return { msgId: message.id, publisherId, mediaKind: 'none', hasVideoAttrNoFilename: false };
      });
    },

    async getPinnedCatalogDocument(channelId: string): Promise<PinnedCatalogDocument | null> {
      const client = getClient();
      const channel = await resolveChannelEntity(channelId);
      const full = await client.invoke(new Api.channels.GetFullChannel({ channel }));
      const pinnedMsgId = full.fullChat instanceof Api.ChannelFull ? full.fullChat.pinnedMsgId : undefined;
      if (!pinnedMsgId) {
        return null;
      }

      const [pinnedMessage] = await client.getMessages(channel, { ids: [pinnedMsgId] });
      const document = pinnedMessage?.media instanceof Api.MessageMediaDocument ? pinnedMessage.media.document : undefined;
      if (!pinnedMessage || !(document instanceof Api.Document)) {
        return null;
      }
      const fileName = extractFileName(document);
      if (!fileName || !CATALOG_FILENAME_RE.test(fileName)) {
        return null;
      }

      const buffer = await client.downloadMedia(pinnedMessage);
      if (!buffer || typeof buffer === 'string') {
        return null;
      }
      return {
        msgId: pinnedMessage.id,
        publisherId: pinnedMessage.senderId?.toString() ?? '',
        raw: new TextDecoder().decode(buffer)
      };
    },

    /**
     * `direction: 'asc'` (mặc định, dùng cho T2 delta) — quét lên từ `minId`,
     * tăng dần, đúng cho "chỉ message MỚI kể từ lần quét trước".
     *
     * `direction: 'desc'` (T3 full-scan bounded) — bỏ qua `minId`, lấy
     * `limit` message MỚI NHẤT (giảm dần). Phát hiện thật: dùng `reverse:
     * true, minId: 0` cho full-scan sẽ quét từ message CŨ NHẤT trước — với
     * kênh có hơn `limit` message, phim thật (thường ở phần mới hơn) không
     * bao giờ được quét tới trong ngân sách bounded, và delta kế tiếp cứ bò
     * dần từ đầu kênh nên cũng luôn ra 0 item. Ưu tiên nội dung MỚI trước là
     * đúng ý "quét toàn bộ" hơn — ADR-0010 chấp nhận phần rất cũ có thể
     * không bao giờ được quét tới trong slice bounded này.
     */
    async fetchHistorySince(channelId: string, minId: number, limit: number, direction: 'asc' | 'desc' = 'asc'): Promise<IndexHistoryMessage[]> {
      const channel = await resolveChannelEntity(channelId);
      const messages =
        direction === 'asc' ? await getClient().getMessages(channel, { minId, limit, reverse: true }) : await getClient().getMessages(channel, { limit });

      const items: IndexHistoryMessage[] = [];
      for (const message of messages) {
        const document = message.media instanceof Api.MessageMediaDocument ? message.media.document : undefined;
        if (!(document instanceof Api.Document)) {
          continue;
        }
        items.push({
          msgId: message.id,
          publisherId: message.senderId?.toString() ?? '',
          date: message.date ? message.date * 1000 : Date.now(),
          fileName: extractFileName(document),
          caption: message.message || undefined,
          mimeType: document.mimeType,
          size: document.size.toJSNumber(),
          video: extractVideoAttributes(document),
          topicId: extractTopicId(message),
          hashtags: extractHashtags(message)
        });
      }
      return items;
    },

    /**
     * Luôn hit mạng — TTL cache là việc của core-index (lưu trong Dexie
     * `indexMeta`, có thể inspect/test được), không cache ở đây.
     *
     * Trả `null` khi Telegram từ chối tiết lộ danh sách admin
     * (`CHAT_ADMIN_REQUIRED` — phát hiện thật: nhiều nhóm/kênh ẩn participant
     * list với thành viên thường, kể cả filter chỉ hỏi admin). Đây KHÔNG phải
     * lỗi cần dừng scan — core-index/trust.ts quyết định null nghĩa là gì
     * (mặc định: tin mọi publisher khi không xác định được ai là admin).
     * Lỗi khác (FLOOD_WAIT, mất mạng...) vẫn ném nguyên văn.
     */
    async getChannelAdmins(channelId: string): Promise<string[] | null> {
      const client = getClient();
      const channel = await resolveChannelEntity(channelId);

      async function fetchParticipants() {
        try {
          return await client.invoke(
            new Api.channels.GetParticipants({
              channel,
              filter: new Api.ChannelParticipantsAdmins(),
              offset: 0,
              limit: 200,
              hash: bigInt(0)
            })
          );
        } catch (err) {
          if (typeof err === 'object' && err !== null && (err as { errorMessage?: unknown }).errorMessage === 'CHAT_ADMIN_REQUIRED') {
            return 'admin_required' as const;
          }
          throw err;
        }
      }

      const result = await fetchParticipants();
      if (result === 'admin_required') {
        return null;
      }
      if (!(result instanceof Api.channels.ChannelParticipants)) {
        return [];
      }
      // ChannelParticipantsAdmins chỉ trả về ChannelParticipant/Creator/Admin
      // — cả ba đều có `userId` (khác Banned/Left, dùng `peer` thay vì
      // `userId`), nên narrow bằng `in` thay vì liệt kê instanceof 3 lớp.
      return result.participants
        .filter((p): p is Api.TypeChannelParticipant & { userId: ReturnType<typeof bigInt> } => 'userId' in p)
        .map((p) => p.userId.toString());
    },

    /**
     * Kiểm tra ĐÚNG MỘT publisher — `channels.GetParticipant`, khác
     * `channels.GetParticipants` (liệt kê toàn bộ) ở chỗ đây là tra cứu một
     * user id đã biết, không phải "cho tôi xem toàn bộ danh sách". Dùng làm
     * fallback LÚC TRUY CẬP (core-index/trust.ts resolvePublisherTrust) khi
     * danh sách admin không sẵn có — KHÔNG BAO GIỜ được gọi hàng loạt cho
     * nhiều publisher trong một lượt quét (kênh 1000 publisher × 1000 cuộc
     * gọi là con đường thẳng tới FLOOD_WAIT, xem ADR-0006). Trả `null` khi
     * Telegram vẫn từ chối tiết lộ dù chỉ hỏi một người (hiếm hơn
     * CHAT_ADMIN_REQUIRED của bản liệt kê, nhưng vẫn có thể xảy ra) — coi
     * như chưa xác định được, không phải "chắc chắn không phải admin".
     * `USER_NOT_PARTICIPANT` (publisher không còn/chưa từng là thành viên)
     * → false, chắc chắn không phải admin.
     */
    async checkPublisherIsAdmin(channelId: string, publisherId: string): Promise<boolean | null> {
      const client = getClient();
      const channel = await resolveChannelEntity(channelId);

      async function fetchParticipant() {
        try {
          return await client.invoke(new Api.channels.GetParticipant({ channel, participant: publisherId }));
        } catch (err) {
          const errorMessage = typeof err === 'object' && err !== null ? (err as { errorMessage?: unknown }).errorMessage : undefined;
          if (errorMessage === 'CHAT_ADMIN_REQUIRED') {
            return 'unknown' as const;
          }
          if (errorMessage === 'USER_NOT_PARTICIPANT') {
            return 'not_participant' as const;
          }
          throw err;
        }
      }

      const result = await fetchParticipant();
      if (result === 'unknown') {
        return null;
      }
      if (result === 'not_participant' || !(result instanceof Api.channels.ChannelParticipant)) {
        return false;
      }
      return result.participant instanceof Api.ChannelParticipantAdmin || result.participant instanceof Api.ChannelParticipantCreator;
    },

    /**
     * `channels.GetForumTopics` (SPIKE-07) — 1 RPC/kênh, cache là việc của
     * core-index/forum-topics.ts (cùng convention với getChannelAdmins()).
     * Kiểm tra `channel.forum` từ entity ĐÃ RESOLVE (miễn phí, không RPC
     * riêng) trước khi gọi — trả `null` ngay cho kênh không phải Forum thay
     * vì để Telegram từ chối, vì đa số kênh media là broadcast (không Forum).
     */
    async listForumTopics(channelId: string): Promise<{ id: string; title: string }[] | null> {
      const client = getClient();
      const channel = await resolveChannelEntity(channelId);
      if (channel.forum !== true) {
        return null;
      }

      const result = await client.invoke(
        new Api.channels.GetForumTopics({
          channel,
          offsetDate: 0,
          offsetId: 0,
          offsetTopic: 0,
          limit: 100
        })
      );
      return result.topics.filter((t): t is Api.ForumTopic => t instanceof Api.ForumTopic).map((t) => ({ id: t.id.toString(), title: t.title }));
    },

    /**
     * Ingest Editor (Màn hình 6) — kiểm tra quyền ghi (`isOwn`) đã làm ở tầng
     * trên (`publish-catalog.ts`), hàm này chỉ lo upload/ghim/dọn. Tên file
     * PHẢI khớp `CATALOG_FILENAME_RE` phía trên để lần đọc kế tiếp
     * (`getPinnedCatalogDocument`) nhận ra đây là catalog, không phải file
     * ghim ngẫu nhiên nào khác. Cùng khuôn `sendFile → pinMessage →
     * deleteMessages` với `publishSnapshot()` (gateway-sync.ts, ADR-0009) —
     * ghim TRƯỚC, xoá catalog CŨ (nếu có) SAU, không để kênh media thiếu
     * catalog dù chỉ một khoảnh khắc giữa hai bước.
     */
    async publishCatalogDocument(channelId: string, json: string, previousMsgId?: number): Promise<{ msgId: number }> {
      const client = getClient();
      const channel = await resolveChannelEntity(channelId);
      const bytes = new TextEncoder().encode(json);

      const message = await client.sendFile(channel, {
        // CustomFile đọc `.length`/index như mảng byte — Uint8Array tương
        // thích runtime dù type khai báo Buffer (cùng ép kiểu như
        // publishSnapshot(), xem comment ở gateway-sync.ts).
        file: new gramjsClientNs.uploads.CustomFile('catalog.v1.json', bytes.length, '', bytes as never),
        forceDocument: true
      });
      await client.pinMessage(channel, message.id, { notify: false });
      if (previousMsgId) {
        await client.deleteMessages(channel, [previousMsgId], { revoke: true });
      }
      return { msgId: message.id };
    }
  };
}
