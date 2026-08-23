# TSMC Catalog Spec v1

> Định dạng mở để một kênh Telegram tự mô tả kho media của mình. Bất kỳ ứng dụng nào cũng đọc được, không riêng TSMC.
>
> Quy định bởi [ADR-0010](./adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md). Đây là tài sản có giá trị lâu dài nhất của dự án: nếu định dạng đủ đơn giản, các kênh khác sẽ tự đăng catalog và hệ sinh thái tự lớn.

## Vấn đề nó giải quyết

Không có catalog, một app muốn biết kênh có gì phải **quét toàn bộ lịch sử tin nhắn**. Kênh 20.000 file, mỗi lần `messages.getHistory` lấy 100 message, là 200 vòng RPC — mất nhiều phút và dễ ăn `FLOOD_WAIT`. Không thể bắt mỗi người dùng mới trả cái giá đó.

Catalog là **một file JSON ghim sẵn** trong kênh: một lần tải là có toàn bộ chỉ mục.

## Ba nguyên tắc thiết kế

1. **Chỉ `msgId` là bắt buộc.** Mọi trường khác optional. Rào cản gia nhập phải thấp nhất có thể — một catalog chỉ có `msgId` vẫn hợp lệ và vẫn hữu ích.
2. **Không nhúng giá trị theo phiên.** Không `access_hash`, không `file_reference` — cả hai đều ngắn hạn và **khác nhau theo từng tài khoản**. Client tự phân giải qua `messages.getMessages`. Nhúng vào là catalog hỏng ngay với mọi người trừ người tạo ra nó.
3. **Mọi trường đều là dữ liệu không tin cậy.** Catalog do người lạ soạn. Client đọc **phải** validate schema, kẹp độ dài, và không bao giờ render bằng `innerHTML` ([ADR-0011](./adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)).

## Đặt ở đâu

| | Cách làm |
|---|---|
| File | Đăng dưới dạng **document** tên `catalog.v1.json` |
| Vị trí | **Ghim** (pin) trong kênh. Client tìm message ghim trước tiên |
| Ai đăng | **Admin của kênh, hoặc bot đã được biết.** Catalog do thành viên thường đăng bị bỏ qua hoàn toàn — nếu không, bất kỳ ai cũng tiêm được hàng nghìn item giả vào thư viện của mọi người |
| Catalog lớn | Chia mảnh `catalog.v1.part1.json`, `part2.json`… kèm `catalog.v1.index.json` trỏ tới các mảnh |

## Cấu trúc

```jsonc
{
  "spec": "tsmc-catalog/1",              // BẮT BUỘC, hằng số nhận dạng
  "channel": {
    "id": -1001234567890,                // tham khảo, client không tin để truy cập
    "title": "Kho Phim 4K"
  },
  "generatedAt": "2026-08-24T00:00:00Z", // ISO 8601
  "trustedPublishers": [123456789],      // user id được phép đăng media vào kênh
  "items": [ /* xem dưới */ ]
}
```

### Một item

```jsonc
{
  "msgId": 4567,                    // BẮT BUỘC — id message chứa file media

  "title": "Dune: Part Two",
  "originalTitle": "Dune: Part Two",
  "year": 2024,
  "genres": ["sci-fi", "adventure"],
  "kind": "movie",                  // "movie" | "episode"
  "series": { "name": "Dune", "season": 1, "episode": 2 },

  "runtime": 9960,                  // giây
  "size": 21474836480,              // byte
  "video": { "w": 3840, "h": 2160, "codec": "hevc" },
  "audio": [{ "lang": "en" }, { "lang": "vi" }],

  "subs":   [{ "lang": "vi", "msgId": 4568 }],  // phụ đề là message RIÊNG
  "poster": { "msgId": 4566 },

  "cast": ["Timothée Chalamet", "Zendaya"],
  "director": "Denis Villeneuve",

  "compat": "full",                 // "full" | "partial" | "unplayable"
  "metaSource": "manual"            // "manual" | "filename" | "bot"
}
```

### Hai trường TSMC quan tâm đặc biệt

**`compat`** — kết quả phân hạng tương thích trình duyệt ([ADR-0013](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md)):

| Giá trị | Nghĩa | App làm gì |
|---|---|---|
| `full` | MP4/H.264/AAC, faststart | Phát bình thường |
| `partial` | HEVC/AV1, hoặc audio Opus/E-AC-3 | **Cảnh báo trung thực** "có thể không phát được trên trình duyệt này" thay vì để user gặp màn hình đen |
| `unplayable` | MKV/DTS/AVI… | Hiện rõ là không phát được trên web, kèm gợi ý mở bằng Telegram |

Thiếu `compat` thì client **không được** giả định là `full` — coi như không biết, và tự dò khi phát.

**`metaSource`** — metadata đến từ đâu. `"filename"` nghĩa là suy luận từ tên file (dễ sai) → UI hiển thị nhẹ hơn, và lần sau có catalog tốt hơn thì ghi đè không do dự.

## Client đọc catalog phải làm gì

1. **Validate schema** (Valibot/Zod). Item sai kiểu thì **loại bỏ item đó**, không "sửa tạm cho chạy".
2. **Kẹp độ dài**: `title` 200 ký tự, mảng 100 phần tử. Chặn cả XSS lẫn tấn công làm phình bộ nhớ.
3. **Loại ký tự điều khiển và ký tự đảo chiều Unicode** (bidi override) — mẹo giả mạo tên file kinh điển.
4. **Kiểm tra người đăng**: chỉ nhận catalog do admin/bot đăng.
5. **Không tin `size`/`runtime` để cấp phát bộ nhớ** — lấy số thật từ `DocumentAttribute` của message khi phát.
6. Xác thực lại tại thời điểm phát: catalog có thể lệch với thực tế của kênh (file đã bị xoá, mất quyền truy cập, `file_reference` hết hạn — ba trạng thái khác nhau, xem [ADR-0007](./adr/0007-luu-tru-cuc-bo-indexeddb-dexie.md)).

## Ví dụ tối thiểu — vẫn hợp lệ

```json
{
  "spec": "tsmc-catalog/1",
  "generatedAt": "2026-08-24T00:00:00Z",
  "items": [
    { "msgId": 101 },
    { "msgId": 102, "title": "Inception", "year": 2010 }
  ]
}
```

Một catalog như thế này đã tiết kiệm cho người dùng hàng trăm vòng RPC. Đừng để "chưa có metadata đầy đủ" trở thành lý do không đăng catalog.

## Phiên bản

`spec` là `"tsmc-catalog/1"`. Client gặp major version lạ thì **bỏ qua toàn bộ file** và rơi về quét lịch sử, không cố đoán. Trường mới được thêm trong v1 phải là optional và không đổi nghĩa trường cũ.
