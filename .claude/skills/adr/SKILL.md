---
name: adr
description: Tạo, thay thế, hoặc bổ sung một Architecture Decision Record cho TSMC theo đúng định dạng và quy tắc bất biến của repo (không sửa ADR đã Accepted). Dùng khi cần ghi lại một quyết định kiến trúc, khi đổi ý về quyết định cũ, hoặc khi phát sinh thông tin mới làm thay đổi đánh giá rủi ro của một ADR.
---

# Viết ADR cho TSMC

## Luật bất biến

> **Không sửa nội dung Quyết định của ADR đã `Accepted`.**

Ghi trong `docs/adr/README.md`. ADR là bản ghi *lịch sử* — biết đội đã nghĩ gì tại thời điểm đó quan trọng hơn việc tài liệu trông gọn gàng. Có **ba** đường đi hợp lệ, chọn đúng đường:

| Tình huống | Làm gì |
|---|---|
| Quyết định **mới**, chưa có ADR nào phủ | ADR mới, `Accepted` |
| Quyết định cũ **sai/đã thay bằng cách khác** | ADR mới + đánh dấu ADR cũ `Superseded by ADR-XXXX` |
| Quyết định cũ **vẫn đúng**, nhưng có thông tin/rủi ro mới | **Addendum** trong chính ADR cũ (xem dưới) |

Nhầm đường thứ 3 thành đường 1 sẽ đẻ ra ADR rỗng nghĩa; nhầm thành sửa thẳng nội dung là phá luật.

## Đường 3 — Addendum (dùng nhiều hơn bạn nghĩ)

Thêm mục **cuối file**, không đụng phần trên:

```markdown
## Cập nhật sau khi Accepted (YYYY-MM-DD, nguồn phát hiện)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định
> đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết
> định gốc **vẫn đứng vững**, xem lý do bên dưới.

<thông tin mới, bằng chứng, và điều gì THAY ĐỔI / KHÔNG thay đổi>
```

Mẫu thật: [ADR-0003](../../../docs/adr/0003-chon-thu-vien-mtproto-gramjs.md) khi phát hiện GramJS bị archive — quyết định giữ nguyên, chỉ mức rủi ro đổi.

## Định dạng file mới

Tên: `docs/adr/NNNN-tieu-de-khong-dau.md` — 4 chữ số, kebab-case, **không dấu tiếng Việt trong tên file** (dấu chỉ nằm trong nội dung).

```markdown
# ADR-NNNN: <Tiêu đề có dấu, nói rõ quyết định chứ không phải chủ đề>

- **Trạng thái:** Accepted
- **Ngày:** YYYY-MM-DD
- **Liên quan:** [ADR-XXXX](./XXXX-....md), [ADR-YYYY](./YYYY-....md)

## Bối cảnh
<Vì sao phải quyết. Nêu ràng buộc thật, số liệu thật nếu có.>

## Các phương án
### A. <tên>
- ✅ / ❌ ...
### B. <tên> (**được chọn**)

## Quyết định
<Nói thẳng đã chọn gì và các quy tắc thực thi kéo theo.>

## Hệ quả
**Tích cực** ...
**Tiêu cực / phải chấp nhận** ...
```

## Sau khi tạo file — bắt buộc

1. **Thêm dòng vào bảng trong `docs/adr/README.md`** (đúng thứ tự số). Quên bước này thì `npm run docs:check` báo `SYNC` — nên cứ chạy checker là biết.
2. **Cross-link hai chiều**: ADR mới trỏ tới ADR liên quan, và cân nhắc thêm ADR mới vào dòng `**Liên quan:**` của những ADR đó (đường này *được phép* sửa file Accepted — nó là metadata, không phải nội dung quyết định).
3. Nếu quyết định đổi bức tranh tổng thể → cập nhật [docs/architecture.md](../../../docs/architecture.md): bảng ràng buộc §1, sơ đồ §2, bản đồ ADR↔Epic §5, hoặc bảng "cố ý làm khác PRD" §6.
4. `npm run docs:check`.

## Chất lượng nội dung — cái phân biệt ADR thật với ADR hình thức

- **Ghi phương án đã LOẠI và vì sao.** Giá trị lớn nhất của ADR nằm ở đây: nó chặn người sau (kể cả chính mình 6 tháng nữa) đi lại con đường cụt.
- **Số liệu thật > tính từ.** "236 KB brotli, 110 ms" thắng "khá nhẹ".
- **Nói thẳng cái giá phải trả.** Mục "Tiêu cực / phải chấp nhận" trống rỗng là dấu hiệu chưa nghĩ đủ.
- **Phân biệt đã kiểm chứng vs. phỏng đoán.** Chưa có bằng chứng thì viết là giả thuyết và mở [spike](../spike/SKILL.md), đừng viết như sự thật.
