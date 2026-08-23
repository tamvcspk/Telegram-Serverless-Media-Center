# ADR-0011: Bảo mật session và ranh giới nội dung không tin cậy

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md), [ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md), [ADR-0012](./0012-trien-khai-static-pwa-va-cau-truc-workspace.md)

## Bối cảnh

Cần nói thẳng mức độ nghiêm trọng: session MTProto lưu trong trình duyệt **không phải là token đăng nhập của một web app**. Nó là quyền truy cập đầy đủ vào tài khoản Telegram cá nhân của user — tin nhắn riêng tư, danh bạ, quyền gửi tin dưới danh nghĩa họ. Một lỗ XSS trong ứng dụng xem phim này là một vụ chiếm tài khoản Telegram.

Đồng thời, [ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md) cố ý nạp JSON do người lạ soạn vào ứng dụng. Hai điều này gặp nhau ở đúng chỗ nguy hiểm nhất.

## Mô hình đe doạ

| Kẻ tấn công | Cách vào | Thiệt hại | Đối phó |
|---|---|---|---|
| Kênh cộng đồng độc hại | Trường trong `catalog.json` | XSS → chiếm session → chiếm tài khoản Telegram | Validate schema, không `innerHTML`, CSP |
| Thư viện npm bị nhiễm độc | Supply chain | Như trên | Khoá phiên bản, `npm ci`, audit khi bump, build tái lập được |
| Người dùng chung máy | Đọc IndexedDB | Chiếm session | Mã hoá at-rest, khoá không xuất được |
| Trang khác cùng trình duyệt | — | Không (same-origin policy) | Không có iframe nhúng, `frame-ancestors 'none'` |
| Chính maintainer dự án | Đẩy bản build độc hại | Toàn bộ | Build công khai tái lập được, tag đã ký, [ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md) không có server nhận dữ liệu |

## Quyết định

### 1. Session lưu ở đâu và như thế nào
- Session string mã hoá bằng **AES-GCM**, khoá do **WebCrypto** sinh với `extractable: false` và lưu chính CryptoKey đó trong IndexedDB.
- Khoá không xuất được nghĩa là: kẻ tấn công XSS **không thể trích xuất session để dùng ở nơi khác**. Cần nói rõ giới hạn: hắn vẫn có thể lạm dụng session *bên trong* trang đang chạy. Đây là nâng rào, không phải khoá kín.
- **Tuỳ chọn "Khoá bằng mật khẩu"**: khoá dẫn xuất từ passphrase qua PBKDF2 (>= 600.000 vòng, SHA-256). Bật lên thì mỗi lần mở app phải nhập mật khẩu, và session đứng vững cả khi ổ đĩa bị đọc trực tiếp. Khuyến nghị mặc định cho máy dùng chung.
- **Không bao giờ** ghi `API_HASH` hay session vào `localStorage` (đồng bộ, dễ vét sạch) hoặc URL.
- Nút "Đăng xuất" phải gọi `auth.logOut` để **huỷ session phía server**, rồi mới xoá dữ liệu cục bộ. Chỉ xoá cục bộ là để lại một session sống trong danh sách thiết bị của user.

### 2. Content Security Policy (bắt buộc, không có ngoại lệ)
```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self';
img-src 'self' blob: data:;
media-src 'self' blob:;
connect-src 'self' wss://*.web.telegram.org blob:;
frame-ancestors 'none';
base-uri 'none';
object-src 'none';
```
Hệ quả kéo theo, phải chấp nhận từ ngày đầu: **không CDN bên thứ ba, không Google Fonts, không analytics, không Sentry.** Mỗi ngoại lệ ở đây là một cửa dẫn thẳng tới tài khoản Telegram của mọi user. Font tự host, icon inline.

### 3. Ranh giới nội dung không tin cậy
Mọi dữ liệu từ Telegram (catalog, tên file, caption, tên kênh) đi qua **một cổng duy nhất**:
1. Validate schema (Valibot) — sai kiểu thì loại bỏ item, không "sửa tạm cho chạy".
2. Kẹp độ dài (title 200 ký tự, mảng 100 phần tử) — chặn cả XSS lẫn tấn công làm phình bộ nhớ.
3. Loại ký tự điều khiển và ký tự đảo chiều Unicode (bidi override) — mẹo giả mạo tên file kinh điển.
4. Render **chỉ** qua text binding của Angular. `[innerHTML]` và `bypassSecurityTrust*` bị **cấm ở tầng lint**, không phải bằng lời nhắc trong code review.

Ảnh poster tải qua MTProto thành Blob rồi hiển thị bằng `blob:` URL — không bao giờ nhận URL http bên ngoài từ catalog.

### 4. Quyền riêng tư
- Không telemetry, không analytics, không crash reporting từ xa. Log chẩn đoán chỉ nằm trong bộ nhớ và trang `#/debug`, user tự sao chép nếu muốn báo lỗi.
- State đồng bộ lên kênh cá nhân ([ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md)) mặc định để dạng thường: Telegram vốn đã thấy toàn bộ hoạt động của tài khoản, mã hoá thêm ở đây chủ yếu tạo cảm giác an toàn giả. Vẫn cung cấp **tuỳ chọn mã hoá payload** bằng khoá dẫn xuất từ passphrase cho ai muốn — đánh đổi là phải nhập passphrase trên mọi thiết bị và mất khả năng khôi phục nếu quên.

### 5. Cảnh báo hiển thị trong onboarding
App phải nói rõ với user, bằng ngôn ngữ thường, trước khi họ nhập gì: đây là tài khoản Telegram thật, chỉ dùng bản tự deploy hoặc bản chính thức, và việc tải quá nhiều có thể khiến tài khoản bị Telegram hạn chế ([ADR-0006](./0006-download-pipeline-dc-pool-flood-wait.md)). Che giấu điều này để onboarding mượt hơn là đánh đổi sai.

## Hệ quả

**Tích cực**: bề mặt tấn công nhỏ và có thể lập luận được; kiểm chứng độc lập dễ vì không có gì bị ẩn phía server.

**Tiêu cực / phải chấp nhận**
- CSP nghiêm ngặt loại bỏ nhiều tiện nghi phát triển (một số công cụ dev cần `unsafe-eval`) → cấu hình CSP riêng cho build dev, nhưng CI phải kiểm tra CSP production không hề nới lỏng.
- Không có crash reporting nghĩa là bug ở môi trường thật khó truy vết hơn → càng cần trang `#/debug` chất lượng cao.
- Thêm ma sát khi bật khoá mật khẩu; phải giải thích rõ đây là lựa chọn có ý thức.

## Cập nhật sau khi Accepted (2026-08-24, ADR-0016)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này ghi nhận **một chỉ thị CSP đã bị sửa** bởi một ADR sau.

[ADR-0016](./0016-angular-material-va-cdk.md) chọn Angular Material + CDK. Angular chèn style của component vào `<head>` lúc chạy bằng thẻ `<style>`, nên `style-src 'self'` ở trên sẽ **chặn toàn bộ style của app**. Giải pháp chính thức (nonce theo từng request) đòi hỏi một server sinh nonce, mà [ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md) đã loại bỏ server khỏi kiến trúc.

**Chỉ thị `style-src` vì vậy được nới thành `'self' 'unsafe-inline'`.** Mọi chỉ thị khác của CSP ở trên **giữ nguyên**, đặc biệt là `script-src` — con đường thật sự dẫn tới chiếm tài khoản Telegram. `img-src`/`connect-src` bị giới hạn sẵn cũng đồng thời bịt kênh rò rỉ dữ liệu kinh điển của CSS injection. Phân tích đánh đổi đầy đủ nằm ở [ADR-0016](./0016-angular-material-va-cdk.md).

Kèm theo: job kiểm CSP trong CI được thu hẹp từ "cấm `unsafe-inline` ở mọi nơi" thành **"cấm `unsafe-inline` trong `script-src`"**. Tinh thần "CI phải kiểm tra CSP production không hề nới lỏng" ở trên vẫn giữ — chỉ là kiểm đúng chỗ đáng kiểm.
