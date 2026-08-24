// Kênh/tin nhắn cho slice Sync & Hydration (F1.2/F1.3) — ADR-0009/ADR-0014.
// Tách khỏi gateway.ts (vốn chỉ lo auth) để file đó không phình; vẫn nằm
// trong core-mtproto vì CLAUDE.md bất biến #3: chỉ package này được import
// `telegram`. Không type nào của GramJS/`Api.*` rò ra ngoài — mọi hàm ở đây
// trả về DTO của @tsmc/shared-models hoặc kiểu do @tsmc/core-sync định nghĩa
// (gateway-port.ts), khớp interface SyncGateway.
import { Api, client as gramjsClientNs, type TelegramClient } from 'telegram';
import { isSyncEvent, type SnapshotV1, type StateChannelCandidate, type SyncEvent } from '@tsmc/shared-models';

// Dấu hiệu nhận dạng kênh state trong `about` — ADR-0014 mục "Tạo và tìm lại kênh".
const STATE_CHANNEL_ABOUT_PREFIX = 'tsmc-state/1';
const STATE_CHANNEL_TITLE = 'TSMC State';
const STATE_CHANNEL_ABOUT = `${STATE_CHANNEL_ABOUT_PREFIX} · Kho dữ liệu của Telegram Media Center. Đừng xoá kênh này.`;
// messages.getHistory trả tối đa 100/lần dù limit lớn hơn — GramJS tự phân
// trang khi limit vượt mức đó (xem IterMessagesParams), 500 chỉ là mức trần
// hợp lý cho một lần đọc kể từ snapshot (compaction chạy trước khi log vượt
// 200 event — ADR-0009 — nên khoảng cách thực tế luôn nhỏ hơn nhiều).
const FETCH_EVENTS_PAGE_LIMIT = 500;

export interface MinimalChannel {
  id: string;
  accessHash: string;
}

/**
 * Nhóm các RPC channel/message cho sync — nhận `getClient` thay vì tự giữ
 * `client` để dùng chung đúng một session với gateway.ts (client chỉ tồn
 * tại sau login/restoreSession thành công).
 */
export function createSyncGatewayMethods(getClient: () => TelegramClient) {
  // Cache entity trong bộ nhớ của phiên Worker này — mọi lần resolve kênh
  // (tạo mới/dò dialog/xác thực cache) đều đi qua các hàm dưới đây và ghi
  // vào đây, nên sendEvent/fetchEventsSince/... sau đó luôn tìm thấy mà
  // không cần gọi lại getEntity(). Fallback getEntity() vẫn giữ cho trường
  // hợp gọi thẳng không qua resolveStateChannel trước (không nên xảy ra
  // trong luồng thật, nhưng rẻ để phòng thủ).
  const channelCache = new Map<string, Api.Channel>();

  function cache(channel: Api.Channel): MinimalChannel {
    channelCache.set(channel.id.toString(), channel);
    return { id: channel.id.toString(), accessHash: channel.accessHash?.toString() ?? '' };
  }

  async function resolveChannel(channelId: string): Promise<Api.Channel> {
    const cached = channelCache.get(channelId);
    if (cached) {
      return cached;
    }
    // EntityLike chấp nhận số nguyên trần (PeerID) — channel id thật của
    // Telegram nằm trong ngưỡng an toàn của Number, không cần BigInteger.
    const entity = await getClient().getEntity(Number(channelId));
    if (!(entity instanceof Api.Channel)) {
      throw new Error(`Entity ${channelId} không phải channel`);
    }
    channelCache.set(channelId, entity);
    return entity;
  }

  function extractAbout(fullChat: Api.TypeChatFull): string | undefined {
    return fullChat instanceof Api.ChannelFull ? fullChat.about : undefined;
  }

  function extractPinnedMsgId(fullChat: Api.TypeChatFull): number | undefined {
    return fullChat instanceof Api.ChannelFull ? fullChat.pinnedMsgId : undefined;
  }

  return {
    async listOwnStateChannelCandidates(): Promise<StateChannelCandidate[]> {
      const client = getClient();
      const dialogs = await client.getDialogs({});
      const candidates: StateChannelCandidate[] = [];

      for (const dialog of dialogs) {
        const entity = dialog.entity;
        if (!(entity instanceof Api.Channel) || !entity.broadcast || !entity.creator) {
          continue;
        }
        const full = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        const about = extractAbout(full.fullChat);
        if (!about?.startsWith(STATE_CHANNEL_ABOUT_PREFIX)) {
          continue;
        }
        cache(entity);
        candidates.push({
          id: entity.id.toString(),
          accessHash: entity.accessHash?.toString() ?? '',
          title: entity.title,
          eventCount: full.fullChat instanceof Api.ChannelFull ? (full.fullChat.pinnedMsgId ?? 0) : 0,
          updatedAt: dialog.date ? dialog.date * 1000 : Date.now()
        });
      }
      return candidates;
    },

    async getChannelById(id: string): Promise<MinimalChannel | null> {
      try {
        const channel = await resolveChannel(id);
        return { id: channel.id.toString(), accessHash: channel.accessHash?.toString() ?? '' };
      } catch {
        return null;
      }
    },

    async createStateChannel(): Promise<MinimalChannel> {
      const client = getClient();
      const result = await client.invoke(
        new Api.channels.CreateChannel({ title: STATE_CHANNEL_TITLE, about: STATE_CHANNEL_ABOUT, broadcast: true, megagroup: false })
      );
      const created = (result as unknown as { chats?: Api.TypeChat[] }).chats?.find((c): c is Api.Channel => c instanceof Api.Channel);
      if (!created) {
        throw new Error('channels.createChannel không trả về channel nào trong Updates.chats');
      }
      return cache(created);
    },

    async sendEvent(channelId: string, event: SyncEvent): Promise<{ msgId: number }> {
      const channel = await resolveChannel(channelId);
      const text = JSON.stringify(event);
      if (text.length > 4096) {
        throw new Error(`Event JSON dài ${text.length} ký tự, vượt giới hạn 4096 của message Telegram`);
      }
      const message = await getClient().sendMessage(channel, { message: text });
      return { msgId: message.id };
    },

    async fetchEventsSince(channelId: string, sinceMsgId: number): Promise<Array<{ msgId: number; event: SyncEvent }>> {
      const channel = await resolveChannel(channelId);
      const messages = await getClient().getMessages(channel, { minId: sinceMsgId, limit: FETCH_EVENTS_PAGE_LIMIT, reverse: true });

      const events: Array<{ msgId: number; event: SyncEvent }> = [];
      for (const message of messages) {
        if (!message.message) {
          continue;
        }
        try {
          const parsed: unknown = JSON.parse(message.message);
          if (isSyncEvent(parsed)) {
            events.push({ msgId: message.id, event: parsed });
          }
        } catch {
          // Message text trong kênh state không phải JSON hợp lệ — bỏ qua
          // thay vì làm vỡ hydrate (biên ngoài, dù tự mình ghi — xem
          // isSyncEvent trong shared-models).
        }
      }
      return events;
    },

    async fetchPinnedSnapshot(channelId: string): Promise<SnapshotV1 | null> {
      const client = getClient();
      const channel = await resolveChannel(channelId);
      const full = await client.invoke(new Api.channels.GetFullChannel({ channel }));
      const pinnedMsgId = extractPinnedMsgId(full.fullChat);
      if (!pinnedMsgId) {
        return null;
      }

      const [pinnedMessage] = await client.getMessages(channel, { ids: [pinnedMsgId] });
      if (!pinnedMessage?.media) {
        return null;
      }
      const buffer = await client.downloadMedia(pinnedMessage);
      if (!buffer || typeof buffer === 'string') {
        return null;
      }
      const parsed: unknown = JSON.parse(new TextDecoder().decode(buffer));
      if (typeof parsed !== 'object' || parsed === null || (parsed as { v?: unknown }).v !== 1) {
        throw new Error('Snapshot ghim trong kênh state không đúng định dạng SnapshotV1');
      }
      return parsed as SnapshotV1;
    },

    async publishSnapshot(channelId: string, snapshot: SnapshotV1, compactedMsgIds: number[]): Promise<{ msgId: number }> {
      const client = getClient();
      const channel = await resolveChannel(channelId);
      const json = JSON.stringify(snapshot);
      // Dùng Uint8Array (TextEncoder), KHÔNG dùng `Buffer` toàn cục — type
      // Buffer chỉ resolve được khi @types/node nằm trong "types" của
      // project ĐANG biên dịch, và project đó có thể là build Angular của
      // apps/web (xuyên type CoreWorkerApi) vốn không được phép biết gì về
      // Node (ADR-0012 §2). CustomFile khai báo tham số kiểu Buffer nhưng
      // implementation của GramJS chỉ đọc `.length`/index như một mảng byte
      // — Uint8Array tương thích runtime, chỉ khác ở type, nên ép kiểu ở
      // đúng một chỗ gọi này thay vì kéo @types/node vào toàn bộ compile
      // graph. Cần xác nhận lại bằng thiết bị thật (rủi ro đã ghi trong
      // plan slice Sync — chưa từng gọi sendFile() thật).
      const bytes = new TextEncoder().encode(json);

      const message = await client.sendFile(channel, {
        file: new gramjsClientNs.uploads.CustomFile('snapshot.json', bytes.length, '', bytes as never),
        forceDocument: true
      });
      // Ghim TRƯỚC, xoá event đã nén SAU — ADR-0009: không để state chỉ
      // tồn tại trong RAM ở bất kỳ thời điểm nào giữa hai bước.
      await client.pinMessage(channel, message.id, { notify: false });
      if (compactedMsgIds.length > 0) {
        await client.deleteMessages(channel, compactedMsgIds, { revoke: true });
      }
      return { msgId: message.id };
    },

    serverNow(): number {
      // Chưa xác nhận được cách đọc time offset nội bộ của GramJS một cách
      // đáng tin cậy (private field, có thể đổi giữa các bản vá) — dùng
      // đồng hồ máy cục bộ cho tới khi kiểm chứng thật trên thiết bị thật.
      // Xem ADR-0009 "kẹp ts vào thời gian server Telegram" và ghi chú rủi
      // ro trong plan slice này.
      return Date.now();
    }
  };
}
