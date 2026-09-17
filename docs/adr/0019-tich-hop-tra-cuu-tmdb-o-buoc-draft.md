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
