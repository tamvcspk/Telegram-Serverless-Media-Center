# ADR-0001: Kiến trúc Client-Heavy, không backend

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md), [ADR-0012](./0012-trien-khai-static-pwa-va-cau-truc-workspace.md)

## Bối cảnh

Mục tiêu dự án là chi phí vận hành **bằng 0**: không server, không băng thông egress, không CSDL trả phí. Telegram đã cung cấp sẵn ba thứ mà một media center cần: identity provider (MTProto auth), object storage + CDN (file trong channel), và một CSDL append-only có thứ tự toàn cục (message history của channel).

Câu hỏi kiến trúc gốc: đặt "bộ não" ở đâu?

## Các phương án

### A. Thin client + backend proxy (kiến trúc web truyền thống)
Backend giữ session MTProto, stream file về cho browser qua HTTP.
- ✅ Client đơn giản, không lộ credential trong browser, dễ cache tập trung.
- ❌ **Egress cost tuyến tính theo lượt xem** — phá vỡ mục tiêu chính.
- ❌ Backend giữ session của *mọi* user → một lần rò rỉ là thảm hoạ toàn hệ thống, và biến dự án open-source thành dịch vụ phải chịu trách nhiệm pháp lý.

### B. Client-heavy, browser nói chuyện trực tiếp với Telegram DC (**được chọn**)
- ✅ Chi phí hạ tầng = chi phí hosting file tĩnh ≈ 0.
- ✅ Không tồn tại kho credential tập trung: session của ai nằm trên máy người đó.
- ✅ Bandwidth = kết nối trực tiếp user ↔ CDN Telegram, nhanh nhất có thể.
- ❌ Mọi thứ khó (đa luồng, streaming, sync, xung đột) bị đẩy vào client.
- ❌ Không cache dùng chung giữa các user; mỗi người tự index lại.

### C. Lai: client-heavy + backend nhỏ chỉ để index cộng đồng
- ✅ Index nhanh hơn cho kênh lớn.
- ❌ Vẫn phải nuôi server + tài khoản bot; và `catalog.json` ghim trong channel ([ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md)) đã giải quyết đúng vấn đề này với chi phí 0.

## Quyết định

Chọn **B**. Toàn bộ ứng dụng là một SPA tĩnh; trình duyệt là orchestrator duy nhất. **Không có thành phần server nào được phép xuất hiện trong runtime path** — kể cả để "chỉ log" hay "chỉ analytics".

Hệ quả bắt buộc:
1. `API_ID`/`API_HASH` **do user tự tạo và tự nhập**. Dự án không nhúng credential của mình (nhúng = mọi user dùng chung một app identity, dễ bị Telegram thu hồi, và biến maintainer thành bên chịu trách nhiệm).
2. Mọi trạng thái do user tạo ra phải sống được ở hai nơi: IndexedDB (nhanh) và Telegram (bền) — xem [ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md).
3. App phải chạy được khi mở từ `file://`-like môi trường tĩnh bất kỳ (GitHub Pages, Cloudflare Pages, self-host) — không phụ thuộc header đặc thù của một nhà cung cấp, ngoại trừ HTTPS (điều kiện bắt buộc của Service Worker).

## Hệ quả

**Tích cực**
- Fork-and-run: bất kỳ ai cũng deploy được bản riêng trong 2 phút.
- Không có single point of failure vận hành.

**Tiêu cực / phải chấp nhận**
- Onboarding có ma sát cao (user phải lên my.telegram.org lấy API key). Cần một trang hướng dẫn có ảnh chụp màn hình từng bước — đây là điểm rơi rụng user lớn nhất, không được xem nhẹ.
- Không thể "sửa nóng" dữ liệu hỏng của user từ xa; mọi migration phải chạy được offline trên client ([ADR-0007](./0007-luu-tru-cuc-bo-indexeddb-dexie.md)).
- Rủi ro XSS trở thành rủi ro **chiếm tài khoản Telegram**, không chỉ mất phiên đăng nhập app → [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md) là ADR bắt buộc đọc trước khi viết bất kỳ dòng render nào.
