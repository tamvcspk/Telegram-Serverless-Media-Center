# ADR-0016: Angular Material + CDK làm thư viện UI

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-24
- **Liên quan:** [ADR-0002](./0002-angular-zoneless-signals-va-signalstore.md), [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md), [ADR-0012](./0012-trien-khai-static-pwa-va-cau-truc-workspace.md)
- **Sửa đổi:** chỉ thị `style-src` trong CSP của [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md) — xem mục "Xung đột với CSP" bên dưới

## Bối cảnh

[ADR-0002](./0002-angular-zoneless-signals-va-signalstore.md) chốt Angular zoneless + signals nhưng để ngỏ tầng UI. Giao diện trong PRD mục 4 cần: sidebar workspace, filter chips, grid thumbnail hàng chục nghìn item, dialog, overlay, skeleton loading, và một player.

Ba nhu cầu trong đó **không nên tự viết**:

1. **Virtual scroll.** [ADR-0002](./0002-angular-zoneless-signals-va-signalstore.md) yêu cầu render danh sách tới hàng chục nghìn phim. Tự viết virtual scroll đúng (thay đổi kích thước, scroll ngang, khôi phục vị trí) là một dự án con.
2. **Accessibility.** Focus trap cho dialog, `LiveAnnouncer` cho screen reader, quản lý bàn phím cho menu/listbox. Tự viết gần như chắc chắn sai, và sai lặng lẽ.
3. **Overlay positioning.** Menu/tooltip/dropdown bám đúng vị trí khi cuộn, khi tràn viewport, khi RTL.

Phiên bản tại thời điểm quyết: `@angular/material` và `@angular/cdk` **22.1.3**, khớp `@angular/core` 22.1.3.

## Các phương án

### A. Tự viết toàn bộ CSS + component
- ✅ Bundle nhỏ nhất, CSP sạch nhất (xem bên dưới).
- ❌ Phải tự viết virtual scroll và a11y — hai thứ khó nhất, và là hai thứ người dùng chịu thiệt trực tiếp nếu làm ẩu.

### B. Thư viện bên thứ ba khác (PrimeNG, Tailwind + headless…)
- ❌ Rủi ro zoneless: [ADR-0002](./0002-angular-zoneless-signals-va-signalstore.md) đặt luật "mọi lib UI phải zoneless-safe". Material/CDK là lib duy nhất được chính đội Angular bảo trì cùng nhịp với core (cùng số phiên bản 22.1.3), nên khả năng theo kịp zoneless cao nhất.
- ❌ Tailwind CDN vi phạm [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md); bản build cục bộ thì lại quay về phương án A cho phần component.

### C. **Angular Material + CDK (được chọn)**
- ✅ Giải quyết cả ba nhu cầu khó ở trên.
- ✅ Cùng nhịp phát hành với Angular core.
- ❌ **Xung đột trực tiếp với CSP `style-src 'self'`** — vấn đề chính của ADR này.
- ❌ Cộng trọng lượng vào app shell.

## Quyết định

Dùng **Angular Material + CDK 22.x**. Ràng buộc thực thi:

1. **CDK Virtual Scroll là bắt buộc** cho mọi danh sách phim. Không có ngoại lệ "danh sách này ngắn mà" — kho cộng đồng có thể phình bất kỳ lúc nào.
2. **Import theo từng component** (`MatButtonModule`, `MatDialogModule`…), không import gói tổng.
3. **CDK trước Material.** Nhiều nhu cầu (overlay, a11y, virtual scroll, portal, clipboard) chỉ cần CDK — thứ gần như không có chi phí style. Chỉ lấy Material khi thật sự cần component có sẵn giao diện.
4. **Theme tự định nghĩa bằng Material 3 tokens**, không nhúng theme dựng sẵn qua CDN. Font tự host ([ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)).
5. Mọi component Material đưa vào phải kiểm chứng chạy đúng ở chế độ **zoneless** — đây là điều kiện của [ADR-0002](./0002-angular-zoneless-signals-va-signalstore.md), không phải chi tiết nhỏ.

## Xung đột với CSP — phần quan trọng nhất của ADR này

Angular **chèn style của component vào `<head>` lúc chạy** bằng thẻ `<style>` (kể cả bản production: CSS của component đi trong JS rồi được inject). Với `style-src 'self'` như [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md) quy định, **những thẻ `<style>` đó bị chặn và app hiển thị không có style.** CDK Overlay còn chèn thêm style lúc chạy.

Cách chính thức của Angular là dùng **nonce** (`ngCspNonce` / token `CSP_NONCE`). Nonce phải **khác nhau mỗi request** → cần một server sinh ra nó. **TSMC không có server** ([ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md)). Nonce tĩnh nhúng sẵn trong `index.html` thì kẻ tấn công XSS đọc được ngay trong DOM và tái sử dụng — nó chỉ tạo cảm giác an toàn giả, không tạo an toàn.

**Quyết định: nới `style-src` thành `'self' 'unsafe-inline'`. Giữ nguyên `script-src` nghiêm ngặt.**

Vì sao đánh đổi này chấp nhận được — và vì sao nó *không* làm hỏng mô hình đe doạ của [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md):

| | Trước | Sau |
|---|---|---|
| `script-src` | `'self' 'wasm-unsafe-eval'` | **không đổi** |
| `style-src` | `'self'` | `'self' 'unsafe-inline'` |

- Con đường dẫn tới **chiếm tài khoản Telegram** là thực thi **script**, không phải CSS. `script-src` không hề bị nới.
- Kênh rò rỉ dữ liệu kinh điển của CSS injection là `background-image: url(https://kẻ-tấn-công/...)`. CSP của TSMC đã chặn sẵn: `img-src 'self' blob: data:` và `connect-src 'self' wss://*.web.telegram.org blob:`. **CSS không có nơi nào để gửi dữ liệu ra ngoài.**
- Rủi ro còn lại là bóp méo giao diện / clickjacking bằng CSS — đã được `frame-ancestors 'none'` và việc không có form nhập credential bên thứ ba giới hạn lại.

Việc cần làm kèm theo (hệ quả thực thi, không phải tuỳ chọn):

- **Sửa job kiểm CSP trong CI.** Hiện tại `.github/workflows/deploy-staging.yml` fail khi thấy chuỗi `unsafe-inline` ở bất kỳ đâu trong `firebase.json`. Phải thu hẹp thành: **fail nếu `script-src` chứa `unsafe-inline`**, cho phép ở `style-src`. Nếu không, chính CI sẽ chặn quyết định này — và tệ hơn, người sau sẽ "sửa" bằng cách xoá luôn kiểm tra.
- Thêm `font-src 'self'` khi bắt đầu tự host font.
- Khi triển khai chế độ Admin có `ffmpeg.wasm` ([ADR-0013](./0013-bot-dong-hanh-va-pipeline-ingest.md)), `worker-src 'self' blob:` đã có sẵn.

## Hệ quả

**Tích cực**
- Virtual scroll, a11y và overlay là hàng có sẵn, được đội Angular bảo trì — ba thứ tự viết dễ sai nhất.
- CDK a11y giúp dự án tử tế với người dùng screen reader mà gần như không tốn công.
- Cùng nhịp phiên bản với core → nâng cấp Angular ít rủi ro hơn lib bên thứ ba.

**Tiêu cực / phải chấp nhận**
- **CSP `style-src` yếu đi.** Đã phân tích ở trên; đây là cái giá có ý thức, không phải sơ suất. Nó phải được ghi trong README công khai để người tự deploy biết mình đang chạy chính sách nào.
- **Trọng lượng app shell tăng, và mức tăng chưa được đo.** [SPIKE-03](../spikes/README.md#spike-03) đặt ngưỡng app shell dưới 300 KB brotli (không tính GramJS). Material + theme có thể ăn phần lớn ngân sách đó. Đây là **giả thuyết chưa kiểm chứng** → [SPIKE-05](../spikes/README.md#spike-05).
- Material 3 theming có đường học riêng; tuỳ biến sâu để khớp wireframe PRD có thể tốn hơn dự kiến.
- Ràng buộc thêm một chiều nâng cấp: Angular core và Material phải nâng cùng nhau.
