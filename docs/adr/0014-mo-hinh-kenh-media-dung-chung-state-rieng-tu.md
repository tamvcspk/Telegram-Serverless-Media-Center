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

## Cập nhật sau khi Accepted (2026-08-24, slice Sync F1.2/F1.3)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

Bước 5 của quy trình dò/tạo kênh (`channels.CreateChannel` với `broadcast:true`, `about` bắt đầu `tsmc-state/1`) đã kiểm chứng thành công trên tài khoản Telegram thật lúc đăng nhập lần đầu trên staging — kênh `TSMC State` tạo đúng, dò lại được qua `about` prefix. Chưa có dịp kiểm chứng thật nhánh "tìm thấy nhiều hơn một" (cần dàn dựng ≥2 kênh state thủ công) hay nhánh dán link (`t.me/c/<id>`) — cả hai vẫn chỉ được phủ bởi test có mock, xem `libs/core-sync/src/hydrate.spec.ts`.

## Cập nhật sau khi Accepted (2026-08-28, slice Ingest Editor — Metadata Editor, Màn hình 6)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

Mục 4 ("Kho Cá Nhân... chỉ khác cờ `writable: true`") mô tả một cờ, nhưng tới trước slice này chưa có dòng code nào đọc/ghi theo nó — `docs/ux-design.md` Màn hình 6 là UI THẬT đầu tiên **ghi** vào kênh media qua MTProto của chính user (đúng path 3 "Chế độ Admin trong web app" của [ADR-0013](./0013-bot-dong-hanh-va-pipeline-ingest.md) — không đụng upload/probe/remux, chỉ sửa metadata của item đã có sẵn).

**"writable" hoá ra không cần một field lưu trữ riêng.** `ResolvedIndexChannel.isOwn` (đã có từ slice Index F2 — `channel.creator === true`, `libs/core-mtproto/src/gateway-index.ts`) chính là cờ đó. RPC `checkSourceWritable(sourceId)` (`libs/worker-host/src/core-worker.ts`) resolve LẠI mỗi lần UI cần biết, không persist vào `IndexMetaRecord`/`SourceRef` — trạng thái admin luôn phản ánh đúng hiện tại, không có nguy cơ lệch/stale mà một cờ cache sẽ mang theo.

**Đường ghi mới** — `libs/core-mtproto/src/gateway-index.ts` thêm `publishCatalogDocument(channelId, json, previousMsgId?)`: `sendFile → pinMessage → deleteMessages` (xoá catalog CŨ), cùng khuôn `publishSnapshot()` của `gateway-sync.ts` ([ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md)) nhưng ghi lên **kênh media**, không phải kênh state — đúng ranh giới §3 của ADR này. `libs/core-index/src/publish-catalog.ts` (mới) chặn NGAY bằng `NotChannelOwnerError` nếu `!channel.isOwn`, trước khi đụng gateway; đóng gói lại **TOÀN BỘ** item hiện có của nguồn (không phải diff — catalog luôn là ảnh chụp đầy đủ, đúng ngữ nghĩa `replaceMediaItems` ở tier đọc), sanitize lại qua `parseCatalogItem` (Valibot) trước khi ghi.

**Không ghi kép.** RPC `saveMediaMetadata()` publish xong tự gọi lại `scanSourceAndReindex()` — catalog vừa ghi được ĐỌC LẠI qua đúng T1 `catalog-tier.ts` đã có sẵn, không có code nào ghi tắt vào Dexie song song với ghi Telegram. Telegram luôn là nguồn sự thật duy nhất; local chỉ là cache được làm mới bằng cách đọc lại, không phải ghi trực tiếp.

**Chưa kiểm chứng bằng thiết bị/kênh thật.** Đây là lần đầu tiên `sendFile`/`pinMessage`/`deleteMessages` được gọi cho **kênh media** — trước đó ba hàm này chỉ có test đơn vị với fake gateway (`libs/core-mtproto/src/gateway-index.spec.ts`, `libs/core-index/src/publish-catalog.spec.ts`), và ngay cả `publishSnapshot()` (kênh state, cùng khuôn) cũng **chưa** được xác nhận trên thiết bị thật (xem addendum 2026-08-24 ở [ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md)). Rủi ro được đánh giá thấp vì cùng code path đã kiểm chứng cho phần đọc (`getMessages`/`getEntity`/`downloadMedia`), nhưng "cùng code path" không phải là "đã test".

**Giới hạn chưa xử lý:** nguồn có catalog rất lớn có thể khiến `JSON.stringify(envelope)` vượt giới hạn dung lượng file Telegram cho phép — chưa phân mảnh (`catalog-spec.md` có nhắc `catalog.v1.partN.json` cho trường hợp này, nhưng slice này chỉ ghi một file đơn, đúng giới hạn "MVP chỉ đọc/ghi file đơn" đã ghi ở đầu `gateway-index.ts`).

## Cập nhật sau khi Accepted (2026-08-28, SPIKE-06)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

[SPIKE-06](../spikes/README.md#spike-06) đã đóng **ĐẠT** trên tài khoản Telegram thật (2026-08-28) — gỡ đúng caveat "chưa kiểm chứng bằng thiết bị/kênh thật" mà addendum "slice Ingest Editor" ở trên đã ghi cho `publishCatalogDocument()`. Kênh test tự sinh, đã tự xoá sau khi chạy. Cả 5 tiêu chí đạt: tạo kênh (`creator=true`); `sendFile`+`pinMessage` catalog A rồi đọc lại khớp byte-chính-xác; `sendFile`+`pinMessage` catalog B + `deleteMessages(A)` rồi đọc lại khớp B (pin chuyển đúng sang bản mới); message A xác nhận bị xoá thật (không phải chỉ unpin); toàn bộ chuỗi chạy tự động, không cần can thiệp tay.

**Không đổi:** quyết định gốc của ADR này (mô hình kênh, cờ `writable`/`isOwn`) vẫn đứng nguyên — SPIKE-06 chỉ xác nhận cơ chế ghi thực thi đúng thiết kế, không phát sinh thay đổi kiến trúc nào.

**Phạm vi bằng chứng — đọc cho đúng, đừng suy rộng quá mức:** một lần chạy, một tài khoản, một kênh test mới tạo/nhỏ/đơn publisher. Đủ mạnh cho câu hỏi **đúng/sai của một chuỗi API call xác định** (khác câu hỏi ngưỡng phụ thuộc tài khoản/thời điểm như `FLOOD_WAIT` ở SPIKE-04, nơi một lần chạy sạch không chứng minh được gì về ngưỡng) — nếu chuỗi `sendFile → pinMessage → deleteMessages` có lỗi thiết kế, nó sẽ lộ ra ở MỌI lần chạy bình thường, không phải hiện tượng cần nhiều mẫu mới thấy.

**Chưa phủ, và là giới hạn thật đã biết:** catalog rất lớn nhiều item; kênh nhiều publisher; và quan trọng nhất — **`FLOOD_WAIT` xảy ra GIỮA CHỪNG chuỗi 3 RPC ghi liên tiếp**. Nếu `FLOOD_WAIT` (hoặc mất mạng) xảy ra sau `sendFile` nhưng trước `pinMessage`, hoặc sau `pinMessage` nhưng trước `deleteMessages`, kênh media có thể rơi vào trạng thái dở dang (catalog mới đã gửi nhưng chưa ghim, hoặc đã ghim nhưng bản catalog cũ chưa bị xoá — tồn đọng như rác). `publishCatalogDocument()`/`publishCatalogMetadata()` hiện **không có** logic retry/rollback cho tình huống này — lỗi giữa chừng sẽ ném ra ngoài (người dùng thấy Lưu thất bại) nhưng không tự dọn phần đã làm được. Đây là giới hạn chưa xử lý, không phải điều SPIKE-06 đặt ra để kiểm chứng; để dành cho slice sau nếu thực tế cho thấy cần.

Đã gỡ dòng rủi ro tương ứng ở [architecture.md §7](../architecture.md#7-rủi-ro-lớn-nhất--trạng-thái-kiểm-chứng) (đánh dấu gạch ngang, 🟢).
