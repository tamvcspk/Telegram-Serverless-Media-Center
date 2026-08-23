---
name: docs-check
description: Kiểm tra tính toàn vẹn tài liệu TSMC — liên kết .md hỏng, anchor tiếng Việt sai, bảng markdown vỡ, và lệch đồng bộ giữa index ADR / bảng spike. Dùng sau MỌI lần sửa file trong docs/, và trước khi báo cáo là đã cập nhật xong tài liệu.
---

# docs-check

## Chạy

```bash
npm run docs:check
```

Exit code 1 nếu có vấn đề. Đã cắm trong CI (`.github/workflows/deploy-staging.yml`).

## Bốn nhóm lỗi nó bắt

| Mã | Ý nghĩa |
|---|---|
| `LINK` | Liên kết `.md` trỏ tới file không tồn tại |
| `ANCHOR` | Liên kết `#anchor` trỏ tới heading không tồn tại |
| `TABLE` | Dòng bảng mất dấu `\|` đầu dòng, hoặc lệch số cột |
| `SYNC` | ADR có file nhưng thiếu dòng trong `docs/adr/README.md`; spike có mục `## SPIKE-NN` nhưng thiếu dòng trong bảng tổng quan (và ngược lại) |

## Luật anchor tiếng Việt — nguồn sai số 1

GitHub sinh slug bằng: **lowercase → xoá dấu câu (giữ chữ/số/khoảng trắng/`_`/`-`) → khoảng trắng thành `-`**. Dấu tiếng Việt được **giữ nguyên**, không bị bỏ dấu.

Hệ quả quan trọng nhất: **em-dash `—` có khoảng trắng hai bên sinh ra HAI gạch nối liên tiếp.**

```
## 3. Hai tầng dữ liệu — State riêng tư và Metadata toàn cục
→ #3-hai-tầng-dữ-liệu--state-riêng-tư-và-metadata-toàn-cục
                      ^^ hai gạch, không phải một
```

Đừng tự gõ anchor bằng tay. Copy heading rồi để `npm run docs:check` xác nhận.

## Khi đổi một heading đã có người trỏ tới

Đổi heading là **breaking change** với mọi anchor đang trỏ tới nó. Quy trình:

1. Đổi heading.
2. `grep -rn "#slug-cũ" docs/` để tìm mọi nơi trỏ tới.
3. Cập nhật hết.
4. `npm run docs:check` xác nhận 0 lỗi.

Bỏ bước 4 là cách chắc chắn nhất để tài liệu nói dối trong im lặng.

## Cạm bẫy CRLF

Repo lẫn CRLF và LF (đã có `.gitattributes` với `eol=lf` để chặn lan rộng). Bản thân checker chuẩn hoá xuống dòng trước khi parse — **đừng bỏ bước chuẩn hoá đó** nếu sửa `tools/docs-check/check.mjs`, vì `\r` sót lại khiến regex heading không khớp và mọi anchor trong file CRLF bị báo hỏng oan.

Lưu ý kèm theo: `sed`/`perl` với neo `$` **không khớp** dòng CRLF. Nếu một lệnh thay thế "chạy xong mà không đổi gì", nhiều khả năng đó là nguyên nhân — dùng công cụ sửa file trực tiếp thay vì cố vá regex.

## Điều checker KHÔNG bắt được

Nó kiểm cấu trúc, không kiểm sự thật. Nó không biết:

- Heading ghi "chưa có kết luận" trong khi bảng bên dưới đã có đủ kết luận.
- Trạng thái spike ở `architecture.md § 7` mâu thuẫn với `docs/spikes/README.md`.
- Một ADR tuyên bố điều trái ngược với ADR khác.

Những thứ đó vẫn phải đọc bằng mắt. Checker chỉ giải phóng sự chú ý khỏi phần cơ học để dồn vào phần ngữ nghĩa.
