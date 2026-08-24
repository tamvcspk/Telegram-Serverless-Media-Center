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

## Cập nhật sau khi Accepted (2026-08-24, slice Auth F1.1)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**, chỉ có thêm một đường build thứ ba.

Khi `libs/worker-host/src/core-worker.ts` bắt đầu import `@tsmc/core-mtproto` (GramJS) thật cho slice Auth, cách dựng Core Worker ở bản đầu — `new Worker(new URL('./core-worker.ts', import.meta.url))`, để `@angular/build:application` tự code-split — **không dùng tiếp được**. Angular CLI's application builder không có hook chèn esbuild plugin tuỳ biến, trong khi GramJS cần polyfill/alias thủ công cho các module Node không có ý nghĩa trong trình duyệt (`fs`, `net`, `tls`).

**Quyết định (không thay đổi quyết định gốc, chỉ bổ sung)**: Core Worker cũng có build riêng bằng esbuild — giống `sw/` đã quy định ở trên — ngay khi nó phụ thuộc một package Node-oriented như GramJS:

- `libs/worker-host/build.mjs` bundle `core-worker.ts` → `apps/web/public/core-worker.js`. Cấu hình esbuild dùng lại **nguyên xi** cấu hình đã kiểm chứng thật ở SPIKE-03 (`esbuild-plugin-polyfill-node` với `globals: {process, buffer}`, `alias: {fs, net, tls → stub rỗng}`) — không đoán lại. Đã build thành công thật với `telegram@2.26.22`: **266.6 KB brotli** (so với 236 KB brotli của SPIKE-03 — chênh lệch hợp lý vì có thêm logic login + Comlink + Dexie).
- Khác với `sw.js` (build **sau** `ng build`, ghi vào `dist/web/browser/`): `core-worker.js` build **trước**, ghi thẳng vào `apps/web/public/`. Lý do: `public/` được cả `ng serve` (dev server) lẫn `ng build` phục vụ như static asset — giống `favicon.ico`/`manifest.webmanifest` đã hoạt động — nên dev không phải chạy full `ng build` mới có Core Worker sống. File này là artifact sinh ra, không commit (`.gitignore`).
- Script mới: `npm run build:worker`, chạy trước `ng build`/`ng serve` (`build:web` và `dev` ở root `package.json` đã gọi nó tự động).
- `apps/web/src/app` gọi `createCoreWorkerClient()` từ `@tsmc/worker-host` như cũ — bất biến "chỉ qua worker-host" của ADR này không đổi, chỉ đổi CÁCH worker được nạp (`new Worker('/core-worker.js')` thay vì `new URL(...)`).

**Hệ quả bổ sung**: bất kỳ `libs/core-*` nào sau này cần vào Core Worker và có dependency Node-oriented tương tự (không chỉ GramJS) sẽ đi theo đúng mẫu này, không cần bàn lại.

**Cập nhật tiếp trong cùng slice — hai phát hiện khi đăng nhập thật lần đầu:**

- **`polyfillNode()` mặc định KHÔNG polyfill `crypto`.** `esbuild-plugin-polyfill-node` để `polyfills.crypto = "empty"` theo mặc định — build vẫn thành công (không lỗi build-time) nhưng GramJS vỡ ngay lúc chạy (`randomBytes is not a function`, chi tiết ở [ADR-0003 § Cập nhật 2026-08-24](./0003-chon-thu-vien-mtproto-gramjs.md#cập-nhật-sau-khi-accepted-2026-08-24-slice-auth-f11)). Đã bật tường minh `polyfills: { crypto: true }` trong `libs/worker-host/build.mjs`. Con số **266.6 KB brotli** ghi ở trên đã đổi thành **422.9 KB brotli** sau khi bật — chênh lệch chấp nhận được (polyfill crypto nền WebCrypto qua `@jspm/core`, không phải lỗi cấu hình), không tính vào ngân sách app shell 300 KB vì Core Worker vẫn lazy-load riêng ([ADR-0004](./0004-mo-hinh-da-luong.md)).
- **Hệ quả kéo theo cho Service Worker**: `core-worker.js` tăng từ ~1.09 MB lên ~3.15 MB raw, vượt ngưỡng mặc định 2 MB của Workbox `injectManifest` — bị **âm thầm loại khỏi precache manifest** (chỉ in cảnh báo, không lỗi build) nếu không xử lý, khiến app mất khả năng chạy offline cho đúng phần quan trọng nhất. Đã nới `maximumFileSizeToCacheInBytes: 5 * 1024 * 1024` trong `sw/build.mjs`.
