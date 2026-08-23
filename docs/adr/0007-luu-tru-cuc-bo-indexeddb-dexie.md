# ADR-0007: Lưu trữ cục bộ — IndexedDB qua Dexie, và vòng đời `file_reference`

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0004](./0004-mo-hinh-da-luong.md), [ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md), [ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md)

## Bối cảnh

Local-first nghĩa là IndexedDB là **nguồn sự thật lúc chạy**; Telegram là nơi sao lưu bền vững. Cần một schema chịu được:
- vài chục nghìn item metadata,
- migration khi user *không thể* được hỗ trợ từ xa ([ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md)),
- và một sự thật khó chịu: **`file_reference` hết hạn sau vài chục phút**, trong khi metadata thì cần cache hàng tháng.

## Quyết định

### Thư viện: Dexie
IndexedDB thuần có API dựa trên sự kiện, rất dễ viết sai transaction. Dexie cho query có typing, migration khai báo, `liveQuery`, và hook nâng cấp phiên bản — đúng ba thứ dự án cần. `idb` (của Jake Archibald) nhẹ hơn nhưng không có tầng migration khai báo, mà migration lại là điểm rủi ro cao nhất khi không có backend để sửa dữ liệu hỏng.

### Phân tách theo tuổi thọ dữ liệu — điểm cốt lõi của ADR này

Cột "Tầng dữ liệu" dưới đây theo đúng phân loại ở [architecture.md § 3](../architecture.md#3-hai-tầng-dữ-liệu--state-riêng-tư-và-metadata-toàn-cục): store nào giữ **state riêng tư** thì đồng bộ qua kênh state ([ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md)); store nào giữ **metadata toàn cục** thì chỉ là cache của `catalog.json`, không bao giờ đẩy lên kênh state.

| Store | Nội dung | Tầng dữ liệu | Tuổi thọ | Đồng bộ lên Telegram? |
|---|---|---|---|---|
| `sources` | Channel/group user đã chọn theo dõi, loại kênh (cá nhân/cộng đồng — xem [ADR-0014](./0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)), con trỏ index | State riêng tư | Lâu dài | Có (→ kênh state) |
| `media` | Metadata phim: tiêu đề, năm, thể loại, kích thước, thời lượng, `messageId`, `dcId`, poster ref | **Metadata toàn cục** | Lâu dài | Không — nguồn thật là `catalog.json` ở kênh media, đây chỉ là cache (index lại được) |
| `fileRefs` | `file_reference` + `fetchedAt` | Cache kỹ thuật, không thuộc tầng nào | **Phù du, TTL 30 phút** | Không |
| `progress` | Mốc thời gian xem, đã xem xong | State riêng tư | Lâu dài | Có (→ kênh state) |
| `collections` | Bộ sưu tập của user, dạng danh sách tham chiếu ID | State riêng tư | Lâu dài | Có (→ kênh state) |
| `outbox` | Event chưa đẩy lên kênh state | State riêng tư (hàng đợi ghi) | Tới khi ACK | Là nguồn của sync |
| `searchIndex` | Chỉ mục MiniSearch đã serialize, dựng từ `media` | Cache, dựng lại được | Cache, dựng lại được | Không |

**Tách `fileRefs` ra khỏi `media` là quyết định trọng tâm.** Nếu nhét reference vào bản ghi phim, mọi lần refresh sẽ ghi đè cả object phim (tốn kém, gây `liveQuery` bắn lại toàn danh sách), và tệ hơn là làm lẫn lộn hai khái niệm hoàn toàn khác nhau: "phim này có tồn tại không" với "tôi có vé tải hợp lệ ngay lúc này không".

### Ba trạng thái tồn tại của một phim
Trực tiếp phục vụ Dead Link UX trong PRD mục 4.2, vốn chỉ mô tả có một trạng thái:

| Trạng thái | Cách phát hiện | UI |
|---|---|---|
| `OK` | Lấy được reference | Bình thường |
| `STALE_REF` | `FILE_REF_EXPIRED` | **Không có UI** — tự làm mới trong nền ([ADR-0006](./0006-download-pipeline-dc-pool-flood-wait.md)) |
| `NO_ACCESS` | `CHANNEL_PRIVATE`, bị kick khỏi kênh | Làm mờ + "Bạn không còn quyền truy cập nguồn này" + nút Tham gia lại |
| `DELETED` | `messages.getMessages` trả `messageEmpty` | Làm mờ + "Nguồn chia sẻ đã xoá tệp tin này" + nút Gỡ khỏi bộ sưu tập |

Gộp ba thứ này thành một sẽ dẫn user tới chỗ tự tay xoá những phim vẫn còn sống — mất dữ liệu do lỗi thiết kế UX.

### Quy tắc ghi
- **Chỉ Core Worker của tab leader được ghi** ([ADR-0004](./0004-mo-hinh-da-luong.md)). UI ghi bằng cách gọi RPC, không bao giờ mở DB để ghi.
- UI đọc qua `liveQuery` → `toSignal()`.
- Ghi hàng loạt khi index: gom lô 500 bản ghi trong một transaction; ghi từng bản một sẽ khiến quá trình index một kênh 20k file mất hàng phút.

### Migration
- Mọi migration là **thuần tiến** và **idempotent**, khai báo qua `db.version(n).stores(...).upgrade(...)`.
- Trước migration lớn, dump snapshot dữ liệu do user tạo (collections, progress) ra một message trong state channel — mạng lưới sao lưu cuối cùng, vì không ai có thể sửa giúp user từ xa.
- Nếu phát hiện DB version cao hơn code (user vừa mở bản cũ hơn): **từ chối ghi**, hiện thông báo yêu cầu tải lại. Ghi ngược version là con đường ngắn nhất tới hỏng dữ liệu.

### Hạn mức lưu trữ
Gọi `navigator.storage.persist()` sau khi user hoàn tất onboarding (lúc này lời xin quyền mới có ngữ cảnh hợp lý). Hiển thị dung lượng đã dùng trong Cài đặt kèm nút xoá cache chunk — chunk cache ([ADR-0005](./0005-streaming-qua-service-worker-http-range.md)) là thứ chiếm chỗ nhiều nhất và cũng là thứ vứt đi vô hại nhất.

## Hệ quả

**Tích cực**: đọc nhanh, offline-capable với metadata; ranh giới rõ giữa dữ liệu dựng lại được và dữ liệu không thể mất.

**Tiêu cực / phải chấp nhận**
- Safari có thể xoá IndexedDB sau 7 ngày không tương tác nếu chưa được cấp `persist` → càng phải chắc rằng dữ liệu do user tạo luôn có bản trên Telegram ([ADR-0009](./0009-dong-bo-state-event-log-va-snapshot.md)). Metadata mất thì index lại; bộ sưu tập mất thì không có gì cứu.
- Test migration cần một bộ fixture các phiên bản DB cũ; phải làm ngay từ v1 chứ không phải khi đã có v4.
