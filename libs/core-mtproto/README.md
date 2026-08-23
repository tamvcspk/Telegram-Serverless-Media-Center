# @tsmc/core-mtproto

`TelegramGateway` — [ADR-0003](../../docs/adr/0003-chon-thu-vien-mtproto-gramjs.md).

Đây là package **duy nhất** trong repo được phép `import` từ package `telegram` (GramJS).
Mọi tầng khác đi qua `TelegramGateway`; không type nào của GramJS được rò ra ngoài package này.

`telegram` ghim đúng bản `2.26.22` (không dùng `^`, gói đã bị archive — xem
[ADR-0003 § Cập nhật sau khi Accepted](../../docs/adr/0003-chon-thu-vien-mtproto-gramjs.md#cập-nhật-sau-khi-accepted-2026-08-23-spike-03)).

**Đã triển khai (slice F1.1 — Auth):** `login`, `restoreSession`, `logout` — xem `src/gateway.ts`.
Session mã hoá AES-GCM tại nghỉ qua `src/session-crypto.ts` + `@tsmc/core-storage` (ADR-0011).

**Chưa triển khai** (thuộc epic sau, không phải F1.1): `listDialogs`, `getHistoryDelta`,
`readChunk(fileRef, offset, length)`, `refreshFileReference`, `appendStateEvent`.
