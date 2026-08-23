# ADR-0006: Download pipeline — DC pool, độ song song, FLOOD_WAIT

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0003](./0003-chon-thu-vien-mtproto-gramjs.md), [ADR-0005](./0005-streaming-qua-service-worker-http-range.md)

## Bối cảnh

Vì đã chọn tầng RPC thấp thay vì TDLib ([ADR-0003](./0003-chon-thu-vien-mtproto-gramjs.md)), ta phải tự gánh phần "khó và bẩn" của việc tải file:

- File nằm trên DC khác DC nhà → `FILE_MIGRATE_X`, cần `auth.exportAuthorization` / `auth.importAuthorization` cho DC đó.
- Một kết nối MTProto tuần tự chỉ đạt vài MB/s; muốn đủ bitrate cho 4K phải mở **nhiều kết nối tải song song** tới cùng DC.
- `FLOOD_WAIT_X` xuất hiện khi tải quá hăng. Đây là **tài khoản thật của user** — bị hạn chế nghĩa là user mất Telegram cá nhân, không chỉ mất phim.
- File lớn/phổ biến có thể trả `FILE_REF_EXPIRED` hoặc chuyển hướng CDN (`upload.getCdnFile`, cần AES-CTR và kiểm tra hash riêng).

Câu hỏi cốt lõi: **tải nhanh tới đâu thì dừng?**

## Quyết định

### 1. Connection pool theo từng DC
- Mỗi DC có pool riêng, mặc định **4 sender tải** (tách hẳn khỏi sender chính đang giữ update loop — không bao giờ tải file trên kết nối chính, vì như vậy sẽ làm nghẽn cả nhận tin nhắn lẫn auth).
- Sender được tạo lười và đóng sau 60 giây không dùng.
- Auth cho DC lạ được export một lần rồi cache trong session.

### 2. Scheduler theo cửa sổ, ưu tiên theo mốc phát
Hàng đợi chunk có **ưu tiên**, không phải FIFO:

| Ưu tiên | Loại chunk |
|---|---|
| P0 | Chunk chứa vị trí phát hiện tại (user đang chờ) |
| P1 | Chunk readahead trong cửa sổ hiện tại |
| P2 | Chunk đầu file cho các phim khác (prefetch để mở nhanh) |
| P3 | Tải nền (nếu sau này có tính năng tải offline) |

Khi seek: mọi P0/P1 cũ bị **huỷ ngay**, không đợi hoàn tất. Huỷ là mặc định, không phải trường hợp ngoại lệ.

### 3. Độ song song thích ứng (AIMD)
Bắt đầu từ 2 request đồng thời/DC, tăng dần từng nấc khi các chunk liên tiếp thành công, **giảm một nửa** ngay khi gặp `FLOOD_WAIT` hoặc timeout. Trần cứng mặc định là 4, cho phép user nâng lên 8 trong Cài đặt kèm cảnh báo rõ ràng về rủi ro tài khoản.

Lý do chọn AIMD thay vì một hằng số: dung lượng đường truyền và ngưỡng chịu đựng của Telegram khác nhau theo tài khoản, theo DC và theo thời điểm. Số cố định thì hoặc quá chậm, hoặc gây `FLOOD_WAIT` cho một nhóm user.

### 4. Tôn trọng FLOOD_WAIT tuyệt đối
- `FLOOD_WAIT_X` → **chờ đủ X giây**, không retry sớm, không thử DC khác để né. Việc né tránh có hệ thống là hành vi lạm dụng và làm tăng nguy cơ tài khoản bị hạn chế.
- Nếu `X` lớn hơn 60 giây: dừng pipeline, hiện thông báo cho user ("Telegram đang giới hạn tốc độ, thử lại sau N phút") thay vì âm thầm treo. Trạng thái này phải nhìn thấy được trên UI.
- Circuit breaker cho mỗi DC: 3 lần FLOOD liên tiếp thì cho DC đó nghỉ theo backoff luỹ thừa.

### 5. Làm mới `file_reference`
`FILE_REF_EXPIRED` **không phải lỗi** mà là đường đi bình thường: gọi lại `messages.getMessages` cho message gốc, rút reference mới, ghi lại vào cache metadata, thử lại chunk. Toàn bộ việc này phải trong suốt với tầng trên — người dùng không bao giờ được thấy lỗi này.

### 6. Chuyển hướng CDN
Xử lý `CDN_REDIRECT`: dùng `upload.getCdnFile`, giải mã AES-CTR, xác minh qua `upload.getCdnFileHashes`. **Không được bỏ qua bước xác minh hash** — CDN của Telegram là bên thứ ba không đáng tin theo thiết kế của chính giao thức.

## Các phương án đã cân nhắc

| Phương án | Đánh giá |
|---|---|
| Một kết nối tuần tự, đơn giản nhất | Không đủ băng thông cho 4K; loại |
| Mở tối đa kết nối để đạt tốc độ cao nhất | Đẩy rủi ro hạn chế tài khoản sang user để đổi lấy con số benchmark đẹp. Loại vì lý do đạo đức sản phẩm, không chỉ kỹ thuật. |
| **AIMD với trần thấp, user tự chọn nâng** | Được chọn: mặc định an toàn, người dùng nâng cao vẫn có lối ra |

## Hệ quả

**Tích cực**: đủ nhanh cho phần lớn nội dung; suy giảm êm khi mạng kém; hành vi thân thiện với hạ tầng Telegram.

**Tiêu cực / phải chấp nhận**
- Phức tạp thật sự nằm ở đây. Cần bộ test riêng cho scheduler với một `FakeTransport` mô phỏng độ trễ, FLOOD_WAIT, migrate và reference hết hạn. Không có bộ test này thì mọi bug streaming đều không tái hiện được.
- Tốc độ không thể sánh với một trình tải chuyên dụng chạy 16 luồng — đây là đánh đổi có chủ ý.
- Cần telemetry cục bộ (chỉ hiển thị trong `#/debug`, không gửi đi đâu — xem [ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md)) để chẩn đoán khi user báo lỗi.
