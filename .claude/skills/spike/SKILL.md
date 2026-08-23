---
name: spike
description: Mở một spike mới, ghi kết quả, hoặc đóng spike cho TSMC — đồng bộ cả ba nơi (bảng tổng quan spike, thân mục spike, bảng rủi ro architecture.md §7). Dùng khi một ADR đang đặt cược vào điều chưa được chứng minh, hoặc khi vừa có số liệu thật từ thiết bị/môi trường thật.
---

# Spike cho TSMC

## Spike tồn tại để làm gì

Mỗi spike gắn với **một ADR đang đặt cược vào điều chưa được chứng minh**. Luật ở [docs/spikes/README.md](../../../docs/spikes/README.md):

> Một spike chỉ đóng khi **có số liệu từ thiết bị thật** — không đóng bằng lập luận, không đóng bằng tài liệu của bên thứ ba.

Chưa chạy thì tài liệu phải nói thẳng là "giả thuyết". Viết như sự thật khi chưa có số đo là lỗi nghiêm trọng nhất ở đây.

## Ba nơi phải đồng bộ — quên một là tài liệu nói dối

Mọi thay đổi trạng thái spike phải chạm đủ **ba** chỗ:

| # | Vị trí | Nội dung |
|---|---|---|
| 1 | Bảng tổng quan đầu `docs/spikes/README.md` | Một dòng, có emoji trạng thái + tóm tắt một câu |
| 2 | Thân mục `## SPIKE-NN` trong cùng file | Chi tiết đầy đủ |
| 3 | Bảng rủi ro `docs/architecture.md` §7 | Rủi ro tương ứng, gạch ngang (`~~...~~`) nếu đã đóng |

`npm run docs:check` bắt được lệch giữa (1) và (2). **Không bắt được** lệch với (3) — chỗ đó phải tự kiểm bằng mắt.

## Quy ước trạng thái

| Emoji | Nghĩa |
|---|---|
| ⏳ | Chưa dựng |
| 🛠️ | Tool sẵn sàng, chưa chạy |
| 🔬 | Đang chạy |
| 🟡 | Đã chạy nhưng **chưa dứt điểm**, hoặc đã đóng theo hướng *chấp nhận rủi ro* |
| 🟢 | Đạt, rủi ro đã gỡ |
| 🔴 | Hỏng — ADR liên quan phải xét lại |

Phân biệt 🟡 và 🟢 rất quan trọng: [SPIKE-02](../../../docs/spikes/README.md) là 🟡 vì `CDN_REDIRECT` **chưa từng xảy ra** trong lần chạy — đó là "chưa kiểm chứng được", **không phải** "đã kiểm chứng là ổn".

## Mở spike mới

Thêm mục vào `docs/spikes/README.md` (heading phải đúng dạng `## SPIKE-NN` để checker nhận):

```markdown
## SPIKE-NN

**Câu hỏi:** <câu hỏi trả lời được bằng đo đạc, không phải câu hỏi mở>

**Vì sao quan trọng:** <hỏng thì cái gì chết, và vì sao phải biết TRƯỚC khi code>

### Bàn thử nghiệm
<Ưu tiên tách khỏi phần chưa chắc chắn khác. SPIKE-01 cố ý KHÔNG dùng
Telegram, để nếu hỏng thì biết chắc lỗi ở trình duyệt chứ không ở MTProto.>

### Cách chạy
### Tiêu chí đạt/không đạt   <- bảng, định lượng, quyết trước khi chạy
### Ma trận thiết bị cần phủ <- nếu phụ thuộc nền tảng
### Kết quả                  <- để trống tới khi có số thật
### Ta sẽ làm gì với từng kết quả  <- bảng, quyết TRƯỚC khi biết kết quả
```

Mục cuối là mục hay bị bỏ nhất và cũng có giá trị nhất: nó chặn việc hợp lý hoá kết quả sau khi đã thấy kết quả.

## Ghi kết quả

- Ghi **số đo thật**, kèm ngày, phiên bản OS/trình duyệt, và mô tả dữ liệu đầu vào.
- Ghi cả **phép đo sai và vì sao sai**. Ví dụ có thật: phép đo độ trễ SPIKE-01 lần đầu ra 52 ms vì media element phục vụ lại từ cache khi URL không đổi — cạm bẫy đó được ghi lại để không ai đo sai lần nữa.
- Mục **"Quan sát"** thường giá trị hơn cột đạt/không đạt. Ví dụ: SPIKE-01 phát hiện WebKit bắn 7 request trùng nhau trong 10 ms → đó là lý do scheduler ở ADR-0006 **bắt buộc** phải de-dup, chứ không còn là tuỳ chọn.
- Nêu rõ **phạm vi bằng chứng**: đo trên Chrome iOS không phải Safari gốc thì phải nói ra, kèm lý do vì sao vẫn suy rộng được (hoặc không).

## Đóng spike

Khi đóng, ghi rõ đóng theo kiểu nào:

- **Đã gỡ (🟢)** — có bằng chứng khẳng định. Gạch ngang dòng rủi ro ở architecture.md §7.
- **Chấp nhận rủi ro (🟡)** — chưa có bằng chứng dứt điểm nhưng quyết định không theo đuổi tiếp. **Phải ghi ngày, ai quyết, và lý do**, để sau này không ai tưởng nhầm là đã kiểm chứng xong.

Nếu spike làm đổi đánh giá của một ADR đã `Accepted` → viết addendum bằng skill [adr](../adr/SKILL.md), đừng sửa nội dung ADR đó.

## Ranh giới an toàn

Spike cần đăng nhập MTProto thật (**SPIKE-02**, **SPIKE-04**) thì **người dùng tự chạy trong terminal của họ**, Claude không chạy hộ: session MTProto tương đương toàn quyền tài khoản Telegram ([ADR-0011](../../../docs/adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)). Script phải ghi kết quả ra file `*.local.json` **chỉ chứa số liệu tổng hợp** — không session, không số điện thoại — để dán lại an toàn.

SPIKE-04 (dò ngưỡng `FLOOD_WAIT`) còn thêm một luật: chạy trên **tài khoản test dùng một lần**, và mục tiêu là tìm **trần an toàn**, không phải tốc độ tối đa.
