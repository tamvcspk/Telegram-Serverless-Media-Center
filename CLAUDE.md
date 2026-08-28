# CLAUDE.md — TSMC

Media center chạy **hoàn toàn trong trình duyệt**, dùng Telegram làm identity provider + kho lưu trữ + CDN + CSDL đồng bộ. Không backend.

**Trạng thái: đang xây dần từng slice.** 16 ADR. Auth (F1.1), Sync & Hydration (F1.2/F1.3), Index (F2, ADR-0010), Browse (F3.1–F3.3, ADR-0002/0008/0016), và Playback (F4, ADR-0004/0005/0006 — vertical slice tối thiểu) chạy thật, deploy tại https://tsmc-staging.web.app — dò/tạo kênh state, ghi event, đẩy lên Telegram, 3 tầng index (catalog/delta/full-scan) + mô hình tin cậy phân tầng, lưới duyệt phim (CDK virtual scroll, lọc theo nguồn, tìm kiếm MiniSearch chuẩn hoá tiếng Việt, SignalStore đầu tiên trong repo), và phát video thật qua Service Worker giả lập HTTP Range đã kiểm chứng bằng tài khoản thật; slice hardening sau đó (2026-08-26) đã thêm AIMD + circuit breaker theo DC (`libs/core-download/src/download-engine.ts`) và CDN redirect (AES-CTR + xác minh SHA-256, `libs/core-mtproto/src/gateway-download.ts`) — vẫn multiplex N request trên MỘT sender/DC (GramJS không cho mở nhiều `MTProtoSender` vật lý song song, xem ADR-0006), và CDN redirect viết theo đặc tả TL, chưa có traffic CDN thật để kiểm chứng (SPIKE-02 vẫn 0/250 lần gặp thật). Slice UI (2026-08-27) đã dựng khung routing mobile-first (`docs/ux-design.md`) — `login` (Vertical MatStepper, full-bleed) → `home` (gate qua `authGuard`, `MainShell` với bottom nav tự ghép, KHÔNG phải component Material — `MatBottomNav` không tồn tại) → `player/...` (immersive, không đổi); `Browse` chạy trong tab `home/browse` và nay đã khớp layout Màn hình 2 (Dashboard) — thanh tìm kiếm + chip lọc nguồn cố định trên cùng bằng flex layout lấp đầy vùng cuộn, chip cuộn ngang; còn thiếu icon ⚙️ vào Settings (chưa có route đích) và bộ lọc Cá nhân/Cộng đồng (field phân loại chưa có ở tầng dữ liệu). `Collections` (tab `home/collections`) nay CRUD thật — tạo/đổi tên/xoá bộ sưu tập, thêm/gỡ/kéo-thả sắp xếp lại phim (`cdkDropList`/`cdkDrag`, lưu thật qua op `collection.reorder` mới thêm xuyên `shared-models`/`core-sync`/`worker-host`), FAB định vị bằng CSS custom property `--tsmc-bottom-nav-height` (khai báo ở `main-shell.scss`, dùng lại cho Sources/Màn hình 4 sau này); entry point thêm-vào-BST duy nhất nằm ở menu trên mỗi row của Browse — chưa phân biệt trạng thái chết link "mất quyền truy cập" vs "nguồn đã xoá tệp tin" (hoãn có chủ đích, cần bắt lỗi tầng MTProto). `Sources` (tab `home/sources`) nay khớp layout Màn hình 4 (2026-08-27): thẻ nguồn thật (tier catalog/delta/full, số phim, lỗi quét gần nhất) + FAB mở `AddSourceSheet` (`MatBottomSheet` căn giữa nội dung — không phải popup giữa màn hình, dán username/link hoặc chọn từ danh sách chat đã tham gia, chặn dán ID thô ở form theo ADR-0014 §1) + nút "Gỡ nguồn" (`removeSource()`, xác nhận bằng `confirm()` gốc — cùng quy ước xoá bộ sưu tập ở Collections). `scanSource()` (`libs/core-index/src/index-engine.ts`) là MỘT LƯỢT bounded, không resumable/không báo tiến trình theo số — lúc quét chỉ hiện `MatProgressBar` indeterminate, KHÔNG có số liệu "1500/5000 tin" như mockup vẽ (cần job nền có tiến trình thật, chưa làm). `ChannelIndex` (công cụ debug F2 cũ) đã xoá — mọi trách nhiệm của nó (thêm/quét nguồn, liệt kê tier) chuyển hẳn vào UI thật này; phần "chẩn đoán 500 tin không lọc" của nó không có chỗ trong 7 màn hình nên bỏ hẳn, xem lại ở git log nếu cần điều tra bug admin-cache. `SyncStatus` (công cụ debug outbox) vẫn tạm host cuối trang `home/sources`, chờ chỗ đàng hoàng hơn — chi tiết ở `.claude/skills/ui-conventions/SKILL.md` §6. Slice Settings (2026-08-28) đã dựng Màn hình 7 thật ở route `settings` (sub-page, `canActivate: [authGuard]`, KHÔNG dưới `home`/Bottom Nav — vào qua icon ⚙️ mới thêm ở header Browse): khối Tài khoản (avatar chữ cái đầu + tên/SĐT từ `TelegramUserSummary` do `authGuard` set vào `shell/current-user.ts`, nút Đăng xuất — đã CHUYỂN khỏi `Sources` — mở `LogoutConfirmSheet` thực hiện đúng Logout Journey: kiểm `pendingOutboxCount()`, gọi một RPC `client.logout()` duy nhất tự flush outbox → dừng timer → `auth.LogOut` → `wipeAllData()` đúng thứ tự, dừng ngay ở bước lỗi không xoá gì); khối Lưu trữ (`navigator.storage.estimate()` ước lượng dung lượng, nút xoá Cache Storage `tsmc-chunks-v1` — hằng số này chuyển sang `shared-models` để cả `sw.ts` lẫn Settings dùng chung); khối Mạng (`MatSlider` [4,8] gọi RPC mới `setMaxConcurrency()` — đóng "known gap" của ADR-0006 §3, đồng bộ qua kênh state VÀ áp dụng ngay cho `downloadEngine` đang chạy, `initSync()` tự nạp lại giá trị đã lưu mỗi lần Core Worker khởi động — xem addendum ADR-0006 2026-08-28; **chưa có traffic thật để kiểm chứng rủi ro FLOOD_WAIT ở trần 8**, chỉ có test đơn vị với fake gateway); khối Debug (cờ log cục bộ lưu `localStorage`, có hiệu lực sau khi tải lại trang). Slice Ingest Editor (2026-08-28) đã dựng Màn hình 6 thật ở route `metadata/:sourceId/:msgId` (`apps/web/src/app/metadata-editor/`, vào qua icon ✏️ mới thêm trên mỗi row Browse — icon hiện ở MỌI row, kiểm tra quyền ghi diễn ra ở đích đến chứ không lọc trước): sửa title/năm/compat của một item rồi RPC `saveMediaMetadata()` đóng gói lại TOÀN BỘ catalog.json của nguồn và ghim đè lên kênh media qua `publishCatalogDocument()` (`libs/core-mtproto/src/gateway-index.ts`, cùng khuôn `sendFile → pinMessage → deleteMessages` với `publishSnapshot()` của ADR-0009 nhưng ghi kênh media, không phải kênh state). Chỉ hợp lệ cho Kho Cá Nhân — "writable" hoá ra chính là `ResolvedIndexChannel.isOwn` đã có sẵn từ slice Index (F2), không cần field lưu trữ riêng, RPC `checkSourceWritable()` resolve lại mỗi lần cần. Publish xong tự gọi lại `scanSourceAndReindex()` — Telegram luôn là nguồn sự thật duy nhất, không có đường ghi tắt song song vào Dexie. **Đã kiểm chứng bằng tài khoản thật (2026-08-28, SPIKE-06)** — kênh test tự sinh, cả 5 tiêu chí đạt: publish lần đầu, publish-cập-nhật (pin chuyển đúng, xoá bản cũ thật), đọc lại byte-chính-xác, không cần can thiệp tay. Một lần chạy/một tài khoản — đủ cho câu hỏi đúng/sai của chuỗi API xác định, nhưng CHƯA phủ `FLOOD_WAIT` xảy ra giữa chừng 3 RPC ghi liên tiếp (không có retry/rollback cho tình huống dở dang đó, xem addendum ADR-0014 2026-08-28 SPIKE-06). Đường tương tự cho kênh state (`publishSnapshot()`) vẫn chưa được xác nhận trên thiết bị thật riêng (xem addendum ADR-0009). Slice Player (2026-08-28) đã đóng hai mảnh còn thiếu của Màn hình 5: `compat-warning-sheet.ts` chặn phát bằng `MatBottomSheet` khi `MediaRecord.compat` (field có thật từ `catalog.json` cộng đồng, xem `libs/core-index/src/catalog-tier.ts`, nhưng chưa ai gán nhãn vì Ingest Editor chưa route) là `'partial'`/`'unplayable'` — nút "Mở trên Telegram" tự dựng deep link từ `SourceRef.ref`; và `flood-wait-notice.ts` bắc cầu tín hiệu `FloodWaitTooLongError` từ `stream-bridge.ts` (module cấp trang) sang `player.ts` (component) để bật `MatSnackBar` ở cạnh trên — trước đó lỗi FLOOD_WAIT chỉ rơi vào debug log, không hiện gì cho user thường. Nén snapshot (>200 event hoặc snapshot >7 ngày) và gộp nhiều kênh state (ADR-0014) chưa qua kiểm chứng thiết bị thật (không tự phát sinh trong một lần dùng bình thường). Lưới duyệt vẫn chỉ hiển thị chữ (title/năm/thể loại) — poster cần một đường tải ảnh riêng (Telegram Photo, khác Document/video vừa xây), chưa thuộc phạm vi F4. 4 spike đã đóng bằng số liệu thật rồi xoá mã nguồn (số liệu giữ ở [docs/spikes/](docs/spikes/)); SPIKE-04 (~1.1 GB tải liên tục ở mức 4/8 request đồng thời, 0 lần FLOOD_WAIT trên tài khoản test — chấp nhận rủi ro, ngưỡng thật chưa lộ ra) đóng 2026-08-26; SPIKE-05 chưa dựng.

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
