# ADR-0005: Streaming qua Service Worker + HTTP Range

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0004](./0004-mo-hinh-da-luong.md), [ADR-0006](./0006-download-pipeline-dc-pool-flood-wait.md)

## Bối cảnh

Thẻ `<video>` chỉ biết nói HTTP. Telegram chỉ biết nói MTProto. Toàn bộ Epic 4 nằm ở chỗ nối hai thứ đó lại mà vẫn cho phép **tua tới bất kỳ đâu trong vài trăm mili giây**.

Ràng buộc của `upload.getFile` (xem [architecture.md](../architecture.md), mục C3): `limit` chia hết cho 4096, `offset` chia hết cho 4096, `limit` là ước của 1 MB, và khoảng `[offset, offset+limit)` không được vắt qua ranh giới 1 MB.

## Các phương án

### A. Tải toàn bộ file rồi `URL.createObjectURL(blob)`
- Đơn giản, chạy trên mọi trình duyệt.
- Phim 4K 20 GB thì không khả thi: muốn xem phút thứ 90 phải tải 90 phút đầu.
- → Giữ làm **fallback duy nhất** cho file nhỏ (dưới 200 MB) khi SW không dùng được.

### B. Media Source Extensions (MSE), tự nạp buffer
- Không cần Service Worker.
- MSE **chỉ nhận fMP4 hoặc WebM**. Kho phim cộng đồng đầy MKV/AVI/MP4 non-fragmented → phải remux bằng WASM trên client. Đó là một dự án riêng, và vẫn chết với codec mà trình duyệt không giải được trong MSE.

### C. Service Worker giả lập một HTTP origin (**được chọn**)
Player trỏ vào `/_stream/{sourceId}/{messageId}`; SW trả `206` kèm `Content-Range`. Bộ demux gốc của trình duyệt làm phần còn lại, nên mọi container mà trình duyệt hỗ trợ đều chạy được.

## Quyết định

Chọn **C**, giữ **A** làm fallback có kiểm soát.

### Giao thức đáp ứng

| Yêu cầu từ player | Đáp ứng của SW |
|---|---|
| `HEAD`, hoặc `GET` không kèm `Range` | `200` + `Accept-Ranges: bytes` + `Content-Length` (lấy từ DocumentAttribute trong metadata, không cần chạm mạng) |
| `Range: bytes=0-` | `206`, phục vụ **một cửa sổ giới hạn** (mặc định 4 MB), `Content-Range: bytes 0-4194303/{size}` |
| `Range: bytes=N-` (tua) | Huỷ mọi chunk đang bay của request cũ, mở cửa sổ mới tại `N` |

**Trả cửa sổ giới hạn thay vì cả file là quyết định có chủ đích**: nó biến `<video>` thành bộ điều tiết tự nhiên (player tự xin range tiếp khi cần), giúp ta không tải trước hàng GB dữ liệu user sẽ không xem, và làm việc huỷ khi seek trở nên đơn giản.

### Đường đi của một byte

```text
video seek  →  Range: bytes=734003200-
   →  SW: chuẩn hoá offset về lưới 1 MB / 512 KB
   →  Core Worker: xếp hàng các chunk đã aligned, tải song song (ADR-0006)
   →  chunk về không đúng thứ tự  →  reorder buffer  →  enqueue tuần tự vào ReadableStream
   →  206 Partial Content
```

### Cache chunk
- Cache Storage, key dạng `/_chunk/{fileId}/{offset}`. `fileId` là hash ổn định của `id` + `access_hash`, **không** chứa `file_reference` — vì reference hết hạn (xem [ADR-0007](./0007-luu-tru-cuc-bo-indexeddb-dexie.md)), đưa nó vào key sẽ khiến cache hit rate về gần 0.
- LRU có trần, mặc định là giá trị nhỏ hơn giữa 2 GB và 30% quota báo bởi `navigator.storage.estimate()`.
- Ưu tiên giữ chunk **đầu file** (moov/metadata cùng vài giây đầu) → mở lại phim là phát ngay.

### Huỷ đúng cách
Khi player abort request, SW nhận `signal.aborted` và báo Core Worker huỷ các chunk chưa xong. Không làm việc này thì mỗi lần user tua 5 lần liên tiếp sẽ để lại 5 pipeline chạy nền, ăn hết connection pool và kích hoạt `FLOOD_WAIT`.

## Hệ quả

**Tích cực**: tua mượt; hỗ trợ mọi container trình duyệt phát được; phụ đề và audio track do player gốc lo.

**Tiêu cực / phải chấp nhận**
- Phụ thuộc HTTPS và Service Worker → không chạy trong Firefox Private Mode.
- **Rủi ro Safari/iOS (Spike #1, ưu tiên cao nhất):** WebKit có lịch sử để media element bỏ qua Service Worker. Phải kiểm chứng trên thiết bị thật *trước khi* xây phần còn lại của Epic 4. Nếu thất bại, iOS chỉ còn fallback A (file nhỏ), và điều đó phải được ghi rõ trong README chứ không để user tự phát hiện.
- SW có thể bị kill giữa lúc stream: giữ nó sống bằng cách luôn có promise chưa resolve trong `respondWith` và ping định kỳ từ tab.
- Không hỗ trợ DRM — nằm ngoài phạm vi dự án.
