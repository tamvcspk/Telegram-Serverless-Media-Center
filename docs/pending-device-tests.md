# Việc chờ kiểm chứng trên thiết bị thật

> **Cách dùng tài liệu này:** danh sách tính năng đã code + deploy staging nhưng **chưa** chạy qua tài khoản Telegram thật — khác [docs/roadmap.md](./roadmap.md) (việc **chưa code**) và khác spike (đặt cược kiến trúc bằng script rời, xem [docs/spikes/README.md](./spikes/README.md)). Đây là code sản xuất thật, chỉ còn thiếu một lượt chạy tay để xác nhận không có gì vỡ khi gặp dữ liệu Telegram thật (entity offset/length, quyền, giới hạn API...).
>
> **Cách cập nhật:** xong một mục → xoá khỏi đây, ghi 1-2 dòng kết quả vào [docs/changelog.md](./changelog.md), và nếu phát hiện gì lệch với thiết kế thì thêm addendum vào ADR liên quan (dùng skill `/adr`). Khi mục cuối cùng của một tính năng biến mất khỏi đây, gỡ luôn nhãn `[Cần kiểm chứng thiết bị thật]` tương ứng ở roadmap.md.

## Index: Forum Topic category + hashtag fallback (2026-08-29)

Liên quan: [ADR-0010 § Cập nhật 2026-08-29](./adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md#cập-nhật-sau-khi-accepted-2026-08-29-spike-07--brainstorm-cải-thiện-quét-nguồn), [docs/roadmap.md § Index / quét nguồn](./roadmap.md#index--quét-nguồn). SPIKE-07 đã verify GramJS Forum Topics API *tự nó* hoạt động bằng script rời (đã xoá) — mục này verify **code sản xuất thật** (`index-engine.ts`/`gateway-index.ts`/`hashtag-parser.ts`/`forum-topics.ts`) chạy đúng khi quét một kênh thật, không phải verify lại API.

### Chuẩn bị dữ liệu test (trong app Telegram thật, không phải web app)

- [ ] Một supergroup đã bật **Topics** (Group settings → Topics → On), có ít nhất 2 topic không phải "General" (vd "Phim lẻ", "Phim bộ").
- [ ] Đăng 1 video document vào topic "Phim bộ" với caption chứa hashtag season/episode + một thẻ lạ, vd: `Some Show #S02E05 #anime`.
- [ ] Đăng 1 video document vào topic "Phim lẻ" với caption chứa hashtag năm + thẻ lạ, vd: `Some Movie #2019 #scifi` (tên file **không** có năm, để phân biệt hashtag-year vs filename-year).
- [ ] (Tuỳ chọn, để verify nhánh `replyToTopId` thay vì `replyToMsgId`) Reply vào một message đã có sẵn TRONG một topic, tạo ra một message "reply sâu" — SPIKE-07 phát hiện hai trường hợp này lấy topicId khác field nhau.

### Các bước trên staging (https://tsmc-staging.web.app)

- [ ] Đăng nhập bằng tài khoản thật.
- [ ] Sources → Thêm nguồn → "Chọn từ danh sách chat của tôi" → chọn supergroup vừa chuẩn bị.
- [ ] Nguồn mới → bấm **"Quét toàn bộ (có thể chậm)"** (full-scan không tự chạy, ADR-0010).

### Checklist xác nhận

- [ ] **`isForum` resolve đúng** — không có cách xem trực tiếp qua UI; nếu bước dưới (`listForumTopics`) có chạy tức là `isForum: true` đã đúng. Nếu tất cả các bước dưới đều thất bại như thể kênh không phải Forum, nghi ngờ đầu tiên là `channel.forum` không được GramJS trả đúng cho kênh này.
- [ ] **`listForumTopics()` gọi đúng 1 lần/lượt quét, cache đúng** — DevTools → Application → IndexedDB → `tsmc` → `indexMeta` → record theo `sourceId` → phải có `forumTopics: { "<topicId>": "Phim lẻ", "<topicId>": "Phim bộ" }` và `forumTopicsFetchedAt` (timestamp gần đây).
- [ ] **`topic` gán đúng vào item** — `tsmc` → `media` table → tìm record theo `msgId` của "Some Show"/"Some Movie" → field `topic` phải khớp đúng tên topic đã đăng vào.
- [ ] **Hashtag season/episode thắng filename** — item "Some Show" (filename không có `SxxExx`) → Browse → tap item → Item Detail Sheet phải hiện **"tập phim"** (kind = episode, suy từ `#S02E05`).
- [ ] **Hashtag năm chỉ dùng khi filename không có năm** — item "Some Movie" → Item Detail Sheet hiện năm **2019** (từ hashtag, vì filename không có).
- [ ] **Hashtag lạ gộp vào `genres`** — cả hai item đều phải thấy `anime`/`scifi` trong dòng genres ở Item Detail Sheet.
- [ ] **`title` luôn từ filename, không bị hashtag ghi đè** — title hiển thị phải khớp tên suy từ filename, không phải chuỗi hashtag.
- [ ] **(Nếu làm bước reply sâu ở trên) `replyToTopId` vs `replyToMsgId`** — cả message gửi thẳng vào topic và message reply sâu trong topic đều phải ra cùng một `topicId`/`topic` đúng — đây là chỗ SPIKE-07 ghi nhận "đọc một field đơn lẻ theo trực giác ban đầu cho kết quả sai", nên đáng test riêng.
- [ ] **Kênh KHÔNG phải Forum vẫn quét bình thường** — thử quét lại một nguồn cũ (broadcast channel thường, không Forum) đã có sẵn, xác nhận `topic` luôn `undefined` và không có lỗi/exception nào phát sinh từ nhánh Forum mới.

### Nếu có gì vỡ

- Item không có `topic` dù đã post đúng vào topic → kiểm tra `indexMeta.forumTopics` trước (map có đúng key không, TTL 1h có hết hạn giữa chừng không) rồi mới nghi ngờ `extractTopicId()`.
- Hashtag không tách được → kiểm tra `message.entities` có thật sự chứa `MessageEntityHashtag` hay Telegram gộp chung vào entity khác (client Telegram khác nhau có thể tạo entity khác nhau cho cùng một caption).
- Bất kỳ hành vi nào lệch thiết kế → ghi vào addendum ADR-0010 (không phải sửa Quyết định gốc), rồi cập nhật lại tài liệu này.
