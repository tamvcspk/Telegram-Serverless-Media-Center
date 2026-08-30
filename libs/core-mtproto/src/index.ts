// TelegramGateway — ADR-0003. Đây là package DUY NHẤT trong repo được phép
// import package `telegram` (GramJS), ghim cứng bản `2.26.22` (bất biến #9, CLAUDE.md).
export const LIB_NAME = '@tsmc/core-mtproto' as const;

export type { TelegramGateway, SessionStoragePort } from './gateway';
export { createTelegramGateway } from './gateway';
export { generateSessionKey, encryptSessionString, decryptSessionString } from './session-crypto';
// Re-export type CHỈ để tsmc-ingest (CLI) tự implement SessionStoragePort mà
// không phải thêm @tsmc/core-storage (Dexie, chỉ chạy trong trình duyệt) làm
// dependency riêng — đây là export TYPE-ONLY, bị xoá hoàn toàn lúc compile,
// không kéo runtime Dexie vào CLI.
export type { SessionRecord } from '@tsmc/core-storage';
