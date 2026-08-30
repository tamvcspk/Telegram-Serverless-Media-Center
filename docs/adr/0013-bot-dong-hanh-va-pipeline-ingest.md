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

## Cập nhật sau khi Accepted (2026-08-29, phản biện "auto-probe-sau-khi-quét" + quyết định thứ tự xây)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định
> đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết
> định gốc **vẫn đứng vững**, xem lý do bên dưới.

**Bác bỏ hướng "auto-probe container/codec ngay lúc `scanSource()`"** (hướng đề xuất ở addendum ngay trên, cùng ngày) — hai lỗ hổng đủ nghiêm trọng để loại bỏ hẳn, không chỉ hoãn:

1. Container thật không hợp tác: `moov` atom của MP4 không-faststart nằm cuối file (bằng chứng thực nghiệm đã có sẵn ở [SPIKE-01](../spikes/README.md#spike-01) — Chrome phải nhảy tới gần cuối file để tìm `moov`), còn MKV/EBML không đảm bảo vị trí track info. Trích codec qua Range request tốn ≥2 round-trip MTProto/file, không phải một lần đọc header nhẹ nhàng như giả định ban đầu.
2. **Nghiêm trọng hơn:** chạy việc này lúc `scanSource()` bắt **tài khoản của người xem** (bất kỳ ai mở tab Nguồn) gánh N request `upload.getFile` cho N item mới trong một kênh — rủi ro `FLOOD_WAIT` diện rộng đúng loại đã bị cấm một lần ở [ADR-0010 §3](./0010-catalog-spec-v1-va-chien-luoc-indexing.md) (tra cứu publisher theo từng item lúc quét, cùng lý do). Việc này đi ngược thẳng lý do ADR-0013 tồn tại: chi phí phân loại compat phải nằm ở **lúc upload, phía admin** — không phải lúc xem, phía người xem.

**Quay lại đúng thiết kế gốc của Quyết định (mục 1):** compat được quyết định bằng `ffprobe` chạy **cục bộ trên máy admin** (không qua mạng, không qua trình duyệt), ánh xạ thẳng sang bảng A/B/C/D tĩnh — không cần bất kỳ browser API nào để "dò khả năng phát". Hệ quả trực tiếp: câu hỏi ở [SPIKE-08](../spikes/README.md#spike-08) (chọn API trình duyệt nào khớp `<video>` thật) **không còn gate đường ingest nữa**. Spike đó vẫn giữ nguyên giá trị cho một mục tiêu khác, ưu tiên thấp hơn: cảnh báo live phía `Player.checkCompat()` (`apps/web/src/app/player/player.ts`) nếu sau này muốn cá nhân hoá theo từng trình duyệt/thiết bị xem — không đóng spike, chỉ hạ mức ưu tiên và đổi lý do "vì sao quan trọng".

**Đã xác nhận: nỗi đau "gõ tay metadata cho nhiều tập phim" là có thật — không phải giả định.** Chính user đã upload phim qua app Telegram gốc và phải tự tay gõ Title/Năm/Compat qua Metadata Editor (Màn hình 6) — màn hình đó chỉ sửa được **một item mỗi lần**, không có autocomplete hay kế thừa từ tập trước cùng series. Đây là input trực tiếp, không phải suy đoán trước khi có công cụ nào tồn tại.

**Quyết định thứ tự xây:** xây `tsmc-ingest` CLI (mục 1 nguyên bản — Node + `ffprobe` cục bộ, upload qua MTProto/GramJS — hiện **chưa có một dòng code nào** trong repo) **trước** khi quyết định có bọc thêm GUI Tauri + Angular hay không. CLI một mình đã giải quyết dứt điểm cả hai lỗ hổng compat nêu trên với chi phí thấp nhất — không cần toolchain Rust/Tauri, không cần đóng gói/ký số đa nền tảng. Hướng GUI Tauri + Angular (autocomplete, kế thừa metadata theo season/episode) vẫn **hợp lý về nguyên tắc** (probe cục bộ, không đẩy chi phí sang người xem — cùng nguyên tắc CLI) nhưng **chưa quyết** — để ngỏ tới khi CLI chạy thật và lộ rõ đúng phần việc gõ tay nào còn đau sau khi đã có `ffprobe` tự động hoá phần compat.

**Việc tiếp theo:** viết `tsmc-ingest` CLI theo đúng mục 1 (probe → phân hạng → remux nếu cần → upload → sinh entry catalog). Vì nỗi đau gõ tay đã xác nhận là thật, thiết kế UX dòng lệnh của bước nhập metadata nên tính tới khả năng "kế thừa từ tập trước cùng series" ngay từ v1 của CLI — không đợi tới khi (nếu) có GUI mới xử lý.

## Cập nhật sau khi Accepted (2026-08-29, `tsmc-ingest` CLI — lần code đầu tiên)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định
> đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết
> định gốc **vẫn đứng vững** (ba thành phần CLI/bot/chế độ admin web, bảng
> phân hạng A/B/C/D) — chỉ mục 1 (CLI) vừa được code lần đầu, gỡ dòng "chưa có
> một dòng code nào" ở addendum ngay trên.

**Vị trí code:** `apps/tsmc-ingest` (CLI — `build.mjs` bằng esbuild → `dist/cli.js`, lệnh `login`/`probe`/`upload`) + `libs/core-ingest` (lib mới, logic thuần không I/O: `compat-rank.ts` phân hạng A/B/C/D + suy `compat` cuối cùng, `metadata-inherit.ts` kế thừa metadata theo series, `catalog-merge.ts` gộp/đóng gói catalog) + `libs/core-mtproto/src/gateway-ingest.ts` (method `uploadVideoDocument()` — việc thật sự MỚI duy nhất cần thêm vào core-mtproto; `publishCatalogDocument()` đã có sẵn từ slice Ingest Editor, CLI tái dùng nguyên vẹn không sửa).

**Phát hiện thật khi code (không phải giả định trước đó):**

1. **`createTelegramGateway()` (`gateway.ts`) hardcode `@tsmc/core-storage` (Dexie/IndexedDB) để lưu session** — chỉ chạy được trong trình duyệt, và đây là rào cản DUY NHẤT từng ngăn CLI tái dùng thẳng gateway đã có. Đã tách thành interface `SessionStoragePort` (`get`/`put`/`delete`), tham số hoá qua `createTelegramGateway(deps?)`, mặc định vẫn dùng adapter Dexie cũ (zero behavior change cho web/worker-host). CLI truyền một adapter file cục bộ mã hoá riêng (`apps/tsmc-ingest/src/session-storage-node.ts`, ghi ở `~/.tsmc-ingest/session.local.json` — **ngoài repo hoàn toàn**, mạnh hơn chỉ dựa vào `.gitignore`).
2. **Khoá mã hoá session (`session-crypto.ts`, AES-GCM) luôn sinh non-extractable** — đúng cho Dexie (IndexedDB giữ nguyên object `CryptoKey` qua structured clone giữa các lần tải trang, không cần export bytes). CLI thì mỗi lần chạy là một **tiến trình Node mới**, không có cơ chế tương đương — phải tự `exportKey`/`importKey` ra bytes để ghi file, nên bắt buộc key phải extractable. Thêm tham số `generateSessionKey(extractable = false)`, CLI gọi qua `createTelegramGateway({ sessionKeyExtractable: true })`. Mối đe doạ khác nhau giữa hai ngữ cảnh (trình duyệt: chống XSS đọc trộm key cùng trang; CLI: tiến trình Node cục bộ đọc được file key thì đằng nào cũng đọc được ciphertext cạnh đó) nên extractable không mở thêm bề mặt tấn công thật nào ở CLI.
3. **`browser-shim.ts` (giả lập `globalThis.window` cho GramJS nhận đúng môi trường Worker) xác nhận AN TOÀN với CLI mà không cần sửa gì** — nó chỉ patch khi `self` tồn tại mà `window` thì không (đúng dấu hiệu Worker global scope thật). Tiến trình Node của CLI không có cả hai global đó nên không bị patch — GramJS tự nhận đúng "đang chạy Node" và dùng nhánh gốc của nó (TCP thật, `crypto` thật), không cần entry point hay polyfill riêng nào.
4. **esbuild bundle cho CLI (`apps/tsmc-ingest/build.mjs`, `platform: 'node'` — ngược hướng `libs/worker-host/build.mjs` vốn bundle cho browser) vỡ hai lần lúc build/chạy thật đầu tiên:**
   - Dùng cả `banner: { js: '#!/usr/bin/env node' }` **lẫn** shebang có sẵn ở dòng đầu `cli.ts` → output có **hai** dòng shebang; dòng thứ hai không được Node bỏ qua (chỉ dòng đầu tiên của file mới được coi là shebang) và `#` không phải cú pháp JS hợp lệ → `SyntaxError` ngay khi chạy. Sửa: bỏ `banner`, chỉ giữ shebang trong source — esbuild tự hoist shebang có sẵn của entry point lên đầu output.
   - Bundle nguyên `telegram` (GramJS, CommonJS) cho `platform: 'node'` vỡ runtime `"Dynamic require of \"util\" is not supported"` — thư viện có nhánh `require(<biến>)` nội bộ (không phải string literal tĩnh) mà esbuild không phân tích tĩnh được khi bundle. Sửa: để `telegram`/`big-integer` là `external` (không bundle, resolve qua `node_modules` thật lúc chạy) — phải khai thêm hai package này làm dependency **trực tiếp** của `apps/tsmc-ingest/package.json` (dù chỉ dùng gián tiếp qua `@tsmc/core-mtproto`) để pnpm đặt đúng symlink `node_modules` cạnh `dist/cli.js`, nếu không runtime resolution từ vị trí file build (khác vị trí lúc esbuild resolve qua symlink workspace) sẽ không tìm thấy.

**Ranh giới ESLint (`eslint.config.mjs`, ADR-0012 §2):** thêm phần tử `app-ingest` (`apps/tsmc-ingest/src/**`) **tách riêng** khỏi `type: 'app'` hiện có — policy "app không được import `lib-mtproto` trực tiếp, phải qua worker-host" đúng cho `apps/web` (không có cách nào khác ngoài trình duyệt) nhưng **sai** cho CLI (không có worker-host để đi qua ngoài trình duyệt, cần import `@tsmc/core-mtproto` thẳng, giống cách `worker-host` đang làm). `libs/core-ingest` gia nhập nhóm `lib-core` hiện có (cùng `core-index`/`core-search`/`core-sync`/`core-storage`/`worker-host`) — không tạo type mới, vì cùng ràng buộc "không phụ thuộc Angular, test được bằng Node thuần".

**Trạng thái kiểm chứng (2026-08-29):** `npm run lint`, `tsc --noEmit` (cả `core-ingest`, `core-mtproto`, `apps/tsmc-ingest`), `npm run test:libs` (280/280 test — gồm test mới cho `compat-rank`/`metadata-inherit`/`catalog-merge`/`gateway-ingest`) đều sạch. CLI build thành công (`node apps/tsmc-ingest/build.mjs`) và chạy được: usage không tham số, preflight báo đúng lỗi khi thiếu `ffprobe`/`ffmpeg` trên PATH, thiếu `--channel`, thiếu `TSMC_API_ID`/`TSMC_API_HASH` — đều đúng thông điệp và exit code.

**Chưa kiểm chứng — để dành cho admin tự chạy (CLAUDE.md: không chạy đăng nhập MTProto hộ người dùng):**
- `login`/`probe`/`upload` thật bằng tài khoản Telegram thật + `ffmpeg`/`ffprobe` cài thật + kênh test thật (khuôn SPIKE-06: kênh tự tạo, tự xoá sau khi test).
- Ngưỡng phân hạng A/B/C/D (`compat-rank.ts`) mới test bằng fixture ffprobe JSON giả lập tay — chưa đối chiếu với file mẫu thật (MP4/H.264/AAC faststart, MKV/HEVC, AVI...).

**Việc chưa làm, nằm ngoài phạm vi lần code này (đã ghi ở `docs/roadmap.md`):** phụ đề rút ra (`extractSubtitles()`) hiện chỉ lưu **cục bộ**, CLI v1 chưa upload kèm file phụ đề lên kênh; retry/rollback khi `FLOOD_WAIT` rơi giữa chuỗi 3 RPC của `publishCatalogDocument()` là gap đã có từ trước (dùng chung với Ingest Editor web), CLI kế thừa nguyên trạng, không tự thêm; `@tsmc_bot` (mục 2 Quyết định gốc) và quyết định GUI Tauri (còn để ngỏ) không thuộc phạm vi lần này.

## Cập nhật sau khi Accepted (2026-08-30, verify Hạng C bằng tài khoản/kênh thật lần đầu)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định
> đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết
> định gốc **vẫn đứng vững**, xem lý do bên dưới.

Admin tự chạy `tsmc-ingest` **thật** lần đầu (tài khoản Telegram thật, kênh thật `tsmc_mediacenter`, file mẫu MKV/H.264 1280x720/audio AC3 thật — `[KST.VN].The.Big.Bang.Theory.S01Tap01.HD.[KSTE].mkv`) — gỡ MỘT PHẦN caveat "chưa kiểm chứng thiết bị thật" của addendum 2026-08-29 ngay trên. **Chỉ phủ nhánh Hạng C**, chưa phủ A/B/D (xem "Còn thiếu" cuối mục này).

**Kết quả:**
- `probe`: đúng Container `matroska`, Video `h264 1280x720`, Audio `ac3` → **Hạng C**, khớp bảng phân hạng ở mục 1 Quyết định gốc.
- `upload`: remux copy-video + encode-audio AAC bằng `ffmpeg` thật chạy đúng (~33 giây cho ~22 phút nội dung, tốc độ 40.8x, output 412874 KiB); prompt Title/Năm hoạt động (seed từ tên file, admin sửa đè được); `restoreSession()` khôi phục đúng session cũ — xác nhận GIÁN TIẾP vì `upload` đi thẳng vào pipeline, không hỏi lại phone/mã; upload thành công (`msgId 3`); `compat` suy đúng **"full"** (video vẫn H.264 sau remux, audio đã encode sang AAC — đúng logic `deriveCompat()`). Xác nhận lại bằng Telegram app thật: video phát được, `catalog.v1.json` đã ghim và có nội dung đúng.

**Hai bug lộ ra lúc chạy thật lần đầu** (unit test/build trước đó không bắt được — không mô phỏng một tiến trình Node thật chạy hết pipeline với kết nối MTProto thật):

1. **CLI treo vô thời hạn sau khi xong việc** (không tự thoát sau `login`/`upload` thành công). Nguyên nhân: GramJS giữ kết nối MTProto (WebSocket/TCP) mở kèm timer keep-alive nội bộ — event loop của Node không bao giờ tự rỗng nếu không exit thẳng. CLI này one-shot (không phải daemon), sửa bằng cách gọi `process.exit(process.exitCode ?? 0)` ngay sau khi `main()` (`apps/tsmc-ingest/src/cli.ts`) settle — mọi ghi quan trọng (session ra đĩa, upload/publish lên Telegram) đã `await` xong trước đó nên không mất gì.
2. **Thêm đọc `TSMC_PHONE_NUMBER` tuỳ chọn từ `.env`** (`apps/tsmc-ingest/src/commands/login.ts`) — không phải bug đúng nghĩa, phát sinh trực tiếp từ việc test lặp lại nhiều lần bằng tay (gõ lại số điện thoại mỗi lần test gây chậm không cần thiết). Có biến thì bỏ qua prompt, không có thì hỏi tay như cũ — không đổi hành vi mặc định.

**Phát hiện phụ, không phải bug** (ghi lại để không ai sau này hoảng, tốn công điều tra nhầm): log GramJS in `"Running gramJS version 2.26.21"` dù `package.json`/lockfile ghim đúng `telegram@2.26.22` (CLAUDE.md bất biến #9). Đã verify: `node_modules/.pnpm/telegram@2.26.22.../Version.js` tự hardcode chuỗi phiên bản nội bộ `"2.26.21"` — lệch có sẵn TỪ TRƯỚC bên trong chính package đã archive, không phải lỗi cài đặt/lockfile của repo này.

**Cập nhật cùng ngày — test "kế thừa metadata" thật (mục "Còn thiếu" bên dưới, bản gốc): ĐÃ LÀM, phát hiện thêm một bug thật.** Admin upload file thứ hai cùng series (`S01E02.mp4`) ngay sau file đầu, chọn "kế thừa" — season/episode tự tăng đúng (1→2), catalog **gộp** đúng (3 item, không mất item cũ, đúng ngữ nghĩa "gộp không phải thay"). Nhưng đọc `catalog.v1.json` thật do CLI ghi cho thấy `series.name` của cả hai item episode là **`"S01E01.mp4"`/`"S01E02.mp4"` (chuỗi tên file trần trụi)**, không phải tên phim — bug thật, hai nguyên nhân cộng lại:
   - `inheritMetadata()` (`libs/core-ingest/src/metadata-inherit.ts`) lấy NGUYÊN `series` (gồm cả `name`) từ `parseFilenameFallback()` của file MỚI thay vì chỉ lấy `season`/`episode` và giữ `series.name` của item TRƯỚC — khi tên file mới chỉ có dạng `SxxExx` trần trụi (không mang tên phim, khác các test/fixture trước đó vốn luôn có tên phim trong filename mẫu), `series.name` bị ghi đè bằng chính chuỗi filename.
   - Lớp CLI (`apps/tsmc-ingest/src/commands/upload.ts`, `resolveMetadataForFile()`) khi admin gõ Title đúng qua prompt chỉ cập nhật field `title` top-level, không đồng bộ lại `series.name` — item ĐẦU TIÊN của series (seed từ file `"S01E01.mp4"` trần trụi, `title` VÀ `series.name` ban đầu đều là chuỗi filename) admin có gõ Title đúng ("The bigbang Theory") nhưng `series.name` không theo, để lại giá trị cũ trong catalog.
   
   **Đã sửa cả hai:** `inheritMetadata()` giờ chỉ lấy `season`/`episode` từ file mới, `series.name` LUÔN kế thừa từ `previous.series?.name ?? previous.title`; `resolveMetadataForFile()` giờ đồng bộ `series.name` theo Title CUỐI CÙNG (sau khi admin sửa đè) mỗi lần prompt. Thêm 2 unit test tái hiện đúng bug thật (`libs/core-ingest/src/metadata-inherit.spec.ts`) — tổng 282/282 test qua.

**Còn thiếu, để dành lần verify sau** (checklist đã cập nhật ở [docs/pending-device-tests.md](../pending-device-tests.md)):
- File mẫu Hạng A (MP4/H.264/AAC đã faststart)/Hạng B (HEVC hoặc audio Opus/E-AC-3)/Hạng D (AVI hoặc codec không giải được) thật.
- Xác nhận thumbnail hiển thị đúng trong Telegram (pipeline không báo lỗi ở bước sinh thumbnail nhưng chưa nhìn tận mắt kết quả).
- Re-verify "kế thừa metadata" một lần nữa SAU khi vá bug `series.name` ở trên (lần verify vừa rồi phát hiện bug TRƯỚC khi có bản vá — chưa có lần chạy thật nào xác nhận bản vá đúng trên tài khoản thật, chỉ mới qua unit test).

## Cập nhật sau khi Accepted (2026-08-30, nối dây subtitle upload — phụ đề text không còn bị bỏ phí)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định
> đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết
> định gốc **vẫn đứng vững**, xem lý do bên dưới.

**Bối cảnh:** `apps/tsmc-ingest/src/commands/upload.ts` trước đây rút phụ đề ra file cục bộ bằng `extractSubtitles()` (cho Hạng C) rồi **bỏ luôn** — tự log "CHƯA upload — CLI v1 chưa gửi kèm subs, chỉ để dành cho admin tự đăng riêng". Schema catalog (`libs/shared-models/src/catalog.ts`, field `subs: { lang, msgId }[]`) đã có sẵn chỗ cho subtitle từ trước nhưng chưa có gì ghi vào đó. Brainstorm cùng ngày với addendum verify Hạng C ở trên: user đánh giá đây là gap **quan trọng hơn** việc verify Hạng A/B/D bằng file mẫu thật — cả ba hạng đó chỉ là biến thể của cùng cơ chế remux/copy-stream đã verify, còn subtitle upload là một tính năng **hoàn toàn chưa nối dây**, không phải "chưa verify". Hạng A/B/D vì vậy bị hoãn có chủ đích, subtitle được ưu tiên làm trước.

**Đã làm (code, chưa verify thiết bị thật):**
- `libs/core-mtproto/src/gateway-ingest.ts`: thêm `uploadSubtitleDocument(channelId, { filePath, fileName })` — cùng pattern `uploadVideoDocument()` nhưng `forceDocument: true` (file phụ trợ, không phải media cần `DocumentAttributeVideo`/streaming), không gán `caption`. Thêm method này vào interface `TelegramGateway` (`gateway.ts`).
- `libs/core-ingest/src/gateway-port.ts`: mở rộng interface `IngestGateway` với method tương ứng (`IngestSubtitleUploadInput`).
- `apps/tsmc-ingest/src/commands/upload.ts`: sau khi upload video, loop qua các phụ đề đã rút — **chỉ** upload phụ đề TEXT (`.srt`, `isImageBased === false`). Phụ đề ảnh (`.sup`, PGS) **vẫn** giữ hành vi cũ — chỉ lưu cục bộ, log riêng — vì trình duyệt không tự render `.sup` như một text track; đây là quyết định nhỏ khi code, không đổi bảng phân hạng A/B/C/D đã Accepted. Kết quả upload (`{ lang, msgId }`, `lang` fallback `'und'` khi ffprobe không trả tag ngôn ngữ) được gán vào `finalItem.subs` trước khi push vào catalog.
- Test: thêm 1 unit test cho `uploadSubtitleDocument()` (`libs/core-mtproto/src/gateway-ingest.spec.ts`) — 283/283 test qua (tăng từ 282). `npm run lint`, `tsc --noEmit` (apps/tsmc-ingest, core-mtproto, core-ingest), `npm run build:ingest` đều sạch.

**Chưa kiểm chứng — để dành cho admin tự chạy** (CLAUDE.md: không chạy đăng nhập MTProto hộ người dùng): upload thật một file Hạng C có phụ đề text nhúng, xác nhận `catalog.v1.json` thật ghi đúng `subs[]`, và mở message phụ đề trong Telegram app thật để xác nhận tải được — checklist mới ở [docs/pending-device-tests.md](../pending-device-tests.md#tsmc-ingest-cli--loginprobeupload-thật-2026-08-29).

**Điều gì KHÔNG đổi:** bảng phân hạng A/B/C/D và toàn bộ Quyết định gốc mục 1 đứng nguyên — đây chỉ là hoàn thiện một bước đã có tên trong pipeline gốc ("rút phụ đề") nhưng trước đó dừng ở "rút", chưa "gửi kèm".

**Việc tiếp theo:** admin verify thật theo checklist mới; Hạng A/B/D vẫn hoãn có chủ đích như addendum trên.

## Cập nhật sau khi Accepted (2026-08-30, re-verify bản vá `series.name` bằng tài khoản thật — ĐẠT)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định
> đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết
> định gốc **vẫn đứng vững**, xem lý do bên dưới.

Gỡ nốt mục "Còn thiếu" cuối cùng của addendum "verify Hạng C..." phía trên: **"Re-verify kế thừa metadata một lần nữa SAU khi vá bug `series.name`"** — admin build lại CLI (đã có bản vá) rồi upload thêm một file thứ ba cùng series (`S01E08.mkv`, chọn "kế thừa" từ item trước), kết quả **ĐẠT**:

- `catalog.v1.json` thật (5 item, `msgId 15`) có `series: { name: "The big bang theory", season: 1, episode: 8 }` — `series.name` khớp đúng tên phim (đồng bộ với `title` sau khi admin gõ lại qua prompt), **không còn** ra chuỗi filename trần trụi (`"S01E08.mkv"`) như bug đã ghi ở addendum trên.
- Catalog vẫn **gộp** đúng — đủ cả 5 item cũ + mới (`msgId` 3/6/9/12/15), không mất item nào qua nhiều lần publish liên tiếp (`generatedAt` cập nhật mỗi lần, `msgId` catalog document tự tăng 13→16 qua các lần ghi/xoá-bản-cũ của `publishCatalogDocument()`).
- Pipeline vẫn ổn định qua nhiều lần chạy liên tiếp trong cùng ngày: remux 52.3x (nhanh hơn lần đo đầu 40.8x — cùng cấp độ, chênh lệch hợp lý do khác file/tải máy), kết nối/ngắt kết nối DC nhiều lần không phát sinh lỗi.

**Không phát sinh bug mới.** Đây là bằng chứng đóng hẳn caveat "series.name — chưa re-verify" — không cần giữ trong danh sách "Còn thiếu" nữa (đã xoá khỏi checklist tương ứng ở [docs/pending-device-tests.md](../pending-device-tests.md)).

## Cập nhật sau khi Accepted (2026-08-30, phụ đề ngoài — sidecar — tự dò file .srt/.vtt cạnh video)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định
> đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết
> định gốc **vẫn đứng vững**, xem lý do bên dưới.

**Bối cảnh:** sau khi nối dây upload phụ đề NHÚNG (addendum "nối dây subtitle upload" phía trên, cùng ngày), user đọc README mới viết và chỉ ra một khoảng trống: ví dụ lệnh `upload` trong README chỉ truyền file video, không có cách nào chỉ định phụ đề — nhưng rất nhiều file thực tế có phụ đề dưới dạng file `.srt` **RỜI** đặt cạnh video (không nhúng trong container, ví dụ scene release kèm sẵn phụ đề ngoài), CLI trước đó hoàn toàn không xử lý case này, dù `extractSubtitles()` chỉ đọc track nhúng qua ffprobe/ffmpeg. Hướng chọn: tự động dò phụ đề ngoài theo quy ước phổ biến của Plex/Jellyfin/Kodi (`<tên video>.srt` hoặc `<tên video>.<mã ngôn ngữ 2-3 ký tự>.srt`, cũng nhận `.vtt`) — **không** thêm flag CLI mới, vì `upload` hỗ trợ batch nhiều video trong một lệnh và một flag kiểu `--subs <file>` sẽ không rõ ràng ứng với video nào khi có nhiều file trên cùng dòng lệnh.

**Đã làm (code, chưa verify thiết bị thật):**
- `libs/core-ingest/src/sidecar-subtitles.ts` (mới): `matchSidecarSubtitles(videoFileName, siblingFileNames)` — logic thuần so khớp tên file bằng regex, không đọc đĩa (đúng ranh giới I/O-ngoài/logic-thuần đã có sẵn của package). Test bằng fixture (`sidecar-subtitles.spec.ts`, 8 case: có lang/không lang, `.vtt`, không tự khớp lại chính file video, không khớp file khác basename, không khớp `.ass`/`.ssa` ngoài phạm vi v1, không phân biệt hoa/thường, mảng rỗng khi không có gì cạnh video). Xuất qua `libs/core-ingest/src/index.ts`.
- `apps/tsmc-ingest/src/sidecar-subtitles.ts` (mới): wrapper I/O — `readdir()` thư mục chứa video rồi gọi hàm thuần ở trên.
- `apps/tsmc-ingest/src/commands/upload.ts`: gọi `findSidecarSubtitles(filePath)` cho **mọi** file (không giới hạn Hạng C như phụ đề nhúng — phụ đề ngoài độc lập với hạng compat), upload từng file tìm được qua `uploadSubtitleDocument()` đã có sẵn (addendum trước), gộp chung vào `subs[]` cùng phụ đề nhúng.
- Chỉ nhận đuôi `.srt`/`.vtt` (text thuần, dùng ngay không cần convert) — `.ass`/`.ssa` chưa hỗ trợ, cùng lý do `.sup`/PGS không tự upload ở addendum trước.
- Test: 291/291 qua (tăng từ 283, +8 test mới cho `sidecar-subtitles.spec.ts`). `npm run lint`, `tsc --noEmit` (apps/tsmc-ingest, core-ingest), `npm run build:ingest` đều sạch.
- README (`apps/tsmc-ingest/README.md`, mục "Phụ đề") cập nhật giải thích rõ hai nguồn (nhúng vs ngoài) kèm ví dụ cụ thể.

**Chưa kiểm chứng — để dành cho admin tự chạy:** upload một video có sẵn file `.srt` ngoài đặt đúng tên cạnh nó, xác nhận CLI tự phát hiện + upload + ghi đúng `subs[]`.

**Điều gì KHÔNG đổi:** Quyết định gốc mục 1 (bảng phân hạng A/B/C/D) đứng nguyên — phụ đề ngoài không liên quan tới phân hạng compat, chỉ là một nguồn phụ đề bổ sung cạnh phụ đề nhúng đã có.

**Việc tiếp theo:** admin verify thật; cân nhắc hỗ trợ `.ass`/`.ssa` sau nếu có nhu cầu thật (chưa có bằng chứng cần ngay).
