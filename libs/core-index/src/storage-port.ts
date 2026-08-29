// Cổng hẹp tới IndexedDB — worker-host/core-worker.ts nối các hàm thật của
// @tsmc/core-storage vào đây. Test trong core-index dùng fake in-memory,
// không kéo fake-indexeddb vào package này — việc đó đã là trách nhiệm của
// core-storage/media-store.spec.ts. Cùng quy ước với core-sync/storage-port.ts.
import type { CatalogItemV1 } from '@tsmc/shared-models';

export type IndexTier = 'catalog' | 'delta' | 'full';

// Nhãn tin cậy — gán "rẻ" lúc quét (owner/channel-post/list đã cache), KHÔNG
// BAO GIỜ tốn RPC theo từng publisher lúc quét (ADR-0006: N publisher × N RPC
// là con đường tới FLOOD_WAIT). Xác minh thật cho publisher CHƯA rõ chỉ xảy
// ra LÚC ITEM ĐÓ ĐƯỢC TRUY CẬP (trust.ts resolvePublisherTrust) — "eventual
// correctness": đúng dần khi được dùng tới, không đúng ngay từ lúc quét.
// `not-admin` LÀ một nhãn lưu trữ hợp lệ (không phải chỉ trạng thái tạm của
// resolve) — phát hiện thật: loại cứng not-admin lúc quét tạo nghịch lý
// "kênh Telegram từ chối trả lời (CHAT_ADMIN_REQUIRED → pending) lại được
// hiện, kênh Telegram TRẢ LỜI THẬT là 'không phải admin' lại bị giấu hoàn
// toàn" — cùng một mức độ không chắc chắn (publisher không phải admin xác
// nhận) nhưng xử lý khác nhau tuỳ một chi tiết triển khai (Telegram có chịu
// tiết lộ list hay không). Quyết định: KHÔNG loại cứng ở tầng index nữa —
// mọi item được lưu kèm nhãn thật, tầng hiển thị (F3 Browse) quyết định ẩn/
// hiện theo mức độ tin cậy.
export type TrustLabel = 'owner' | 'channel-post' | 'catalog' | 'verified-admin' | 'not-admin' | 'pending';

export interface IndexMeta {
  sourceId: string;
  tier?: IndexTier;
  lastIndexedMsgId?: number;
  catalogGeneratedAt?: string;
  /** `null` = đã hỏi nhưng Telegram từ chối tiết lộ (CHAT_ADMIN_REQUIRED). */
  trustedAdmins?: string[] | null;
  trustedAdminsFetchedAt?: number;
  /**
   * Map topicId -> title đã sanitize, cache TTL cùng khuôn `trustedAdmins`
   * (forum-topics.ts). `null` = kênh không phải Forum (`listForumTopics()`
   * trả null) — không phải "rỗng".
   */
  forumTopics?: Record<string, string> | null;
  forumTopicsFetchedAt?: number;
  lastScanAt?: number;
  lastError?: string;
  itemCount?: number;
}

// Item lưu — CatalogItemV1 (spec công khai, catalog-spec.md) + trust/publisherId
// (bookkeeping nội bộ, KHÔNG thuộc spec — không bao giờ round-trip qua catalog.json).
export type StoredMediaItem = CatalogItemV1 & {
  trust: TrustLabel;
  /** Chỉ có ở item quét từ lịch sử (T2/T3) — cần để resolvePublisherTrust() sau này. Item catalog (T1) không có publisher riêng. */
  publisherId?: string;
};

export interface PublisherTrustRecord {
  isAdmin: boolean;
  fetchedAt: number;
}

export interface IndexStoragePort {
  getIndexMeta(sourceId: string): Promise<IndexMeta>;
  putIndexMeta(sourceId: string, patch: Partial<Omit<IndexMeta, 'sourceId'>>): Promise<IndexMeta>;
  /** Tier catalog — thay TOÀN BỘ item của nguồn (catalog luôn là ảnh chụp đầy đủ mới nhất). */
  replaceMediaItems(sourceId: string, items: StoredMediaItem[]): Promise<void>;
  /** Tier delta/full — cộng dồn theo msgId. */
  upsertMediaItems(sourceId: string, items: StoredMediaItem[]): Promise<void>;
  deleteMediaBySource(sourceId: string): Promise<void>;
  /** Toàn bộ item hiện có của nguồn — dùng để đóng gói lại catalog.json khi publish (Ingest Editor, Màn hình 6, xem publish-catalog.ts). */
  listMediaItems(sourceId: string): Promise<StoredMediaItem[]>;
  /** Tổng số item THẬT của nguồn (nguồn sự thật cho `itemCount` — không tự cộng dồn thủ công, tránh lệch khi quét lại/chồng lấn). */
  countMediaItems(sourceId: string): Promise<number>;

  // Cho lazy trust resolution (on-access) — xem trust.ts resolvePublisherTrust().
  getMediaItem(sourceId: string, msgId: number): Promise<StoredMediaItem | undefined>;
  updateMediaItemTrust(sourceId: string, msgId: number, trust: TrustLabel): Promise<void>;
  /** Item bị xác nhận KHÔNG phải admin sau khi truy cập — xoá thay vì giữ gắn nhãn xấu. */
  deleteMediaItem(sourceId: string, msgId: number): Promise<void>;
  getPublisherTrust(sourceId: string, publisherId: string): Promise<PublisherTrustRecord | undefined>;
  putPublisherTrust(sourceId: string, publisherId: string, isAdmin: boolean, fetchedAt: number): Promise<void>;
}
