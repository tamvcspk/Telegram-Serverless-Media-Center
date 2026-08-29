// Điều phối 3 tầng — ADR-0010 mục 1. Chạy trong Core Worker, không import
// @tsmc/core-mtproto (nhận gateway/storage thật qua tham số, worker-host/
// core-worker.ts nối dây — cùng quy ước với core-sync/sync-engine.ts).
import { tryCatalogTier } from './catalog-tier';
import { ensureForumTopicsCached, lookupTopicTitle } from './forum-topics';
import type { IndexGateway, ResolvedIndexChannel } from './gateway-port';
import { deriveFallbackMetadata } from './hashtag-parser';
import { publishCatalogMetadata as writeCatalogPatch, type CatalogMetadataPatch } from './publish-catalog';
import type { IndexStoragePort, StoredMediaItem, TrustLabel } from './storage-port';
import { classifyFromCache, ensureChannelAdminListCached, resolvePublisherTrust } from './trust';

// messages.getHistory trả tối đa 100/lần dù limit lớn hơn — GramJS tự phân
// trang (xem gateway-sync.ts cho tiền lệ), 500 là mức trần hợp lý cho một
// lần quét delta (chỉ message MỚI kể từ lastIndexedMsgId, luôn nhỏ).
const DELTA_PAGE_LIMIT = 500;
// Quét MỘT LƯỢT, bounded — KHÔNG phải job nền thật (không resumable/cancel/
// progress-bar). Kênh có nhiều hơn số message này thì phần còn lại chưa
// được index — nâng cấp thành job nền có tiến trình để dành slice sau
// (quyết định đã chốt khi lập kế hoạch slice Index F2).
const FULL_SCAN_LIMIT = 2000;

export interface ScanResult {
  tier: 'catalog' | 'delta' | 'full' | 'none';
  itemCount: number;
  /** ADR-0010: quét toàn bộ không bao giờ tự chạy — UI phải hỏi user trước khi gọi lại với opts.tier = 'full'. */
  needsFullScanConfirmation?: boolean;
  error?: string;
}

export interface ResolveItemTrustResult {
  trust: TrustLabel | 'not-found';
}

export interface IndexEngine {
  scanSource(sourceId: string, ref: string, opts?: { tier: 'full' }): Promise<ScanResult>;
  /**
   * Lúc TRUY CẬP (on-access) — CHỈ resolve trust của item cụ thể này (không
   * đụng tới item khác của cùng nguồn). No-op rẻ nếu item đã resolve trước
   * đó (không phải 'pending'). Xem trust.ts resolvePublisherTrust().
   */
  resolveItemTrust(sourceId: string, ref: string, msgId: number): Promise<ResolveItemTrustResult>;
  /**
   * Ingest Editor (Màn hình 6) — chỉ hợp lệ cho Kho Cá Nhân (ADR-0014 §4,
   * `ResolvedIndexChannel.isOwn`). Gọi UI TRƯỚC khi cho nhập liệu, để chặn
   * ngay từ đầu thay vì đợi tới lúc Lưu mới báo lỗi.
   */
  checkWritable(ref: string): Promise<boolean>;
  /** Sửa 1 item rồi đóng gói lại TOÀN BỘ catalog.json của nguồn, ghim đè lên kênh media — xem publish-catalog.ts. */
  publishCatalogMetadata(sourceId: string, ref: string, msgId: number, patch: CatalogMetadataPatch): Promise<void>;
}

async function scanHistoryItems(
  gateway: IndexGateway,
  storage: IndexStoragePort,
  sourceId: string,
  channel: ResolvedIndexChannel,
  minId: number,
  limit: number,
  direction: 'asc' | 'desc'
): Promise<{ items: StoredMediaItem[]; maxMsgId: number }> {
  // MỘT cuộc gọi/kênh (rẻ, cache TTL) trước vòng lặp — KHÔNG bao giờ tra cứu
  // theo từng publisher ở đây (đó là việc của resolvePublisherTrust(), chỉ
  // chạy lúc item được TRUY CẬP — xem trust.ts).
  await ensureChannelAdminListCached(gateway, storage, sourceId, channel);
  // Cùng nguyên tắc "MỘT cuộc gọi/kênh" — bỏ qua hẳn cho kênh không phải
  // Forum (channel.isForum === false), xem forum-topics.ts.
  await ensureForumTopicsCached(gateway, storage, sourceId, channel);

  const messages = await gateway.fetchHistorySince(channel.id, minId, limit, direction);
  const items: StoredMediaItem[] = [];
  let maxMsgId = minId;

  for (const message of messages) {
    if (message.msgId > maxMsgId) {
      maxMsgId = message.msgId;
    }
    // Trước đây yêu cầu fileName tuyệt đối — loại bỏ TOÀN BỘ video gửi kiểu
    // "as video" (streamable, không phải "as file"): Telegram không gắn
    // DocumentAttributeFilename cho kiểu gửi đó, chỉ có
    // DocumentAttributeVideo (`message.video` đã có giá trị). Phát hiện
    // thật: một kênh 174 video toàn loại này → luôn ra 0 item. Chấp nhận
    // document nếu có fileName HOẶC rõ ràng là video (có video attribute).
    if (!message.fileName && !message.video) {
      continue;
    }
    // Trust chỉ dùng tín hiệu ĐÃ CÓ (owner/channel-post/list đã cache) —
    // KHÔNG gọi mạng ở đây. KHÔNG loại cứng `not-admin` — phát hiện thật:
    // loại cứng ở đây tạo nghịch lý so với `pending` (kênh Telegram từ chối
    // tiết lộ list thì được hiện, kênh Telegram TRẢ LỜI THẬT "không phải
    // admin" thì bị giấu tuyệt đối, dù cùng mức tin cậy). Mọi item được lưu
    // kèm nhãn trust thật — tầng hiển thị (F3) quyết định ẩn/hiện.
    const trust = await classifyFromCache(storage, sourceId, channel, message.publisherId);
    // Không có fileName (video "as video") → dùng caption làm nguồn parse
    // thay thế; không có cả hai → placeholder theo msgId, vẫn là item hợp lệ
    // (catalog-spec.md: chỉ msgId bắt buộc, "chưa có metadata đầy đủ" không
    // phải lý do bỏ qua).
    const titleSource = message.fileName ?? message.caption ?? `Video ${message.msgId}`;
    // Hashtag (message.entities) ưu tiên TRƯỚC filename cho season/episode,
    // filename luôn thắng cho title — xem thứ tự đầy đủ ở hashtag-parser.ts.
    const derived = deriveFallbackMetadata(message.msgId, titleSource, message.hashtags);
    // Forum Topic (đã cache 1 lần/kênh ở ensureForumTopicsCached phía trên)
    // — `undefined` khi kênh không phải Forum hoặc message ngoài mọi topic.
    const topic = await lookupTopicTitle(storage, sourceId, message.topicId);
    if (topic) {
      derived.topic = topic;
    }
    // `size` (nếu Telegram trả) — giữ lại từ T2/T3 quét lịch sử, không phải
    // do parseFilenameFallback() suy luận. Cần cho slice Playback (F4,
    // ADR-0005): SW đọc `size` cục bộ để trả Content-Length mà "không cần
    // chạm mạng" — phát hiện thật lúc dựng F4: field này trước đó bị bỏ rơi
    // ở tầng quét, dù `size` đã có sẵn trong CatalogItemV1/IndexHistoryMessage.
    items.push({ ...derived, size: message.size, trust, publisherId: message.publisherId });
  }
  return { items, maxMsgId };
}

export function createIndexEngine(gateway: IndexGateway, storage: IndexStoragePort): IndexEngine {
  return {
    async scanSource(sourceId, ref, opts) {
      try {
        // resolveIndexChannel() không tự nuốt lỗi (gateway-index.ts) — lỗi
        // resolve thật (username sai, FLOOD_WAIT, chưa join kênh riêng tư...)
        // phải rơi vào nhánh catch bên dưới để lastError ghi đúng nguyên
        // nhân, thay vì một câu chung chung không debug được.
        const channel = await gateway.resolveIndexChannel(ref);
        if (!channel) {
          const error = `"${ref}" không phải kênh (có thể là user/group thường).`;
          await storage.putIndexMeta(sourceId, { lastError: error, lastScanAt: Date.now() });
          return { tier: 'none' as const, itemCount: 0, error };
        }

        // T1 — dừng ở tầng đầu tiên thành công.
        const catalogResult = await tryCatalogTier(gateway, storage, sourceId, channel);
        if (catalogResult) {
          await storage.replaceMediaItems(sourceId, catalogResult.items);
          await storage.putIndexMeta(sourceId, {
            tier: 'catalog',
            catalogGeneratedAt: catalogResult.generatedAt,
            lastScanAt: Date.now(),
            lastError: undefined,
            itemCount: catalogResult.items.length
          });
          return { tier: 'catalog', itemCount: catalogResult.items.length };
        }

        const meta = await storage.getIndexMeta(sourceId);
        const hasScannedBefore = meta.lastIndexedMsgId !== undefined;

        if (!hasScannedBefore && opts?.tier !== 'full') {
          // Không có catalog VÀ chưa từng quét — KHÔNG tự chạy T3, để UI hỏi.
          return { tier: 'none', itemCount: 0, needsFullScanConfirmation: true };
        }

        const isFullScan = opts?.tier === 'full';
        const limit = isFullScan ? FULL_SCAN_LIMIT : DELTA_PAGE_LIMIT;
        // Full scan (T3): lấy `limit` message MỚI NHẤT (direction 'desc'),
        // bỏ qua minId — ưu tiên nội dung mới, xem comment ở
        // gateway-index.ts/fetchHistorySince() (phát hiện thật: quét từ đầu
        // kênh khiến kênh lớn không bao giờ chạm tới phim thật). Delta (T2):
        // tăng dần từ lastIndexedMsgId, chỉ lấy phần MỚI kể từ lần quét trước.
        const minId = isFullScan ? 0 : (meta.lastIndexedMsgId ?? 0);
        const { items, maxMsgId } = await scanHistoryItems(gateway, storage, sourceId, channel, minId, limit, isFullScan ? 'desc' : 'asc');

        await storage.upsertMediaItems(sourceId, items);
        const tier = isFullScan ? 'full' : 'delta';
        // itemCount luôn đọc lại từ storage (nguồn sự thật) thay vì tự cộng
        // dồn thủ công — quét lại/full-scan chồng lấn với item đã có (cùng
        // msgId, upsert ghi đè) sẽ làm phép cộng thủ công lệch khỏi số thật.
        const itemCount = await storage.countMediaItems(sourceId);
        await storage.putIndexMeta(sourceId, {
          tier,
          lastIndexedMsgId: maxMsgId,
          lastScanAt: Date.now(),
          lastError: undefined,
          itemCount
        });
        return { tier, itemCount };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await storage.putIndexMeta(sourceId, { lastError: error, lastScanAt: Date.now() });
        return { tier: 'none', itemCount: 0, error };
      }
    },

    async resolveItemTrust(sourceId, ref, msgId) {
      const item = await storage.getMediaItem(sourceId, msgId);
      if (!item) {
        return { trust: 'not-found' };
      }
      // Đã resolve từ trước (owner/channel-post/catalog/verified-admin/
      // not-admin) — không cần làm gì, kể cả không có publisherId (item catalog).
      if (item.trust !== 'pending' || !item.publisherId) {
        return { trust: item.trust };
      }

      const channel = await gateway.resolveIndexChannel(ref);
      if (!channel) {
        // Không resolve được kênh (lỗi mạng, ref đổi...) — giữ nguyên
        // pending, thử lại lần truy cập sau, không suy diễn thành xấu.
        return { trust: 'pending' };
      }

      // KHÔNG xoá item khi xác nhận not-admin — chỉ cập nhật nhãn (cùng
      // nguyên tắc "không loại cứng" áp dụng lúc quét, xem scanHistoryItems).
      const trust = await resolvePublisherTrust(gateway, storage, sourceId, channel, item.publisherId);
      if (trust !== 'pending') {
        await storage.updateMediaItemTrust(sourceId, msgId, trust);
      }
      return { trust };
    },

    async checkWritable(ref) {
      const channel = await gateway.resolveIndexChannel(ref);
      return channel?.isOwn ?? false;
    },

    async publishCatalogMetadata(sourceId, ref, msgId, patch) {
      const channel = await gateway.resolveIndexChannel(ref);
      if (!channel) {
        throw new Error(`"${ref}" không phải kênh hoặc không resolve được.`);
      }
      await writeCatalogPatch(gateway, storage, sourceId, channel, msgId, patch);
    }
  };
}
