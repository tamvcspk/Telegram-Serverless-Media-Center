# ADR-0019: Tích hợp tra cứu metadata TMDB tại bước Draft — `tsmc-ingest-desktop`

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-13
- **Liên quan:** [ADR-0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md) (Catalog Spec v1 — ràng buộc `metaSource`), [ADR-0014](./0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md) (addendum 2026-09-17 — lý do TMDB chỉ gọi từ ingest-desktop, không nhân bản sang Ingest Editor web app), [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md) (mô hình lưu bí mật ở app-data), [ADR-0017](./0017-grammers-cho-cong-cu-ingest-desktop.md) (để ngỏ TMDB), [ADR-0018](./0018-task-id-lam-khoa-tuong-quan-ipc-ingest-desktop.md) (tiền lệ command điều khiển không thuộc `IngestRpc`), [ADR-0020](./0020-ma-hoa-bi-mat-app-data-qua-os-keyring.md) (mã hoá `tmdb_api_key.json` qua OS keyring)

## Bối cảnh

[ADR-0017 § Việc để ngỏ](./0017-grammers-cho-cong-cu-ingest-desktop.md) và [docs/ux-design.md](../ux-design.md) (mục Bảng metadata) đã ghi nhận nhu cầu "tra metadata online (TMDB/OMDb)" từ đầu nhưng chưa quyết: *"về kiến trúc được phép (nằm phía admin, ngoài đường chạy người xem — bất biến #8 nói về app web), và nó giết nỗi đau gõ tay triệt để hơn 'điền xuống'. Đổi lại: gửi tên phim trong kho của admin sang bên thứ ba + thêm một API key. Nếu làm thì opt-in, mặc định tắt."*

Đây là lần đầu app này gọi một dịch vụ bên thứ ba KHÔNG phải Telegram — cần quyết định nơi gọi (Rust hay Angular), cách lưu API key, và luồng UX áp dụng kết quả vào bảng metadata (Draft) mà không phá vỡ luồng seed/kế thừa hiện có (`seedMetadataFromFilename()`/`inheritMetadata()`, `@tsmc/core-ingest`).

`CatalogItemV1.metaSource` (`libs/shared-models/src/catalog.ts`) hiện là `v.picklist(['manual', 'filename', 'bot'])` — không có `'tmdb'`. `parseCatalogItem()` dùng `v.safeParse()` trên toàn bộ item; một giá trị enum lạ ở field `metaSource` làm cả item bị loại bỏ (catalog-spec.md: sai kiểu → loại riêng item đó). Thêm giá trị enum mới là đổi Catalog Spec (phạm vi ADR-0010), ảnh hưởng khả năng đọc ngược của client cũ.

## Các phương án

### A. Gọi TMDB trực tiếp từ Angular (`fetch()`)
- ✅ Đơn giản nhất, không cần thêm Tauri command.
- ❌ API key nằm trong bộ nhớ/console JS của webview — xem được qua DevTools nếu ai đó mở (khác mức độ nhạy cảm với session MTProto, nhưng vẫn là bí mật của admin, không có lý do để lộ khi có sẵn tầng Rust đáng tin hơn).
- **Loại.**

### B. Gọi TMDB từ Rust (Tauri command mới) (**được chọn**)
- ✅ API key không lộ ra webview; nhất quán với cách app đã xử lý bí mật khác (`credentials.json` ở app-data, không phải `localStorage` — ADR-0011 nói rõ lý do: `localStorage` tách theo origin webview, khác nhau giữa `cargo tauri dev` và bản release, đã là bug thật lúc code màn Đăng nhập).
- ⚠️ Thêm một dependency HTTP client phía Rust (`reqwest` hoặc tương đương) — chi phí build/binary size nhỏ, chấp nhận được.

### C. Tự động tra cứu + tự điền khi thả file
- ✅ Nhanh nhất cho admin, không cần bấm gì thêm.
- ❌ Dễ điền SAI khi tên phim mơ hồ/trùng tên (vd nhiều phim cùng tên khác năm) — một lỗi điền sai lặng lẽ còn tệ hơn không điền; đồng thời gọi API cho MỌI file thả vào, kể cả file admin sẽ tự sửa tay hoặc xoá ngay sau đó, tốn quota free tier của TMDB vô ích.
- **Loại.**

### D. Nút "Tra TMDB" theo từng dòng, admin tự chọn kết quả (**được chọn**)
- ✅ Chỉ gọi API khi admin thật sự cần; luôn có bước xác nhận bằng mắt trước khi ghi đè Title/Năm — đúng nguyên tắc đã áp dụng cho `inheritMetadata()` (mockup UX principle 3: kết quả suy luận chỉ là GỢI Ý, không tự động chốt).
- ⚠️ Chậm hơn phương án C nếu admin có hàng chục file cần tra — chấp nhận, vì đây là tính năng phụ trợ không bắt buộc dùng cho mọi file.

## Quyết định

Thêm nút **"Tra TMDB"** vào từng dòng bảng metadata (Draft, `workspace.ts`) — bấm mới gọi Tauri command mới `tmdb_search` (Rust, dùng `reqwest`, **không** thuộc `IngestRpc` vì không phải RPC MTProto — cùng tiền lệ `cancel_upload`/`get_current_task` ở ADR-0018: command điều khiển phía client, đăng ký thẳng trong `lib.rs`).

### Quy tắc thực thi

1. **API key TMDB v3 auth** (`api_key` query param — đơn giản hơn Bearer v4 token, đủ dùng cho search). Lưu ở app-data, file JSON riêng `tmdb_api_key.json` — **cùng mô hình `credentials.json`** (ADR-0011), không phải `localStorage`.
2. **"Opt-in, mặc định tắt" hiện thực KHÔNG cần màn Settings** (app chưa có): nút "Tra TMDB" luôn hiện, nhưng nếu chưa có key lưu sẵn, bấm vào mở dialog "Nhập TMDB API Key" (kèm hướng dẫn lấy key) thay vì gọi API ngay. Admin chủ động cung cấp key = hành vi opt-in tự nhiên, không cần thêm cờ bật/tắt riêng.
3. **Search theo `item.metadata.kind`:** `'episode'` → endpoint `search/tv` (field kết quả: `name`, `first_air_date`); `'movie'`/`undefined` → `search/movie` (field kết quả: `title`, `release_date`). Query mặc định = `item.metadata.title` đã seed sẵn từ filename, admin sửa lại được trong dialog trước khi tìm.
4. **Dialog kết quả:** liệt kê poster nhỏ (`https://image.tmdb.org/t/p/w92{poster_path}`) + tên + năm cho từng kết quả — admin bấm chọn ĐÚNG MỘT, không có "tự động chọn kết quả đầu".
5. **Áp dụng khi chọn:** chỉ ghi `title` + `year` (4 số đầu của `release_date`/`first_air_date`) vào metadata dòng đó, và `metaSource: 'manual'` (KHÔNG thêm `'tmdb'` vào enum — xem "Đánh đổi chấp nhận"). KHÔNG lấy `genres`/`cast`/`director`/poster ở PR3 này:
   - `search/movie`/`search/tv` không trả cast/director — cần gọi thêm endpoint `credits` riêng cho từng lựa chọn, để dành PR sau nếu thật sự cần.
   - `CatalogItemV1.poster` chỉ nhận `{ msgId }` (message Telegram đã upload), không nhận URL ngoài — gắn poster TMDB đòi thêm bước tải ảnh + upload thành message riêng, ngoài phạm vi PR3.
6. **Lỗi mạng/TMDB** hiển thị qua `DialogService.alert()` đơn giản — TMDB là dịch vụ Internet thật, không phải Telegram, không bị `FLOOD_WAIT`, không cần cơ chế retry kiểu `withFloodWaitRetry()`.

### Đánh đổi chấp nhận: `metaSource: 'manual'`, không thêm `'tmdb'`

`CatalogItemV1.metaSource` hiện là `v.picklist(['manual', 'filename', 'bot'])`. Thêm `'tmdb'` là đổi Catalog Spec v1 (ADR-0010) — client cũ (`parseCatalogItem()` dùng `v.safeParse()` trên toàn item) sẽ LOẠI BỎ item nếu gặp giá trị enum lạ, tức cần một cuộc thảo luận version-bump riêng, không phải quyết định phụ trong ADR này. Dùng `'manual'` vì đúng ngữ nghĩa hiện có: admin đã TỰ TAY xác nhận kết quả (khác `'filename'` — suy luận tự động, và khác `'bot'` — người xem tự soạn qua `@tsmc_bot`).

### Giới hạn thật của quyết định này — chưa kiểm chứng

**CHƯA verify bằng gọi API TMDB thật** — không có API key thật trong phiên viết ADR này để test. Field name (`title`/`name`/`release_date`/`first_air_date`/`poster_path`/`id`) dựa trên tài liệu TMDB v3 đã ổn định công khai nhiều năm, **không phải đã đo**. Cùng tinh thần CLAUDE.md "không chạy đăng nhập MTProto hộ người dùng" áp dụng tương tự ở đây theo hướng khác: đây không phải bí mật tài khoản Telegram, nhưng vẫn cần admin tự cung cấp API key thật của họ để verify — agent không có key để tự chạy thử.

## Hệ quả

**Tích cực**
- Giảm đáng kể việc gõ tay Title/Năm cho phim/show có trên TMDB, đúng nhu cầu đã ghi từ ux-design.md.
- Không lộ API key ra webview; không đổi Catalog Spec (không rủi ro tương thích ngược).
- Không đụng `libs/core-ingest` — `seedMetadataFromFilename()`/`inheritMetadata()` giữ nguyên vai trò nguồn điền MẶC ĐỊNH, TMDB chỉ là một nguồn điền THÊM có chủ đích (admin tự bấm).

**Tiêu cực / phải chấp nhận**
- Thêm một dependency HTTP client phía Rust (`reqwest`) — bề mặt build/binary tăng nhẹ.
- Không gắn được TMDB ID vào catalog (không có field lưu) — nếu admin đổi ý muốn tra lại, phải tra lại từ đầu bằng tên, không nhớ lựa chọn cũ.
- `genres`/`cast`/`director`/poster từ TMDB — CHƯA làm, admin vẫn phải tự nhập tay nếu cần (chỉ Title/Năm được TMDB hỗ trợ ở PR3).
- Toàn bộ field name TMDB dùng trong code là GIẢ ĐỊNH chưa verify — nếu API thật khác (đổi field, đổi auth), phải sửa lại sau khi admin test bằng key thật, không phải trước.

## Cập nhật sau khi Accepted (2026-09-13, verify bằng API key thật — ĐẠT)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

Gỡ đúng mục "Giới hạn thật của quyết định này — chưa kiểm chứng" ở trên: user đã tự có API key TMDB thật và verify — luồng nhập key → tìm kiếm → chọn kết quả → điền Title/Năm chạy đúng. Field response TMDB thật khớp giả định (`title`/`release_date`/`poster_path` cho movie, tương ứng `name`/`first_air_date` cho tv) — **không cần sửa `tmdb.rs`**. Chưa có chi tiết verify riêng từng nhánh (đặc biệt `kind: 'episode'` → `search/tv`) — xem checklist còn mở ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--tích-hợp-tra-cứu-tmdb-pr3-2026-09-13).

## Cập nhật sau khi Accepted (2026-09-14, màn Cài đặt mới — thêm lối vào thứ hai quản lý key)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**, xem lý do bên dưới.

`apps/tsmc-ingest-desktop` vừa thêm màn "Cài đặt" (route `/settings`, `ui/src/app/settings/`) — đóng gap ghi ở [docs/roadmap.md § Ingest](../roadmap.md#ingest) ("Màn Settings — chưa có"), KHÔNG có trong mockup A.3/A.4 gốc ([docs/ux-design.md](../ux-design.md)). Màn này thêm một khối "TMDB": xem trạng thái key (đã cấu hình/chưa), đổi key, xoá key.

**Quyết định gốc mục 2 ("Opt-in, mặc định tắt hiện thực KHÔNG cần màn Settings") vẫn đứng vững** — luồng first-use dialog (bấm "Tra TMDB" lần đầu → hỏi nhập key nếu chưa có, `TmdbKeyDialog`/`DialogService.promptTmdbApiKey()`) không đổi gì, vẫn là cách CHÍNH để bật tính năng lần đầu. Màn Cài đặt chỉ thêm một **lối vào thứ hai** cho việc quản lý chủ động (xem/đổi/xoá) ngoài lúc đang cần tra cứu — dùng lại NGUYÊN VẸN dialog nhập key đã có, không viết dialog thứ hai.

**Việc mới, ngoài phạm vi ADR gốc:** một command Rust `tmdb_delete_key` (`tmdb.rs`, xoá `tmdb_api_key.json` best-effort) — trước đây cách DUY NHẤT "xoá key sai" là admin tự tay xoá file ở app-data (ghi trong `describeTmdbError()`).

**Không đổi:** cách lưu key (`tmdb_api_key.json`, plaintext app-data, cùng mô hình `credentials.json`) — mã hoá vẫn để ngỏ, một mục riêng ở roadmap, không thuộc phạm vi thay đổi này.

`cargo build`/`cargo clippy --workspace` (0 warning) + `ng build`/`npm run lint` sạch. **Verify 2026-09-14, ĐẠT (tổng quát)** — user xác nhận chạy `cargo tauri dev` + tài khoản thật, màn Cài đặt hoạt động đúng thiết kế; chưa có xác nhận riêng từng bước con, checklist ở [docs/pending-device-tests.md § màn Cài đặt](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--màn-cài-đặt-2026-09-14).

## Việc để ngỏ

- Verify bằng API key TMDB thật (admin tự làm, có key riêng).
- Cân nhắc thêm `'tmdb'` vào `metaSource` enum nếu sau này cần phân biệt nguồn gốc metadata rõ hơn — cần version-bump Catalog Spec, ADR riêng.
- ~~`genres`/`cast`/`director`/poster từ TMDB — PR sau nếu cần, đòi thêm endpoint `credits` + luồng upload poster thành message Telegram.~~ Đã code, xem addendum 2026-09-17 bên dưới.

## Cập nhật sau khi Accepted (2026-09-17, TMDB nâng cao — genres/cast/director/poster)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững** (vẫn phương án B "gọi TMDB từ Rust" + D "nút Tra TMDB, admin tự chọn kết quả") — mục này đóng nốt "Việc để ngỏ" cuối cùng của ADR.

### Genres/cast/director — MỘT lệnh gọi, không phải endpoint `credits` riêng như dự tính

Khác giả định lúc viết ADR gốc ("đòi thêm endpoint `credits` riêng"), thực tế dùng `/movie/{id}?append_to_response=credits` hoặc `/tv/{id}?append_to_response=credits` — **một** lệnh HTTP trả về cả `genres` (tên đầy đủ có sẵn, khỏi cần bảng tra `id`→tên riêng như phác thảo ban đầu ở brainstorm) lẫn `credits` (cast/crew). Tauri command mới `tmdb_details(app, id, kind)` (`src-tauri/src/tmdb.rs`) — gọi SAU khi admin đã chọn một kết quả `tmdb_search()` cụ thể (cần `id` thật, không suy luận lại theo tên).

- **Movie:** `director` = phần tử đầu của `credits.crew` có `job == "Director"`.
- **Phim bộ (`kind: 'episode'`):** TMDB không có "director" một người cho cả series — dùng `created_by` (field CHỈ có ở `/tv/{id}`, KHÔNG nằm trong `credits`) làm tương đương gần nhất, lấy người **đầu tiên** nếu có nhiều hơn một đồng sáng tác (field `director` trong catalog schema là `string` đơn, không phải mảng — quyết định brainstorm 2026-09-17, chấp nhận mất thông tin nếu có ≥2 người).
- `cast`: cắt về top 10 theo đúng thứ tự `order` (billing order) TMDB trả sẵn, không tự sắp lại.

### Poster — quyết định quan trọng nhất: Document, không phải Photo

`apps/web` hiện **chưa có** pipeline tải Telegram Photo — `poster-tile.ts` chỉ hiện gradient placeholder, chưa từng đọc `item.poster.msgId` (xem doc comment component đó). Pipeline Photo là một mục roadmap riêng ("Poster ảnh thật"), còn `[Chưa bắt đầu]`, có rủi ro `FLOOD_WAIT` khi tải hàng loạt lúc duyệt danh sách lớn. Nếu poster ghi dưới dạng Telegram Photo thật, `catalog.json` sẽ có `poster.msgId` hợp lệ nhưng **không ai đọc được** — dữ liệu chết cho tới khi pipeline Photo kia xong, không biết bao giờ.

**Né bằng cách upload poster dưới dạng Document** (`InputMessage::new().document(...)`, không có attribute `Video`/`Photo` nào) — tái dùng **nguyên vẹn** pipeline download Document đã verify thật (subtitle/video, cùng RPC `download_document`), không cần code mới ở tầng đọc để có poster hiển thị được ngay.

Thực thi:
- `IngestRpc` (`ingest-rpc-trait/src/lib.rs`) thêm thao tác thứ 14, `upload_poster(channel, file_name, bytes: Vec<u8>)` — NGOẠI LỆ thứ bảy không tương ứng 1-1 phía TS (`gateway-ingest.ts` không có khái niệm poster, tính năng mới chỉ ở ingest-desktop). Nhận `bytes` trực tiếp (khác `upload_subtitle` nhận `file_path`) vì nguồn là HTTP response tải về, không phải file sẵn trên đĩa — implement bằng `upload_stream()` (cùng khuôn `publish_catalog()`, stream thẳng từ bộ nhớ, không ghi file tạm).
- Tauri command `upload_tmdb_poster(state, poster_path, file_name)` (`upload.rs`) **gộp** cả bước tải ảnh (`reqwest::get()`, cỡ `w500` — hằng số `TMDB_IMAGE_BASE_LARGE`, khác cỡ `w92` dùng cho thumbnail nhỏ ở dialog tìm kiếm) và bước ghi Telegram (`rpc.upload_poster()`) trong MỘT command, vì bước ghi cần `state.selected_channel`/`rpc` mà `tmdb.rs` (nơi có `tmdb_search`/`tmdb_details`) cố tình không có — giữ đúng ranh giới "gọi TMDB" tách khỏi "ghi Telegram" của Quyết định gốc.
- `TmdbSearchResultDto` thêm field `poster_path` (đường dẫn THÔ, vd `/abc.jpg`) tách khỏi `poster_url` (đã ghép sẵn base URL NHỎ cho dialog) — Angular truyền `poster_path` nguyên văn qua IPC, Rust tự ghép base URL LỚN lúc upload thật.
- **Thời điểm upload:** KHÔNG upload ngay lúc admin chọn kết quả TMDB (khác Title/Năm/genres/cast/director — thuần điền metadata, không I/O mạng). Chỉ lưu `pendingPosterPath` vào `QueueItem` (Draft, `draft-store.ts`) lúc chọn, upload THẬT dời tới `processItem()` — lúc bấm "Upload", cùng lúc với video/subtitle của dòng đó — tránh message poster mồ côi trên kênh nếu admin chọn TMDB rồi xoá dòng khỏi bảng trước khi upload. Threading qua `UploadQueueItem.pendingPosterPath` (`queue-store.ts`), thêm stage `uploading_poster` vào `UploadStage`.

### Hashtag vào caption — chi tiết kỹ thuật (quyết định "vì sao chỉ ở ingest-desktop" đã ghi riêng ở [ADR-0014 § addendum 2026-09-17](./0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md#cập-nhật-sau-khi-accepted-2026-09-17-đóng-băng-phạm-vi-ingest-editor--hai-đường-ghi-catalog-không-còn-ngang-hàng), không lặp lại ở đây)

Hàm thuần mới `composeCaption(item: CatalogItemV1): string` (`libs/core-ingest/src/caption-hashtags.ts`) — ghép title + hashtag suy từ season/episode (`#S01E02`, luôn 2 chữ số), năm (`#2024`), genres (chuẩn hoá bỏ khoảng trắng/dấu câu, vd "Science Fiction" → `#ScienceFiction`, Telegram không chấp nhận khoảng trắng trong hashtag). Thay `caption: item.metadata.title` cũ (`processItem()`, `workspace.ts`) bằng `caption: composeCaption(item.metadata)` — ghi **một lần** lúc `upload_video()`, không đồng bộ lại sau.

Format cố ý khớp **đúng** pattern mà `libs/core-index/src/hashtag-parser.ts` (tầng ĐỌC, quét kênh cộng đồng bất kỳ) đã kỳ vọng — verify bằng test round-trip (`caption-hashtags.spec.ts`): hashtag do `composeCaption()` sinh ra được `deriveFallbackMetadata()` đọc lại **đúng** season/episode/year/genres, khép kín vòng ghi→đọc bằng test, không chỉ bằng đọc code bằng mắt.

### Trạng thái kiểm chứng

`cargo build`/`cargo clippy --workspace -- -D warnings` sạch, `ng build`/`npm run lint`/`npm run test:libs` (302 test, gồm 7 test mới ở `caption-hashtags.spec.ts`) sạch. **CHƯA verify bằng API key TMDB thật/tài khoản Telegram thật** — chưa gọi `tmdb_details()`/`upload_tmdb_poster()` với dữ liệu thật, field response (`credits`/`created_by`/`genres` ở endpoint details) dựa trên tài liệu TMDB v3 công khai, **giả định chưa đo** — cùng tình trạng ban đầu của PR3 gốc trước khi user tự verify bằng key thật (xem addendum 2026-09-13 ở trên).

## Cập nhật sau khi Accepted (2026-09-17, verify TMDB nâng cao bằng tài khoản/API key thật — ĐẠT)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

User xác nhận qua `cargo tauri dev` + API key TMDB thật + tài khoản Telegram thật: **ĐẠT** toàn bộ checklist ở [docs/pending-device-tests.md](../pending-device-tests.md) (nay đã xoá khỏi đó theo đúng quy ước "xong thì xoá, chuyển kết quả vào changelog") —

- Chọn kết quả TMDB có poster → Title/Năm điền ngay, `genres`/`cast`/`director` tự điền theo sau qua `tmdb_details()`.
- Nhánh `kind: 'episode'` (phim bộ) → `director` ra đúng tên từ `created_by`, không lỗi/rỗng.
- Chọn TMDB rồi xoá dòng trước khi Upload → không tạo message poster mồ côi (xác nhận đúng thiết kế "upload thật dời tới `processItem()`").
- Upload thành công → `catalog.json` có `poster: { msgId }`, caption message video có hashtag đúng định dạng, tap hashtag lọc đúng trong kênh (Telegram Desktop).
- TMDB key sai/hết hạn giữa chừng (sau search, lúc gọi `tmdb_details()`) → báo lỗi rõ ràng, không xoá mất Title/Năm đã điền trước đó.

**Một giới hạn observability đã biết, không phải lệch thiết kế:** không phân biệt được bằng mắt Photo hay Document qua Telegram Desktop — client hiện cả hai dạng tương tự nhau khi là ảnh (preview inline). Đây **không** phải lỗ hổng verify: `.document(uploaded)` (không có nhánh code nào khác có thể tạo ra Photo) đã được xác nhận bằng đọc mã nguồn `upload_poster()` (`ingest-grammers/src/rpc.rs`) + `cargo clippy` sạch, và mục đích thật của quyết định "Document không phải Photo" là để tái dùng pipeline `download_document()` đã verify — không phải để tạo ra khác biệt nhìn thấy được bằng mắt trên Telegram Desktop. Không cần thêm bước verify nào khác cho điểm này.

Không phát sinh thay đổi thiết kế nào — mọi giả định field response TMDB (`genres`/`credits.cast`/`credits.crew`/`created_by`) khớp đúng dữ liệu thật, không cần sửa `tmdb.rs`.

## Cập nhật sau khi Accepted (2026-09-18, sync hashtag caption khi "Lưu catalog" sửa metadata sau publish)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

Đóng nốt việc còn để dành ở addendum 2026-09-17 (`docs/roadmap.md` § Ingest): hashtag ghi lúc upload lần đầu đã xong, nhưng nếu admin sửa Title/Season/Ep/Năm ở "Trình quản lý catalog" SAU publish ban đầu, caption cũ vẫn giữ hashtag lệch với `catalog.json` mới — logic đối soát diff theo `msgId` đã chốt lúc brainstorm 2026-09-17 (xem [ADR-0014 § addendum 2026-09-17](./0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md#cập-nhật-sau-khi-accepted-2026-09-17-đóng-băng-phạm-vi-ingest-editor--hai-đường-ghi-catalog-không-còn-ngang-hàng)) nay đã code.

### Thực thi

- `IngestRpc` thêm thao tác thứ 15, `edit_message_caption(channel, msg_id, caption: String)` (`ingest-rpc-trait/src/lib.rs`) — NGOẠI LỆ thứ tám không tương ứng 1-1 phía TS (`gateway-index.ts` không có nhu cầu sửa caption message video, chỉ ghi/xoá nguyên khối `catalog.json`). Implement (`ingest-grammers/src/rpc.rs`) bằng `Client::edit_message(peer, msg_id, InputMessage::new().text(caption))` — đã đối chiếu trực tiếp mã nguồn `grammers-client` 0.10.0 (`client/messages.rs::edit_message()`) trước khi code: `messages.editMessage` bỏ trống field `media` giữ NGUYÊN media hiện có của message, chỉ đổi text/caption — không phải đoán từ tài liệu TL suông (cùng kỷ luật đã áp dụng cho `upload_poster()` ở addendum trước).
- Tauri command `edit_message_caption(state, msg_id, caption)` mới ở `catalog.rs`, cùng nhóm bốn ngoại lệ Trình quản lý catalog (`check_deleted_messages`/`delete_message`/`scan_channel_videos`/`edit_message_caption`), đều thao tác trên `state.selected_channel`.
- `catalog-manager.ts::onPublish()` — SAU khi `publishCatalog()` ghi catalog THÀNH CÔNG, gọi thêm `syncHashtagCaptions(remoteItems)` mới:
  - `remoteItems` là catalog vừa đọc lại NGAY TRƯỚC lúc publish (biến đã có sẵn sẵn trong `onPublish()` để merge) — dùng bản này thay vì bản nạp lúc mount màn hình, tránh so sánh nhầm với dữ liệu có thể đã cũ nếu màn hình mở lâu.
  - Diff bằng `composeCaption(remote) !== composeCaption(current)` theo từng `msgId` — KHÔNG liệt kê field thủ công (title/season/episode/year/genres): `composeCaption()` (addendum trước) là hàm thuần xác định, so sánh OUTPUT của nó tự động bắt đúng mọi field ảnh hưởng hashtag.
  - **Chỉ đồng bộ item CÓ trong `remoteItems`** (đã tồn tại từ trước khi mở màn) — item MỚI thêm qua "Tìm file mồ côi" (hoặc mới upload từ Workspace trong lúc màn đang mở) bị **bỏ qua có chủ đích**: không biết/không kiểm soát caption gốc của message đó (có thể ai đó viết tay trước khi có app) — ghi đè mù bằng `composeCaption()` mới có thể xoá mất nội dung caption thật không phải do app sinh ra.
  - Best-effort theo từng item, bọc `withFloodWaitRetry()` — một caption sync lỗi KHÔNG rollback/làm hỏng catalog vừa publish thành công (catalog.json đã ghi xong TRƯỚC bước này); lỗi gom lại rồi báo MỘT `alert()` duy nhất liệt kê `msgId` chưa đồng bộ được, không chặn luồng.

### Trạng thái kiểm chứng

`cargo build` sạch. **`cargo clippy --workspace -- -D warnings` chưa chạy được trong phiên viết addendum này** — máy dev có sẵn `cargo tauri dev` đang chạy (phiên verify TMDB nâng cao ngay trước đó), khoá file `ffmpeg-runtime/avcodec-61.dll` khiến build script của `cargo clippy` lỗi `os error 32` (file đang dùng bởi tiến trình khác) — xác nhận là file lock, không phải lỗi code (`cargo build` không đụng build script đó theo cùng cách nên vẫn qua). `ng build`/`npm run lint`/`npm run test:libs` (302 test, không đổi — logic diff nằm ở component `catalog-manager.ts`, không phải hàm thuần mới trong `libs/`) sạch. **CHƯA verify bằng tài khoản Telegram thật** — chưa gọi `edit_message_caption()` với dữ liệu thật, cần đóng phiên `cargo tauri dev` đang treo rồi admin tự chạy lại để verify + chạy `cargo clippy` sạch.

## Cập nhật sau khi Accepted (2026-09-18, verify sync hashtag caption — ĐẠT một phần)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

User xác nhận qua `cargo tauri dev` + tài khoản Telegram thật, đánh dấu trực tiếp trong [docs/pending-device-tests.md](../pending-device-tests.md) — **3/5 bước ĐẠT**:

- Sửa Title/Season/Ep/Năm một dòng rồi "Lưu catalog" → caption message video đó cập nhật đúng hashtag MỚI.
- Sửa một dòng nhưng field ảnh hưởng hashtag không đổi thực chất → không gọi `editMessageCaption()` thừa (diff bằng `composeCaption()` hoạt động đúng, không phải cứ "Lưu" là sync mọi dòng).
- Sửa nhiều dòng cùng lúc rồi Lưu một lần → đúng số dòng đổi được cập nhật caption, dòng không đổi giữ nguyên.

**Còn mở, chưa test (không chặn — đã ghi trong checklist):**
- Item mới thêm qua "Tìm file mồ côi" → xác nhận caption gốc KHÔNG bị ghi đè (nhánh "bỏ qua có chủ đích").
- Ngắt kết nối/đóng app giữa lúc đang chạy caption sync (sau khi catalog đã publish xong) → catalog.json không hỏng dù caption có thể chưa kịp đồng bộ hết.
- `cargo clippy --workspace -- -D warnings` — vẫn chưa chạy được do file `ffmpeg-runtime` bị khoá bởi phiên `cargo tauri dev` khác trên máy dev.

Không phát sinh lệch thiết kế nào ở 3 nhánh đã verify — `edit_message_caption()`/diff `composeCaption()` chạy đúng như addendum trên mô tả.

## Cập nhật sau khi Accepted (2026-09-18, "Sửa nâng cao" — Advanced Metadata Edit)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

### Bối cảnh phát sinh

Sau khi TMDB nâng cao (genres/cast/director/poster, addendum 2026-09-17) chạy được ở bước ingest (Workspace, "Tra TMDB"), phát hiện gap: **Trình quản lý catalog** (post-publish) không có cách nào sửa các field này cho item ĐÃ publish — chỉ sửa được Title/Năm/Season/Ep. Brainstorm 2026-09-18 chốt: một dialog dùng chung cho cả hai màn, thêm `series.name`/`genres`/`cast`/`director`/poster, cộng một hành động "Chuyển thành phim lẻ".

### Một dialog dùng chung, không phải hai lần

`AdvancedMetadataDialog` mới (`apps/tsmc-ingest-desktop/ui/src/app/shared/dialog/advanced-metadata-dialog.ts`) — dùng CHUNG cho `workspace.ts` (Draft, trước upload) và `catalog-manager.ts` (đã publish), tránh viết hai lần (đúng bài học rút ra từ quyết định "đóng băng phạm vi Ingest Editor web" — [ADR-0014 § addendum 2026-09-17](./0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md#cập-nhật-sau-khi-accepted-2026-09-17-đóng-băng-phạm-vi-ingest-editor--hai-đường-ghi-catalog-không-còn-ngang-hàng): mọi field catalog nâng cao mới chỉ nên sửa MỘT chỗ).

Nhận `CatalogItemV1` + `kind` + `posterMsgId?` (nếu item đã có poster từ trước) + một callback `searchTmdb` — truyền từ tầng gọi (đã có `DialogService`) thay vì dialog này tự `inject(DialogService)`, né import vòng (file đó phải import CHÍNH dialog này để mở nó). Trả về `CatalogItemV1` đã sửa + `posterChange?: {type:'replace', posterPath, posterUrl} | {type:'remove'}` — poster **chưa** upload/xoá gì cả ở bước này, chỉ trả Ý ĐỊNH; tầng gọi tự xử lý lúc publish/upload thật (tránh side-effect mạng ngay khi mới CHỌN trong dialog, cùng nguyên tắc `pendingPosterPath` đã dùng cho TMDB nâng cao).

### Genres: picker VÀ nhập tay (không phải chỉ một trong hai)

`mat-chip-grid`/`mat-chip-row` (Angular Material MDC, đã có sẵn trong `@angular/material` mà `ui/` đang dùng — **không** thêm dependency mới) cho chip tự do gõ tay, cộng danh sách nút "+ &lt;tên&gt;" lấy từ TMDB canonical genre list. Tauri command mới `tmdb_genre_list(kind)` (`GET /genre/movie/list` hoặc `/genre/tv/list`) — không cache phía Rust/Angular, payload nhỏ (~19/~16 mục), gọi lại mỗi lần mở dialog đơn giản hơn quản lý vòng đời cache. Cast dùng chip tự do tương tự (không có nguồn canonical để picker). Director là input text đơn (schema `string`, không phải mảng).

### "Chuyển thành phim lẻ" — phát hiện gap thật lúc thiết kế

Một chiều DUY NHẤT (episode → movie), chỉ BẬT khi `item.series?.episode` ĐANG rỗng — season/episode là Quick edit sửa NGOÀI dialog, admin phải tự xoá số Ep ở bảng TRƯỚC. Lý do gate này tồn tại: đọc lại `onSeasonInput()`/`onEpisodeInput()` (cả `workspace.ts` lẫn `catalog-manager.ts`) phát hiện cả hai hàm LUÔN set `kind: 'episode'` bất kể giá trị gõ vào rỗng hay không sau khi xoá — nghĩa là **trước addendum này, không có cách nào đảo ngược** một item bị parse nhầm thành episode trở lại movie, kể cả sau khi đã xoá sạch Season/Ep ở Quick edit. Đây là bug thật phát hiện qua đọc code khi thiết kế tính năng này, không phải giả định.

Bulk action "Chuyển thành phim lẻ" (`convertSelectedToMovie()`) thêm ở CẢ HAI màn — chỉ áp dụng cho dòng đã chọn thoả điều kiện trên (không còn Ep), dòng còn Ep bị bỏ qua LẶNG LẼ (hành vi "áp dụng cho dòng đủ điều kiện", không phải all-or-nothing).

**Hệ quả phụ:** `catalog-manager.ts` trước đây KHÔNG có checkbox multi-select (chỉ sửa từng dòng rời) — thêm mới `selectedIds` (cùng pattern Set riêng như `removedIds`/`brokenIds` đã có, không phải field trên item) để hỗ trợ bulk action này.

### Poster — hai việc, một thứ tự bắt buộc

**Ảnh xem trước:** wire nốt `download_document()` (`IngestRpc`, có implementation từ lâu — ghi rõ trong `commands.rs`/`catalog.rs` cũ là "chưa có UI nào cần tới" — nay cuối cùng có). Tauri command cùng tên trả **base64** (không phải `Vec<u8>` trần — Tauri serialize mảng byte thành mảng số JSON, phình gấp nhiều lần so với base64 cho ảnh vài trăm KB). Thêm dependency `base64 = "0.22"` (đã có sẵn transitively qua `reqwest`/`tauri`, promote lên direct dependency không tốn build size mới).

**Đổi poster ở item ĐÃ CÓ poster từ trước (Catalog Manager)** — quyết định brainstorm: **xoá message poster CŨ trên kênh**, không để mồ côi. Thứ tự bắt buộc, quan trọng nhất của addendum này:

1. `catalog-manager.ts::onPublish()` phải upload/xoá poster MỚI **TRƯỚC** khi build envelope — khác hashtag caption sync (addendum 2026-09-18 trước): caption KHÔNG nằm trong nội dung `catalog.json` nên sync được SAU khi publish, còn `poster.msgId` LÀ field trong `catalog.json`, phải có mặt TRƯỚC lúc publish.
2. Nếu upload poster mới lỗi → **ABORT toàn bộ** `onPublish()` (không gọi `publishCatalog()` với poster thiếu) — khác cách hashtag caption sync xử lý lỗi (best-effort, không rollback), vì poster LÀ nội dung catalog thật, không nên publish nửa vời.
3. Xoá message poster CŨ chỉ thực hiện **SAU KHI** catalog mới publish THÀNH CÔNG — nếu publish thất bại giữa chừng, không nên đã lỡ xoá poster cũ trong khi catalog vẫn còn trỏ tới nó.

**Workspace (Draft, chưa publish gì):** `posterMsgId` luôn `undefined` (chưa có poster nào để xoá) — `posterChange: 'remove'` ở đây chỉ nghĩa "bỏ lựa chọn TMDB poster đã chọn trước đó lúc chưa upload", không đụng Telegram gì cả.

### Trạng thái kiểm chứng

`cargo build` sạch. `ng build`/`npm run lint`/`npm run test:libs` (302 test, không đổi — logic mới nằm ở component, không phải hàm thuần trong `libs/`) sạch. **`cargo clippy --workspace -- -D warnings` CHƯA chạy được** trong phiên viết addendum này — máy dev có sẵn `cargo tauri dev` đang chạy (phiên verify trước đó), khoá file `ffmpeg-runtime/avcodec-61.dll`. **CHƯA verify bằng tài khoản Telegram thật/API key TMDB thật.**

## Cập nhật sau khi Accepted (2026-09-18, dạng cây/nhóm cho bảng metadata)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

### Bối cảnh

Brainstorm 2026-09-18 tiếp theo: bảng metadata (cả Workspace lẫn Trình quản lý catalog) là danh sách PHẲNG, khó duyệt khi có nhiều tập cùng series lẫn lộn với phim lẻ. Quyết định: hiện dạng cây/nhóm — phim lẻ một dòng, phim bộ nhóm `series.name` > `season` > dòng tập, áp dụng cho CẢ hai màn.

### Mảng phẳng có discriminant, không phải cây lồng nhau thật

Hàm thuần mới `flattenMetadataTree()` (`libs/core-ingest/src/metadata-tree.ts`, 8 test case) — generic theo `T` (khác nhau giữa hai màn: `QueueItem` bọc `CatalogItemV1` trong field `metadata` ở Workspace, Catalog Manager dùng thẳng `CatalogItemV1`), nhận `getMetadata: (row: T) => CatalogItemV1` để không cần biết shape `T`. Trả về **mảng phẳng** có discriminant `kind: 'movie' | 'series-header' | 'season-header' | 'episode'` — cố ý KHÔNG phải cấu trúc cây lồng nhau thật, vì cả hai màn dùng `cdk-virtual-scroll-viewport` với `itemSize` cố định (không `MatTree`/`mat-table` — cùng lựa chọn hand-rolled div+CDK đã ghi trong comment đầu hai file component từ trước). CDK không có "virtual scrolling tree" chính thức; viết cây lồng nhau thật sẽ phải tự dựng lại cơ chế virtual scroll từ đầu. Mảng phẳng feed thẳng vào `cdkVirtualFor` sẵn có, giữ nguyên hiệu năng với catalog nhiều trăm/nghìn item.

**Sắp xếp:** nhóm cấp cao nhất (phim lẻ VÀ tên series) xen kẽ alphabet theo tên — không tách khối phim-lẻ-trước/phim-bộ-sau, dễ tìm theo tên hơn khi danh sách lớn. Season/episode tăng dần, giá trị không rõ số rơi xuống cuối. `series.name` rỗng/thiếu gộp vào một nhóm `"(Không tên)"` duy nhất, tránh nhiều nhóm rỗng trộn lẫn.

**Collapse là UI state, không phải dữ liệu:** `collapsedGroups: Set<string>` (khoá qua `seriesGroupKey()`/`seasonGroupKey()`, cũng export từ file trên) sống RIÊNG ở từng component, mặc định RỖNG (mọi nhóm mở rộng — không ẩn gì bất ngờ lúc mới vào màn). Header nhóm dùng CHUNG class CSS `.metadata-row`/`.table-row` (giữ đúng 48px khớp `itemSize` — trộn chiều cao khác nhau sẽ làm sai scroll math của `FixedSizeVirtualScrollStrategy`), chỉ đổi `display: grid` nhiều cột thành `flex` một hàng (chevron + tên + số lượng). `trackByTreeRow()` viết riêng ở mỗi component (khác kiểu `T`, không share được) — header dùng khoá nhóm ổn định, leaf dùng khoá gốc đã có (`msgId`/`path`).

Tìm kiếm áp dụng TRƯỚC khi nhóm cây (nhóm theo `filteredQueue()`/`filteredItems()`, không phải mảng gốc) — gõ tìm tự thu gọn cây về đúng nhánh khớp.

### Chọn hàng loạt — giữ nguyên ở cấp leaf, một giới hạn đã biết

Checkbox/`selectedIds`/`selected` KHÔNG đổi, vẫn ở cấp LEAF row (movie/episode) — không thêm checkbox ở header nhóm (chưa có ngữ nghĩa "chọn cả nhóm" lần này, để dành sau nếu cần).

**Giới hạn chấp nhận:** `fillDown()`/`autoNumberEpisodes()` (Workspace) vẫn lấy "dòng ĐẦU TIÊN đã chọn" theo thứ tự MẢNG GỐC (`queue()`), không phải thứ tự hiển thị MỚI trên cây (đã sắp lại theo alphabet/season/episode) — có thể lệch trực giác nếu admin chọn nhiều dòng theo thứ tự nhìn thấy trên cây. Chưa sửa vì thường trùng nhau trong thực tế (file cùng series/season thả vào cùng lúc, thứ tự mảng gốc thường đã gần giống thứ tự season/episode) — không phải bỏ sót, là đánh đổi có cân nhắc.

### Bug thật gặp lúc build — ngân sách `anyComponentStyle`

CSS mới cho header nhóm đẩy `workspace.scss` vượt ngân sách `anyComponentStyle` của Angular CLI (6kB cảnh báo, đã cấu hình từ trước) — 6.32kB, vượt 318 byte. **Không sửa bằng cách cắt bớt style đang dùng** (sẽ mất tính năng có sẵn) — sửa bằng cách **tách CSS mới ra file riêng** `workspace-tree.scss` (`styleUrls: [...]` thay `styleUrl` đơn), vì Angular CLI tính ngân sách RIÊNG từng file stylesheet của một component — hợp lệ khi nội dung thật sự cần thêm, không phải né ngân sách bằng thủ thuật. `catalog-manager.scss` không vỡ ngân sách (dưới 6kB kể cả sau khi thêm), giữ nguyên một file.

### Trạng thái kiểm chứng

`cargo build`/`cargo clippy --workspace -- -D warnings` sạch (phiên `cargo tauri dev` treo từ addendum trước đã đóng, hết file lock — cũng xác nhận luôn phần "Sửa nâng cao" ở addendum trên sạch clippy). `ng build`/`npm run lint`/`npm run test:libs` (310 test, 8 mới ở `metadata-tree.spec.ts`) sạch, không còn cảnh báo ngân sách. **CHƯA verify bằng tài khoản Telegram thật/catalog thật nhiều item** — cây/nhóm mới test bằng fixture nhỏ trong unit test, chưa có dữ liệu thật hàng trăm/nghìn item để xác nhận hiệu năng virtual scroll không đổi.

## Cập nhật sau khi Accepted (2026-09-18, vá bug "Chuyển thành phim lẻ" không phản hồi)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**, xem lý do bên dưới.

### Bug thật phát hiện qua báo cáo user (chưa kịp verify thiết bị thật)

Addendum "Sửa nâng cao" ở trên (2026-09-18) đặt cổng an toàn cho "Chuyển thành phim lẻ": chỉ bật khi `series?.episode` ĐANG rỗng, buộc admin tự xoá số Ep ở Quick edit TRƯỚC. User báo: *"Chuyển thành phim lẻ không hoạt động, cũng không biểu hiện gì"*.

**Nguyên nhân gốc — chính cổng an toàn đó là bug:** trường hợp cần dùng tính năng này nhiều nhất là item ĐANG CÓ Ep (parse nhầm thành episode) — đúng lý do admin muốn chuyển. Cổng an toàn khiến nút bị disable ÂM THẦM (không có thông báo rõ ràng ngoài một `title` tooltip phải hover mới thấy) ở đúng trường hợp phổ biến nhất, và bulk action bỏ qua lặng lẽ mọi dòng còn Ep — nếu TẤT CẢ dòng đã chọn còn Ep (tình huống thường gặp khi thử lần đầu), bấm nút không có tác dụng gì và không có phản hồi nào giải thích lý do.

### Sửa: bỏ cổng an toàn, dùng "Lưu"/xác nhận sẵn có làm điểm chốt

- **Bulk action** (`convertSelectedToMovie()`, cả `workspace.ts` lẫn `catalog-manager.ts`): bỏ điều kiện `series?.episode === undefined` — giờ chuyển THẲNG mọi dòng đã chọn có `kind === 'episode'` thành `movie` (xoá `series`) trong cùng một lần bấm. Không cần cổng an toàn: dữ liệu chỉ đổi trong buffer đang sửa (Draft chưa upload / catalog chưa "Lưu"), chưa ghi Telegram — admin vẫn có thể huỷ bằng cách rời màn không lưu.
- **Dialog "Sửa nâng cao"** (`AdvancedMetadataDialog`): bỏ hẳn `canConvertToMovie`/trạng thái disabled — nút luôn bật khi item là `kind: 'episode'`. Bấm chỉ ĐÁNH DẤU ý định (`convertedToMovie` signal, đổi UI hiện dòng "Sẽ chuyển thành phim lẻ khi Lưu"), áp dụng thật (xoá `series`) khi bấm "Lưu" của CHÍNH dialog — "Lưu"/"Huỷ" đã là bước xác nhận tự nhiên, không cần thêm cổng disable nào trước đó.

### Bài học

Một điều kiện tiên quyết ẩn (phải làm thao tác X ở nơi khác TRƯỚC khi nút Y sáng lên) mà không có thông báo tường minh ngay tại chỗ dễ bị hiểu nhầm là "tính năng hỏng" hơn là "tính năng có điều kiện" — đặc biệt khi điều kiện đó ngược với usecase phổ biến nhất. Xác nhận bằng dialog/điểm chốt đã có sẵn (Lưu/Huỷ) là cách an toàn tương đương mà không cần disable âm thầm.

### Trạng thái kiểm chứng

`ng build`/`npm run lint`/`npm run test:libs` (310 test, không đổi — sửa nằm ở logic component, không phải hàm thuần) sạch. Không đụng Rust, không cần build lại `cargo`. **CHƯA verify lại bằng tài khoản thật** — user cần xác nhận cả hai đường (bulk + dialog) hoạt động đúng sau bản vá.

## Cập nhật sau khi Accepted (2026-09-18, verify "Sửa nâng cao" — ĐẠT 10/11 bước, gồm cả bản vá "Chuyển thành phim lẻ")

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

User xác nhận qua `cargo tauri dev` + tài khoản Telegram thật + API key TMDB thật, đánh dấu trực tiếp trong [docs/pending-device-tests.md](../pending-device-tests.md) — **10/11 bước ĐẠT** ở cả Workspace lẫn Trình quản lý catalog:

- Dialog "Sửa nâng cao" mở đúng, hiện đúng field hiện có; genres picker (chip từ TMDB + nhập tay) hoạt động; "Tra TMDB" trong dialog tự điền title/năm/genres/cast/director/poster.
- **Bản vá "Chuyển thành phim lẻ" (addendum ngay trên) xác nhận ĐÚNG** ở cả hai đường: dialog (nút luôn bật kể cả khi còn Ep, "Lưu" áp dụng đúng) và bulk toolbar (chuyển ngay mọi dòng `kind: 'episode'` đã chọn, không còn bị bỏ qua lặng lẽ) — ở cả Workspace và Catalog Manager.
- Poster: upload mới khi bấm "Upload" (Workspace), đổi poster xoá đúng message cũ trên kênh, "Xoá poster" xoá đúng field + message (Catalog Manager). Checkbox chọn dòng/"Chọn tất cả" hoạt động đúng.

**Còn mở, chưa test (không chặn):** "Cố tình làm upload poster mới THẤT BẠI giữa chừng (rút mạng)" — khó chủ động tạo điều kiện lỗi mạng đúng lúc, để ngỏ tới khi có cơ hội tự nhiên (cùng tinh thần CLAUDE.md: không né/kích `FLOOD_WAIT`/lỗi mạng một cách nhân tạo).

Không phát sinh lệch thiết kế nào — mọi hành vi khớp đúng addendum "Sửa nâng cao" và bản vá "Chuyển thành phim lẻ" ở trên.

## Cập nhật sau khi Accepted (2026-09-18, "Thêm vào series" / "Tạo series mới")

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

### Bối cảnh

Chiều NGƯỢC LẠI "Chuyển thành phim lẻ" (addendum trước): đưa một phim lẻ (hoặc nhiều phim lẻ đã chọn) vào một series, có sẵn hoặc mới tạo.

### Bốn hàm thuần mới (`libs/core-ingest/src/series-registry.ts`, 10 test case)

- `listSeriesNames(items)`: tên series phân biệt đã có trong `items` (chỉ tính `kind === 'episode'`, bỏ tên rỗng), sort alphabet — nguồn cho picker "Series có sẵn", **KHÔNG cho gõ tay** để tránh lệch chữ hoa/thường tạo nhóm trùng lặp trong `flattenMetadataTree()` (nhóm theo string CHÍNH XÁC).
- `findRepresentativeEpisode(items, seriesName)`: item ĐẦU TIÊN khớp series — nguồn "kế thừa" genres/cast/director.
- `suggestNextEpisode(items, seriesName)`: season = season LỚN NHẤT đã dùng trong series (season mới hầu như luôn là "season đang chiếu tiếp", không phải season 1), episode = tập LỚN NHẤT trong đúng season đó + 1. Series chưa tồn tại → `{ season: 1, episode: 1 }`.
- `assignToSeries(target, seriesName, season, episode, inheritFrom?)`: đổi `kind`/`series`, kế thừa **CÓ CHỌN LỌC** chỉ `genres`/`cast`/`director` từ `inheritFrom` nếu có — cố ý không đụng `title`/`year`/`msgId` của `target`. Khác `inheritMetadata()` (kế thừa TOÀN BỘ field, dùng cho "tập KẾ TIẾP của CÙNG MỘT phim" lúc seed tuần tự từ tên file) — ở đây `target` là MỘT PHIM LẺ CÓ SẴN với tên/năm riêng của chính nó, ghi đè toàn bộ sẽ mất dữ liệu thật.

### Hai đường vào, dùng chung các hàm thuần trên

- **Đơn lẻ** (`AdvancedMetadataDialog`, dùng chung Workspace + Catalog Manager): nhánh mới cho item ĐANG LÀ phim lẻ (`kind !== 'episode'`) — radio "Series có sẵn" (dropdown, tự gợi ý season/episode kế tiếp khi chọn, checkbox kế thừa mặc định BẬT) / "Series mới" (gõ tay, season/episode mặc định 1/1). Bấm "Thêm vào series" chỉ ĐÁNH DẤU ý định (`addedToSeries` signal), áp dụng thật (`assignToSeries()`) khi bấm "Lưu" của chính dialog — cùng nguyên tắc "Lưu/Huỷ là điểm xác nhận" đã áp dụng cho "Chuyển thành phim lẻ".
- **Hàng loạt** (`AssignSeriesDialog` mới, `shared/dialog/`): chọn N dòng phim lẻ → một dialog chọn series (có sẵn/mới) MỘT LẦN cho cả batch → season cố định, episode tăng dần theo `startEpisode + index` (thứ tự `items()`/`queue()`, không phải thứ tự hiển thị cây — cùng giới hạn đã ghi cho `autoNumberEpisodes()`). Gợi ý tên series mới = title của dòng ĐẦU TIÊN đã chọn (cùng tinh thần `fillDown()`).

`DialogService` thêm `assignSeries(count, suggestedName, knownItems)`. `editAdvancedMetadata()` đổi chữ ký, thêm tham số `knownItems: CatalogItemV1[]` (trước `posterMsgId`).

### "Cross-reference catalog đã publish" (quyết định brainstorm)

`knownItems` truyền vào không chỉ là bảng đang sửa, mà GHÉP thêm catalog ĐÃ PUBLISH:

- **Catalog Manager:** đơn giản, `knownItems = this.items()` (đã load sẵn toàn bộ catalog, không cần đọc gì thêm).
- **Workspace:** cần đọc THÊM — hàm mới `fetchKnownItems()` gọi `readPinnedCatalog()` + `parseExistingCatalogItems()` ghép với `queue()` hiện tại. Best-effort: đọc lỗi (chưa chọn kênh, mất mạng) → fallback chỉ dùng Draft, KHÔNG chặn mở dialog (đây là danh sách GỢI Ý, không phải điều kiện bắt buộc).

### Trạng thái kiểm chứng

`ng build` (không cảnh báo ngân sách)/`npm run lint`/`npm run test:libs` (320 test, 10 mới) sạch. Không đụng Rust — không cần `cargo build`/`clippy`. **CHƯA verify bằng tài khoản Telegram thật.**

## Cập nhật sau khi Accepted (2026-09-18, vá bug "thêm series mới không hoạt động")

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

### Bug thật phát hiện qua báo cáo user

*"Thêm series mới không hoạt động, bấm Lưu mà không có series mới được tạo."*

**Nguyên nhân gốc:** yêu cầu ngay trước đó (cùng ngày) là đặt nút "Thêm vào series" cạnh nút "Tra TMDB" ở ĐẦU dialog, thay vì ở cuối form chọn series/season/episode như thiết kế gốc. Khi thực hiện, nút này vẫn là một nút **bấm-một-lần**: bấm là chốt NGAY giá trị các signal (`seriesAssignMode`/`seriesAssignExisting`/`seriesAssignNewName`/`seriesAssignSeason`/`seriesAssignEpisode`) đang có TẠI THỜI ĐIỂM ĐÓ vào `addedToSeries.set(true)`, rồi ẩn hẳn toàn bộ form — thay bằng một dòng hint tĩnh + nút "Huỷ".

Vì nút đặt Ở ĐẦU dialog (trước form), admin bấm nó ngay khi thấy (phản xạ tự nhiên với một nút nổi bật ở đầu) TRƯỚC KHI kịp chọn radio "Series mới" và gõ tên — form biến mất ngay lúc đó, admin không bao giờ có cơ hội gõ tên series mới. "Lưu" sau đó dùng giá trị MẶC ĐỊNH đã chốt nhầm (mode mặc định `'existing'` nếu catalog có sẵn series khác, hoặc nếu mặc định `'new'` thì `seriesAssignNewName` mặc định = title của chính bộ phim) — không phải điều admin định gõ, nên không có series mới nào theo ý admin được tạo.

### Sửa: checkbox thay nút bấm-một-lần

Đổi thành `<mat-checkbox [checked]="addedToSeries()" (change)="addedToSeries.set($event.checked)">` — **giữ nguyên vị trí** (cạnh "Tra TMDB", đúng yêu cầu bố cục ban đầu), nhưng giờ tick chỉ HIỆN form, form ở lại **hiển thị và chỉnh sửa được** cho tới khi thật sự bấm "Lưu" — không còn bước "chốt sớm" tách rời khỏi lúc Lưu. Bỏ nút "Huỷ thêm vào series" riêng (bỏ tick checkbox đã đủ, cùng ngữ nghĩa) và hai method thừa `confirmAddToSeries()`/`cancelAddToSeries()` (thay bằng set thẳng signal từ template, cùng cách checkbox `seriesAssignInherit` trong dialog này đã làm từ đầu).

### Bài học (nối tiếp bài học "vá bug Chuyển thành phim lẻ" cùng ngày)

Một nút chỉ có ĐÚNG MỘT hành động không cần điền thêm gì (như "Chuyển thành phim lẻ") đặt ở đầu dialog bên cạnh nút khác là an toàn — bấm là xong. Nhưng một hành động cần **điền thêm dữ liệu** trước khi áp dụng (như "Thêm vào series" — chọn/gõ tên, season, episode) thì nút "bấm để chốt" không được đứng TRƯỚC form nó chốt. Muốn đặt gần nút khác ở đầu dialog vì lý do bố cục, nó phải là một **toggle** (checkbox) mở form ra ở dưới và GIỮ NGUYÊN form đó cho tới khi thật sự "Lưu" — không phải một hành động chốt-ngay-rồi-ẩn.

### Trạng thái kiểm chứng

`ng build`/`npm run lint`/`npm run test:libs` (320 test, không đổi — sửa nằm ở logic/template component, không phải hàm thuần) sạch. Không đụng Rust. **CHƯA verify lại bằng tài khoản thật** — checklist đã cập nhật đúng bước trong [docs/pending-device-tests.md](../pending-device-tests.md) (mục "Thêm vào series", nhánh "Series mới" đơn lẻ).

## Cập nhật sau khi Accepted (2026-09-18, verify "Thêm vào series" — ĐẠT 7/7 bước, gồm cả bản vá checkbox)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết định gốc **vẫn đứng vững**.

User xác nhận qua `cargo tauri dev` + tài khoản Telegram thật, đánh dấu trực tiếp trong [docs/pending-device-tests.md](../pending-device-tests.md) — **7/7 bước ĐẠT**, cả đơn lẻ lẫn hàng loạt, cả Workspace lẫn Trình quản lý catalog:

- Series có sẵn: chọn từ dropdown, season/episode tự gợi ý đúng, kế thừa genres/cast/director từ tập đại diện đúng (không mất title/năm riêng của phim).
- **Series mới xác nhận ĐÚNG sau bản vá checkbox** — form không còn tự ẩn, gõ tên mới bình thường, "Lưu" tạo đúng series theo tên đã gõ (không còn rơi vào series có sẵn hay tên trùng phim như bug gốc).
- Cross-reference catalog đã publish từ Workspace hoạt động đúng (series chỉ có trong catalog đã publish vẫn xuất hiện trong dropdown khi đang ở Draft).
- Hàng loạt: season cố định + episode tăng dần đúng thứ tự, tạo series mới từ nhiều phim đã chọn với tên gợi ý đúng, đóng dialog không xác nhận đúng là không đổi gì.

Không phát sinh lệch thiết kế nào ngoài bug checkbox đã vá ở addendum ngay trên.
