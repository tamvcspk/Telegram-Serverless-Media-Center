# Việc chờ kiểm chứng trên thiết bị thật

> **Cách dùng tài liệu này:** danh sách tính năng đã code + deploy staging nhưng **chưa** chạy qua tài khoản Telegram thật — khác [docs/roadmap.md](./roadmap.md) (việc **chưa code**) và khác spike (đặt cược kiến trúc bằng script rời, xem [docs/spikes/README.md](./spikes/README.md)). Đây là code sản xuất thật, chỉ còn thiếu một lượt chạy tay để xác nhận không có gì vỡ khi gặp dữ liệu Telegram thật (entity offset/length, quyền, giới hạn API...).
>
> **Cách cập nhật:** xong một mục → xoá khỏi đây, ghi 1-2 dòng kết quả vào [docs/changelog.md](./changelog.md), và nếu phát hiện gì lệch với thiết kế thì thêm addendum vào ADR liên quan (dùng skill `/adr`). Khi mục cuối cùng của một tính năng biến mất khỏi đây, gỡ luôn nhãn `[Cần kiểm chứng thiết bị thật]` tương ứng ở roadmap.md.

## `tsmc-ingest` CLI — login/probe/upload thật (2026-08-29)

Liên quan: [ADR-0013 § Cập nhật 2026-08-29, lần code đầu tiên](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-08-29-tsmc-ingest-cli--lần-code-đầu-tiên), [docs/roadmap.md § Ingest](./roadmap.md#ingest). Khác các mục khác trong file này — đây không phải tính năng web deploy lên staging, mà một CLI chạy trên **máy admin**, nên "thiết bị thật" ở đây nghĩa là: tài khoản Telegram thật + `ffmpeg`/`ffprobe` cài thật + file video mẫu thật (không phải fixture JSON giả lập ffprobe như unit test hiện có).

**KHÔNG chạy hộ bằng agent/Claude** — CLAUDE.md: "Không chạy đăng nhập MTProto hộ người dùng". Admin tự chạy các bước dưới trong terminal của họ.

### Chuẩn bị

- [x] Cài `ffmpeg` (kèm `ffprobe`) trên PATH — `winget install ffmpeg` / `brew install ffmpeg` / `apt install ffmpeg`.
- [x] Có `TSMC_API_ID`/`TSMC_API_HASH` (tự tạo tại https://my.telegram.org).
- [x] Build CLI: `npm run build:ingest` (sinh `apps/tsmc-ingest/dist/cli.js`).
- [x] Kênh test + file mẫu Hạng C thật (MKV/H.264/audio AC3) — xem kết quả 2026-08-30 bên dưới.
- [x] File mẫu Hạng D thật (AVI) — verify thật 2026-08-30, xem "Kết quả verify 2026-08-30 (Hạng D + phụ đề ngoài)" bên dưới. **Còn thiếu (hoãn có chủ đích — brainstorm 2026-08-30):** file mẫu Hạng A (MP4/H.264/AAC faststart sẵn), Hạng B (HEVC/AV1 hoặc Opus/E-AC-3) — cả hai chỉ là biến thể của cùng cơ chế remux/copy-stream đã verify ở Hạng C, nên không ưu tiên verify riêng ngay bây giờ.
- [ ] File mẫu MKV có phụ đề TEXT nhúng (không phải PGS ảnh) — file mẫu Hạng C hiện có (`[KST.VN].The.Big.Bang.Theory...`) chưa xác nhận có track phụ đề hay không; cần để verify nhánh upload subtitle mới (xem mục dưới).

### Các bước

- [x] `node apps/tsmc-ingest/dist/cli.js login` — verify thật 2026-08-30 (xem bên dưới).
- [x] `restoreSession()` khôi phục đúng, KHÔNG hỏi lại phone/mã — xác nhận gián tiếp: `upload` lần chạy 2026-08-30 đi thẳng vào pipeline mà không hỏi lại phone/code, chứng tỏ session cũ được khôi phục.
- [x] `tsmc-ingest probe <file mẫu>` — verify thật 2026-08-30, đúng Hạng C cho file MKV/H.264/AC3 (xem bên dưới). Còn thiếu probe cho mẫu A/B/D.
- [x] `tsmc-ingest upload --channel <ref kênh test> <file mẫu>` — verify thật 2026-08-30, pipeline chạy hết (remux → prompt metadata → upload → publish), xem bên dưới.
- [x] Mở kênh test bằng Telegram app thật — xác nhận file đã upload phát được, `catalog.v1.json` đã ghim và có nội dung. **Còn thiếu:** chưa xác nhận rõ ràng thumbnail có hiện đúng không (pipeline không báo lỗi ở bước sinh thumbnail, nhưng chưa nhìn tận mắt trong Telegram).
- [x] Upload thêm MỘT file thứ hai cùng series (tên file dạng `S01E02`) — verify thật 2026-08-30: prompt "kế thừa metadata" hoạt động, season/episode tự tăng đúng (1→2). **Phát hiện bug thật lúc này** — xem bên dưới, đã vá, CHƯA re-verify bằng tài khoản thật sau vá (chỉ mới qua unit test).
- [x] Xác nhận catalog sau lần upload thứ hai có ĐỦ cả hai item (không bị ghi đè mất item đầu) — verify thật 2026-08-30: catalog có đủ 3 item (msgId 3/6/9), đúng ngữ nghĩa "gộp".
- [x] **Phát sinh từ bug vừa vá:** re-upload một file thứ hai cùng series lần nữa (sau khi đã build lại CLI với bản vá `series.name`) — verify thật 2026-08-30, **ĐẠT**: upload `S01E08.mkv` chọn "kế thừa", `series.name` ra đúng `"The big bang theory"` (khớp title), không còn ra chuỗi filename trần trụi. Catalog vẫn gộp đủ 5 item. Chi tiết: [ADR-0013 § Cập nhật 2026-08-30, re-verify series.name — ĐẠT](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-08-30-re-verify-bản-vá-seriesname-bằng-tài-khoản-thật--đạt).
- [ ] **MỚI (2026-08-30, subtitle upload):** upload một file Hạng C có phụ đề TEXT nhúng (`.srt` sau khi rút, không phải PGS) — xác nhận: (1) `extractSubtitles()` chạy đúng như cũ, (2) mỗi phụ đề text được upload thành document rời qua `uploadSubtitleDocument()` (KHÔNG còn chỉ lưu cục bộ như hành vi cũ), (3) `catalog.v1.json` thật ghi đúng `subs: [{ lang, msgId }]` cho item đó, (4) mở message phụ đề trong Telegram app thật, xác nhận tải/xem được. Nếu file mẫu có cả track PGS (ảnh), xác nhận track đó VẪN chỉ lưu cục bộ (không upload) và log đúng thông báo "CHƯA upload" mới.
- [x] **Phụ đề ngoài — sidecar:** verify thật 2026-08-30, **ĐẠT** — xem "Kết quả verify 2026-08-30 (Hạng D + phụ đề ngoài)" bên dưới. **Còn thiếu:** chưa thử case tên sai quy ước (đuôi khác/basename không khớp) để xác nhận CLI bỏ qua đúng, không nhầm lẫn; chưa thử nhiều phụ đề cùng lúc (đa ngôn ngữ) trên một video.

### Kết quả verify 2026-08-30 (Hạng C, lần đầu tiên trên tài khoản/kênh thật)

File mẫu: `[KST.VN].The.Big.Bang.Theory.S01Tap01.HD.[KSTE].mkv` (MKV/H.264 1280x720/audio AC3), kênh `tsmc_mediacenter`.

- `probe`: đúng Container `matroska`, Video `h264 1280x720`, Audio `ac3` → **Hạng C** (khớp bảng ADR-0013).
- `upload`: remux copy-video + encode-audio AAC chạy thật (ffmpeg, ~33s cho ~22 phút nội dung, tốc độ 40.8x — output 412874 KiB), prompt Title/Năm hoạt động (seed từ filename, admin sửa đè được), kết nối 2 DC khác nhau lúc đăng nhập/lúc upload (bình thường — GramJS tự chọn DC theo tác vụ), upload thành công (`msgId 3`), `compat` suy ra **"full"** (đúng — sau remux, video vẫn H.264 + audio đã encode sang AAC).
- Xác nhận bằng Telegram app thật: video có mặt, phát được; `catalog.v1.json` đã ghim và tồn tại.
- **Phát hiện phụ (không phải bug):** log GramJS in `"Running gramJS version 2.26.21"` dù `package.json`/lockfile ghim đúng `telegram@2.26.22` (đã verify lại: `node_modules/.pnpm/telegram@2.26.22.../Version.js` tự hardcode chuỗi `"2.26.21"` — lệch version nội bộ có sẵn TỪ TRƯỚC trong chính package đã archive, không phải lỗi cài đặt/lockfile của repo này). Ghi lại để không ai sau này hoảng vì tưởng cài sai version.
- **Bug thật phát hiện khi upload file thứ hai cùng series:** `catalog.v1.json` thật cho thấy `series.name` của cả hai item episode ra `"S01E01.mp4"`/`"S01E02.mp4"` (chuỗi tên file trần trụi) thay vì tên phim, dù `title` đúng. Nguyên nhân + bản vá: xem [ADR-0013 § Cập nhật 2026-08-30](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-08-30-verify-hạng-c-bằng-tài-khoảnkênh-thật-lần-đầu). Đã vá `inheritMetadata()` (`libs/core-ingest/src/metadata-inherit.ts`) + `resolveMetadataForFile()` (`apps/tsmc-ingest/src/commands/upload.ts`), thêm 2 unit test tái hiện đúng bug — **CHƯA re-verify bằng tài khoản thật sau vá.**

### Kết quả verify 2026-08-30 (Hạng D + phụ đề ngoài)

File mẫu: `The Big Bang Theory S01E01.avi` (container AVI, ~24 phút) + sidecar `The Big Bang Theory S01E01.srt` (không có mã ngôn ngữ trong tên file) đặt cùng thư mục, kênh `tsmc_mediacenter`.

- `probe`/phân hạng: đúng **Hạng D** ("Container AVI — luôn Hạng D bất kể codec bên trong", khớp ADR-0013), CLI hỏi xác nhận re-encode trước khi chạy — đúng thiết kế "re-encode luôn phải hỏi".
- `re-encode`: `libx264 preset medium` chạy thật, ~24 phút nội dung xong sau ~42s (elapsed), tốc độ 33.5x, output ~127 MB. Nhanh hơn nhiều so với ước tính "hàng giờ" ở Quyết định gốc ADR-0013 (đúng bản chất — ước tính đó là cảnh báo thận trọng cho admin, không phải benchmark) — đáng ghi lại làm số liệu thật đầu tiên cho Hạng D.
- **Phụ đề ngoài (sidecar) — ĐẠT:** CLI tự log "Phụ đề ngoài phát hiện: The Big Bang Theory S01E01.srt", upload thành công, `catalog.v1.json` thật ghi đúng `subs: [{ "lang": "und", "msgId": 19 }]` cho item (`msgId 18`) — `lang: "und"` đúng như kỳ vọng vì tên file sidecar không mang mã ngôn ngữ (`sub.lang ?? 'und'` hoạt động đúng).
- Upload video thành công (`msgId 18`), `compat` suy đúng **"full"** (sau re-encode, H.264 + AAC). Catalog gộp đúng — đủ 6 item qua nhiều lần publish liên tiếp trong ngày.
- **Quan sát (không phải bug):** phát video trong app thật — phát được, nhưng **không thấy phụ đề nào hiện lên**. Đây là hành vi ĐÚNG theo phạm vi hiện tại — `apps/web/src/app/player/` chưa có bất kỳ code nào đọc `subs[]`/gắn `<track>` cho `<video>`; `tsmc-ingest` chỉ có nhiệm vụ upload + ghi tham chiếu vào catalog, không phải render. Ghi nhận thành gap mới ở [docs/roadmap.md § UI theo từng màn hình](./roadmap.md#ui-theo-từng-màn-hình) (Player, Màn hình 5) — kèm lưu ý kỹ thuật: `<track>` native chỉ nhận WebVTT, phụ đề hiện tại (nhúng lẫn ngoài) đều ở dạng `.srt`, cần convert SRT→VTT khi làm tính năng này.

### Nếu có gì vỡ

- Lỗi ngay ở bước `login` (vd `AUTH_KEY` hoặc kết nối) → nghi ngờ đầu tiên là `browser-shim.ts`/nhánh Node của GramJS trong môi trường Node thật của admin (khác Vitest, vốn không có `self` lẫn `window` — môi trường Node thật của admin cũng vậy, nhưng đáng xác nhận không có gì khác biệt hệ điều hành).
- Rank in sai so với kỳ vọng → đối chiếu trực tiếp JSON thô của `ffprobe -show_format -show_streams` với logic `compat-rank.ts` (unit test hiện tại dùng fixture tay, có thể chưa phủ đúng codec_name thật ffprobe trả về).
- Upload thành công nhưng phát không được trên `<video>` → đối chiếu `compat` ghi trong catalog với hạng thật, và kiểm tra `+faststart` có thật sự áp dụng (dùng `ffprobe -show_format` trên file đã upload/tải lại, tìm `moov` trước `mdat`).
- Thấy log in `"Running gramJS version 2.26.21"` khác `telegram@2.26.22` đã ghim — **bình thường, không phải bug** (xem "Phát hiện phụ" ở trên), đừng tốn thời gian điều tra lại.
- `subs` không xuất hiện trong catalog dù log báo đã upload phụ đề → đối chiếu `finalItem.subs` (`apps/tsmc-ingest/src/commands/upload.ts`) có được gán trước khi push vào `newItems` không, và `buildCatalogEnvelope()`/`parseCatalogItem()` (Valibot) có drop field lạ nếu sai shape (`{ lang: string, msgId: number }`, `lang` KHÔNG optional trong schema — `sub.lang ?? 'und'` phải chạy đúng khi ffprobe không trả tag ngôn ngữ).
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0013 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## Index: Forum Topic category + hashtag fallback (2026-08-29)

Liên quan: [ADR-0010 § Cập nhật 2026-08-29](./adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md#cập-nhật-sau-khi-accepted-2026-08-29-spike-07--brainstorm-cải-thiện-quét-nguồn), [docs/roadmap.md § Index / quét nguồn](./roadmap.md#index--quét-nguồn). SPIKE-07 đã verify GramJS Forum Topics API *tự nó* hoạt động bằng script rời (đã xoá) — mục này verify **code sản xuất thật** (`index-engine.ts`/`gateway-index.ts`/`hashtag-parser.ts`/`forum-topics.ts`) chạy đúng khi quét một kênh thật, không phải verify lại API.

### Chuẩn bị dữ liệu test (trong app Telegram thật, không phải web app)

- [ ] Một supergroup đã bật **Topics** (Group settings → Topics → On), có ít nhất 2 topic không phải "General" (vd "Phim lẻ", "Phim bộ").
- [ ] Đăng 1 video document vào topic "Phim bộ" với caption chứa hashtag season/episode + một thẻ lạ, vd: `Some Show #S02E05 #anime`.
- [ ] Đăng 1 video document vào topic "Phim lẻ" với caption chứa hashtag năm + thẻ lạ, vd: `Some Movie #2019 #scifi` (tên file **không** có năm, để phân biệt hashtag-year vs filename-year).
- [ ] (Tuỳ chọn, để verify nhánh `replyToTopId` thay vì `replyToMsgId`) Reply vào một message đã có sẵn TRONG một topic, tạo ra một message "reply sâu" — SPIKE-07 phát hiện hai trường hợp này lấy topicId khác field nhau.

### Các bước trên staging (https://tsmc-staging.web.app)

- [ ] Đăng nhập bằng tài khoản thật.
- [ ] Sources → Thêm nguồn → "Chọn từ danh sách chat của tôi" → chọn supergroup vừa chuẩn bị.
- [ ] Nguồn mới → bấm **"Quét toàn bộ (có thể chậm)"** (full-scan không tự chạy, ADR-0010).

### Checklist xác nhận

- [ ] **`isForum` resolve đúng** — không có cách xem trực tiếp qua UI; nếu bước dưới (`listForumTopics`) có chạy tức là `isForum: true` đã đúng. Nếu tất cả các bước dưới đều thất bại như thể kênh không phải Forum, nghi ngờ đầu tiên là `channel.forum` không được GramJS trả đúng cho kênh này.
- [ ] **`listForumTopics()` gọi đúng 1 lần/lượt quét, cache đúng** — DevTools → Application → IndexedDB → `tsmc` → `indexMeta` → record theo `sourceId` → phải có `forumTopics: { "<topicId>": "Phim lẻ", "<topicId>": "Phim bộ" }` và `forumTopicsFetchedAt` (timestamp gần đây).
- [ ] **`topic` gán đúng vào item** — `tsmc` → `media` table → tìm record theo `msgId` của "Some Show"/"Some Movie" → field `topic` phải khớp đúng tên topic đã đăng vào.
- [ ] **Hashtag season/episode thắng filename** — item "Some Show" (filename không có `SxxExx`) → Browse → tap item → Item Detail Sheet phải hiện **"tập phim"** (kind = episode, suy từ `#S02E05`).
- [ ] **Hashtag năm chỉ dùng khi filename không có năm** — item "Some Movie" → Item Detail Sheet hiện năm **2019** (từ hashtag, vì filename không có).
- [ ] **Hashtag lạ gộp vào `genres`** — cả hai item đều phải thấy `anime`/`scifi` trong dòng genres ở Item Detail Sheet.
- [ ] **`title` luôn từ filename, không bị hashtag ghi đè** — title hiển thị phải khớp tên suy từ filename, không phải chuỗi hashtag.
- [ ] **(Nếu làm bước reply sâu ở trên) `replyToTopId` vs `replyToMsgId`** — cả message gửi thẳng vào topic và message reply sâu trong topic đều phải ra cùng một `topicId`/`topic` đúng — đây là chỗ SPIKE-07 ghi nhận "đọc một field đơn lẻ theo trực giác ban đầu cho kết quả sai", nên đáng test riêng.
- [ ] **Kênh KHÔNG phải Forum vẫn quét bình thường** — thử quét lại một nguồn cũ (broadcast channel thường, không Forum) đã có sẵn, xác nhận `topic` luôn `undefined` và không có lỗi/exception nào phát sinh từ nhánh Forum mới.

### Nếu có gì vỡ

- Item không có `topic` dù đã post đúng vào topic → kiểm tra `indexMeta.forumTopics` trước (map có đúng key không, TTL 1h có hết hạn giữa chừng không) rồi mới nghi ngờ `extractTopicId()`.
- Hashtag không tách được → kiểm tra `message.entities` có thật sự chứa `MessageEntityHashtag` hay Telegram gộp chung vào entity khác (client Telegram khác nhau có thể tạo entity khác nhau cho cùng một caption).
- Bất kỳ hành vi nào lệch thiết kế → ghi vào addendum ADR-0010 (không phải sửa Quyết định gốc), rồi cập nhật lại tài liệu này.
