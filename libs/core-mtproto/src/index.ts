// TelegramGateway — ADR-0003. Đây là package DUY NHẤT trong repo được phép
// import package `telegram` (GramJS), ghim cứng bản `2.26.22` khi được cài (bất biến #9, CLAUDE.md).
// Chưa cài `telegram` ở bước này — xem README.md trong thư mục này.
export const LIB_NAME = '@tsmc/core-mtproto' as const;
