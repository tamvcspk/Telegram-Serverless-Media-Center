# @tsmc/core-mtproto

`TelegramGateway` — [ADR-0003](../../docs/adr/0003-chon-thu-vien-mtproto-gramjs.md).

Đây là package **duy nhất** trong repo được phép `import` từ package `telegram` (GramJS).
Mọi tầng khác đi qua `TelegramGateway`; không type nào của GramJS được rò ra ngoài package này.

**Trạng thái hiện tại: skeleton rỗng.** `telegram` chưa được cài — sẽ cài khi slice Auth (F1.1)
thực sự viết `TelegramGateway`, ghim đúng bản `2.26.22` (không dùng `^`, gói đã bị archive —
xem [ADR-0003 § Cập nhật sau khi Accepted](../../docs/adr/0003-chon-thu-vien-mtproto-gramjs.md#cập-nhật-sau-khi-accepted-2026-08-23-spike-03)).

Các method dự kiến trên `TelegramGateway` (đặt tên theo ADR-0003, chưa có chữ ký đầy đủ):
`login`, `listDialogs`, `getHistoryDelta`, `readChunk(fileRef, offset, length)`,
`refreshFileReference`, `appendStateEvent`.
