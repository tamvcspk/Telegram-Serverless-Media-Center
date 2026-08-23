# ADR-0014: Mô hình kênh — media dùng chung, state riêng tư mỗi tài khoản

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md), [ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md), [ADR-0013](./0013-bot-dong-hanh-va-pipeline-ingest.md)

## Bối cảnh

Hệ thống dùng channel Telegram cho hai mục đích hoàn toàn khác nhau, và việc trộn lẫn chúng là một lỗi thiết kế đắt giá:

- **Kênh media**: chứa file phim, poster, phụ đề, `catalog.json` — tức **metadata toàn cục** (title, năm, thể loại, category, liên kết file). Nhiều người cùng đọc. Sống lâu hơn bất kỳ user nào.
- **Kênh state**: chứa lịch sử xem, bộ sưu tập, cài đặt — tức **state riêng tư**. **Của riêng một tài khoản.** Không ai khác được đọc.

Chú ý: chữ "riêng tư" ở đây nói về *tính cá nhân-hoá của dữ liệu* (state riêng tư — xem [architecture.md § 3](../architecture.md#3-hai-tầng-dữ-liệu--state-riêng-tư-và-metadata-toàn-cục)), **khác** với chữ "cá nhân" trong "Kho Cá Nhân" (mục 4 bên dưới), vốn nói về *quyền sở hữu kênh media*. Metadata toàn cục — kể cả của Kho Cá Nhân — không bao giờ đi vào kênh state.

ADR này chốt topology và — quan trọng hơn — các quy tắc bất biến quanh nó.

## Quyết định

### 1. Kênh media: dùng chung, nhiều-người-đọc, chỉ-đọc với người xem

| Thuộc tính | Giá trị |
|---|---|
| Loại | Broadcast channel (công khai có username, hoặc riêng tư có invite link) |
| Quan hệ | **n user : 1 kênh** |
| Quyền người xem | Chỉ đọc. App **không bao giờ** ghi vào kênh media của người khác |
| Nội dung | Media + poster + subs + `catalog.json` ghim ([ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md)) |
| Ghi bởi | Admin hoặc bot ([ADR-0013](./0013-bot-dong-hanh-va-pipeline-ingest.md)) |

**Cách chia sẻ một kênh media — điểm dễ làm sai:**
`access_hash` của một channel **khác nhau theo từng tài khoản**. Không thể xuất `{id, access_hash}` từ máy A rồi nhập vào máy B — máy B sẽ nhận `CHANNEL_INVALID`.

Vì vậy đơn vị chia sẻ luôn là **username hoặc invite link**, không bao giờ là id thô:
- Kênh công khai → `@tenkenh`, app gọi `contacts.resolveUsername` để tự lấy `access_hash` của tài khoản mình.
- Kênh riêng tư → link `t.me/+hash`, app gọi `messages.checkChatInvite` (xem trước) rồi `messages.importChatInvite` (tham gia) sau khi user xác nhận.
- Trong IndexedDB, mỗi nguồn lưu **cả** `{id, accessHash}` (cache theo tài khoản) **và** `{username | inviteLink}` (định danh bền vững, dùng để phân giải lại khi hash hỏng).

Hệ quả cho tính năng "chia sẻ bộ sưu tập" trong tương lai: một collection tham chiếu tới `{sourceRef, msgId}` trong đó `sourceRef` là username/invite link — nhờ vậy nó mang sang tài khoản khác được. Nếu lưu id thô thì tính năng đó chết ngay từ trong trứng.

### 2. Kênh state: **đúng một kênh cho mỗi tài khoản, riêng tư tuyệt đối**

| Thuộc tính | Giá trị |
|---|---|
| Loại | Broadcast channel riêng tư, **không** username, **không** phát tán invite link |
| Quan hệ | **1 tài khoản : 1 kênh** (bất biến cứng) |
| Thành viên | Chỉ chính chủ tài khoản |
| Nội dung | Snapshot đã ghim + event log ([ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md)) |

**Bất biến:** app **không bao giờ** thêm thành viên, tạo invite link, hay đặt username cho kênh state. Không có tính năng "chia sẻ tiến trình xem" nào được phép chạm vào kênh này — nếu sau này cần chia sẻ, phải xuất ra một kênh khác.

**Tạo và tìm lại kênh (bài toán thật sự khó ở đây)**

Thiết bị mới đăng nhập phải tìm được kênh state cũ, nếu không nó sẽ tạo kênh thứ hai và lịch sử bị tách đôi vĩnh viễn. Quy trình:

1. Tra `stateChannelId` trong IndexedDB cục bộ. Có thì xác thực và dùng.
2. Không có → duyệt dialog, lọc channel **do chính mình tạo** có `about` bắt đầu bằng dấu hiệu nhận dạng `tsmc-state/1`.
3. Tìm thấy **đúng một** → dùng, lưu lại id.
4. Tìm thấy **nhiều hơn một** → **không tự đoán**. Hiện màn hình cho user chọn, kèm số event và thời điểm cập nhật cuối của từng kênh, và đề nghị **gộp** (replay cả hai log rồi ghi snapshot mới vào kênh được chọn). Chính vì state là event log bất biến nên việc gộp này khả thi — đây là lợi ích thứ hai, không lường trước, của [ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md).
5. Không tìm thấy → tạo mới, tiêu đề `TSMC State`, `about` = `tsmc-state/1 · Kho dữ liệu của Telegram Media Center. Đừng xoá kênh này.`

Ngoài ra luôn cho user **dán thủ công** link kênh state trong Cài đặt, làm lối thoát khi tự dò thất bại.

**Không dùng Saved Messages** cho state: nó là không gian cá nhân user thật sự dùng hàng ngày, việc app xả hàng trăm message JSON vào đó vừa gây phiền vừa dễ bị xoá nhầm, lại không có ranh giới namespace rõ ràng. Một channel riêng thì đổi tên, tắt thông báo, hoặc archive được — và nếu user xoá nó, ý định đó rõ ràng chứ không phải tai nạn.

### 3. Bảng phân biệt (dán ngay trong code như tài liệu sống)

| | Kênh media — chứa **metadata toàn cục** | Kênh state — chứa **state riêng tư** |
|---|---|---|
| Số lượng | Nhiều, tuỳ user chọn | Chính xác 1 |
| Chia sẻ | Có, đó là mục đích | **Không bao giờ** |
| App ghi vào? | Chỉ khi là kho cá nhân của chính user | Luôn luôn |
| Mất thì sao? | Index lại từ nguồn | **Mất dữ liệu thật** — không dựng lại được |
| Định danh bền | username / invite link | channel id + dấu hiệu trong `about` |
| Ai tin? | Chỉ admin/bot ([ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md)) | Chỉ chính mình |

Bảng đầy đủ về hai tầng dữ liệu (kèm ví dụ cụ thể từng trường) nằm ở [architecture.md § 3](../architecture.md#3-hai-tầng-dữ-liệu--state-riêng-tư-và-metadata-toàn-cục) — đọc trước khi thêm một trường dữ liệu mới vào bất kỳ kênh nào, để chọn đúng chỗ ngay từ đầu.

### 4. Kho cá nhân là trường hợp riêng của kênh media
"Kho Cá Nhân" trong PRD là **kênh media mà user có quyền ghi** — không phải loại thứ ba. Cùng schema, cùng catalog spec, chỉ khác cờ `writable: true` và mô hình tin cậy (tin toàn bộ). Nhờ vậy user có thể mở kho cá nhân thành kho cộng đồng sau này chỉ bằng cách thêm username, không cần migrate gì.

## Hệ quả

**Tích cực**
- Ranh giới quyền riêng tư rõ ràng và có thể kiểm chứng: đọc code là biết ngay chỗ nào ghi vào kênh state.
- Kênh media sống độc lập với app — ai có link Telegram vẫn xem được bằng Telegram thường. Không khoá người dùng vào sản phẩm.
- Lưu username/invite link mở đường cho chia sẻ bộ sưu tập sau này mà không cần đổi schema.

**Tiêu cực / phải chấp nhận**
- Logic dò kênh state là mã có trạng thái, nhiều nhánh, và **phải có test cho cả bốn kịch bản** (không có / một / nhiều / bị xoá). Đây là chỗ hỏng thì user mất dữ liệu, nên không được làm qua loa.
- Phân giải lại kênh qua username tốn thêm RPC lúc khởi động; cache `access_hash` theo tài khoản và chỉ phân giải lại khi gặp lỗi.
- User có thể tự tay xoá kênh state trong Telegram. Cảnh báo trong mô tả kênh, và mỗi khi kênh biến mất thì hiện đúng thông điệp "state đã mất, sẽ tạo mới" thay vì âm thầm bắt đầu lại từ số 0.
