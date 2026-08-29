// Catalog parser, tầng index (T1 catalog / T2 delta / T3 full-scan bounded),
// mô hình tin cậy — ADR-0010. Chạy trong Core Worker, không import
// @tsmc/core-mtproto (xem gateway-port.ts) — nhận gateway/storage thật qua
// tham số, worker-host/core-worker.ts nối dây. Search (MiniSearch/ADR-0008)
// KHÔNG thuộc package này — đó là F3 Browsing.
export const LIB_NAME = '@tsmc/core-index' as const;

export { createIndexEngine } from './index-engine';
export type { IndexEngine, ScanResult } from './index-engine';

export type { IndexGateway, ResolvedIndexChannel, MemberChannelSummary, PinnedCatalogDocument, IndexHistoryMessage } from './gateway-port';
export type { IndexStoragePort, IndexMeta, IndexTier, TrustLabel, StoredMediaItem, PublisherTrustRecord } from './storage-port';

export { tryCatalogTier } from './catalog-tier';
export type { CatalogTierResult } from './catalog-tier';
export { parseFilenameFallback } from './filename-parser';
export { deriveFallbackMetadata } from './hashtag-parser';
export { ensureForumTopicsCached, lookupTopicTitle } from './forum-topics';
export { classifyFromCache, ensureChannelAdminListCached, resolvePublisherTrust } from './trust';
export { NotChannelOwnerError } from './publish-catalog';
export type { CatalogMetadataPatch } from './publish-catalog';
