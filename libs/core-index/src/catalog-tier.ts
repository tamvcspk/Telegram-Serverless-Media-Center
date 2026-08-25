// T1 — catalog ghim trên kênh, ADR-0010 mục 1+3. "Dừng ở tầng đầu tiên
// thành công": index-engine.ts chỉ rơi xuống T2/T3 khi hàm này trả null.
import { parseCatalogEnvelope, parseCatalogItem, type CatalogItemV1 } from '@tsmc/shared-models';
import type { IndexGateway, ResolvedIndexChannel } from './gateway-port';
import type { IndexStoragePort, StoredMediaItem } from './storage-port';
import { classifyFromCache, ensureChannelAdminListCached } from './trust';

export interface CatalogTierResult {
  items: StoredMediaItem[];
  generatedAt: string;
}

function extractRawItems(raw: unknown): unknown[] {
  if (typeof raw !== 'object' || raw === null) {
    return [];
  }
  const items = (raw as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}

/**
 * Trả null nếu: không có catalog ghim, publisher CHƯA CHẮC CHẮN đáng tin
 * (không phải admin/kênh riêng — bao gồm cả `pending`, không chỉ `not-admin`
 * — tier này THAY TOÀN BỘ item của nguồn nên rủi ro cao hơn T2/T3, chỉ chấp
 * nhận khi trust đã DỨT KHOÁT, không chấp nhận "chưa biết"), hoặc JSON không
 * đúng envelope (spec sai/major version lạ — catalog-spec.md §Phiên bản).
 * Item sai kiểu trong `items` bị loại riêng từng cái, không làm hỏng phần
 * còn lại. Publisher `pending` không bị mất vĩnh viễn — lần quét sau
 * (ensureChannelAdminListCached hoặc admin list đã được resolve qua
 * resolvePublisherTrust ở nguồn khác) có thể sẽ trả về dứt khoát.
 */
export async function tryCatalogTier(
  gateway: IndexGateway,
  storage: IndexStoragePort,
  sourceId: string,
  channel: ResolvedIndexChannel
): Promise<CatalogTierResult | null> {
  const doc = await gateway.getPinnedCatalogDocument(channel.id);
  if (!doc) {
    return null;
  }

  // MỘT cuộc gọi/kênh (rẻ, cache) — không phải theo từng publisher.
  await ensureChannelAdminListCached(gateway, storage, sourceId, channel);
  const trust = await classifyFromCache(storage, sourceId, channel, doc.publisherId);
  if (trust === 'not-admin' || trust === 'pending') {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(doc.raw);
  } catch {
    return null;
  }

  const envelope = parseCatalogEnvelope(raw);
  if (!envelope) {
    return null;
  }

  const items = extractRawItems(raw)
    .map(parseCatalogItem)
    .filter((item): item is CatalogItemV1 => item !== null)
    // Trust của publisher CATALOG (không phải per-item) đã dứt khoát ở
    // trên — mọi item trong tài liệu này đều gắn nhãn 'catalog' đồng nhất.
    .map((item): StoredMediaItem => ({ ...item, trust: 'catalog' }));

  return { items, generatedAt: envelope.generatedAt };
}
