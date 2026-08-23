# ADR-0008: Tìm kiếm client-side bằng MiniSearch

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0004](./0004-mo-hinh-da-luong.md), [ADR-0007](./0007-luu-tru-cuc-bo-indexeddb-dexie.md)

## Bối cảnh

PRD yêu cầu ô tìm kiếm theo "Tên phim, Đạo diễn, Diễn viên" và "Indexed Search" trong IndexedDB. Không có backend, nên toàn bộ việc này chạy trong trình duyệt.

Quy mô giả định: 5.000 item cho user điển hình, 50.000 cho trường hợp xấu (nhiều kênh cộng đồng lớn). Yêu cầu: gõ tới đâu ra kết quả tới đó (dưới 50 ms), chịu được lỗi chính tả, và **xử lý được tiếng Việt có dấu lẫn không dấu** — user gõ "phim hanh dong" phải ra "Phim Hành Động".

## Các phương án

| | IndexedDB index thuần | Lunr.js | FlexSearch | **MiniSearch** |
|---|---|---|---|---|
| Tìm giữa từ / prefix | Chỉ prefix trên đúng một trường | Có | Có | Có |
| Fuzzy | Không | Hạn chế | Có | Có |
| Thêm/xoá tài liệu tăng dần | — | **Không** (phải dựng lại cả index) | Có | Có |
| Serialize index | — | Có | Có | Có (`toJSON`/`loadJSON`) |
| Tuỳ biến tokenizer/processTerm | — | Có | Có | Có, đơn giản |
| Kích thước | 0 | ~30 KB | ~40 KB | ~12 KB |

Lunr bị loại vì index bất biến: mỗi lần index thêm một kênh sẽ phải dựng lại toàn bộ. FlexSearch nhanh nhưng API và tình trạng bảo trì thất thường hơn.

## Quyết định

Dùng **MiniSearch**, chạy **trong Core Worker**, index giữ trong RAM, và **serialize xuống IndexedDB** để khởi động nguội không phải index lại.

### Chuẩn hoá tiếng Việt (bắt buộc)
`processTerm` áp dụng: lowercase → `normalize('NFD')` → bỏ dấu thanh (dải U+0300–U+036F) → chuyển `đ` thành `d`. Áp dụng **cả lúc index lẫn lúc query**, nên "Hành động" và "hanh dong" gặp nhau ở cùng một token. Đây không phải chi tiết phụ: bỏ qua nó thì tính năng tìm kiếm coi như vô dụng với người dùng Việt Nam gõ không dấu.

### Cấu hình
- Fields index: `title`, `originalTitle`, `cast`, `director`, `genres`, `year`, `fileName`.
- `storeFields`: chỉ `id` và `sourceId`. **Không** lưu object phim trong index — lấy chi tiết từ IndexedDB theo id trả về. Giữ index gọn để nó vừa RAM và vừa quota.
- `searchOptions`: `prefix: true`, `fuzzy: 0.2`, boost `title` gấp 3 lần.
- Lọc theo workspace context (PRD F3.2) làm bằng `filter` trên `sourceId` — một lần index dùng cho mọi góc nhìn.

### Vòng đời
1. Khởi động: nạp index đã serialize từ IndexedDB (`loadJSON`, nhanh hơn index lại nhiều lần).
2. Khi index thêm nguồn: `addAll` theo lô, rồi ghi lại bản serialize sau khi debounce.
3. Ngưỡng an toàn: nếu vượt 100.000 tài liệu, chuyển sang chế độ chỉ prefix trên `title` và cảnh báo trong Cài đặt. Suy giảm êm còn hơn tab bị OOM.

### Vì sao index nằm trong Worker
Index 50k tài liệu chiếm hàng trăm ms CPU liên tục. Trên main thread, đó là ô tìm kiếm giật cục — đúng chỗ mà độ mượt được cảm nhận rõ nhất.

## Hệ quả

**Tích cực**: tìm kiếm tức thời, hoạt động offline, không tốn hạ tầng.

**Tiêu cực / phải chấp nhận**
- Index chiếm RAM (ước tính 20–60 MB ở mức 50k tài liệu). Cần đo thật trong spike, không đoán.
- Bỏ dấu làm mất khả năng phân biệt vài cặp từ tiếng Việt; đổi lại là trải nghiệm gõ không dấu. Đánh đổi đúng cho đối tượng người dùng của dự án.
- Không có ngữ nghĩa/gợi ý thông minh. Nếu sau này muốn, hướng đi là embedding + vector search bằng WASM — đủ lớn để cần một ADR riêng.
