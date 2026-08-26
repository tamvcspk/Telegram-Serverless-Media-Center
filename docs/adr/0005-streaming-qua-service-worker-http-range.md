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

## Cập nhật sau khi Accepted (2026-08-26, slice Playback F4 — vertical slice tối thiểu)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

Slice này ship **phần lõi tối thiểu** của thiết kế trên (đã người dùng xác nhận: phát được video thật, tài khoản thật, Windows Chrome) — **KHÔNG** làm AIMD/đa kết nối/CDN redirect/circuit breaker FLOOD_WAIT theo DC (phần còn lại của [ADR-0006](./0006-download-pipeline-dc-pool-flood-wait.md); SPIKE-04 đo tốc độ thật với 2/4/8 kết nối song song vẫn **chưa chạy**). Cửa sổ 1 MB (không phải 4 MB) — 1 kết nối tuần tự thì cửa sổ nhỏ hơn giảm độ trễ byte-đầu-tiên; cần đo lại khi có AIMD.

Ba lỗi thật phát hiện lúc verify trên thiết bị thật, xếp theo thứ tự lộ ra (mỗi lỗi cho triệu chứng gần như giống hệt: video không phát, im lặng hoặc lỗi mơ hồ):

1. **Content-Type sai vì lấy từ catalog thay vì Telegram.** `catalog-spec.md` không lưu `mimeType` gốc của document (chỉ có `video.codec`, một trường khác hẳn) — hardcode `Content-Type: video/mp4` khiến trình duyệt từ chối phát (`MEDIA_ERR_SRC_NOT_SUPPORTED`) với file không phải mp4, DÙ tải bytes đúng. Đã vá: thêm RPC `getStreamInfo(sourceId, msgId)` — Core Worker trả `size`/`mimeType` THẬT lấy trực tiếp từ `Api.Document` (dữ liệu này vốn đã có sẵn lúc `getPlaybackDocument()`, chỉ chưa từng được đưa ra ngoài) qua cùng cơ chế MessageChannel với chunk. Đánh đổi: mất tính "không cần chạm mạng" nêu ở bảng giao thức trên cho phần metadata — chấp nhận được, vẫn rẻ hơn nhiều so với tải chunk.
2. **200 với `Content-Length` > 0 nhưng body rỗng cho `GET` không kèm `Range`.** Bảng giao thức gốc ghi "HEAD, hoặc GET không kèm Range → 200 + Content-Length" — hiểu nhầm thành `new Response(null, {headers:{Content-Length}})` cho CẢ HAI. Với `HEAD` thì đúng (HTTP cấm body). Với `GET` thường thì SAI: hứa hẹn N byte nhưng không đưa byte nào, `<video>` phát hiện ngay và báo lỗi mà chưa kịp xin thêm dữ liệu — im lặng hoàn toàn phía server, không exception nào lộ ra. Đã vá: chỉ `HEAD` mới được body rỗng; `GET` không kèm `Range` coi như `bytes=0-`, luôn trả `206` kèm dữ liệu thật khớp `Content-Length`.
3. **Ép mọi response về đúng `WINDOW_SIZE`, bỏ qua `end` trình duyệt yêu cầu — làm hỏng khả năng tự dò `moov` của trình duyệt với file thiếu `+faststart`.** Gặp thật: một file MP4 có `mdat` (dữ liệu) ngay sau `ftyp`, chiếm gần trọn file — nghĩa là bảng `moov` (track/codec) nằm Ở CUỐI file. Trình duyệt bình thường sẽ tự dò: gửi probe nhỏ (SPIKE-01 đã ghi WebKit dùng `bytes=0-1`) để biết tổng dung lượng, rồi tự quyết định có cần xin thêm range ở cuối file hay không. Server luôn trả đủ 1 MB bất kể probe hỏi bao nhiêu byte làm hỏng chiến lược dò đó — trình duyệt chỉ nhận ĐÚNG MỘT chunk (offset 0) rồi báo lỗi ngay, không hề thử xin thêm. Đã vá: đọc cả `end` tường minh trong header `Range` (không chỉ `start` như trước); nếu trình duyệt hỏi ít hơn cửa sổ, trả ĐÚNG phần đã hỏi (vẫn tải đủ một cửa sổ `SUB_CHUNK_SIZE`-aligned từ Core Worker nội bộ — Telegram không cho tải ít hơn — nhưng chỉ SERVE đúng phần trình duyệt cần). Không mâu thuẫn với "không tin `end` của client vào scheduler thật" đã ghi ở bảng trên: cửa sổ nội bộ vẫn bị chặn trần ở `WINDOW_SIZE`, chỉ là không còn ÉP một `end` nhỏ hơn phồng lên bằng trần đó.

Sau khi vá cả ba, phát video thật thành công trên Windows Chrome (file có `moov` cuối file, không `+faststart`) — xác nhận trình duyệt tự dò/seek tới cuối file đúng như kỳ vọng khi server không còn "nói dối" về kích thước dữ liệu trả về.

**Giới hạn đã biết, để lại cho slice sau (không phải bug):**
- Không AIMD/đa kết nối/CDN redirect/circuit breaker FLOOD_WAIT theo DC — chờ SPIKE-04.
- Huỷ khi seek chỉ chặn round-trip MỚI ở Core Worker, không abort round-trip đang bay (`event.request.signal` abort chỉ gửi tín hiệu best-effort qua bridge).
- Cache chunk (Cache Storage) không có LRU chủ động — dựa vào eviction tự nhiên của trình duyệt.
- Cache key rút gọn `{sourceId}:{msgId}/{offset}` thay vì hash `access_hash` như bảng trên đề xuất — đủ ổn định cho slice này (id/access_hash không đổi dù `file_reference` hết hạn).
- Chưa verify trên iOS/Safari thật với code thật của slice này (SPIKE-01 xác nhận cơ chế SW-passthrough hoạt động trên iPadOS, nhưng bằng code spike đã xoá — không phải code này).

## Cập nhật sau khi Accepted (2026-08-26, slice hardening — AIMD)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

Đóng lại flag "cần đo lại khi có AIMD" ở addendum slice F4 phía trên: `WINDOW_SIZE` ở `sw/sw.ts` đổi từ `2 × SUB_CHUNK_SIZE` (1 MB) lên `8 × SUB_CHUNK_SIZE` (4 MB) — đúng bằng đề xuất gốc của Quyết định trên ("mặc định 4 MB").

Lý do: [ADR-0006 addendum "slice hardening"](./0006-download-pipeline-dc-pool-flood-wait.md#cập-nhật-sau-khi-accepted-2026-08-26-slice-hardening--aimd--circuit-breaker--cdn-redirect) vừa ship AIMD — cửa sổ 1 MB cũ chỉ đủ 2 sub-chunk 512 KB, trong khi AIMD ramp tới trần mặc định 4 (hay trần nâng cấp 8) sẽ không còn gì để tận dụng nếu cửa sổ không đủ lớn. 4 MB (8 sub-chunk) cho đủ chỗ để độ song song thật sự phát huy tác dụng ở cả hai trần.

Chưa đo lại độ trễ byte-đầu-tiên với cửa sổ 4 MB + AIMD trên thiết bị thật (cùng giới hạn "chưa verify trên iOS/Safari thật với code thật của slice này" đã ghi ở trên) — số liệu duy nhất có được là `npm run build:web`/`test:libs` pass, không phải benchmark thời gian mở phim thật.
