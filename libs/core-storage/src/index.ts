// Dexie schema + migration — ADR-0007.
// Ngoại lệ duy nhất trong nhóm core-*: được phép dùng liveQuery, không phụ thuộc @angular/*.
export const LIB_NAME = '@tsmc/core-storage' as const;

// Re-export để apps/web đọc qua liveQuery → toSignal() (ADR-0007 "đường
// đọc") mà không cần tự thêm dependency trực tiếp vào `dexie` — chi tiết
// dùng Dexie ở dưới nên nằm gọn trong package này.
export { liveQuery } from 'dexie';

export type {
  SessionRecord,
  SyncMetaRecord,
  SyncStateRecord,
  OutboxRecord,
  MediaRecord,
  IndexMetaRecord,
  TrustLabel,
  PublisherTrustRecord,
  SearchIndexRecord
} from './session-store';
export { getSessionRecord, putSessionRecord, deleteSessionRecord } from './session-store';

export { getSearchIndexBlob, putSearchIndexBlob } from './search-index-store';

export {
  getSyncMeta,
  putSyncMeta,
  getSyncState,
  putSyncState,
  appendOutbox,
  listOutbox,
  removeOutbox,
  countOutbox
} from './sync-store';

export type { MediaItemInput } from './media-store';
export {
  getIndexMeta,
  putIndexMeta,
  replaceMediaItems,
  upsertMediaItems,
  deleteMediaBySource,
  countMediaBySource,
  listMediaBySource,
  listAllMedia,
  getMediaItem,
  updateMediaItemTrust,
  deleteMediaItem,
  getPublisherTrust,
  putPublisherTrust
} from './media-store';
