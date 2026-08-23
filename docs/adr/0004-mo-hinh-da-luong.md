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
