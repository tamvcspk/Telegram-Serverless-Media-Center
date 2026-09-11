# Việc chờ kiểm chứng trên thiết bị thật

> **Cách dùng tài liệu này:** danh sách tính năng đã code + deploy staging nhưng **chưa** chạy qua tài khoản Telegram thật — khác [docs/roadmap.md](./roadmap.md) (việc **chưa code**) và khác spike (đặt cược kiến trúc bằng script rời, xem [docs/spikes/README.md](./spikes/README.md)). Đây là code sản xuất thật, chỉ còn thiếu một lượt chạy tay để xác nhận không có gì vỡ khi gặp dữ liệu Telegram thật (entity offset/length, quyền, giới hạn API...).
>
> **Cách cập nhật:** xong một mục → xoá khỏi đây, ghi 1-2 dòng kết quả vào [docs/changelog.md](./changelog.md), và nếu phát hiện gì lệch với thiết kế thì thêm addendum vào ADR liên quan (dùng skill `/adr`). Khi mục cuối cùng của một tính năng biến mất khỏi đây, gỡ luôn nhãn `[Cần kiểm chứng thiết bị thật]` tương ứng ở roadmap.md.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — màn Đăng nhập UI thật (2026-09-10)

Liên quan: [docs/changelog.md § 2026-09-10, màn Đăng nhập UI thật](./changelog.md#2026-09-10--gui-ingest-desktop-màn-đăng-nhập-ui-thật-angular-22--material), [ADR-0017 § Cập nhật 2026-09-10, khung sườn](./adr/0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-09-10-khung-sườn-appstsmc-ingest-desktop--code-thật-lần-đầu), [docs/roadmap.md § Ingest](./roadmap.md#ingest). Khác các mục CLI/web khác trong file này — đây là app desktop Tauri, "thiết bị thật" nghĩa là: tài khoản Telegram thật + `cargo tauri dev` chạy trên máy thật (không phải `cargo build`/`cargo clippy`/`pnpm run build` ở `ui/`, vốn đã sạch và không cần MTProto).

**KHÔNG chạy hộ bằng agent/Claude** — CLAUDE.md: "Không chạy đăng nhập MTProto hộ người dùng". Admin tự chạy trong `apps/tsmc-ingest-desktop/` (`cargo tauri dev`).

### Chuẩn bị

- [x] `cargo build --workspace` sạch, không warning — verify 2026-09-10.
- [x] `cargo clippy --workspace` sạch, không warning — verify 2026-09-10.
- [x] `cargo tauri dev` boot được cửa sổ WebView2 thật, chạy ổn định tới khi dừng chủ động, không panic — verify 2026-09-10 (không phải trên máy admin, môi trường dựng khung sườn — trước khi có UI Angular, nạp `ui/index.html` cũ).
- [x] `pnpm --filter @tsmc/tsmc-ingest-desktop-ui run build` sạch; render đúng qua Puppeteer headless nhắm `ng serve` (không phải cửa sổ Tauri, không chạm MTProto) — verify 2026-09-10.
- [x] `cargo tauri dev` với `ui/` mới: `devUrl` cổng 4300 nạp đúng màn Đăng nhập Angular thật — verify 2026-09-10 (tài khoản thật).
- [x] `TSMC_API_ID`/`TSMC_API_HASH` thật (tự tạo tại https://my.telegram.org) — verify 2026-09-10.

### Các bước

- [x] Bước 1 (API_ID + API_HASH + số điện thoại) → **Tiếp tục**: lần đầu (chưa có session) app tự gọi `check_session` (trả `false`) rồi `request_login_code`, chuyển sang Bước 2 — verify 2026-09-10, ĐẠT.
- [x] Bước 2 (mã OTP) → **Xác nhận**: tài khoản KHÔNG có 2FA → `submit_otp` trả `LoggedIn`, UI hiện panel "Đã đăng nhập" — verify 2026-09-10, ĐẠT.
- [x] Đóng app, mở lại, nhập lại đúng 3 ô ở Bước 1 (API_ID cũ + API_HASH + số điện thoại) → `check_session` lần hai trả `true` → UI nhảy thẳng tới panel "Đã đăng nhập", KHÔNG hỏi lại OTP (khôi phục session SQLite ở thư mục app-data của HĐH) — verify 2026-09-10, ĐẠT. Kiểm trực tiếp file `session.sqlite3` khớp lý thuyết: `dc_home` = 5 (đã migrate khỏi DC mặc định lúc `request_login_code`), `dc_option` có 2 dòng (DC 2 ban đầu + DC 5), đúng dòng DC 5 có `auth_key`. Gap UX ghi lúc đó ("user phải tự gõ lại cả 3 ô") đã vá 2 lần kể từ đó — xem mục checklist mới ngay dưới, đây chỉ còn giá trị lịch sử.
- [ ] Bước 2 → tài khoản CÓ 2FA: `submit_otp` trả `PasswordRequired`, UI hiện Bước 3; nhập đúng mật khẩu → `submit_password` → panel "Đã đăng nhập". Chưa test — tài khoản dùng để verify 2026-09-10 không bật 2FA.
- [ ] Bước 2 nhập mã OTP SAI: `errorMessage` hiện lỗi, UI tự lùi về Bước 1 với API_HASH/số điện thoại VẪN CÒN trong ô (không cần gõ lại) — bấm **Tiếp tục** lần nữa chạy được ngay (`resetAfterAuthFailure()` đã tự gọi lại `check_session()` ngầm), không kẹt ở trạng thái lỡ dở.
- [ ] Cố tình kích `FLOOD_WAIT` (nếu gặp tự nhiên khi test — KHÔNG chủ động né/kích bằng cách spam gọi, CLAUDE.md tôn trọng FLOOD_WAIT tuyệt đối): xác nhận UI hiện đúng số giây, đếm ngược sống, nút submit bị khoá tới khi hết đếm ngược.

### Nếu có gì vỡ

- `invoke()` không trả gì / lỗi "command not found" → kiểm `capabilities/default.json` (`core:default`) và tên command trong `generate_handler!` (`src-tauri/src/lib.rs`) khớp đúng `#[tauri::command]` fn name.
- Lỗi ngay ở `request_login_code`/`submit_otp` (không phải do gõ sai) → đối chiếu với `docs/spikes/README.md#spike-10` (cùng `grammers-client` 0.10.0, đã verify thật qua CLI) — nếu CLI cũ (`tools/spike-10/r3-grammers`) vẫn chạy đúng nhưng app desktop mới lỗi, nghi ngờ đầu tiên là khác biệt session path (app-data dir vs cwd) hoặc state machine mới viết ở `commands.rs`, không phải bug thư viện.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — nhớ credential ở app-data (2026-09-11)

Liên quan: [docs/changelog.md § 2026-09-11, nhớ credential ở app-data](./changelog.md#2026-09-11--gui-ingest-desktop-nhớ-credential-ở-app-data-mở-app-không-cần-gõ-gì-nếu-còn-đăng-nhập). Cùng ghi chú môi trường như 2 mục trên.

**KHÔNG chạy hộ bằng agent/Claude.**

- [x] `cargo build --workspace`/`cargo clippy --workspace`/`ng build` sạch sau khi thêm `load_saved_credentials`/`save_credentials` + `credentials.json` — verify 2026-09-11.
- [ ] Đăng nhập lần đầu thật (Bước 1 đầy đủ → OTP) → kiểm file `credentials.json` xuất hiện ở app-data (cùng thư mục `session.sqlite3`), chứa đúng `api_id`/`api_hash`/`dial_code`/`national_number` vừa nhập (plaintext — có chủ đích, xem README.md § Bảo mật).
- [ ] **Bug thật đã sửa 2026-09-11** (user report: mở app vẫn phải gõ API_ID mãi, `credentials.json` xác nhận KHÔNG tồn tại dù đăng nhập "thành công" nhiều lần) — đăng nhập lại chỉ bằng cách gõ API_ID rồi để debounce tự nhận ra (KHÔNG bấm "Tiếp tục", KHÔNG điền API_HASH/số điện thoại) → kiểm `credentials.json` VẪN được tạo/cập nhật (chứa đúng `api_id`, `api_hash`/phone có thể rỗng nếu đây là lần đầu) — đây chính là nhánh trước đó bị bỏ sót `persistCredentials()` (`runAutoCheck()`, `login.ts`).
- [ ] Đóng app, mở lại **CÙNG cách chạy** (vd `cargo tauri dev` cả hai lần) → **KHÔNG gõ gì** → nhảy thẳng sang Chọn kênh trước khi kịp thấy form Bước 1 (hoặc thấy "Đang kiểm tra phiên đăng nhập…" rất ngắn rồi chuyển).
- [ ] Đóng app, mở lại bằng **cách chạy KHÁC** (vd lần trước `cargo tauri dev`, lần này `.exe` release, hoặc ngược lại) → vẫn **KHÔNG gõ gì** — đây là case đã lỗi ở bản `localStorage` (origin khác nhau), giờ phải ĐẠT vì đọc từ `credentials.json` (app-data, không phụ thuộc origin).
- [ ] Xoá tay `credentials.json` rồi mở lại app → rơi về Bước 1, form TRỐNG (không prefill gì, vì không còn gì để đọc) — gõ lại đầy đủ một lần, `check_session()` vẫn nhận ra session thật (session.sqlite3 không bị xoá) nên nhảy thẳng luôn, KHÔNG hỏi lại OTP — xác nhận `credentials.json` mất không đồng nghĩa mất đăng nhập, chỉ mất tiện nghi tự điền.
- [ ] Sau khi session hết hạn thật (hoặc xoá `session.sqlite3` để giả lập) → mở app → `check_session()` trả `false`/lỗi → Bước 1 hiện ra nhưng **tự điền sẵn cả 4 ô** từ `credentials.json` (API_ID, API_HASH, mã vùng, số điện thoại) — chỉ cần bấm "Tiếp tục" (hoặc sửa rồi bấm) để đăng nhập lại, không gõ lại từ đầu.

### Nếu có gì vỡ

- Vẫn phải gõ lại dù đã có `credentials.json` → kiểm `tryAutoLogin()` có thật sự gọi `loadSavedCredentials()` trước `checkSession()` không (log qua `tauri_plugin_log`, giờ đã bật cả ở release — xem `lib.rs`), và file `credentials.json` có đúng field `api_id` là số hợp lệ không (JSON hỏng/rỗng → `load_saved_credentials()` trả `None` thầm lặng, không lỗi).

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — màn Chọn kênh (2026-09-11)

Liên quan: [docs/roadmap.md § Ingest](./roadmap.md#ingest). Cùng ghi chú môi trường như mục trên — "thiết bị thật" nghĩa là `cargo tauri dev` + tài khoản Telegram thật, không phải `cargo build`/`cargo clippy`/`ng build` (đã sạch, verify 2026-09-11, không cần MTProto).

**KHÔNG chạy hộ bằng agent/Claude.** Admin tự chạy sau khi đã đăng nhập xong (mục trên).

- [x] `cargo build --workspace`/`cargo clippy --workspace` sạch sau khi thêm `check_write_permission`/`read_pinned_catalog` + `AppState::selected_channel` — verify 2026-09-11.
- [x] `pnpm --filter @tsmc/tsmc-ingest-desktop-ui run build` sạch sau khi thêm route `/channel` — verify 2026-09-11.
- [x] `cargo build`/`cargo clippy`/`ng build` sạch sau khi thêm `list_own_channels`/`create_channel`/`select_channel` (picker + tạo kênh mới) — verify 2026-09-11.
- [x] `ng build` sạch sau khi đổi UI sang kiểu Telegram (ô lọc + `mat-action-list` + nút "+") — verify 2026-09-11.
- [ ] Sau khi đăng nhập xong, UI tự điều hướng sang `/channel` (`goToDone()` ở `login.ts`), danh sách kênh của admin tự tải NGAY (không cần bấm gì) — `list_own_channels()` chạy trong constructor `Channel`.
- [ ] Tài khoản CÓ ít nhất một kênh là creator → danh sách hiện đúng, đối chiếu tay với app Telegram gốc (Settings → My Channels hoặc tương đương), KHÔNG hiện kênh cộng đồng đã join nhưng không sở hữu.
- [ ] Tài khoản CÓ ít nhất một supergroup là creator (đã bật/nâng cấp — không phải group nhỏ mặc định) → supergroup đó XUẤT HIỆN trong danh sách (không chỉ broadcast channel). Chọn nó → `check_write_permission`/`read_pinned_catalog` chạy đúng, KHÔNG lỗi "peer không phải InputPeer::Channel".
- [ ] Tài khoản CÓ một group nhỏ CHƯA nâng cấp supergroup là creator → group đó KHÔNG xuất hiện trong danh sách, và gõ @username/link của nó vào ô lọc (nếu có username) không cho ra kết quả tìm kiếm — đúng thiết kế (group nhỏ không tương thích `channels.*` API, xem ADR-0017 addendum 2026-09-11).
- [ ] Tài khoản CHƯA có kênh nào là creator → hiện đúng hint rỗng ("Chưa có kênh nào bạn là chủ sở hữu…"), không lỗi, không đơ.
- [ ] Gõ vào ô lọc một phần tên của MỘT kênh đã có trong danh sách → danh sách tự lọc còn đúng kênh khớp (substring, không phân biệt hoa/thường) — không gọi RPC nào cho việc lọc tại chỗ này (chỉ lọc mảng đã tải).
- [ ] Gõ đúng `@username` của một kênh **của chính tài khoản đang đăng nhập** nhưng KHÔNG khớp tên hiển thị trong danh sách (vd username khác hẳn title) → sau ~500ms hiện thêm MỘT dòng "kết quả tìm kiếm" phía trên/trong cùng danh sách, `searching()` hint biến mất đúng lúc.
- [ ] Bấm dòng "kết quả tìm kiếm" đó (`is_own: true`) → `finishSelecting()` chạy thẳng, KHÔNG gọi lại `resolve_channel` lần hai (kiểm bằng log — object đã resolve lúc debounce được dùng lại nguyên vẹn).
- [ ] Gõ đúng `@username`/link của một kênh **KHÔNG thuộc tài khoản đang đăng nhập** (vd kênh cộng đồng bất kỳ đã join) → dòng "kết quả tìm kiếm" vẫn hiện (resolve thành công), nhưng bấm vào → `is_own: false` → chặn ngay, hiện đúng thông báo "không thể chọn", KHÔNG gọi `check_write_permission`/`read_pinned_catalog` (CLAUDE.md bất biến #5).
- [ ] Gõ một ID số thô (vd `123456789`) vào ô lọc → hiện lỗi "Không dùng ID thô…" ngay, KHÔNG debounce, KHÔNG gọi `resolve_channel` (CLAUDE.md bất biến #10) — danh sách kênh của admin (nếu title tình cờ chứa chuỗi số đó) vẫn lọc bình thường, không bị chặn.
- [ ] Gõ một ref không tồn tại/không phải channel → không có gì xảy ra sau debounce (silent catch, đây là tìm kiếm ngầm) — danh sách không đổi, không có lỗi đỏ nào bật lên khi đang gõ dở.
- [ ] Bấm nút "+" cạnh ô lọc → panel "Tạo kênh mới" mở ra (nút đổi màu `active`); bấm lại → đóng. Gõ tên + bấm "Tạo kênh" (`create_channel`) → kênh mới xuất hiện thật trong app Telegram gốc (broadcast channel, không phải group/supergroup) → panel tự đóng, UI tự chuyển sang "đã chọn", `check_write_permission` trả `true`, `read_pinned_catalog` trả "chưa có gì ghim" (kênh mới toanh).
  - **Đã gặp thật (2026-09-11): `USER_RESTRICTED`** — Telegram từ chối `channels.createChannel` cho tài khoản test (thường do tài khoản còn mới/chưa đủ tin cậy). **Đây KHÔNG phải bug của app** — không có cách né hợp lệ (CLAUDE.md: tôn trọng giới hạn tài khoản thật). Đã cải thiện thông báo lỗi từ dạng kỹ thuật thô sang câu tiếng Việt giải thích rõ (`to_rpc_error()`, `rpc.rs`) — verify lại UI hiện đúng câu mới, không phải chuỗi `"request error: rpc error 403..."` thô nữa. Nếu tài khoản test vẫn bị hạn chế, thử tài khoản khác đã hoạt động lâu hơn để verify nhánh THÀNH CÔNG.
- [ ] Sau khi tạo kênh mới, bấm "Chọn kênh khác" quay lại màn Chọn kênh → kênh vừa tạo XUẤT HIỆN trong danh sách (thêm tại chỗ vào `ownChannels`, không gọi lại `list_own_channels()` — kiểm không có request thừa nào qua log).
- [ ] Kênh đã chọn (bất kỳ đường nào) CHƯA có gì ghim → UI hiện "chưa có catalog nào được ghim" (không lỗi, không crash).
- [ ] Kênh đã chọn ĐÃ ghim đúng `catalog.v1.json` (vd kênh dùng ở SPIKE-06/apps/web) → UI hiện đúng số item đếm được (đối chiếu tay với nội dung catalog thật) — xác nhận nhánh `tryDescribeCatalog()` phòng thủ trong `channel.ts` đọc đúng `spec`/`items`, không throw.

### Nếu có gì vỡ

- Lỗi "chưa resolve_channel() — gọi trước check_write_permission()/read_pinned_catalog()" dù đã chọn kênh thành công → kiểm `AppState::selected_channel` có bị `submit_otp`/`submit_password` sai reset `ConnState::Disconnected` xoá mất `GrammersIngestRpc` (và cache `Peer` bên trong nó) hay không — `selected_channel` ở `AppState` KHÔNG bị xoá theo, nhưng `rpc.check_write_permission()`/`read_pinned_catalog()` sẽ lỗi khác (không `Ready`) nếu vậy; phải chọn lại kênh sau khi đăng nhập lại.
- Bấm dòng "kết quả tìm kiếm" báo lỗi "chưa resolve_channel()..." → nghi ngờ đầu tiên: user gõ tiếp SAU khi debounce trả về (đổi `filterToken`) rồi mới bấm — `searchResult` phía UI có thể đang hiện một kênh KHÁC với kênh `selected_channel` phía Rust nếu có race; đối chiếu `filterToken` lúc `runSearch()` hoàn tất với lúc bấm.
- `list_own_channels` trả rỗng dù admin CÓ kênh sở hữu → nghi ngờ đầu tiên: `chan.raw.creator` sai với kênh migrate từ group cũ (Telegram có case group→supergroup giữ nguyên id nhưng đổi cờ creator) — đối chiếu tay bằng `channels.GetFullChannel` cho đúng kênh đó.
- `create_channel` lỗi "channels.createChannel không trả Updates chứa danh sách chats" → Telegram trả về biến thể `Updates` khác `Updates`/`Combined` (hiếm, nhưng có thể) — ghi lại nguyên văn biến thể gặp phải để bổ sung nhánh match ở `ingest-grammers/src/rpc.rs::create_channel()`.
- `read_pinned_catalog` trả `None` dù kênh CÓ ghim gì đó → đối chiếu `ingest-grammers/src/rpc.rs` ghi chú `tl::enums::ChatFull` có 2 biến thể (`Full` vs `ChannelFull`) — bug thật đã gặp ở SPIKE-10 nếu build cũ.
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0017 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## Player: hiển thị phụ đề (`subs[]`) (2026-08-31)

Liên quan: [docs/changelog.md § 2026-08-31, verify — ĐẠT](./changelog.md#2026-08-31--player-verify-thật-phụ-đề-đơn-ngôn-ngữ--đạt), [docs/roadmap.md § UI theo từng màn hình](./roadmap.md#ui-theo-từng-màn-hình). Khác mục CLI ngay dưới đây — đây là tính năng web, verify trên **staging** (https://tsmc-staging.web.app) bằng trình duyệt thật, không phải máy admin.

### Kết quả verify 2026-08-31 — ĐẠT (phụ đề đơn ngôn ngữ)

Phát video có `subs[]` trên staging bằng tài khoản thật — phụ đề hiện đúng qua menu CC gốc của `<video controls>`, xác nhận cả pipeline: RPC `getSubtitleDocument` tải đúng document, `srtToVtt()` convert đúng (nội dung + timing khớp video). **Chưa test:** case nhiều phụ đề cùng lúc (đa ngôn ngữ) — hoãn có chủ đích, gộp chung vào khi làm UI chọn track riêng (xem [docs/roadmap.md § UI theo từng màn hình](./roadmap.md#ui-theo-từng-màn-hình)). Hai case nhỏ còn lại dưới đây vẫn chưa test tay, để ngỏ trong danh sách.

### Các bước còn lại

- [ ] Mở Player cho item KHÔNG có `subs[]` — xác nhận không có track/lỗi console nào phát sinh, video vẫn phát bình thường.
- [ ] Rời Player rồi mở lại video khác vài lần liên tiếp — xác nhận không có lỗi console (Blob URL revoke đúng lúc component huỷ, xem `DestroyRef.onDestroy` trong `player.ts`).

### Nếu có gì vỡ

- Phụ đề hiện chữ nhưng sai encoding (ký tự lạ thay vì tiếng Việt có dấu) → `toVttText()` hiện chỉ decode UTF-8; phụ đề cũ ở encoding khác (Windows-1258/TCVN3) sẽ ra sai — ghi nhận thành gap mới ở roadmap.md nếu gặp, không phải bug của convert SRT→VTT.
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0005 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

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
