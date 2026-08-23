// TelegramGateway — ADR-0003. Đây là package DUY NHẤT trong repo được phép
// import package `telegram` (GramJS), ghim cứng bản `2.26.22` (bất biến #9, CLAUDE.md).
export const LIB_NAME = '@tsmc/core-mtproto' as const;

export type { TelegramGateway } from './gateway';
export { createTelegramGateway } from './gateway';
