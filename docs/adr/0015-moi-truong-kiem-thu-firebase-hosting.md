# ADR-0015: Môi trường kiểm thử trên Google Cloud free tier (Firebase Hosting)

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0012](./0012-trien-khai-static-pwa-va-cau-truc-workspace.md), [ADR-0005](./0005-streaming-qua-service-worker-http-range.md)

## Bối cảnh

Hai rủi ro lớn nhất của dự án ([architecture.md](../architecture.md) mục 6) hiện **chỉ là phỏng đoán**:

- SPIKE-01: Safari/iOS có cho `<video>` đi qua Service Worker không?
- SPIKE-02: GramJS xử lý `CDN_REDIRECT` tới đâu?

Cả hai **không thể kiểm chứng trên `localhost`**: Service Worker và các hành vi media của iOS chỉ bộc lộ đúng trên **HTTPS, tên miền thật, thiết bị thật**. Safari trên iOS còn không thể trỏ vào `localhost` của máy khác. Vậy nên cần một chỗ deploy trước khi có bằng chứng — chứ không phải sau.

Yêu cầu của môi trường này: HTTPS thật, tuỳ chỉnh được header (cho CSP ở [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)), phục vụ được `sw.js` ở scope gốc, có URL chia sẻ nhanh cho từng lần thử, và **miễn phí**.

## Các phương án trên Google Cloud

| Phương án | HTTPS | Header tuỳ biến | SPA rewrite | Free tier | Đánh giá |
|---|---|---|---|---|---|
| **Firebase Hosting** | Có, `*.web.app` sẵn | Có, khai báo trong `firebase.json` | Có | 10 GB lưu trữ, 360 MB/ngày truyền | **Được chọn** |
| Cloud Storage static website | Endpoint website **chỉ HTTP** → Service Worker không đăng ký được | Hạn chế | Không | Có | Loại: chết ngay ở yêu cầu đầu tiên |
| Cloud Storage + Load Balancer | Có | Có | Thủ công | **LB tính phí theo giờ** | Loại: không còn miễn phí |
| Cloud Run (nginx tĩnh) | Có | Có | Có | 2 triệu request/tháng | Chạy được nhưng phải nuôi container và chịu cold start cho một app tĩnh |
| App Engine standard | Có | Có | Có | Có quota | Cấu hình rườm rà hơn Firebase Hosting mà không được gì thêm |

## Quyết định

Dùng **Firebase Hosting (gói Spark, miễn phí)** làm môi trường staging và bàn thử nghiệm spike.

### Vì sao nó hợp với dự án này một cách bất ngờ
Băng thông là thứ duy nhất đáng lo ở free tier (360 MB/ngày), nhưng **media không bao giờ đi qua Firebase** — nó đi thẳng từ Telegram DC về trình duyệt ([ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md)). Firebase chỉ phục vụ vài trăm KB app shell. Nói cách khác, chính kiến trúc serverless làm cho hạn mức miễn phí trở nên dư dả — một xác nhận thực nghiệm cho luận điểm chi phí của [ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md).

### Preview channel — thứ quyết định lựa chọn này
```bash
firebase hosting:channel:deploy spike-01 --expires 7d
# → https://<project>--spike-01-<hash>.web.app
```
Mỗi lần thử spike có một URL HTTPS riêng, tự hết hạn, mở được ngay trên iPhone/iPad thật. Không cần cấu hình DNS, không đụng vào bản chính. Đây đúng là hình dạng mà công việc kiểm chứng cần.

### Cấu hình bắt buộc
- `sw.js` phục vụ ở gốc, kèm `Cache-Control: no-cache` (nếu không, SW cũ sẽ bị cache và mọi lần thử đều cho kết quả của bản cũ — một cái bẫy tốn hàng giờ).
- `Service-Worker-Allowed: /` cho chắc chắn về scope.
- Header CSP theo [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md); riêng bản staging được nới để cho phép công cụ đo, và CI phải kiểm tra bản production **không** mang cấu hình nới đó.
- Hai project/site tách bạch: `tsmc-staging` và `tsmc-prod`.

### Quan hệ với ADR-0012
[ADR-0012](./0012-trien-khai-static-pwa-va-cau-truc-workspace.md) chọn GitHub Pages / Cloudflare Pages cho bản phát hành chính thức. ADR này **không thay thế** điều đó: Firebase Hosting là môi trường **staging và thử nghiệm**. Vì app dùng hash routing và không phụ thuộc header riêng của nhà cung cấp, chạy song song nhiều host là chuyện không tốn công — và bản thân việc đó là một phép thử tốt cho lời hứa "fork là chạy".

## Hệ quả

**Tích cực**
- Có bằng chứng thật cho SPIKE-01/02 trong vòng vài giờ thay vì tranh luận trên giấy.
- Preview channel biến mỗi PR thành một bản demo bấm được — rất giá trị cho một dự án mở.

**Tiêu cực / phải chấp nhận**
- Thêm một tài khoản Google và một phụ thuộc nhà cung cấp cho staging. Chấp nhận được vì không có gì trong sản phẩm phụ thuộc vào Firebase; xoá đi thì chỉ mất môi trường thử.
- `firebase login` là thao tác tương tác, phải do người thật thực hiện một lần; sau đó CI dùng service account.
- Free tier có thể đổi. Vì bundle nhỏ và không có lock-in, chi phí di chuyển gần bằng 0.
