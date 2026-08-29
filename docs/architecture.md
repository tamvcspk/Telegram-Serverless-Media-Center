# Kiến trúc Hệ thống — Telegram Serverless Media Center (TSMC)

> Tài liệu tổng quan. Mọi quyết định có tính ràng buộc đều nằm trong [docs/adr/](./adr/).

## 1. Ràng buộc nền tảng (Forces)

Đây là các "định luật vật lý" của dự án. Mọi thiết kế phải sống chung với chúng:

| # | Ràng buộc | Hệ quả kiến trúc |
|---|-----------|------------------|
| C1 | Không có backend, không có secret phía server | API_ID/API_HASH do **user tự cung cấp**; mọi credential nằm trong trình duyệt |
| C2 | MTProto là giao thức nhị phân trên WebSocket, **không phải HTTP** | Không thể trỏ `<video src>` trực tiếp vào Telegram → bắt buộc có lớp dịch HTTP↔MTProto |
| C3 | `upload.getFile` bị chặn ở **1 MB/lần**, offset & limit phải chia hết cho 4096, và một chunk **không được vắt qua ranh giới 1 MB** | Bộ lập lịch tải phải tự cắt/gộp chunk; seek = phép toán offset |
| C4 | File nằm rải rác trên nhiều **DC**, cần `auth.exportAuthorization` cho DC lạ | Cần connection pool theo DC, không dùng chung 1 socket |
| C5 | `file_reference` **hết hạn** (~vài chục phút) | Metadata cache **không thể** tin cậy lâu dài → cần cơ chế refresh on-demand |
| C6 | Tài khoản thật của user đứng ra tải → có `FLOOD_WAIT`, có rủi ro bị hạn chế tài khoản | Bắt buộc backoff + giới hạn song song, coi throttling là tính năng lõi |
| C7 | Giải mã AES-IGE khối lượng lớn (hàng chục MB/phút) | Không được chạy trên main thread nếu muốn giữ 60fps |
| C8 | Kênh cộng đồng chứa dữ liệu **do người lạ soạn** | `catalog.json` là untrusted input → validate + sanitize trước khi render |
| C9 | Đồng bộ đa thiết bị nhưng không có server phân xử xung đột | Cần một total-order log; Telegram channel chính là log đó |
| C10 | **Bot API chỉ cho gửi file ≤ 50 MB**, tải về ≤ 20 MB | Bot **không thể** là nơi upload phim; upload phải đi qua MTProto từ máy admin ([ADR-0013](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md)) |
| C11 | Trình duyệt chỉ phát được một tập container/codec hẹp (MP4/H.264/AAC là mẫu số chung) | Khả năng phát được phải được quyết định **lúc upload**, không phải lúc xem |
| C12 | `access_hash` của channel **khác nhau theo từng tài khoản** | Chia sẻ nguồn phải dùng **username / invite link**, không bao giờ dùng id thô ([ADR-0014](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)) |
| C13 | Chữ "riêng tư" trong dự án này mang **hai nghĩa khác trục nhau** — quyền sở hữu kênh media (cá nhân/cộng đồng) và tính cá nhân-hoá của dữ liệu (state riêng tư/metadata toàn cục) | Không được dùng lẫn hai nghĩa; xem mục 3 |

## 2. Bức tranh tổng thể

```text
┌─────────────────────────── BROWSER TAB ────────────────────────────┐
│                                                                    │
│  MAIN THREAD                    CORE WORKER (Dedicated Worker)     │
│  ┌──────────────────────┐       ┌────────────────────────────────┐ │
│  │ Angular (zoneless)   │◄─────►│ GramJS  (MTProto/WSS)          │ │
│  │  SignalStore facades │  RPC  │  ├─ Auth & Session             │ │
│  │  UI / Router / Player│(Comlink) ├─ DC Connection Pool         │ │
│  └──────────────────────┘       │  ├─ Download Scheduler         │ │
│            ▲                    │  └─ Sync Engine (event log)    │ │
│            │ signals            │ Dexie/IndexedDB (writer)       │ │
│            │                    │ MiniSearch (inverted index)    │ │
│            │                    └──────────────┬─────────────────┘ │
│  ┌─────────┴────────────┐                      │ MessageChannel    │
│  │ <video src=          │                      │ (ArrayBuffer      │
│  │  /_stream/{id}>      │                      │  transferable)    │
│  └─────────┬────────────┘                      │                   │
└────────────┼───────────────────────────────────┼───────────────────┘
             │ HTTP Range                        │
             ▼                                   ▼
      ┌─────────────────────────────────────────────────┐
      │ SERVICE WORKER — "Stream Proxy"                 │
      │  fetch(/_stream/*) → xin chunk từ Core Worker   │
      │  → trả 206 Partial Content + ReadableStream     │
      │  Cache Storage: LRU chunk cache                 │
      └─────────────────────────────────────────────────┘
                              │ (chỉ Core Worker mới nói chuyện mạng)
                              ▼
      ┌─────────────────────────────────────────────────┐
      │ TELEGRAM DC 1..5   (Storage + CDN)              │
      │  Kênh media (n user : 1 kênh, chia sẻ, chỉ đọc) │
      │  Kênh state  (1 tài khoản : 1 kênh, riêng tư)   │
      └─────────────────────────────────────────────────┘
                              ▲
                              │ ghi (chỉ phía tác giả nội dung)
      ┌───────────────────────┴─────────────────────────┐
      │ PHÍA ADMIN KÊNH — ngoài đường chạy người xem    │
      │  tsmc-ingest CLI (MTProto, ffmpeg)  → upload    │
      │  @tsmc_bot (Bot API)  → catalog.json + hậu kiểm │
      └─────────────────────────────────────────────────┘
```

**Hai bất biến:**
1. Chỉ **Core Worker** được phép mở kết nối MTProto ([ADR-0004](./adr/0004-mo-hinh-da-luong.md)).
2. App **không bao giờ** ghi vào kênh media của người khác, và **không bao giờ** chia sẻ kênh state ([ADR-0014](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)).

## 3. Hai tầng dữ liệu — State riêng tư và Metadata toàn cục

Dự án dùng chữ "riêng tư" (private) cho **hai trục hoàn toàn khác nhau**, và việc lẫn lộn chúng là nguồn nhầm lẫn dễ xảy ra nhất khi đọc các ADR:

- **Trục 1 — quyền sở hữu kênh media:** một kênh media là *"cá nhân"* (Kho Cá Nhân, user viết được) hay *"cộng đồng"* (user chỉ đọc). Đây là thuộc tính của **kênh**, không liên quan gì đến quyền riêng tư dữ liệu.
- **Trục 2 — tính cá nhân-hoá của dữ liệu:** một mẩu dữ liệu có ý nghĩa khi thuộc về *một mình user này* hay không.

Trục 2 mới là thứ mục này nói tới, và nó chia dữ liệu người dùng làm hai tầng rạch ròi:

| | **State riêng tư** | **Metadata toàn cục** |
|---|---|---|
| Ví dụ | Tiến trình xem, bộ sưu tập (playlist), cài đặt hiển thị, danh sách nguồn đã theo dõi | Tiêu đề, năm, thể loại (genre), category, diễn viên, đạo diễn, liên kết file media (`msgId`), poster, phụ đề |
| Có ý nghĩa khi chia sẻ? | **Không** — "phút 30 của Dune" chỉ có nghĩa với đúng một người | **Có** — đây chính là thứ nhiều người cùng đọc |
| Sống ở đâu | Kênh state (1 tài khoản : 1 kênh, riêng tư tuyệt đối) | Kênh media (n user : 1 kênh, chia sẻ) — `catalog.json` |
| Ai ghi | Chính chủ tài khoản, qua event log | Admin/bot của kênh ([ADR-0013](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md)), hoặc chính user nếu là Kho Cá Nhân |
| Cơ chế đồng bộ | Event log + snapshot compaction ([ADR-0009](./adr/0009-dong-bo-state-event-log-va-snapshot.md)) | `catalog.json` ghim + quét delta ([ADR-0010](./adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md)) |
| Mất thì sao | **Mất thật** — không nơi nào khác giữ bản sao | Index lại được từ kênh media — không mất vĩnh viễn |
| ADR nền tảng | [0009](./adr/0009-dong-bo-state-event-log-va-snapshot.md), [0014](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md) | [0010](./adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md), [0007](./adr/0007-luu-tru-cuc-bo-indexeddb-dexie.md) (store `media`) |

**Quy tắc bất biến rút ra từ đây:** metadata toàn cục **không bao giờ** được ghi vào kênh state, dù chỉ là tham chiếu. Hai lý do:

1. **Vô nghĩa về mặt dữ liệu** — mọi user xem cùng một kênh media đều phải thấy cùng một thể loại, cùng một tiêu đề. "Riêng tư hoá" một thứ vốn dùng chung không tạo ra giá trị gì, chỉ tạo ra N bản sao lệch nhau (N = số user).
2. **Lãng phí tài nguyên quý** — kênh state có event log bị giới hạn 4096 ký tự/message ([ADR-0009](./adr/0009-dong-bo-state-event-log-va-snapshot.md)); nhét catalog vào đó là dùng sai công cụ cho đúng việc mà `catalog.json` đã giải quyết với chi phí bằng 0.

Ngược lại, **state riêng tư không bao giờ được suy ra hay lưu chung trong `catalog.json`** — nó không thuộc về kênh media, dù kênh đó là Kho Cá Nhân của chính user. Lẫn hai chiều này là cách chắc chắn nhất để một thiết bị thứ hai nhìn thấy tiến trình xem của người khác, hoặc để catalog phình to theo số người xem thay vì số phim.

## 4. Bốn "đường dây" (data paths)

1. **Control path** — UI → Core Worker (Comlink RPC) → MTProto. Dùng cho auth, liệt kê dialog, index, sync.
2. **Stream path** — `<video>` → Service Worker → Core Worker → MTProto. Băng thông cao, zero-copy, không đi qua Angular.
3. **Read path** — UI đọc dữ liệu từ IndexedDB qua signals; Core Worker là **writer duy nhất** (single-writer để tránh race).
4. **Sync path** — thay đổi state → event log append lên kênh state riêng tư, nén định kỳ thành snapshot.

Ngoài bốn đường trên còn một **đường ingest** chạy ở phía admin kênh, tách hẳn khỏi runtime của người xem ([ADR-0013](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md)).

## 5. Bản đồ ADR ↔ Epic trong PRD

| Epic / Feature | ADR liên quan |
|---|---|
| Toàn dự án | [0001](./adr/0001-kien-truc-client-heavy-khong-backend.md), [0012](./adr/0012-trien-khai-static-pwa-va-cau-truc-workspace.md), [0015](./adr/0015-moi-truong-kiem-thu-firebase-hosting.md) |
| F1.1 Auth | [0003](./adr/0003-chon-thu-vien-mtproto-gramjs.md), [0011](./adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md) |
| F1.2 / F1.3 Sync & Hydration | [0009](./adr/0009-dong-bo-state-event-log-va-snapshot.md), [0014](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md), [0007](./adr/0007-luu-tru-cuc-bo-indexeddb-dexie.md) |
| F2.1–F2.3 Index | [0010](./adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md), [0014](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md), [0006](./adr/0006-download-pipeline-dc-pool-flood-wait.md) |
| F3.1–F3.3 Browsing | [0002](./adr/0002-angular-zoneless-signals-va-signalstore.md), [0016](./adr/0016-angular-material-va-cdk.md), [0008](./adr/0008-tim-kiem-client-side-minisearch.md) |
| F4.1–F4.3 Playback | [0005](./adr/0005-streaming-qua-service-worker-http-range.md), [0004](./adr/0004-mo-hinh-da-luong.md) |
| Đưa nội dung vào kho (mới, ngoài PRD) | [0013](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md) |

## 6. Những chỗ tôi **cố ý làm khác PRD**

| PRD nói | Tài liệu này quyết | Lý do |
|---|---|---|
| F1.2: ghi đè (Edit Message) 1 file JSON trạng thái | **Append event log + snapshot compaction** | Ghi đè = Last-Write-Wins → mở 2 thiết bị là mất dữ liệu. Xem [ADR-0009](./adr/0009-dong-bo-state-event-log-va-snapshot.md) |
| Sơ đồ PRD: Service Worker tự "Pipe MTProto Chunks" | SW **không** giữ kết nối MTProto, chỉ proxy sang Core Worker | SW bị OS/trình duyệt kill bất kỳ lúc nào; giữ session MTProto trong đó là nguồn lỗi vô tận. Xem [ADR-0004](./adr/0004-mo-hinh-da-luong.md) |
| "IndexedDB (Local Cache lưu Metadata)" | Metadata cache **có TTL cho `file_reference`**, phải refresh trước khi phát | C5 — reference hết hạn thì link "chết giả". Xem [ADR-0007](./adr/0007-luu-tru-cuc-bo-indexeddb-dexie.md) |
| Dead-link UX chỉ xử lý "file bị xoá" | Phân biệt **3 trạng thái**: reference hết hạn (tự sửa), mất quyền truy cập, file bị xoá thật | Gộp cả 3 thành "đã xoá" sẽ khiến user tự tay gỡ phim còn sống khỏi bộ sưu tập |
| PRD không nói gì về việc đưa file vào kho | Thêm **Epic 5: Ingest** (CLI + bot + chế độ admin) | "Up xong không coi được" là kịch bản hỏng phổ biến nhất, và chỉ chặn được ở lúc upload. Xem [ADR-0013](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md) |
| F3 wireframe PRD: lưới thumbnail | Slice F3 ship **list ảo 1 cột, chỉ chữ** (title/năm/thể loại), không ảnh | Pipeline tải/stream file thuộc Epic 4 (Playback), chưa xây — không có gì để làm thumbnail từ đó. Grid ảo nhiều cột (CDK `cdkVirtualFor` là 1-D) để lại cho một lượt polish UI sau, không phải việc của F3 |
| ADR-0006: DC pool nhiều sender + AIMD + CDN redirect + circuit breaker | Slice F4 ship **1 sender/DC, tuần tự, không AIMD/CDN redirect/circuit breaker** trước; slice hardening sau đó ship **AIMD + circuit breaker + CDN redirect** (không phải pool nhiều sender vật lý — xem dưới) | Lúc F4 đóng, SPIKE-04 chưa chạy nên hardening bị hoãn để tránh đoán tham số. Sau khi SPIKE-04 đóng (2026-08-26, chấp nhận rủi ro — ~1.1 GB tải liên tục ở mức 4/8 không gặp `FLOOD_WAIT`), slice hardening (2026-08-26) đã ship: AIMD 2→4 (nâng cấp tối đa 8, chưa có Settings UI) mỗi DC trong `libs/core-download/src/download-engine.ts`; circuit breaker 3-lần-flood-liên-tiếp/DC; CDN redirect (AES-CTR qua WebCrypto native + xác minh SHA-256) trong `libs/core-mtproto/src/gateway-download.ts`. **Không** ship §2 (scheduler ưu tiên P0-P3 — cần tính năng prefetch đa video app chưa có). Phát hiện quan trọng khi xây: `floodSleepThreshold: 60` của GramJS đã tự chờ mọi FLOOD_WAIT ≤60s trước khi tầng download quan sát được — AIMD/circuit breaker chỉ phản ứng với flood ĐÃ vượt 60s, không phải "mọi FLOOD_WAIT" theo nghĩa đen của ADR-0006 §3 gốc. CDN redirect viết theo đặc tả TL, **chưa traffic-verified** (SPIKE-02 vẫn 0/250 lần gặp thật). Xem [ADR-0005](./adr/0005-streaming-qua-service-worker-http-range.md#cập-nhật-sau-khi-accepted-2026-08-26-slice-hardening--aimd)/[ADR-0006](./adr/0006-download-pipeline-dc-pool-flood-wait.md#cập-nhật-sau-khi-accepted-2026-08-26-slice-hardening--aimd--circuit-breaker--cdn-redirect) |

## 7. Rủi ro lớn nhất — trạng thái kiểm chứng

Toàn bộ 7 rủi ro dưới đây giờ đã có bằng chứng thực nghiệm hoặc quyết định rõ ràng — không còn giả thuyết treo. Bàn thử nghiệm nằm ở [docs/spikes/](./spikes/), chạy trên môi trường ở [ADR-0015](./adr/0015-moi-truong-kiem-thu-firebase-hosting.md). Dòng bị gạch ngang là rủi ro đã đóng (đã gỡ hoặc đã chấp nhận có chủ đích); dòng còn lại là rủi ro thường trực được giảm thiểu bằng thiết kế, không phải thứ một spike đơn lẻ có thể "xong".

| Rủi ro | Ảnh hưởng nếu đúng | Trạng thái |
|---|---|---|
| ~~Safari/WebKit có thể không cho `<video>` đi qua Service Worker~~ | ~~Toàn bộ Epic 4 chết trên iOS~~ | 🟢 **Đã gỡ** — [SPIKE-01](./spikes/README.md#spike-01) đạt trên iPad thật (WebKit) lẫn Chrome desktop, 2026-08-23. Còn lại: đưa 2 quan sát về de-dup request và không tin `end` của client vào scheduler thật ([ADR-0006](./adr/0006-download-pipeline-dc-pool-flood-wait.md)) |
| `CDN_REDIRECT` (`upload.getCdnFile`) yêu cầu AES-CTR + verify hash riêng | Một số file lớn không phát được | 🟡 **Spike đóng, code đã viết, vẫn chưa traffic-verified** — [SPIKE-02](./spikes/README.md#spike-02) (2026-08-23): đường tải chính ổn định tuyệt đối (250/250 chunk, file tới 962 MB), nhưng chưa từng gặp CDN_REDIRECT thật (kênh test không đủ đông người tải để kích hoạt). Slice hardening (2026-08-26) đã **triển khai** xử lý CDN_REDIRECT (AES-CTR qua WebCrypto + xác minh SHA-256 bắt buộc, `libs/core-mtproto/src/gateway-download.ts`) theo đúng đặc tả TL — nhưng vẫn CHƯA có traffic thật để kiểm chứng (không có cách chủ động kích hoạt mà không tạo tải giả lên hạ tầng Telegram, ngoài phạm vi). Xem [ADR-0006 addendum](./adr/0006-download-pipeline-dc-pool-flood-wait.md#cập-nhật-sau-khi-accepted-2026-08-26-slice-hardening--aimd--circuit-breaker--cdn-redirect) |
| Bundle GramJS + WASM crypto nặng | TTI kém trên mạng chậm | 🟢 [SPIKE-03](./spikes/README.md#spike-03) — **đã gỡ**: 236 KB brotli lúc nạp (không tính polyfill crypto, xem dưới), ~110 ms khởi tạo trong Chrome thật, dưới ngưỡng. Không cộng vào ngân sách app shell vì Core Worker lazy-load (ADR-0004) |
| GramJS tự nhận diện sai môi trường (Node/browser) khi chạy trong Worker | Kết nối MTProto vỡ hoàn toàn lúc `connect()` thật — SPIKE-03 chưa từng gọi `connect()` nên không lộ ra | 🟢 **Đã gỡ (2026-08-24, slice Auth F1.1)** — phát hiện + vá thật khi đăng nhập thật lần đầu (`randomBytes` vỡ, kết nối nhầm IP thô của DC). Vá bằng `browser-shim.ts`, verify lại bằng kết nối MTProto thật (credential giả). Core Worker sau vá nặng hơn: 422.9 KB brotli. Chi tiết ở [ADR-0003 § Cập nhật 2026-08-24](./adr/0003-chon-thu-vien-mtproto-gramjs.md#cập-nhật-sau-khi-accepted-2026-08-24-slice-auth-f11) |
| ~~Package `telegram` (GramJS) đã bị archive, ngừng bảo trì~~ | Không ai vá lỗi/theo kịp thay đổi giao thức Telegram về sau | 🟡 **Đã quyết (2026-08-23)** — giữ GramJS, ghim cứng `2.26.22`, chấp nhận rủi ro. Chi tiết ở [ADR-0003 § Cập nhật sau khi Accepted](./adr/0003-chon-thu-vien-mtproto-gramjs.md#cập-nhật-sau-khi-accepted-2026-08-23-spike-03) |
| Tài khoản user bị hạn chế do tải quá nhiều | Mất niềm tin, mất user | Giảm thiểu bằng thiết kế ([ADR-0006](./adr/0006-download-pipeline-dc-pool-flood-wait.md)) — AIMD + circuit breaker theo DC **đã triển khai** ở slice hardening (2026-08-26); 🟡 **SPIKE-04 đã đóng, chấp nhận rủi ro (2026-08-26)** — ~1.1 GB tải liên tục ở mức 4/8 request đồng thời (trần thật của sản phẩm), 0 lần gặp `FLOOD_WAIT` trên tài khoản test. Ngưỡng thật của Telegram chưa lộ ra (giống SPIKE-02), nhưng đủ bằng chứng cho use-case phát phim thật ở đúng mức sản phẩm dùng |
| ~~Ghi `catalog.json` lên kênh media qua MTProto (`sendFile`/`pinMessage`/`deleteMessages`) chưa từng chạy trên tài khoản thật~~ | ~~Ingest Editor (Màn hình 6) có thể pin sai/xoá nhầm metadata thật của Kho Cá Nhân user~~ | 🟢 **Đã gỡ (2026-08-28)** — [SPIKE-06](./spikes/README.md#spike-06): publish lần đầu, publish-cập-nhật (pin chuyển đúng, xoá bản cũ thật), đọc lại byte-chính-xác — cả 5 tiêu chí đạt trên tài khoản thật, kênh test tự sinh. Phạm vi bằng chứng: một lần chạy, kênh nhỏ/đơn publisher — chưa phủ catalog lớn hay `FLOOD_WAIT` giữa chuỗi ghi (thuộc [ADR-0006](./adr/0006-download-pipeline-dc-pool-flood-wait.md), không phải câu hỏi của spike này). Xem [ADR-0014 § Cập nhật 2026-08-28 (SPIKE-06)](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md) |
| ~~Forum Topics API của GramJS `2.26.22` chưa kiểm chứng trên tài khoản thật — quét lịch sử có phân biệt được message thuộc topic nào không~~ | ~~Nếu vỡ hoặc đắt RPC, không thể categorize phim theo topic (phim lẻ/phim bộ) như brainstorm đề xuất~~ | 🟢 **Đã gỡ (2026-08-29)** — [SPIKE-07](./spikes/README.md#spike-07): tạo nhóm forum, tạo topic, `GetForumTopics` liệt kê đúng, và quét lịch sử (`messages.getHistory`/`getMessages`, cùng RPC `scanHistoryItems()` đã dùng) suy ra đúng topic mỗi message thuộc về — `replyToTopId ?? replyToMsgId` khi `forumTopic`, **không cần RPC thêm mỗi message** (rẻ giống hashtag, không đắt như lo ngại ban đầu). 4 lần chạy trên tài khoản thật, 3 lần đầu là bug script (đã sửa, giữ lại trong SPIKE-07 làm bằng chứng "phép đo sai và vì sao sai"), lần cuối A-E đều đạt. Việc tiếp theo (addendum [ADR-0010](./adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md) + code `CatalogItemV1`/`IndexGateway` thật) chưa làm, xem `docs/roadmap.md` § Index/quét nguồn |
| API trình duyệt dùng để tự động hoá bước "probe" compat lúc ingest ([ADR-0013](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md) mục 3) có thể trả lời sai — WebCodecs/`MediaCapabilities` báo "giải mã được codec" chứ không phải "`<video src>` phát được file", và kiến trúc dùng progressive playback ([ADR-0005](./adr/0005-streaming-qua-service-worker-http-range.md)) chứ không phải MSE nên `MediaSource.isTypeSupported()` cũng có thể là API sai | Tự động hoá Ingest Editor (hiện vẫn là 3 radio button admin tự đoán, `apps/web/src/app/metadata-editor/metadata-editor.html`) bằng API sai sẽ báo compat sai **có hệ thống** — tệ hơn giữ nguyên thao tác thủ công, vì admin sẽ tin nhầm vào một con số tưởng là đo được | ⏳ **Chưa kiểm chứng** — [SPIKE-08](./spikes/README.md#spike-08) mở, chưa dựng tool |
