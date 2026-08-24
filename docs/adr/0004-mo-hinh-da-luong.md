# ADR-0004: Mô hình đa luồng — Main / Core Worker / Service Worker

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0003](./0003-chon-thu-vien-mtproto-gramjs.md), [ADR-0005](./0005-streaming-qua-service-worker-http-range.md)
- **Ghi chú:** ADR này **thay đổi** sơ đồ trong PRD mục 1.

## Bối cảnh

PRD vẽ Service Worker như nơi "Pipe MTProto Chunks". Nếu hiểu theo nghĩa đen — SW tự giữ kết nối MTProto — ta gặp ba vấn đề nghiêm trọng:

1. **Vòng đời SW không do ta kiểm soát.** Trình duyệt có thể kill SW bất kỳ lúc nào nó rảnh (thường khoảng 30 giây idle). Một session MTProto bị cắt giữa chừng đồng nghĩa phải bắt tay lại từ đầu, kéo theo handshake `auth_key` và độ trễ vài giây ngay giữa lúc user đang tua.
2. **SW dùng chung cho mọi tab.** Hai tab cùng phát phim sẽ tranh nhau một client MTProto không có chủ.
3. **Không có DOM/UI trong SW** → mọi luồng cần tương tác user (nhập OTP, mật khẩu 2FA, hiện lỗi FLOOD_WAIT) đều phải bắc cầu ngược lại tab.

Mặt khác, giải mã AES-IGE cho luồng video 4K là công việc CPU nặng và liên tục — chạy trên main thread sẽ làm giật cả UI lẫn playback.

## Quyết định

Ba ngữ cảnh thực thi, phân vai rạch ròi:

### 1. Main thread — chỉ UI
Angular, router, player, DOM. **Không** thực hiện I/O mạng, **không** đụng vào crypto.

### 2. Core Worker (Dedicated Worker, thuộc sở hữu của tab) — "bộ não"
- Instance GramJS **duy nhất** trong toàn ứng dụng.
- Download scheduler và connection pool ([ADR-0006](./0006-download-pipeline-dc-pool-flood-wait.md)).
- **Writer duy nhất** của IndexedDB ([ADR-0007](./0007-luu-tru-cuc-bo-indexeddb-dexie.md)).
- Chỉ mục tìm kiếm ([ADR-0008](./0008-tim-kiem-client-side-minisearch.md)) và Sync Engine ([ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md)).
- Giao tiếp với Main thread bằng **Comlink** (RPC kiểu proxy, đỡ phải tự viết state machine cho postMessage).

### 3. Service Worker — proxy giao thức mỏng, **không giữ trạng thái nghiệp vụ**
- Chặn `fetch` của các URL `/_stream/*`, hỏi Core Worker qua `MessageChannel`, trả `206 Partial Content`.
- Quản lý LRU chunk cache trong Cache Storage.
- Ngoài ra: precache app shell (Workbox).
- **Bất biến: SW không bao giờ mở kết nối tới Telegram.** Nếu không tìm thấy client nào đang sống, SW trả `503` kèm mã lỗi để player hiện thông báo "hãy mở lại tab".

### Nhiều tab
Tab nào cũng có Core Worker riêng, nhưng chỉ **một tab giữ vai leader** cho các tác vụ ghi (index, sync) — bầu chọn qua Web Locks (`navigator.locks.request` với khoá `tsmc-leader`). Tab thường vẫn phát video được (đọc, tải chunk), chỉ không được ghi. Điều này ngăn hai tab cùng append event log và cùng nén snapshot.

## Các phương án đã loại

| Phương án | Vì sao loại |
|---|---|
| MTProto ngay trong Service Worker | Vòng đời không kiểm soát được; chia sẻ giữa tab tạo tranh chấp; không tương tác được với user |
| MTProto trên Main thread | Jank UI khi giải mã; thêm vấn đề timer bị throttle khi tab ở background |
| SharedWorker giữ một client cho mọi tab | Hấp dẫn về lý thuyết (chia sẻ kết nối, tiết kiệm handshake) nhưng Safari hỗ trợ kém và không ổn định, lại rất khó debug. Giữ như *tối ưu tương lai*, không phải nền tảng. |

## Hệ quả

**Tích cực**
- Kết nối MTProto sống đúng bằng vòng đời tab — dễ suy luận, dễ dọn dẹp.
- Chunk truyền bằng ArrayBuffer **transferable** → zero-copy giữa Core Worker, SW và response stream.
- UI không bao giờ chạm dữ liệu nhị phân.

**Tiêu cực / phải chấp nhận**
- Đóng tab là dừng phát. Chấp nhận được: đây là web app, không phải trình tải nền.
- SW phải tự tìm client: dùng `clients.matchAll()`, ưu tiên client cùng `resultingClientId` với request; nếu có nhiều tab thì chọn tab đang phát. Cần heartbeat để phát hiện tab chết.
- Debug xuyên ba ngữ cảnh rất khó → bắt buộc có **correlation id** trong mọi message và một trang `#/debug` hiển thị log gộp. Đây là hạng mục hạ tầng, không phải "nice to have".

## Cập nhật sau khi Accepted (2026-08-24, slice Sync F1.2/F1.3)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

"Mỗi tab có Core Worker riêng" (bất biến đúng) ngầm giả định thêm một điều ADR này chưa nói rõ: **cũng chỉ một Core Worker cho mỗi tab**, không phải một Core Worker cho mỗi *component* trong tab. `libs/worker-host/src/index.ts` ban đầu không enforce điều này — `createCoreWorkerClient()` tạo một `Worker` mới ở MỖI lần gọi. Khi slice Sync thêm component thứ hai (`SyncStatus`, bên cạnh `Login`) cũng tự gọi hàm này, kết quả là **hai Core Worker độc lập trong cùng một tab**: một cái đã đăng nhập + `initSync()` (từ `Login`), một cái hoàn toàn trống (từ `SyncStatus`) — RPC ghi gọi vào cái trống thất bại âm thầm (chi tiết ở [ADR-0009 § Cập nhật](./0009-dong-bo-state-event-log-va-snapshot.md#cập-nhật-sau-khi-accepted-2026-08-24-slice-sync-f12f13)).

Đã vá: `createCoreWorkerClient()` giờ là singleton cấp module (`client ??= Comlink.wrap(...)`), có test regression xác nhận nhiều lời gọi chỉ tạo đúng một `Worker`. Bài học cho các slice sau: bất kỳ component Angular nào cần nói chuyện với Core Worker phải gọi `createCoreWorkerClient()` — **không** tự giữ instance riêng hay tự `new Worker(...)`.
