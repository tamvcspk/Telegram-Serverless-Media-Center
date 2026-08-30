// Gộp item vừa upload vào catalog.json hiện có — cùng nguyên tắc "catalog
// luôn là ảnh chụp đầy đủ, không phải diff" của publishCatalogMetadata()
// (libs/core-index/src/publish-catalog.ts), nhưng viết lại riêng cho CLI vì
// bản gốc phụ thuộc IndexStoragePort (Dexie, chỉ có trong trình duyệt) — CLI
// không có index cục bộ, nguồn sự thật duy nhất là chính catalog.json vừa
// đọc lại từ kênh (existingItems), không phải một DB nào khác.
import { parseCatalogItem, type CatalogEnvelopeV1, type CatalogItemV1 } from '@tsmc/shared-models';

const CATALOG_SPEC_V1 = 'tsmc-catalog/1' as const;

export interface CatalogChannelRef {
  id: string;
  title: string;
}

export class NotChannelOwnerError extends Error {
  constructor() {
    super('Chỉ chủ kênh (Kho Cá Nhân của bạn, ADR-0014 §4) mới upload/publish được — kênh này không phải do bạn tạo.');
    this.name = 'NotChannelOwnerError';
  }
}

/** Chặn NGAY từ đầu pipeline, trước khi tốn byte upload nào — cùng vị trí kiểm tra với publish-catalog.ts. */
export function assertChannelWritable(channel: { isOwn: boolean }): void {
  if (!channel.isOwn) {
    throw new NotChannelOwnerError();
  }
}

/**
 * Parse catalog.json hiện có (đọc lại từ `getPinnedCatalogDocument()`) —
 * KHÔNG throw khi JSON hỏng/không hợp lệ (catalog-spec.md: dữ liệu không tin
 * cậy, kể cả khi đó là catalog do chính CLI từng ghi — phòng trường hợp bị
 * sửa tay/hỏng giữa hai lần chạy). Trả mảng rỗng thay vì ném lỗi.
 */
export function parseExistingCatalogItems(raw: string): CatalogItemV1[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = (parsed as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map(parseCatalogItem).filter((item): item is CatalogItemV1 => item !== null);
}

/** Item mới thắng nếu trùng `msgId` (hiếm — chỉ khi CLI chạy lại đúng file đã upload trước đó và Telegram tình cờ tái sử dụng msgId, không xảy ra trong flow bình thường vì msgId luôn mới mỗi lần sendFile). */
export function mergeCatalogItems(existingItems: CatalogItemV1[], newItems: CatalogItemV1[]): CatalogItemV1[] {
  const byMsgId = new Map<number, CatalogItemV1>();
  for (const item of existingItems) {
    byMsgId.set(item.msgId, item);
  }
  for (const item of newItems) {
    byMsgId.set(item.msgId, item);
  }
  return Array.from(byMsgId.values());
}

/** Sanitize lại TOÀN BỘ mảng qua schema Valibot trước khi đóng gói — catalog sắp ghi đè trở thành nguồn sự thật MỚI (cùng nguyên tắc publish-catalog.ts). */
export function buildCatalogEnvelope(channel: CatalogChannelRef, items: CatalogItemV1[]): CatalogEnvelopeV1 & { items: CatalogItemV1[] } {
  const sanitized = items.map(parseCatalogItem).filter((item): item is CatalogItemV1 => item !== null);
  return {
    spec: CATALOG_SPEC_V1,
    channel: { id: channel.id, title: channel.title },
    generatedAt: new Date().toISOString(),
    items: sanitized
  };
}
