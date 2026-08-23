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
