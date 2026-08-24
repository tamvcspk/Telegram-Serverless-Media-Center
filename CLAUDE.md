# CLAUDE.md — TSMC

Media center chạy **hoàn toàn trong trình duyệt**, dùng Telegram làm identity provider + kho lưu trữ + CDN + CSDL đồng bộ. Không backend.

**Trạng thái: đang xây dần từng slice.** 16 ADR. Auth (F1.1) và Sync & Hydration (F1.2/F1.3) chạy thật, deploy tại https://tsmc-staging.web.app — dò/tạo kênh state, ghi event, đẩy lên Telegram đã kiểm chứng bằng tài khoản thật; nén snapshot (>200 event hoặc snapshot >7 ngày) và gộp nhiều kênh state (ADR-0014) chưa qua kiểm chứng thiết bị thật (không tự phát sinh trong một lần dùng bình thường). Browse/player chưa có. 3 spike đã đóng bằng số liệu thật rồi xoá mã nguồn (số liệu giữ ở [docs/spikes/](docs/spikes/)); SPIKE-04/05 chưa dựng.

Đọc [docs/architecture.md](docs/architecture.md) trước khi sửa bất cứ thứ gì có tính kiến trúc. Quyết định ràng buộc nằm ở [docs/adr/](docs/adr/).

## Bất biến — vi phạm là bug, không phải lựa chọn phong cách

1. **Không có thành phần server nào trong đường chạy của người xem.** Kể cả "chỉ để log" hay "chỉ analytics". ([ADR-0001](docs/adr/0001-kien-truc-client-heavy-khong-backend.md))
2. **Chỉ Core Worker được mở kết nối MTProto.** Service Worker là proxy giao thức mỏng, không giữ session, không tự nói chuyện mạng. ([ADR-0004](docs/adr/0004-mo-hinh-da-luong.md))
3. **Chỉ `libs/core-mtproto` được import package `telegram`.** Mọi tầng khác đi qua cổng `TelegramGateway`. Đây là thứ giữ chi phí đổi thư viện MTProto ở mức một package. ([ADR-0003](docs/adr/0003-chon-thu-vien-mtproto-gramjs.md))
4. **`apps/web` không import `core-mtproto` / `core-download`** — chỉ qua `worker-host`. Ngăn bundle GramJS bị kéo vào main thread. ([ADR-0012](docs/adr/0012-trien-khai-static-pwa-va-cau-truc-workspace.md))
5. **Không bao giờ ghi vào kênh media của người khác. Không bao giờ chia sẻ kênh state.** Kênh state là 1-đổi-1 với tài khoản, riêng tư tuyệt đối: không username, không invite link, không thêm thành viên. ([ADR-0014](docs/adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md))
6. **Metadata toàn cục không đi vào kênh state; state riêng tư không đi vào `catalog.json`.** Hai tầng dữ liệu khác nhau — xem [architecture.md §3](docs/architecture.md#3-hai-tầng-dữ-liệu--state-riêng-tư-và-metadata-toàn-cục).
7. **Cấm `[innerHTML]` và `bypassSecurityTrust*`.** Catalog là JSON do người lạ soạn; XSS ở đây = chiếm tài khoản Telegram thật của user. ([ADR-0011](docs/adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md))
8. **Không CDN bên thứ ba, không Google Fonts, không analytics, không crash reporting.** Font tự host, icon inline. Mỗi ngoại lệ là một cửa dẫn thẳng tới tài khoản Telegram của mọi user.
9. **`telegram` ghim cứng `2.26.22`** (không `^`). Package đã bị archive; ghim là điều kiện của quyết định giữ nó.
10. **Chia sẻ nguồn bằng username / invite link, không bao giờ bằng id thô** — `access_hash` khác nhau theo từng tài khoản.

## Ranh giới an toàn khi làm việc

- **Không chạy đăng nhập MTProto hộ người dùng.** Session MTProto = toàn quyền tài khoản Telegram (đọc/gửi tin nhắn, xoá tài khoản). Viết script để họ tự chạy trong terminal của họ; script ghi ra `*.local.json` chỉ chứa số liệu tổng hợp.
- **Không commit** session, `API_HASH`, `.firebaserc`, `*.local.json`.
- Tôn trọng `FLOOD_WAIT` tuyệt đối — không né bằng cách đổi DC. Đây là tài khoản thật của user đang chịu rủi ro. ([ADR-0006](docs/adr/0006-download-pipeline-dc-pool-flood-wait.md))

## Quy ước code

- **Angular zoneless** + signals + `@ngrx/signals` SignalStore, standalone components, `OnPush` mặc định. Store chỉ giữ **truy vấn + ID kết quả**, không giữ object phim (30k object trong store sẽ ngốn RAM và biến mọi filter thành một lần copy mảng). ([ADR-0002](docs/adr/0002-angular-zoneless-signals-va-signalstore.md))
- **Angular Material + CDK** cho UI. CDK Virtual Scroll là bắt buộc cho mọi danh sách phim. ([ADR-0016](docs/adr/0016-angular-material-va-cdk.md))
- **Mọi lib UI đưa vào phải zoneless-safe.** Không có `NgZone` nghĩa là lib nào còn phụ thuộc zone.js sẽ không trigger change detection.
- `@for` bắt buộc có `track`. Dùng `@defer` cho khối nặng (player, cài đặt, ffmpeg.wasm).
- Subscription dùng `takeUntilDestroyed()`.
- Chunk truyền giữa các luồng bằng `ArrayBuffer` **transferable** (zero-copy). UI không bao giờ chạm dữ liệu nhị phân.
- Mọi message xuyên luồng phải có **correlation id** — debug xuyên 3 ngữ cảnh (main / Core Worker / SW) không có nó là bất khả thi.

## Tài liệu

Tài liệu là sản phẩm chính của giai đoạn này. Sau **mọi** lần sửa `docs/`:

```bash
npm run docs:check
```

- Viết/sửa ADR → dùng skill `/adr`. **Không sửa nội dung Quyết định của ADR đã `Accepted`** — viết ADR mới (`Superseded`) hoặc addendum.
- Mở/ghi/đóng spike → dùng skill `/spike`. Spike chỉ đóng khi có **số liệu từ thiết bị thật**.
- Anchor tiếng Việt: em-dash `—` sinh **hai** gạch nối trong slug. Đừng gõ tay, để checker xác nhận.

## Môi trường

- Windows + PowerShell. `npm run <script> -- --flag` **bị npm nuốt mất `--flag`** — gọi thẳng `node script.mjs --flag`.
- `sed`/`perl` với neo `$` không khớp dòng CRLF (repo còn lẫn CRLF). Lệnh thay thế "chạy xong không đổi gì" thường là do nguyên nhân này — dùng công cụ sửa file trực tiếp.
- Staging: Firebase Hosting, project `tsmc-staging` → https://tsmc-staging.web.app

## Lệnh hay dùng

```bash
npm run docs:check      # kiểm tra tài liệu
npm run dev              # build Core Worker rồi ng serve, localhost:4200
npm run lint             # eslint-plugin-boundaries ép ranh giới ADR-0012
npm run test:libs        # vitest cho libs/*, chạy bằng Node thuần
npm run deploy:preview   # preview channel, tự hết hạn sau 7 ngày
npm run deploy:staging   # deploy staging thật (tự build trước)
```
