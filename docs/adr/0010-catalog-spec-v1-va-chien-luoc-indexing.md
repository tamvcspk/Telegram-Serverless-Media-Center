# ADR-0010: Catalog Spec v1 và chiến lược lập chỉ mục

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0007](./0007-luu-tru-cuc-bo-indexeddb-dexie.md), [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)

## Bối cảnh

PRD F2.2 yêu cầu "Zero-Latency Indexing": đọc `catalog.json` được ghim trên channel để nạp tức thì, có fallback quét lịch sử tin nhắn.

Vấn đề nằm ở chỗ này: một kênh cộng đồng 20.000 file, nếu quét bằng `messages.getHistory` với 100 message mỗi lần, là 200 vòng RPC — mất nhiều phút và dễ ăn `FLOOD_WAIT`. Không thể bắt mỗi user mới vào phải trả cái giá đó.

Đồng thời, `catalog.json` là **dữ liệu do người lạ soạn**. Nó vừa là tính năng hay nhất của dự án vừa là bề mặt tấn công lớn nhất.

## Quyết định

### 1. Ba tầng, dừng ở tầng đầu tiên thành công

| Tầng | Nguồn | Chi phí |
|---|---|---|
| T1 | `catalog.json` ghim (hoặc file `catalog.v1.json` mới nhất do admin đăng) | 1–2 RPC, tức thì |
| T2 | Quét delta: chỉ message mới hơn `lastIndexedMsgId` đã lưu | Tỉ lệ thuận với lượng phát sinh |
| T3 | Quét toàn bộ lịch sử, chạy nền, có tiến trình và huỷ được | Đắt, chỉ khi user chủ động yêu cầu |

Quét toàn bộ **không bao giờ tự chạy** cho kênh cộng đồng lớn. Nếu không có catalog, hiện nút "Quét kênh này (ước tính N phút)" và để user quyết định — đó là tài khoản của họ đang chịu rủi ro rate limit.

### 2. Catalog Spec v1 — hợp đồng liên thông
Đây là tài sản có giá trị lâu dài nhất của dự án: nếu định dạng đủ đơn giản, các kênh khác sẽ tự đăng catalog và hệ sinh thái tự lớn. Vì vậy spec phải **được version hoá và tài liệu hoá công khai** trong [docs/catalog-spec.md](../catalog-spec.md), không giấu trong mã nguồn. **Spec đã được viết** — mọi thay đổi định dạng phải cập nhật ở đó.

```jsonc
{
  "spec": "tsmc-catalog/1",
  "channel": { "id": -1001234567890, "title": "Kho Phim 4K" },
  "generatedAt": "2026-08-23T00:00:00Z",
  "trustedPublishers": [123456789],       // user id được phép đăng file
  "items": [{
    "msgId": 4567,
    "title": "Dune: Part Two",
    "originalTitle": "Dune: Part Two",
    "year": 2024,
    "genres": ["sci-fi", "adventure"],
    "kind": "movie",                       // movie | episode
    "series": { "name": "Dune", "season": 1, "episode": 2 },
    "runtime": 9960,
    "size": 21474836480,
    "video": { "w": 3840, "h": 2160, "codec": "hevc" },
    "audio": [{ "lang": "en" }, { "lang": "vi" }],
    "subs": [{ "lang": "vi", "msgId": 4568 }],
    "poster": { "msgId": 4566 },
    "cast": ["..."], "director": "..."
  }]
}
```

Nguyên tắc thiết kế spec:
- **Chỉ `msgId` là bắt buộc**; mọi trường khác optional. Rào cản gia nhập phải thấp nhất có thể.
- Không nhúng `access_hash` hay `file_reference` — cả hai đều theo phiên/ngắn hạn ([ADR-0007](./0007-luu-tru-cuc-bo-indexeddb-dexie.md)); client tự phân giải qua `messages.getMessages`.
- Catalog lớn được **chia mảnh** (`catalog.v1.part1.json`, ...) kèm một `catalog.v1.index.json` trỏ tới các mảnh, để nạp dần.

### 3. Mô hình tin cậy (PRD F2.3)
- Với kênh **shared**: chỉ nhận item mà message gốc do **admin** hoặc **bot đã biết** đăng. Danh sách admin lấy từ `channels.getParticipants` với filter admin, cache lại.
- `catalog.json` chỉ được chấp nhận nếu **chính file đó** do admin đăng. Catalog do thành viên thường đăng bị bỏ qua hoàn toàn — nếu không thì bất kỳ ai cũng có thể tiêm hàng nghìn item giả vào thư viện của mọi người.
- Với kênh **private** của user: tin toàn bộ, index mọi thứ.

### 4. Fallback parse tên file
Khi không có catalog, dựng metadata từ tên file và hashtag: nhận diện mẫu `S01E02`, năm trong ngoặc, độ phân giải, nhóm release. Nguồn suy luận được đánh dấu `metaSource: "filename"` để UI hiển thị nhẹ hơn và để lần sau có catalog thì ghi đè không do dự.

### 5. Index tăng dần
Lưu `lastIndexedMsgId` cho mỗi nguồn; quét delta dùng `min_id`. Xử lý cả message bị **sửa** và bị **xoá** bằng cách đối chiếu định kỳ theo lô id (chạy nền, tần suất thấp).

## Hệ quả

**Tích cực**: onboarding gần như tức thì trên các kênh có catalog; chi phí bằng 0; spec mở tạo hiệu ứng mạng lưới.

**Tiêu cực / phải chấp nhận**
- Catalog có thể lệch với thực tế của kênh → luôn xác thực tại thời điểm phát, và xử lý sai lệch theo bảng trạng thái ở [ADR-0007](./0007-luu-tru-cuc-bo-indexeddb-dexie.md).
- **Mọi trường trong catalog đều là chuỗi do người lạ kiểm soát.** Bắt buộc validate bằng schema (Valibot/Zod) trước khi lưu, giới hạn độ dài, và không bao giờ render bằng `innerHTML` — xem [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md).
- Phải tự bảo trì công cụ sinh catalog cho admin kênh (một script Node hoặc chính app ở chế độ admin), nếu không sẽ không ai dùng spec.

## Cập nhật sau khi Accepted (2026-08-25, slice Index F2)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững** ở phần khung (3 tầng, spec, fallback tên file, index tăng dần); chỉ **mục 3 (mô hình tin cậy)** có thay đổi thật, lý do bên dưới.

### Mô hình tin cậy đã đổi từ nhị phân sang phân tầng — phát hiện thật khi verify bằng tài khoản thật

Mục 3 gốc ngầm định hai điều: (a) luôn xác định được ai là admin qua `channels.getParticipants`, và (b) publisher không phải admin thì loại bỏ hoàn toàn. Cả hai đều vỡ khi verify thật:

1. **`channels.getParticipants` (liệt kê toàn bộ) thường ném `CHAT_ADMIN_REQUIRED`** cho tài khoản không phải admin — phổ biến ở nhóm/kênh nhỏ ẩn participant list với thành viên thường. Thử fallback sang `channels.getParticipant` (tra cứu **một** người, không phải liệt kê) với giả thuyết permission model lỏng hơn cho tra cứu đơn — **giả thuyết sai với một số kênh thật**: verify trên thiết bị thật cho thấy kênh có thể chặn `CHAT_ADMIN_REQUIRED` ở cả hai, không chỉ liệt kê toàn bộ.
2. **GramJS `Message`: kênh không bật "Sign Messages" (mặc định đa số kênh) → post không có `fromId` → `senderId` rơi về CHÍNH peer id của kênh**, không phải user id của admin đã đăng — xác nhận bằng cách đọc `telegram/tl/custom/message.js` thật, không suy đoán:
   ```js
   if (fromId) { senderId = utils.getPeerId(fromId); }
   else if (peerId) { if (post || ...) { senderId = utils.getPeerId(peerId); } }
   ```
   So publisherId đó với danh sách admin (toàn user id) không bao giờ khớp, dù message chỉ có thể do admin đăng — Telegram chặn member thường gửi vào broadcast channel ở tầng protocol, nên đây là bằng chứng đủ dù không khớp user id. Quan sát được: kênh có document/filename hợp lệ nhưng scan luôn ra 0 item.
3. **Loại cứng "không phải admin thì bỏ" tạo nghịch lý khi kết hợp với (1)+(2)**: kênh mà Telegram **từ chối trả lời** (không xác định được ai là admin) lại hiện item (không có gì để loại), còn kênh mà Telegram **trả lời thật** là "publisher này không phải admin" lại bị giấu tuyệt đối — cùng một mức độ không chắc chắn về nội dung, nhưng xử lý khác nhau tuỳ một chi tiết triển khai (Telegram có chịu tiết lộ list hay không), không tuỳ mức độ rủi ro thật.

**Quyết định sửa (đã code, đã verify bằng tài khoản thật trên nhiều loại kênh — kênh riêng, kênh cộng đồng bị `CHAT_ADMIN_REQUIRED`, kênh cộng đồng có publisher xác nhận không phải admin):**

- Bỏ mô hình nhị phân "loại bỏ hoàn toàn non-admin", thay bằng **nhãn trust phân tầng lưu cùng item**: `owner` (kênh riêng) / `channel-post` (publisherId === channel.id, mục 2 ở trên) / `verified-admin` / `not-admin` / `pending`. **Không loại bỏ item nào ở tầng index nữa** — mọi item được lưu kèm nhãn thật; ẩn/hiện theo mức độ tin cậy chuyển thành việc của tầng hiển thị (F3 Browse UI, chưa xây), không phải quyết định cứng lúc index.
- **Lúc quét**: chỉ gán nhãn bằng tín hiệu MIỄN PHÍ đã có sẵn (owner/channel-post/admin-list đã cache tối đa 1 lần/kênh, TTL 1h) — **không bao giờ** gọi RPC theo từng publisher trong một lượt quét. Lý do: một kênh N publisher × N RPC tra cứu là con đường thẳng tới `FLOOD_WAIT` thật ([ADR-0006](./0006-download-pipeline-dc-pool-flood-wait.md)) — rủi ro này bị chính người yêu cầu slice chỉ ra trước khi kịp code sai.
- **Lúc truy cập (on-access)**, không lúc quét: publisher còn `pending` mới được tra cứu — và chỉ tra cứu **đúng một** publisher đó (`channels.getParticipant`), cache lại theo publisherId nên các item khác cùng publisher ăn theo miễn phí. Cùng nguyên tắc "refresh `file_reference` on-demand lúc phát" đã có ở [ADR-0006](./0006-download-pipeline-dc-pool-flood-wait.md)/[ADR-0007](./0007-luu-tru-cuc-bo-indexeddb-dexie.md) §C5 — không xác thực trước, chỉ xác thực khi thật sự dùng. RPC `resolveItemTrust(sourceId, ref, msgId)` là cơ chế lâu dài; UI thật gọi nó lúc render item là việc của F3 (Browse UI, chưa xây) — slice F2 chỉ verify cơ chế bằng một nút debug tạm thời, xoá khi F3 xong.
- **Tier catalog (T1) vẫn nghiêm ngặt hơn T2/T3**: chỉ chấp nhận khi trust publisher của catalog **dứt khoát** (owner/channel-post/verified-admin) — `pending` bị từ chối ở tier này. Lý do: T1 thay TOÀN BỘ item của nguồn trong một lần, rủi ro cao hơn nhiều so với T2/T3 chỉ cộng dồn từng item.
- **T3 (full-scan bounded) đổi hướng quét**: bản đầu quét tăng dần từ message đầu kênh (`minId: 0, reverse: true`) — với kênh nhiều hơn giới hạn quét (2000 message), nội dung media thật (thường ở phần mới hơn) không bao giờ được quét tới trong ngân sách bounded, quan sát được kênh luôn ra 0 item dù có phim thật. Sửa: lấy N message **mới nhất** trước (bỏ qua `minId`), ưu tiên nội dung mới — phần rất cũ có thể không bao giờ được quét tới trong slice bounded này vẫn là đánh đổi đã chấp nhận ở Quyết định gốc, chỉ hướng quét là phát hiện mới.

### Resolve `ref` kênh — hạn chế thật của GramJS `2.26.22` (liên quan [ADR-0003](./0003-chon-thu-vien-mtproto-gramjs.md))

Phát sinh khi cho user tự thêm nguồn bằng username/invite link (không thuộc mục 3, nhưng cùng slice nên ghi ở đây):

- `parseUsername()` nội bộ của GramJS chỉ nhận dạng invite link kiểu CŨ `t.me/joinchat/HASH`, không nhận `t.me/+HASH` (định dạng Telegram đã đổi sang từ lâu) — `getEntity()` ném "Cannot find any entity corresponding to...". Workaround ở tầng gọi: chuyển `+HASH` về `joinchat/HASH` trước khi gọi GramJS.
- Link nội bộ `t.me/c/<id>` (Telegram tự sinh khi kênh không có invite link/username) nhúng thẳng channel id thô, không resolve được qua `ResolveUsername`/`CheckChatInvite`. Không vô dụng: nếu tài khoản đang đăng nhập đã là thành viên, id này nằm sẵn trong dialog list **của chính tài khoản đó** — resolve qua `getDialogs()` thay vì coi là id thô chia sẻ được, đúng tinh thần CLAUDE.md bất biến #10 (`access_hash` khác nhau theo từng tài khoản).
- Bổ sung `listMemberChannels()` cho user **chọn thẳng** từ danh sách chat đã tham gia thay vì gõ/dán ref thủ công — loại bỏ hầu hết nguồn lỗi resolve ở trên vì entity đã có sẵn `access_hash` đúng.

## Cập nhật sau khi Accepted (2026-08-29, SPIKE-07 + brainstorm cải thiện quét nguồn)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững** (3 tầng, spec, fallback tên file + hashtag, index tăng dần, mô hình tin cậy phân tầng); mục này **mở rộng thêm** hai nguồn tín hiệu mới cho fallback derivation (mục 4 của Quyết định gốc), chưa có dòng nào trong Quyết định gốc bị đổi.

### Bối cảnh phát sinh

Brainstorm cải thiện chức năng quét nguồn (`libs/core-index/src/index-engine.ts`) đặt câu hỏi: Telegram cung cấp hashtag và **Forum Topics** (nhóm dạng supergroup có thể bật chia tin theo chủ đề) bên cạnh channel/group thô — quét có thể adapt để derive metadata từ đó, và dùng topic để categorize phim lẻ/phim bộ. Hashtag đã được Quyết định gốc §4 nhắc tới nhưng chưa code cụ thể cách làm; Forum Topics là bề mặt GramJS hoàn toàn mới, cần kiểm chứng trước khi cam kết — mở [SPIKE-07](../spikes/README.md#spike-07).

**SPIKE-07 đã đóng 🟢 (2026-08-29)** — chi tiết đầy đủ + 3 lần chạy hỏng trước đó (bug script, không phải hành vi Telegram/GramJS) ở [docs/spikes/README.md#spike-07](../spikes/README.md#spike-07), tóm tắt:
- `channels.GetForumTopics` liệt kê đúng topic + title, **1 RPC/kênh**, cache được (cùng khuôn TTL với `getChannelAdmins` đã có ở mục 3 phía trên).
- Quét lịch sử — **chính RPC `messages.getHistory`/`getMessages` mà `scanHistoryItems()` đã gọi**, không cần RPC riêng nào thêm mỗi message — xác định đúng topic mỗi message thuộc về, với điều kiện suy luận đúng: `replyToTopId ?? replyToMsgId` khi `forumTopic === true` (Telegram chỉ set `replyToTopId` cho reply sâu bên trong topic; message gửi thẳng vào topic chỉ có `replyToMsgId` = chính id topic — đọc một field đơn lẻ theo trực giác ban đầu cho kết quả sai).
- Message không thuộc topic nào: `replyTo` hoàn toàn `undefined` — tín hiệu "không category" rõ ràng, không lẫn với topic "General" (id cố định `1`, luôn tồn tại mặc định khi bật Forum).

Kết luận chi phí: categorize-theo-topic **rẻ ngang hashtag** (không tốn RPC/item như lo ngại ban đầu ở nhánh xấu nhất của bảng "Ta sẽ làm gì" trong SPIKE-07) — không vi phạm nguyên tắc "tín hiệu MIỄN PHÍ" đã đặt ra ở mục 3 phía trên.

### Quyết định thiết kế mới (đã code 2026-08-29, chưa verify thiết bị thật)

**A. Category theo Forum Topic**

- Thêm field mới **`topic?: string`** vào `CatalogItemV1` (`libs/shared-models/src/catalog.ts`) — sanitize bằng `sanitizeUntrustedString()` giống `genres`, giới hạn cùng độ dài. Giá trị là **nguyên văn tên topic** (vd "Phim lẻ", "Phim bộ", "Anime") — KHÔNG được dùng để tự động suy luận `kind`/`series`: đoán "kind: episode" bằng cách khớp từ khoá tiếng Việt như "bộ" trong tên topic là suy diễn không đáng tin (channel có thể đặt tên topic tuỳ ý, tiếng Anh, có emoji, hoặc dùng từ không theo quy ước nào) — rủi ro gán sai cao hơn giá trị mang lại. `topic` tách biệt khỏi `genres` vì khác bản chất: `genres` mô tả **nội dung phim** (hài, kinh dị...), `topic` mô tả **cách nguồn tự tổ chức** (do admin kênh đặt, không phải đặc tính của phim) — trộn chung sẽ làm bộ lọc thể loại ở Browse (F3) nhiễu theo cấu trúc kênh thay vì nội dung thật.
- Thêm `topicId?: string` vào `IndexHistoryMessage` (`libs/core-index/src/gateway-port.ts`) — suy ra bằng đúng công thức đã kiểm chứng ở SPIKE-07 (`replyToTopId ?? replyToMsgId` khi `forumTopic`).
- Thêm method mới vào `IndexGateway`: `listForumTopics(channelId): Promise<{ id: string; title: string }[] | null>` — trả `null` khi kênh không phải Forum (cùng convention null-safety đã có ở `getChannelAdmins()`: null nghĩa là "không áp dụng", không phải "rỗng"). Gọi **đúng một lần/kênh/lượt quét**, cache theo TTL giống admin list — **không bao giờ** gọi theo từng message, đúng nguyên tắc "tín hiệu MIỄN PHÍ" ở mục 3.
- `ResolvedIndexChannel` cần thêm `isForum: boolean` — `channels.CreateChannel`/kết quả resolve kênh đã trả thẳng field `forum` (xác nhận tại SPIKE-07, không cần RPC riêng để biết), dùng để `index-engine.ts` **bỏ qua hẳn** việc gọi `listForumTopics()` cho kênh không phải Forum (đa số kênh media hiện tại là broadcast channel — theo ADR-0013, không phải supergroup — không có Forum, nên đây không phải trường hợp hiếm).

**B. Hashtag — cụ thể hoá cách làm (Quyết định gốc §4 đã nói CÓ làm, mục này nói LÀM THẾ NÀO)**

- Thêm `hashtags?: string[]` vào `IndexHistoryMessage` — `TelegramGateway` tách từ `message.entities` (lọc `MessageEntityHashtag`, cắt chuỗi theo `offset`/`length` UTF-16 có sẵn trong entity) — **không** regex lại caption thô như suy nghĩ ban đầu ở comment đầu `filename-parser.ts`, vì entity đã phân tách sẵn, đáng tin hơn tự đoán ranh giới từ bằng regex.
- Thứ tự ưu tiên khi hợp nhất với `parseFilenameFallback()` hiện có (hàm suy luận mới, tách riêng, không sửa hàm cũ):
  1. `catalog.json` thật (T1) luôn thắng tuyệt đối — không đổi.
  2. Season/episode: thử pattern trên hashtag trước (vd `#S01E02`); không khớp thì rơi về regex filename hiện có (`SEASON_EPISODE_RE`).
  3. Title: luôn ưu tiên nguồn filename — hashtag hiếm khi chứa tên phim đầy đủ, thường chỉ là thẻ ngắn.
  4. Hashtag không khớp bất kỳ pattern season/episode/year/resolution nào → gộp vào `genres` (thẻ tự do, sanitize giống `genres` hiện có) thay vì bỏ qua.

**Trạng thái code hoá (2026-08-29):** cả mục A và B đã code — `libs/shared-models/src/catalog.ts` (field `topic`), `libs/core-index/src/gateway-port.ts` + `libs/core-mtproto/src/gateway-index.ts` (`topicId`/`hashtags`/`isForum`/`listForumTopics()` thật qua `channels.GetForumTopics`), file mới `libs/core-index/src/forum-topics.ts` (cache TTL 1h, cùng khuôn `trust.ts`) và `libs/core-index/src/hashtag-parser.ts` (`deriveFallbackMetadata()`, tách khỏi `parseFilenameFallback()` như đã chốt). `docs/catalog-spec.md` đã cập nhật field `topic` cùng lúc (xem đánh đổi bên dưới — dòng "CHƯA cập nhật" đã hết hiệu lực). Có unit test đầy đủ ở cả 3 package (`core-index`, `core-mtproto`, `shared-models`), `tsc --noEmit`/`eslint` sạch. **Chưa verify bằng kênh Forum thật** (SPIKE-07 verify bằng script test riêng, không phải qua đường code này) — xem [docs/roadmap.md](../roadmap.md) § Sync & dữ liệu cho quy ước "cần kiểm chứng thiết bị thật".

### Đánh đổi chấp nhận

- **Bỏ heuristic suy luận `kind`/`series` từ tên topic** ở v1 — an toàn hơn (không gán nhãn sai) nhưng bỏ lỡ một tín hiệu tốt (kênh đặt topic "Phim bộ" rất có thể đúng là phim bộ). Có thể làm lại ở slice sau nếu có dữ liệu thật cho thấy heuristic đủ tin cậy — không phải quyết định vĩnh viễn, chỉ là phạm vi thận trọng cho lần code đầu.
