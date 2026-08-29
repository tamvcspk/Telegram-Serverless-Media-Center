# ADR-0013: Bot đồng hành và pipeline ingest / chuẩn hoá media

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md), [ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md), [ADR-0014](./0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)

## Bối cảnh

Kịch bản hỏng phổ biến nhất của một media center kiểu này không nằm ở lúc phát, mà ở lúc **đưa file vào kho**:

- User up một bản "4K remux" `.mkv` + HEVC + DTS-HD → **trình duyệt không phát được**, dù file hoàn toàn nguyên vẹn. User đã tốn hàng chục GB băng thông upload để nhận về một ô phim làm mờ.
- User up MP4 nhưng `moov` atom nằm cuối file → player phải lấy đuôi file trước khi phát được một khung hình, làm hỏng trải nghiệm khởi động nhanh mà [ADR-0005](./0005-streaming-qua-service-worker-http-range.md) hứa hẹn.
- Phụ đề nằm nhúng trong MKV dạng PGS (ảnh) → không rút ra được thành `.srt`/`.vtt`.
- Metadata rác (tên file kiểu `[Group].Movie.2024.2160p.WEB-DL.x265-XXX.mkv`) → catalog không có tiêu đề, năm, thể loại nào dùng được.

Nói ngắn gọn: **khả năng phát được là thuộc tính của lúc upload, không phải lúc xem.** Đến lúc xem thì đã quá muộn.

### Sự thật kỹ thuật ràng buộc thiết kế

| Ràng buộc | Con số |
|---|---|
| Bot API (cloud) gửi file | **tối đa 50 MB** |
| Bot API (cloud) tải file về (`getFile`) | **tối đa 20 MB** |
| Bot API tự host (local server) | tới 2000 MB |
| MTProto (tài khoản user) | 2 GB/file, 4 GB nếu Premium |

**Hệ quả trực tiếp: một bot Telegram thông thường KHÔNG THỂ upload phim.** Bất kỳ thiết kế nào đặt việc upload media vào tay Bot API cloud đều sai ngay từ tiền đề. Đây là điểm dễ sa lầy nhất của yêu cầu "làm một con bot để up cho nhanh".

## Quyết định

Tách làm **ba thành phần**, mỗi thứ làm đúng việc mà giới hạn kỹ thuật cho phép:

### 1. `tsmc-ingest` — CLI chạy trên máy admin (nơi upload thật sự diễn ra)
Node + `ffprobe`/`ffmpeg` cục bộ, đăng nhập bằng **tài khoản MTProto của admin** (không phải bot, vì giới hạn 50 MB).

Pipeline cho mỗi file:
```text
probe → phân hạng tương thích → (remux/chuyển audio nếu cần)
      → rút phụ đề → sinh thumbnail → upload → sinh entry catalog
```

**Bảng phân hạng tương thích** — trái tim của ADR này:

| Hạng | Điều kiện | Hành động |
|---|---|---|
| 🟢 **A** | MP4/MOV + H.264 + AAC + `faststart` | Upload thẳng |
| 🟡 **B** | MP4 + HEVC/AV1, hoặc audio Opus/E-AC-3 | Upload, **đánh dấu `compat: "partial"`** trong catalog; app cảnh báo "có thể không phát được trên trình duyệt này" |
| 🟠 **C** | MKV/TS + H.264/HEVC, audio DTS/TrueHD/PGS subs | **Remux** sang MP4 (copy video, encode audio sang AAC ~5 phút/phim, rẻ), rút subs ra file rời |
| 🔴 **D** | AVI, VC-1, RealVideo, video codec trình duyệt không giải được | Cần **re-encode video** — đắt. CLI báo thời lượng ước tính và **bắt admin xác nhận**, không tự chạy |

Nguyên tắc: **remux (copy stream) là mặc định, re-encode video luôn phải hỏi.** Remux 20 GB mất vài phút và không mất chất lượng; re-encode mất hàng giờ và mất chất lượng — không được lặng lẽ làm thay user.

Ngoài ra CLI luôn: bật `+faststart`, ghi `DocumentAttributeVideo(w, h, duration, supportsStreaming=true)`, đính thumbnail, và parse tên file thành metadata rồi cho admin sửa trước khi đăng.

### 2. `@tsmc_bot` — bot Telegram, admin của kênh
Bot **không** đụng vào media lớn. Việc của nó:

- **Cổng lệnh onboarding**: `/setup` tạo/kiểm tra cấu hình kênh, `/publish` sinh và ghim `catalog.json` ([ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md) — catalog nhỏ, dưới 50 MB, bot đăng được thoải mái), `/check` báo cáo tình trạng kho.
- **Danh tính publisher đáng tin**: catalog do bot đăng thoả mãn mô hình tin cậy ở [ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md) mà không cần admin nào tự tay đăng file.
- **Kiểm tra nông, hậu kiểm, miễn phí**: mỗi khi có file mới vào kênh, bot nhận update chứa `mime_type`, `file_size`, `duration`, `w`, `h` — **không cần tải file** — nên phát hiện được ngay các dấu hiệu đỏ (`video/x-matroska`, thiếu `supports_streaming`, thiếu thumbnail, thiếu duration) và **trả lời ngay dưới message đó**: "File này nhiều khả năng không phát được trên web, chạy `tsmc-ingest fix` trước khi đăng."
- **Nhắc phụ đề và poster** còn thiếu.

Bot là **tuỳ chọn, do admin kênh tự host** (Cloud Run scale-to-zero, hoặc chạy long-polling trên máy admin). Nó nằm ở phía **tác giả nội dung**, không nằm trong đường chạy của người xem — nên không vi phạm [ADR-0001](./0001-kien-truc-client-heavy-khong-backend.md). Người xem vẫn dùng app được với kênh không có bot.

### 3. Chế độ Admin trong web app — lối vào không cần cài gì
Với người chỉ up vài phim lẻ, bắt cài Node + ffmpeg là rào cản quá lớn. Web app có màn hình "Thêm phim vào kho cá nhân":

- Kéo thả file → **probe ngay trong trình duyệt** (đọc header container, không cần đọc hết file) → hiện ngay phân hạng A/B/C/D **trước khi tốn một byte upload nào**.
- Hạng A: upload thẳng qua MTProto.
- Hạng C nhẹ (dưới ~4 GB): remux bằng `ffmpeg.wasm` (chỉ copy stream + encode audio), có thanh tiến trình.
- Hạng D hoặc file rất lớn: từ chối và chỉ sang `tsmc-ingest`, kèm dòng lệnh sẵn để copy.

Phần probe là thứ **bắt buộc phải có ngay từ v1**; phần remux trong trình duyệt có thể lùi sang sau. Chỉ riêng việc chặn trước một lần upload 20 GB vô ích đã đủ trả giá cho tính năng này.

## Các phương án đã loại

| Phương án | Vì sao loại |
|---|---|
| Bot API cloud làm nơi upload media | Trần 50 MB — bất khả thi về mặt vật lý |
| Bot API tự host (2 GB) làm nơi upload | Bắt admin dựng và duy trì một server; MTProto từ máy admin cho kết quả tương đương mà không cần hạ tầng |
| Transcode phía server cho tất cả | Cần GPU/CPU thật, phá vỡ mô hình chi phí 0, và biến maintainer thành nơi trung chuyển nội dung có bản quyền |
| Không làm gì, để user tự lo | Chính là kịch bản "up xong không coi được" mà ADR này sinh ra để chặn |

## Hệ quả

**Tích cực**
- Vấn đề tương thích được bắt ở nơi duy nhất còn sửa được: **trước khi upload**.
- Kho nội dung tự nâng chất lượng theo thời gian; catalog có trường `compat` để app cảnh báo trung thực thay vì để user gặp màn hình đen.
- Onboarding admin kênh rút xuống còn: mời bot làm admin → `/setup` → `/publish`.

**Tiêu cực / phải chấp nhận**
- Thêm hai artifact phải bảo trì (CLI và bot) ngoài web app. Cần đặt chúng cùng repo để phiên bản catalog spec không bao giờ lệch nhau.
- `ffmpeg.wasm` nặng (vài chục MB) → **lazy-load, chỉ tải khi user thật sự vào chế độ Admin**, không bao giờ nằm trong bundle chính.
- CSP ở [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md) cần `'wasm-unsafe-eval'` (đã có) và `worker-src 'self' blob:` cho `ffmpeg.wasm` — phải bổ sung khi triển khai tính năng này.
- Bot cần token lưu ở phía admin; tuyệt đối không đưa token bot vào web app.

## Cập nhật sau khi Accepted (2026-08-29, brainstorm compat detection)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định
> đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết
> định gốc **vẫn đứng vững**, xem lý do bên dưới.

**Hiện trạng thật của bước "probe ngay trong trình duyệt" (mục 3):** chưa được xây. Ingest Editor (Màn hình 6, `apps/web/src/app/metadata-editor/metadata-editor.ts`) hiện chỉ có 3 radio button (`Full`/`Partial`/`Unplayable`) do admin **tự đoán bằng mắt** rồi ghi thẳng vào `compat` — không có bất kỳ probe container/codec thật nào chạy. `tsmc-ingest` CLI (ffprobe-based, mục 1 của Quyết định) cũng chưa tồn tại trong repo.

**Câu hỏi mới phát sinh khi bàn cách tự động hoá bước probe đó:** dùng API trình duyệt nào để dò khả năng phát là đúng? Có ba ứng viên (`HTMLVideoElement.canPlayType()`, `MediaSource.isTypeSupported()`, WebCodecs `VideoDecoder.isConfigSupported()`/`MediaCapabilities.decodingInfo()`) và rủi ro cụ thể: WebCodecs trả lời "thiết bị giải mã được codec", không phải "`<video>` phát được file" — và vì kiến trúc dùng progressive playback ([ADR-0005](./0005-streaming-qua-service-worker-http-range.md), không dùng `MediaSource`/`appendBuffer`), ngay cả `MediaSource.isTypeSupported()` — lựa chọn hay bị dùng mặc định — cũng có thể là API sai cho đúng đường phát thật của TSMC. Đây **chưa phải kết luận** — chỉ là giả thuyết mở [SPIKE-08](../spikes/README.md#spike-08), chưa có số liệu thiết bị thật.

**Điều gì KHÔNG đổi:** bảng phân hạng A/B/C/D ở mục 1 (điều kiện container/codec quyết định hạng) vẫn đứng nguyên — SPIKE-08 chỉ nhắm tới việc chọn đúng *cơ chế đo* cho bước probe trình duyệt ở mục 3, không đổi *tiêu chí phân hạng*. Quy tắc "MKV/container lạ luôn Hạng C/D bất kể codec bên trong" cũng không đổi trừ khi SPIKE-08 phát hiện bằng chứng ngược lại.

**Việc tiếp theo:** sau khi SPIKE-08 có số liệu thật, viết addendum kế tiếp chỉ định rõ API dùng cho Ingest Editor + `Player.checkCompat()` (`apps/web/src/app/player/player.ts`), trước khi thay 3 radio button thủ công bằng probe tự động.
