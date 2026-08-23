# ADR-0012: Triển khai static PWA và cấu trúc workspace

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md), [ADR-0005](./0005-streaming-qua-service-worker-http-range.md), [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)

## Bối cảnh

Sản phẩm là một bundle tĩnh, ai cũng deploy được. Nhưng có một xung đột kỹ thuật cụ thể phải giải: **`@angular/service-worker` (ngsw) không cho phép viết `fetch` handler tuỳ biến**, mà toàn bộ [ADR-0005](./0005-streaming-qua-service-worker-http-range.md) chính là một `fetch` handler tuỳ biến.

## Quyết định

### 1. Service Worker: Workbox `injectManifest`, không dùng ngsw
- Viết `sw.ts` thủ công: handler `/_stream/*` do ta kiểm soát hoàn toàn, phần precache app shell giao cho Workbox.
- SW build bằng một bước **esbuild riêng**, xuất ra `sw.js` ở **thư mục gốc** của site (scope phải là `/`, nếu nằm trong `/assets/` thì không chặn được request của player).
- Bản dựng SW phải có hash trong precache manifest nhưng **tên file `sw.js` giữ nguyên** để cơ chế cập nhật của trình duyệt hoạt động.

### 2. Cấu trúc workspace (Angular CLI, pnpm)
```text
apps/
  web/                  # Angular app: routes, UI, player shell
libs/
  core-mtproto/         # TelegramGateway (nơi duy nhất import GramJS) — ADR-0003
  core-download/        # scheduler, DC pool, chunk cache — ADR-0006
  core-index/           # catalog parser, tầng index, search — ADR-0008/0010
  core-sync/            # event log, replay, compaction — ADR-0009
  core-storage/         # Dexie schema + migration — ADR-0007
  shared-models/        # kiểu dữ liệu miền + schema Valibot — ADR-0011
  worker-host/          # bootstrap Core Worker + Comlink API
sw/
  sw.ts                 # Service Worker, build riêng
docs/
  adr/  architecture.md  catalog-spec.md
```

Quy tắc phụ thuộc, **ép bằng lint** (`eslint-plugin-boundaries`) chứ không bằng thoả thuận miệng:
- `apps/web` **không được** import `core-mtproto` hay `core-download` trực tiếp — chỉ qua `worker-host`. Đây là cách duy nhất giữ cho bundle GramJS không bị kéo vào main thread.
- `libs/core-*` không import gì từ `@angular/*` (trừ `core-storage` có thể dùng `liveQuery` — không phụ thuộc Angular). Lõi phải test được bằng Node thuần.
- `shared-models` không phụ thuộc bất cứ thứ gì.

### 3. Hosting
- Mục tiêu chính: **GitHub Pages** (deploy bằng Actions) và Cloudflare Pages. Cả hai đều HTTPS, đều phục vụ được file tĩnh với header tuỳ biến ở mức cần thiết.
- Routing dùng **hash-based** (`#/`) để không phụ thuộc cấu hình rewrite SPA của từng nhà cung cấp — điều này giữ đúng lời hứa "fork là chạy" của [ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md).
- CSP đặt bằng thẻ `<meta http-equiv>` (chạy ở mọi host) **và** header khi host hỗ trợ. Thẻ meta không hỗ trợ `frame-ancestors`, nên nơi nào cấu hình được header thì phải cấu hình.
- Không dùng COOP/COEP — dự án không cần `SharedArrayBuffer`, mà bật chúng lên sẽ chỉ chuốc thêm rắc rối tương thích.

### 4. Build tái lập được
- `pnpm` với lockfile được commit, `pnpm install --frozen-lockfile` trong CI.
- CI publish kèm **checksum của bundle**, để người dùng đối chiếu bản đang chạy với mã nguồn — hệ quả trực tiếp của mô hình đe doạ "maintainer" trong [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md).

### 5. Chiến lược cập nhật
- SW mới **không** tự `skipWaiting`. Hiện thông báo "Có bản mới, tải lại". Tự động kích hoạt giữa lúc đang phát phim sẽ cắt luồng stream đang chạy.
- Migration schema chạy khi khởi động, sau khi SW đã ổn định ([ADR-0007](./0007-luu-tru-cuc-bo-indexeddb-dexie.md)).

## Các phương án đã cân nhắc

| Phương án | Đánh giá |
|---|---|
| `@angular/service-worker` (ngsw) | Không có custom fetch handler → không làm được streaming. Loại dứt khoát. |
| Nx thay cho Angular CLI workspace | Nhiều tính năng tốt nhưng nặng với một dự án cộng đồng; CLI workspace + boundaries lint là đủ. Có thể xem lại nếu số lib tăng gấp đôi. |
| Đóng gói thêm bản Tauri/Electron | Bỏ được giới hạn của Service Worker, nhưng phá vỡ lời hứa "web app không cài đặt". Cân nhắc lại nếu Spike #1 (Safari) thất bại và iOS trở thành ưu tiên. |

## Hệ quả

**Tích cực**: fork và deploy trong vài phút; ranh giới module ngăn được lỗi kiến trúc phổ biến nhất (kéo MTProto vào main thread).

**Tiêu cực / phải chấp nhận**
- URL có `#/` xấu hơn và kém thân thiện SEO — không quan trọng với một app đứng sau màn hình đăng nhập.
- Hai đường build (app và SW) phải giữ đồng bộ; cần một smoke test CI kiểm tra `sw.js` thực sự nằm ở gốc và có scope đúng.
