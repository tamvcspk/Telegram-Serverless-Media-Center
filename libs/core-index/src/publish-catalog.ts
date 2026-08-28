// Ghi catalog.json — Ingest Editor (Màn hình 6, docs/ux-design.md). Đối
// xứng với catalog-tier.ts (đọc): tier đó dừng ở tầng đầu tiên thành công
// lúc SCAN, còn file này chỉ chạy lúc user chủ động SỬA metadata một item
// rồi bấm Lưu — không phải một phần của scanSource().
import { parseCatalogItem, type CatalogEnvelopeV1, type CatalogItemV1 } from '@tsmc/shared-models';
import type { IndexGateway, ResolvedIndexChannel } from './gateway-port';
import type { IndexStoragePort, StoredMediaItem } from './storage-port';

const CATALOG_SPEC_V1 = 'tsmc-catalog/1' as const;

/** Chỉ 3 field Ingest Editor (Màn hình 6) thật sự cho sửa — mockup không có form nào khác, chưa mở rộng thêm để tránh xây UI không ai dùng. */
export interface CatalogMetadataPatch {
  title?: string;
  year?: number;
  compat?: 'full' | 'partial' | 'unplayable';
}

export class NotChannelOwnerError extends Error {
  constructor() {
    super('Chỉ chủ kênh (Kho Cá Nhân của bạn, ADR-0014 §4) mới sửa được metadata — kênh này không phải do bạn tạo.');
    this.name = 'NotChannelOwnerError';
  }
}

/**
 * Chọn ĐÚNG field của `CatalogItemV1` — liệt kê tường minh thay vì destructure-
 * bỏ `trust`/`publisherId` (bookkeeping nội bộ, storage-port.ts) để không có
 * field lạ nào lọt qua nếu `StoredMediaItem` sau này thêm field mới.
 */
function toCatalogItem(item: StoredMediaItem): CatalogItemV1 {
  return {
    msgId: item.msgId,
    title: item.title,
    originalTitle: item.originalTitle,
    year: item.year,
    genres: item.genres,
    kind: item.kind,
    series: item.series,
    runtime: item.runtime,
    size: item.size,
    video: item.video,
    audio: item.audio,
    subs: item.subs,
    poster: item.poster,
    cast: item.cast,
    director: item.director,
    compat: item.compat,
    metaSource: item.metaSource
  };
}

/**
 * Đóng gói TOÀN BỘ item hiện có của nguồn (không chỉ item vừa sửa) thành một
 * `catalog.json` mới rồi ghim đè — catalog luôn là ảnh chụp đầy đủ, không
 * phải diff (đúng ngữ nghĩa `replaceMediaItems` ở tier đọc). Nguồn CHƯA từng
 * có catalog.json (mới quét qua T2/T3 filename-fallback) vẫn xuất bản được
 * bình thường — đây là cách tự nhiên một Kho Cá Nhân "nâng cấp" lên catalog
 * thật lần đầu, không cần luồng riêng.
 */
export async function publishCatalogMetadata(
  gateway: IndexGateway,
  storage: IndexStoragePort,
  sourceId: string,
  channel: ResolvedIndexChannel,
  msgId: number,
  patch: CatalogMetadataPatch
): Promise<void> {
  if (!channel.isOwn) {
    throw new NotChannelOwnerError();
  }

  const [existingDoc, allItems] = await Promise.all([gateway.getPinnedCatalogDocument(channel.id), storage.listMediaItems(sourceId)]);

  const patchedItems = allItems.map((item) => {
    const base = toCatalogItem(item);
    return item.msgId === msgId ? { ...base, ...patch } : base;
  });

  // Sanitize lại TOÀN BỘ mảng, không riêng item vừa sửa — catalog.json sắp
  // ghi đè trở thành nguồn sự thật MỚI, không được mang theo dữ liệu chưa
  // qua schema (vd item cũ lỡ có string chưa strip ký tự bidi/control).
  const items = patchedItems.map(parseCatalogItem).filter((item): item is CatalogItemV1 => item !== null);

  const envelope: CatalogEnvelopeV1 & { items: CatalogItemV1[] } = {
    spec: CATALOG_SPEC_V1,
    channel: { id: channel.id, title: channel.title },
    generatedAt: new Date().toISOString(),
    items
  };

  await gateway.publishCatalogDocument(channel.id, JSON.stringify(envelope), existingDoc?.msgId);
}
