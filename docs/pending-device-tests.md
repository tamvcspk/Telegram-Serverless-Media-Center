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
- [ ] Bước 2 nhập mã OTP SAI: `errorMessage` hiện lỗi, UI tự lùi về Bước 1 với API_HASH/số điện thoại VẪN CÒN trong ô (không cần gõ lại) — bấm **Tiếp tục** lần nữa chạy được ngay (`resetAfterAuthFailure()` đã tự gọi lại `check_session()` ngầm), không kẹt ở trạng thái lỡ dở. (sign in error: invalid code thay vi quay lai buoc 1, nhap dung otp thi loi gọi request_login_code() trước submit_otp())
- [ ] Cố tình kích `FLOOD_WAIT` (nếu gặp tự nhiên khi test — KHÔNG chủ động né/kích bằng cách spam gọi, CLAUDE.md tôn trọng FLOOD_WAIT tuyệt đối): xác nhận UI hiện đúng số giây, đếm ngược sống, nút submit bị khoá tới khi hết đếm ngược.

### Nếu có gì vỡ

- `invoke()` không trả gì / lỗi "command not found" → kiểm `capabilities/default.json` (`core:default`) và tên command trong `generate_handler!` (`src-tauri/src/lib.rs`) khớp đúng `#[tauri::command]` fn name.
- Lỗi ngay ở `request_login_code`/`submit_otp` (không phải do gõ sai) → đối chiếu với `docs/spikes/README.md#spike-10` (cùng `grammers-client` 0.10.0, đã verify thật qua CLI) — nếu CLI cũ (`tools/spike-10/r3-grammers`) vẫn chạy đúng nhưng app desktop mới lỗi, nghi ngờ đầu tiên là khác biệt session path (app-data dir vs cwd) hoặc state machine mới viết ở `commands.rs`, không phải bug thư viện.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — nhớ credential ở app-data (2026-09-11)

Liên quan: [docs/changelog.md § 2026-09-11, nhớ credential ở app-data](./changelog.md#2026-09-11--gui-ingest-desktop-nhớ-credential-ở-app-data-mở-app-không-cần-gõ-gì-nếu-còn-đăng-nhập). Cùng ghi chú môi trường như 2 mục trên.

**KHÔNG chạy hộ bằng agent/Claude.**

- [x] `cargo build --workspace`/`cargo clippy --workspace`/`ng build` sạch sau khi thêm `load_saved_credentials`/`save_credentials` + `credentials.json` — verify 2026-09-11.
- [ ] Đăng nhập lần đầu thật (Bước 1 đầy đủ → OTP) → kiểm file `credentials.json` xuất hiện ở app-data (cùng thư mục `session.sqlite3`), chứa đúng `api_id`/`api_hash`/`dial_code`/`national_number` vừa nhập (plaintext — có chủ đích, xem README.md § Bảo mật).
- [x] **Bug thật đã sửa 2026-09-11** (user report: mở app vẫn phải gõ API_ID mãi, `credentials.json` xác nhận KHÔNG tồn tại dù đăng nhập "thành công" nhiều lần) — đăng nhập lại chỉ bằng cách gõ API_ID rồi để debounce tự nhận ra (KHÔNG bấm "Tiếp tục", KHÔNG điền API_HASH/số điện thoại) → kiểm `credentials.json` VẪN được tạo/cập nhật (chứa đúng `api_id`, `api_hash`/phone có thể rỗng nếu đây là lần đầu) — đây chính là nhánh trước đó bị bỏ sót `persistCredentials()` (`runAutoCheck()`, `login.ts`).
- [x] Đóng app, mở lại **CÙNG cách chạy** (vd `cargo tauri dev` cả hai lần) → **KHÔNG gõ gì** → nhảy thẳng sang Chọn kênh trước khi kịp thấy form Bước 1 (hoặc thấy "Đang kiểm tra phiên đăng nhập…" rất ngắn rồi chuyển).
- [x] Đóng app, mở lại bằng **cách chạy KHÁC** (vd lần trước `cargo tauri dev`, lần này `.exe` release, hoặc ngược lại) → vẫn **KHÔNG gõ gì** — đây là case đã lỗi ở bản `localStorage` (origin khác nhau), giờ phải ĐẠT vì đọc từ `credentials.json` (app-data, không phụ thuộc origin).
- [x] Xoá tay `credentials.json` rồi mở lại app → rơi về Bước 1, form TRỐNG (không prefill gì, vì không còn gì để đọc) — gõ lại đầy đủ một lần, `check_session()` vẫn nhận ra session thật (session.sqlite3 không bị xoá) nên nhảy thẳng luôn, KHÔNG hỏi lại OTP — xác nhận `credentials.json` mất không đồng nghĩa mất đăng nhập, chỉ mất tiện nghi tự điền.
- [x] Sau khi session hết hạn thật (hoặc xoá `session.sqlite3` để giả lập) → mở app → `check_session()` trả `false`/lỗi → Bước 1 hiện ra nhưng **tự điền sẵn cả 4 ô** từ `credentials.json` (API_ID, API_HASH, mã vùng, số điện thoại) — chỉ cần bấm "Tiếp tục" (hoặc sửa rồi bấm) để đăng nhập lại, không gõ lại từ đầu.

### Nếu có gì vỡ

- Vẫn phải gõ lại dù đã có `credentials.json` → kiểm `tryAutoLogin()` có thật sự gọi `loadSavedCredentials()` trước `checkSession()` không (log qua `tauri_plugin_log`, giờ đã bật cả ở release — xem `lib.rs`), và file `credentials.json` có đúng field `api_id` là số hợp lệ không (JSON hỏng/rỗng → `load_saved_credentials()` trả `None` thầm lặng, không lỗi).

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — màn Chọn kênh (2026-09-11)

Liên quan: [docs/roadmap.md § Ingest](./roadmap.md#ingest). Cùng ghi chú môi trường như mục trên — "thiết bị thật" nghĩa là `cargo tauri dev` + tài khoản Telegram thật, không phải `cargo build`/`cargo clippy`/`ng build` (đã sạch, verify 2026-09-11, không cần MTProto).

**KHÔNG chạy hộ bằng agent/Claude.** Admin tự chạy sau khi đã đăng nhập xong (mục trên).

- [x] `cargo build --workspace`/`cargo clippy --workspace` sạch sau khi thêm `check_write_permission`/`read_pinned_catalog` + `AppState::selected_channel` — verify 2026-09-11.
- [x] `pnpm --filter @tsmc/tsmc-ingest-desktop-ui run build` sạch sau khi thêm route `/channel` — verify 2026-09-11.
- [x] `cargo build`/`cargo clippy`/`ng build` sạch sau khi thêm `list_own_channels`/`create_channel`/`select_channel` (picker + tạo kênh mới) — verify 2026-09-11.
- [x] `ng build` sạch sau khi đổi UI sang kiểu Telegram (ô lọc + `mat-action-list` + nút "+") — verify 2026-09-11.
- [x] Sau khi đăng nhập xong, UI tự điều hướng sang `/channel` (`goToDone()` ở `login.ts`), danh sách kênh của admin tự tải NGAY (không cần bấm gì) — `list_own_channels()` chạy trong constructor `Channel`.
- [x] Tài khoản CÓ ít nhất một kênh là creator → danh sách hiện đúng, đối chiếu tay với app Telegram gốc (Settings → My Channels hoặc tương đương), KHÔNG hiện kênh cộng đồng đã join nhưng không sở hữu.
- [x] Tài khoản CÓ ít nhất một supergroup là creator (đã bật/nâng cấp — không phải group nhỏ mặc định) → supergroup đó XUẤT HIỆN trong danh sách (không chỉ broadcast channel). Chọn nó → `check_write_permission`/`read_pinned_catalog` chạy đúng, KHÔNG lỗi "peer không phải InputPeer::Channel".
- [x] Tài khoản CÓ một group nhỏ CHƯA nâng cấp supergroup là creator → group đó KHÔNG xuất hiện trong danh sách, và gõ @username/link của nó vào ô lọc (nếu có username) không cho ra kết quả tìm kiếm — đúng thiết kế (group nhỏ không tương thích `channels.*` API, xem ADR-0017 addendum 2026-09-11).
- [x] Tài khoản CHƯA có kênh nào là creator → hiện đúng hint rỗng ("Chưa có kênh nào bạn là chủ sở hữu…"), không lỗi, không đơ.
- [x] Gõ vào ô lọc một phần tên của MỘT kênh đã có trong danh sách → danh sách tự lọc còn đúng kênh khớp (substring, không phân biệt hoa/thường) — không gọi RPC nào cho việc lọc tại chỗ này (chỉ lọc mảng đã tải).
- [x] Gõ đúng `@username` của một kênh **của chính tài khoản đang đăng nhập** nhưng KHÔNG khớp tên hiển thị trong danh sách (vd username khác hẳn title) → sau ~500ms hiện thêm MỘT dòng "kết quả tìm kiếm" phía trên/trong cùng danh sách, `searching()` hint biến mất đúng lúc.
- [x] Bấm dòng "kết quả tìm kiếm" đó (`is_own: true`) → `finishSelecting()` chạy thẳng, KHÔNG gọi lại `resolve_channel` lần hai (kiểm bằng log — object đã resolve lúc debounce được dùng lại nguyên vẹn).
- [x] Gõ đúng `@username`/link của một kênh **KHÔNG thuộc tài khoản đang đăng nhập** (vd kênh cộng đồng bất kỳ đã join) → dòng "kết quả tìm kiếm" vẫn hiện (resolve thành công), nhưng bấm vào → `is_own: false` → chặn ngay, hiện đúng thông báo "không thể chọn", KHÔNG gọi `check_write_permission`/`read_pinned_catalog` (CLAUDE.md bất biến #5).
- [x] Gõ một ID số thô (vd `123456789`) vào ô lọc → hiện lỗi "Không dùng ID thô…" ngay, KHÔNG debounce, KHÔNG gọi `resolve_channel` (CLAUDE.md bất biến #10) — danh sách kênh của admin (nếu title tình cờ chứa chuỗi số đó) vẫn lọc bình thường, không bị chặn.
- [ ] Gõ một ref không tồn tại/không phải channel → không có gì xảy ra sau debounce (silent catch, đây là tìm kiếm ngầm) — danh sách không đổi, không có lỗi đỏ nào bật lên khi đang gõ dở.
- [ ] Bấm nút "+" cạnh ô lọc → panel "Tạo kênh mới" mở ra (nút đổi màu `active`); bấm lại → đóng. Gõ tên + bấm "Tạo kênh" (`create_channel`) → kênh mới xuất hiện thật trong app Telegram gốc (broadcast channel, không phải group/supergroup) → panel tự đóng, UI tự chuyển sang "đã chọn", `check_write_permission` trả `true`, `read_pinned_catalog` trả "chưa có gì ghim" (kênh mới toanh).
  - **Đã gặp thật (2026-09-11): `USER_RESTRICTED`** — Telegram từ chối `channels.createChannel` cho tài khoản test (thường do tài khoản còn mới/chưa đủ tin cậy). **Đây KHÔNG phải bug của app** — không có cách né hợp lệ (CLAUDE.md: tôn trọng giới hạn tài khoản thật). Đã cải thiện thông báo lỗi từ dạng kỹ thuật thô sang câu tiếng Việt giải thích rõ (`to_rpc_error()`, `rpc.rs`) — verify lại UI hiện đúng câu mới, không phải chuỗi `"request error: rpc error 403..."` thô nữa. Nếu tài khoản test vẫn bị hạn chế, thử tài khoản khác đã hoạt động lâu hơn để verify nhánh THÀNH CÔNG.
- [ ] Sau khi tạo kênh mới, bấm "Chọn kênh khác" quay lại màn Chọn kênh → kênh vừa tạo XUẤT HIỆN trong danh sách (thêm tại chỗ vào `ownChannels`, không gọi lại `list_own_channels()` — kiểm không có request thừa nào qua log).
- [x] Kênh đã chọn (bất kỳ đường nào) CHƯA có gì ghim → UI hiện "chưa có catalog nào được ghim" (không lỗi, không crash).
- [x] Kênh đã chọn ĐÃ ghim đúng `catalog.v1.json` (vd kênh dùng ở SPIKE-06/apps/web) → UI hiện đúng số item đếm được (đối chiếu tay với nội dung catalog thật) — xác nhận nhánh `tryDescribeCatalog()` phòng thủ trong `channel.ts` đọc đúng `spec`/`items`, không throw.

### Nếu có gì vỡ

- Lỗi "chưa resolve_channel() — gọi trước check_write_permission()/read_pinned_catalog()" dù đã chọn kênh thành công → kiểm `AppState::selected_channel` có bị `submit_otp`/`submit_password` sai reset `ConnState::Disconnected` xoá mất `GrammersIngestRpc` (và cache `Peer` bên trong nó) hay không — `selected_channel` ở `AppState` KHÔNG bị xoá theo, nhưng `rpc.check_write_permission()`/`read_pinned_catalog()` sẽ lỗi khác (không `Ready`) nếu vậy; phải chọn lại kênh sau khi đăng nhập lại.
- Bấm dòng "kết quả tìm kiếm" báo lỗi "chưa resolve_channel()..." → nghi ngờ đầu tiên: user gõ tiếp SAU khi debounce trả về (đổi `filterToken`) rồi mới bấm — `searchResult` phía UI có thể đang hiện một kênh KHÁC với kênh `selected_channel` phía Rust nếu có race; đối chiếu `filterToken` lúc `runSearch()` hoàn tất với lúc bấm.
- `list_own_channels` trả rỗng dù admin CÓ kênh sở hữu → nghi ngờ đầu tiên: `chan.raw.creator` sai với kênh migrate từ group cũ (Telegram có case group→supergroup giữ nguyên id nhưng đổi cờ creator) — đối chiếu tay bằng `channels.GetFullChannel` cho đúng kênh đó.
- `create_channel` lỗi "channels.createChannel không trả Updates chứa danh sách chats" → Telegram trả về biến thể `Updates` khác `Updates`/`Combined` (hiếm, nhưng có thể) — ghi lại nguyên văn biến thể gặp phải để bổ sung nhánh match ở `ingest-grammers/src/rpc.rs::create_channel()`.
- `read_pinned_catalog` trả `None` dù kênh CÓ ghim gì đó → đối chiếu `ingest-grammers/src/rpc.rs` ghi chú `tl::enums::ChatFull` có 2 biến thể (`Full` vs `ChannelFull`) — bug thật đã gặp ở SPIKE-10 nếu build cũ.
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0017 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — workspace ba vùng: hàng đợi + probe native (2026-09-12)

Liên quan: [docs/changelog.md § 2026-09-12](./changelog.md#2026-09-12--gui-ingest-desktop-workspace-ba-vùng-a3--vùng-hàng-đợi--probe-native-ffmpeg-next), [docs/ux-design.md § A.3](./ux-design.md#a3-màn-hình-chính--workspace-ba-vùng), [docs/roadmap.md § Ingest](./roadmap.md#ingest). Cùng ghi chú môi trường như các mục trên — "thiết bị thật" nghĩa là `cargo tauri dev` + tài khoản Telegram thật; riêng phần probe ở mục này KHÔNG đụng MTProto (chạy được không cần đăng nhập) nên "thiết bị thật" ở đây chủ yếu nghĩa là **file media thật của admin** (khác file mẫu tổng hợp `tools/spike-09/fixtures/sample.mkv` đã dùng để verify trong lúc code).

**KHÔNG chạy hộ bằng agent/Claude** phần đăng nhập/chọn kênh. Phần probe/kéo thả bên dưới an toàn để tự chạy thử (không chạm session/tài khoản), nhưng vẫn cần `cargo tauri dev` thật (webview thật mới có sự kiện kéo thả OS, không giả lập được bằng Puppeteer/`ng serve` như các slice trước).

- [x] `cargo build --workspace`/`cargo clippy --workspace` sạch sau khi thêm crate `ingest-ffmpeg` + 2 command `list_media_files`/`probe_media` — verify 2026-09-12.
- [x] `probe()` (`ingest-ffmpeg`) đối chiếu trực tiếp với `ffprobe` CLI thật trên `tools/spike-09/fixtures/sample.mkv` (container/codec/kích thước/duration khớp 1-1: `matroska`, video h264 1280×720, audio ac3, subtitle subrip, ~300.006s) — verify 2026-09-12, môi trường dev (không phải máy admin).
- [x] `ng build`/`ng serve` + `pnpm install` sạch sau khi thêm `@tsmc/core-ingest` vào `ui/package.json` — phát hiện thật cùng lúc: `ng build` sạch nhưng `ng serve` (Vite) lỗi `Failed to resolve dependency: valibot` (transitive qua `@tsmc/shared-models`, dep của `core-ingest`) vì pnpm strict node_modules không hoist nó vào `ui/node_modules`; vá bằng cách thêm `valibot` làm dependency TRỰC TIẾP của `ui/package.json` (cùng cách `apps/web/package.json` đã làm cho chính vấn đề này) — verify 2026-09-12.
- [x] `cargo tauri dev` thật: kéo MỘT file video thật (bất kỳ định dạng nào — mp4/mkv/avi) từ File Explorer thả vào vùng "HÀNG ĐỢI" → item xuất hiện ngay với hạng "…" (đang probe) rồi chuyển sang đúng màu 🟢A/🟡B/🟠C/🔴D trong vài trăm ms, hover/tooltip hiện đúng lý do phân hạng. **Verify 2026-09-12, ĐẠT** — thả LẦN LƯỢT 5 file lẻ thật (không phải folder) từ một season "The Big Bang Theory": 3 file `.mkv` → 🟠C, 1 file `.avi` (bản trailer) → 🔴D (đúng luật "AVI luôn Hạng D bất kể codec", ADR-0013), 1 file `.mp4` đã cắt đoạn → 🟡B — cả 5 khớp kỳ vọng, không có item nào bị thiếu hay sai hạng. Có một `Uncaught TypeError: Cannot read properties of undefined (reading 'startTime') at et.reportAllChanges` (`VM181:2`) xuất hiện trên console DevTools nhưng KHÔNG ảnh hưởng gì tới UI/thao tác (user xác nhận). Đã grep toàn bộ `main-*.js`/`chunk-*.js` (dist thật) + `ui/node_modules` — không có chỗ nào chứa chuỗi `reportAllChanges`, xác nhận lỗi này KHÔNG đến từ code/dependency của app; `VM181` là cách Chromium DevTools đặt tên cho script eval/inject từ bên ngoài (nghi ngờ đầu tiên: một extension DevTools đang gắn vào tiến trình WebView2, không phải bug — nhưng chưa xác nhận được NGUỒN cụ thể, ghi lại đây phòng khi tái hiện kèm nhiều bằng chứng hơn).
- [x] Kéo NGUYÊN MỘT FOLDER chứa nhiều tập phim (season thật) thả vào → `list_media_files` quét đệ quy, tất cả file video bên trong (đúng phần mở rộng: mp4/mkv/avi/mov/webm/ts/m4v/wmv/flv/mpg/mpeg/m2ts) xuất hiện trong hàng đợi, file không phải video (`.nfo`, `.srt`, ảnh poster...) bị bỏ qua đúng như thiết kế.
- [x] Thả file KHÔNG PHẢI media (vd đổi tên `.txt` thành `.mp4`) → `probe_media` lỗi, item đó hiện "Lỗi" (không phải hạng màu), các item khác trong cùng lượt thả VẪN ra kết quả bình thường (không bị một file hỏng chặn cả batch — mockup A.5 "Pipeline FFmpeg crash: file đó đánh dấu Lỗi, batch chạy tiếp").
- [x] Thả lại ĐÚNG file đã có sẵn trong hàng đợi → không bị thêm trùng (dedupe theo đường dẫn tuyệt đối).
- [x] Bấm nút "×" trên một dòng → item biến mất khỏi hàng đợi, không ảnh hưởng các dòng khác.
- [ ] Rời màn Workspace về `/channel` rồi quay lại thẳng bằng cách gõ URL `/workspace` (không qua `/channel` trước — F5/reload trong `cargo tauri dev`) → tự điều hướng về `/channel` (store `SelectedChannelStore` rỗng sau reload, không có gì để hiện ở header).
- [x] File RẤT LỚN (nhiều GB, HEVC 4K...) → `probe_media` không đơ UI lâu bất thường (đây chỉ đọc header/metadata, không decode toàn bộ frame — nên phải nhanh bất kể dung lượng file; nếu chậm thật, nghi ngờ đầu tiên là container có index đặt cuối file buộc phải seek xa).

**Vùng BẢNG METADATA (thêm 2026-09-12, cùng slice, chưa verify):**

- [x] `ng build`/`ng serve`/`npm run lint` sạch sau khi thêm bảng metadata (7 cột, thao tác hàng loạt) — verify 2026-09-12, môi trường dev (không phải `cargo tauri dev`).
- [ ] Thả 3-4 file cùng series (season thật) → dòng ĐẦU TIÊN seed Title/Season/Ep từ tên file (`seedMetadataFromFilename()`), các dòng SAU đó tự điền sẵn CÙNG Title (kế thừa `inheritMetadata()`) với Season/Ep đúng theo tên file riêng của từng file — đối chiếu tay bằng cách gõ cùng file qua `tsmc-ingest` CLI (`--assume-yes=false`) xem có ra cùng Title/Season/Ep gợi ý không.
- [x] Sửa tay Title ở MỘT dòng bất kỳ → chỉ dòng đó đổi, các dòng khác giữ nguyên (kế thừa chỉ áp dụng lúc THẢ, không tự động lan truyền ngược/xuôi sau khi đã vào bảng).
- [x] Gõ Season/Ep vào một dòng đang trống (item không khớp `SxxExx` lúc parse tên file, vd file "Extra.mp4") → ô nhận giá trị, hạng/tên file không đổi, cột 🚦 vẫn đúng như trước.
- [ ] Chọn 3+ checkbox (không nhất thiết liền nhau) → bấm "Điền xuống ▾" → chọn "Title" → Title của dòng ĐẦU TIÊN (theo thứ tự hàng đợi, không phải thứ tự bấm chọn) được gõ xuống các dòng CÒN LẠI đã chọn — dòng đầu tiên không đổi gì.
- [ ] Tương tự "Điền xuống" → "Season" và → "Năm" — đúng hành vi trên cho từng field.
- [ ] Chọn 3+ checkbox, dòng đầu tiên có Season=1/Ep=2 → bấm "Đánh số tập tự động" → TẤT CẢ dòng đã chọn nhận Season=1, Episode lần lượt 2, 3, 4... theo đúng thứ tự hàng đợi (không phải thứ tự bấm chọn).
- [ ] Bấm "Xoá khỏi hàng" khi có dòng đã chọn → các dòng đó biến mất khỏi CẢ hai vùng (hàng đợi lẫn bảng metadata, cùng một `queue` signal) — dòng chưa chọn không đổi.
- [ ] Bấm checkbox header ("chọn tất cả") → toàn bộ dòng được chọn/bỏ chọn cùng lúc; nút "Điền xuống"/"Đánh số tập tự động"/"Xoá khỏi hàng" tự bật/tắt đúng theo `selectedCount()` (Điền xuống cần ≥2 dòng chọn, hai nút kia cần ≥1).
- [ ] Probe một file ra Hạng D (vd `.avi`) → checkbox dòng đó TỰ ĐỘNG bỏ chọn ngay khi hạng hiện ra (không cần user bấm tay) — các dòng hạng khác không bị ảnh hưởng.
- [ ] Cuộn cả hai vùng (hàng đợi + bảng metadata) khi hàng đợi dài (thả một season nhiều chục tập) → không giật/lag bất thường, `cdk-virtual-scroll-viewport` chỉ render đúng số dòng đang hiện trên màn hình.
- [ ] Gõ vào ô tìm kiếm ở `.metadata-toolbar` một phần tên file/Title đã có → CẢ HAI vùng (hàng đợi lẫn bảng metadata) cùng lọc còn đúng dòng khớp, không lệch danh sách giữa hai cột. Xoá hết ô tìm kiếm → cả hai vùng hiện lại đầy đủ.
- [ ] Gõ một chuỗi KHÔNG khớp dòng nào → cả hai vùng rỗng, bảng metadata hiện đúng dòng "Không có dòng nào khớp…"; header row/footer (checkbox "chọn tất cả", "X/Y đã chọn") vẫn tính theo TOÀN BỘ hàng đợi (không theo kết quả lọc) — xác nhận tìm kiếm chỉ để định vị, không thu hẹp phạm vi thao tác hàng loạt.
- [ ] Đang lọc (ô tìm kiếm có chữ) → bấm "Điền xuống"/"Đánh số tập tự động"/"Xoá khỏi hàng" → vẫn áp dụng đúng cho MỌI dòng đã chọn trong toàn bộ hàng đợi, kể cả dòng đang bị ẩn bởi bộ lọc (không chỉ dòng đang hiển thị).

### Nếu có gì vỡ

- `probe_media` lỗi `STATUS_DLL_NOT_FOUND` (`0xC0000135`) hoặc app không khởi động được sau khi build release → thiếu DLL FFmpeg cạnh `.exe` — cần đủ 7 file (`avcodec-61.dll`, `avdevice-61.dll`, `avfilter-10.dll`, `avformat-61.dll`, `avutil-59.dll`, `swscale-8.dll`, `swresample-5.dll`, xem [ADR-0013 § addendum 2026-09-04](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-09-04-tích-hợp-thật-vào-tsmc-ingest--sửa-số-liệu-đóng-gói-ở-addendum-trên)) — **chưa giải quyết ở slice này**, `cargo tauri dev`/`cargo build` chỉ chạy đúng trên máy đã có `vcpkg install ffmpeg:x64-windows` (xem `tools/spike-09/README.md`); đóng gói `.exe` phân phối được để dành việc sau.
- Kéo thả không có phản ứng gì (không log, không item nào xuất hiện) → kiểm `capabilities/default.json` có đủ quyền cho sự kiện webview (`core:default` normally đủ, nhưng nếu Tauri đổi mặc định thì cần thêm permission `core:webview:default` tường minh) — khác lỗi "command not found" (đó là thiếu đăng ký ở `generate_handler!`).
- Hạng hiện SAI so với đối chiếu tay bằng `ffprobe`/MediaInfo → nghi ngờ đầu tiên là `normalize_container()` (`ingest-ffmpeg/src/lib.rs`) đọc nhầm `AVInputFormat.name` cho một container lạ chưa gặp lúc code (function này PHẢI khớp `normalizeContainer()` của `apps/tsmc-ingest/src/ffprobe.ts` — hai bên cùng đọc field `iformat->name`/`format_name`, lệch nhau ở đây là bug, không phải khác biệt runtime).
- Title/Season/Ep KHÔNG kế thừa từ dòng trước (mỗi dòng đều seed từ đầu như thể đứng một mình) → kiểm `addPaths()` (`workspace.ts`) có thật sự đọc `this.queue().at(-1)?.metadata` TRƯỚC khi push item mới hay không — bug hợp lý nếu logic vô tình đọc `previous` SAU khi đã `this.queue.update()` thêm cả batch (queue lúc đó đã đổi, `.at(-1)` trỏ nhầm item vừa thêm thay vì item cuối TRƯỚC batch).
- "Điền xuống"/"Đánh số tập tự động" áp dụng SAI thứ tự (không phải theo hàng đợi mà theo thứ tự bấm chọn checkbox) → `fillDown()`/`autoNumberEpisodes()` đọc `this.queue().filter(i => i.selected)` — thứ tự filter luôn theo `queue` gốc (đã đúng thiết kế); nếu sai, nghi ngờ UI đang giữ một mảng `selected` rời thay vì lọc trực tiếp từ `queue()`.
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0017/ADR-0013 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — workspace ba vùng: "Bắt đầu upload" (2026-09-12)

Liên quan: [docs/changelog.md § 2026-09-12, wire Bắt đầu upload](./changelog.md#2026-09-12--gui-ingest-desktop-workspace-ba-vùng--wire-bắt-đầu-upload-hạng-abc), [docs/roadmap.md § Ingest](./roadmap.md#ingest). Đây là RPC MTProto THẬT đầu tiên của app này ngoài đăng nhập/chọn kênh — khác các mục probe/kéo thả ở trên (không đụng MTProto), mục này **GHI THẬT vào kênh Telegram** (upload video/phụ đề, ghim/xoá message catalog). **KHÔNG chạy hộ bằng agent/Claude** (CLAUDE.md).

### Chuẩn bị

- [x] `cargo build --workspace`/`cargo clippy --workspace` (0 warning) sau khi thêm `pipeline.rs`/`upload.rs`/`AppState::active_cancel`/`list_dir_entries` — verify 2026-09-12.
- [x] `ingest-ffmpeg::remux()`/`extract_thumbnail()`/`extract_subtitles()` chạy đúng trên fixture thật (`tools/spike-09/fixtures/sample.mkv`) qua ví dụ chạy tay — verify 2026-09-12, môi trường dev (không phải máy admin, không phải qua Tauri command).
- [x] `ingest-ffmpeg::reencode_to_mp4()` (Hạng D) chạy đúng trên fixture AVI/Xvid+MP3 tổng hợp (sinh bằng `ffmpeg -f lavfi ... -c:v mpeg4 -vtag XVID -c:a mp3 ... .avi`, KHÔNG phải file thiết bị thật) qua ví dụ chạy tay — output MP4/H.264/AAC, `ffprobe -count_frames` đọc đủ khung hình, `ffmpeg ... -f null -` decode lại KHÔNG lỗi — verify 2026-09-12, môi trường dev, KHÔNG phải máy admin, KHÔNG phải qua Tauri command, KHÔNG phải file AVI/Xvid thật của admin (khác profile chuẩn nhưng cùng container/codec class).
- [x] `ng build`/`ng serve`/`npm run lint`/`npm run test:libs`/`npm run docs:check` sạch sau khi wire `startUpload()`/`processItem()`/`publishAll()` — verify 2026-09-12.
- [x] Chuẩn bị kênh test — verify 2026-09-12 (dùng luôn để test đường hạnh phúc, xem mục dưới).

### Đường hạnh phúc

- [ ] Thả 1 file Hạng A (mp4 H.264/AAC thật) → tick chọn → bấm "Upload (1)" → hàng đợi (sidebar trái) hiện lần lượt "Đang remux…" → "Đang tạo thumbnail…" → (bỏ qua rút phụ đề nếu không có track) → "Đang upload video… N%" (số % tăng dần, kèm `mat-progress-bar` xác định) → "Xong". Mở kênh bằng app Telegram gốc → video xuất hiện thật, phát được, có thumbnail đúng khung hình giữa video.
- [x] Thả 1 file Hạng C (mkv, audio không phải AAC) → upload → **verify 2026-09-12, ĐẠT (user xác nhận thành công qua `cargo tauri dev` + tài khoản thật)** — chưa có chi tiết từng bước riêng (có phụ đề nhúng hay không, hiện đúng % tiến trình hay không, catalog ghim đúng nội dung hay không) nên các dòng con dưới đây VẪN mở, coi như chưa verify riêng lẻ:
  - [ ] Hàng đợi hiện đúng thứ tự stage: "Đang rút phụ đề…" (nếu có track nhúng) trước "Đang upload video…", rồi "Đang upload phụ đề…" sau khi video xong.
  - [ ] Mở kênh gốc → thấy đúng video + (nếu có) document phụ đề riêng, đúng track/ngôn ngữ.
  - [ ] `catalog.v1.json` ghim đúng, chứa item mới với `compat` chính xác (suy từ codec THẬT của file đã remux, không phải file gốc).
- [ ] Đặt MỘT file phụ đề rời cạnh video gốc trên đĩa (vd `Movie.vi.srt`) trước khi thả → sau khi upload xong, document phụ đề đó XUẤT HIỆN thêm trong kênh (độc lập với phụ đề nhúng, nếu file cũng có track nhúng thì có CẢ HAI).
- [ ] Chọn 2-3 file (Hạng A/B/C trộn lẫn) → "Upload" → xử lý ĐÚNG TUẦN TỰ từng file một (không chạy song song — mỗi lúc chỉ 1 dòng trong hàng đợi đang "Đang upload…") → sau khi CẢ BATCH xong, footer bảng metadata hiện "Đang publish catalog…" rồi "Đã publish — N item (M mới)." → mở kênh gốc → catalog.v1.json ĐÃ GHIM khớp đúng, chứa đủ M item mới CỘNG item cũ đã có trước đó (nếu kênh đã có catalog) — không mất item cũ.
- [ ] Sau khi publish xong, header ("catalog: ...") tự cập nhật số item mới mà KHÔNG cần rời màn/quay lại.

**Hạng D (re-encode video thật):**

- [x] Re-encode + upload Hạng D — **verify 2026-09-12, ĐẠT (user xác nhận "Hạng D re-encode và upload thành công" qua `cargo tauri dev` + tài khoản thật)** — chưa có chi tiết từng bước riêng (đúng nội dung dialog xác nhận, đúng nhãn stage `reencoding`, đúng hình ảnh/âm thanh sau re-encode) nên các dòng con dưới đây VẪN mở:
  - [ ] Thả 1 file Hạng D thật (vd `.avi` Xvid/DivX) → tick chọn (mặc định KHÔNG chọn, phải tự tick) → bấm "Upload (N)" → hiện `ConfirmDialog` (Angular Material, KHÔNG còn phải `window.confirm()` — đổi thành shared dialog từ 2026-09-12) đúng nội dung "`<tên file>` cần re-encode video (đắt — không phải remux). Nội dung ~N phút. Tiếp tục?" với N là số phút làm tròn LÊN từ duration thật, nút xác nhận tô màu warn (đỏ).
  - [ ] Bấm "Bỏ qua" trên dialog đó → item đó KHÔNG vào hàng đợi (vẫn nằm lại bảng metadata bên phải, có thể sửa/thử lại), CÁC FILE KHÁC trong batch (nếu có) vẫn upload bình thường — không dừng cả batch.
  - [ ] Bấm "Tiếp tục" trên dialog đó → hàng đợi (sidebar trái) hiện "Đang re-encode video (chậm)…" (khác "Đang remux…" của A/B/C, đúng nhãn `reencoding`) trong thời gian ĐÁNG KỂ hơn hẳn remux → sau đó "Đang tạo thumbnail…" → "Đang upload video…" → "Xong". Mở kênh gốc → video phát được, đúng nội dung hình ảnh/âm thanh (không vỡ hình, không lệch tiếng — đối chiếu bằng mắt/tai với file gốc).
  - [ ] Trộn 1 file Hạng D + 1-2 file A/B/C trong CÙNG một lượt "Upload" → dialog xác nhận CHỈ hiện cho đúng file Hạng D, các file khác không bị hỏi gì — thứ tự xử lý vẫn tuần tự đúng theo hàng đợi.

**Redesign hai danh sách tách biệt (thêm 2026-09-12, CHƯA verify — bảng metadata và hàng đợi trước đó lặp lại CÙNG một danh sách, giờ tách hẳn):**

- [ ] Trước khi bấm "Upload": sidebar trái CHỈ hiện khung "+ Thả file hoặc folder vào đây" (trống, không lặp lại danh sách bên phải) — khác bản cũ vốn mirror y hệt bảng metadata.
- [ ] Bấm "Upload (N)" với N file đã chọn → NGAY LẬP TỨC (trước khi kịp xong file đầu tiên) N dòng đó biến mất khỏi bảng metadata (bên phải) và xuất hiện trong hàng đợi (bên trái) với trạng thái "Trong hàng đợi…" — không phải đợi xử lý xong mới chuyển.
- [ ] Trong lúc một file đang ở bất kỳ stage nào (remux/thumbnail/upload...), avatar (vòng tròn bên trái tên file) hiện `mat-progress-spinner` xoay đúng kiểu: xác định (có %, tăng dần GIỮA vòng) khi "Đang upload video…", KHÔNG xác định (xoay vô định, không số) ở các stage cục bộ khác (remux/re-encode/thumbnail/phụ đề) — avatar đổi hẳn sang icon tick (✓) khi "Xong", icon X khi "Lỗi", icon đồng hồ khi "Trong hàng đợi…" (không còn spinner ở ba trạng thái này).
- [ ] Icon-button Huỷ/dismiss trong hàng đợi VÀ nút "×" trong bảng metadata — ripple (hiệu ứng lan khi bấm) và icon nằm ĐÚNG TÂM nút, không lệch/tràn ra ngoài khung tròn (vá bug lệch do ép cứng `width`/`height` — nếu vẫn lệch, kiểm `--mat-icon-button-state-layer-size`/`--mat-icon-button-icon-size` có bị override đè bởi CSS khác không).
- [ ] Nút "Upload (N)" đúng SỐ N = số dòng đang tick chọn trong bảng metadata, kể cả khi N gồm cả Hạng D (không cần đạt Hạng A/B/C mới đếm) — gõ/bỏ tick một checkbox bất kỳ, số N trên nút cập nhật ngay.
- [ ] Trong lúc batch đang chạy, dưới hàng đợi (bên trái, "góc dưới sidebar" kiểu Apple Mail) hiện đúng "Đã tải X/N file — P%", X tăng dần sau MỖI file xử lý xong (kể cả file lỗi/bị bỏ qua — vẫn tính là "đã xử lý", không chỉ đếm file thành công).
- [ ] Với dòng ĐÃ "Xong" hoặc "Lỗi" trong hàng đợi → nút "×" (dismiss) xuất hiện, bấm vào thì dòng đó biến mất khỏi hàng đợi — dòng ĐANG xử lý (chưa xong/lỗi) KHÔNG có nút này (chỉ có nút Huỷ hình vuông nếu đang ở "Đang upload video…").
- [ ] Bảng metadata (bên phải) giờ có thêm cột nút "×" cuối mỗi dòng — bấm xoá ĐÚNG dòng đó khỏi bảng (không ảnh hưởng dòng khác), tương đương chọn 1 checkbox rồi bấm "Xoá khỏi hàng" ở toolbar nhưng nhanh hơn.

**Vá 4 bug thật từ phiên test tiếp theo (thêm 2026-09-12, CHƯA verify bằng `cargo tauri dev` — chỉ #4 đã verify riêng bằng fixture tái hiện lỗi gốc, xem "Nếu có gì vỡ"):**

- [ ] Trong lúc "Đang remux…"/"Đang re-encode video…"/"Đang tạo thumbnail…"/"Đang rút phụ đề…" → vòng `mat-progress-spinner` (avatar bên trái tên file) THỰC SỰ XOAY (trước đó đứng yên do `provideNoopAnimations()`) — quan sát bằng mắt vài giây, không chỉ nhìn một khung hình tĩnh.
- [x] Lúc mới chuyển sang "Đang upload video…" (trước khi có % byte đầu tiên) → avatar vẫn hiện spinner XOAY VÔ ĐỊNH (không phải một vòng trống/vô hình) — sau khi % đầu tiên tới, spinner chuyển sang xác định (có số ở giữa, tăng dần). **Đã vá 2026-09-13 ([ADR-0018](./adr/0018-task-id-lam-khoa-tuong-quan-ipc-ingest-desktop.md)) — verify 2026-09-13, ĐẠT (user xác nhận qua `cargo tauri dev` + tài khoản thật): progress chuyển đúng sang xác định với Hạng B/C/D, không còn đứng mãi vô định. Chưa có chi tiết từng bước riêng (hạng cụ thể nào, có quan sát race huỷ-nhầm-file không).**
- [ ] Bấm "Huỷ" (icon vuông) đúng lúc hàng đợi VỪA chuyển sang file KẾ TIẾP (giao ca giữa 2 file trong cùng batch) → chỉ file ĐANG chạy lúc bấm bị huỷ, KHÔNG huỷ nhầm file vừa mới bắt đầu — race đã vá bằng so khớp `task_id` ở `cancel_upload()` (ADR-0018), khó tái hiện chủ động (cần bấm đúng khoảnh khắc) nên chỉ cần quan sát KHÔNG THẤY hành vi huỷ nhầm trong lúc test đường hạnh phúc bình thường.
- [ ] Sidebar hàng đợi (cột trái) KHÔNG còn thanh cuộn ngang dù tên file dài — tên file dài bị cắt đúng kiểu "…" (ellipsis), hover vào hiện tooltip tên đầy đủ.
- [ ] Icon-button Huỷ/dismiss (hàng đợi) và nút "×" (bảng metadata) — ripple lan ĐÚNG tâm nút tròn, icon không lệch sang một bên (so sánh trực quan với các icon-button khác trong app, vd nút back ở toolbar, để thấy rõ khác biệt nếu vẫn còn lệch).
- [ ] Re-encode một file Hạng D BẤT KỲ (không cần đúng file đã gây lỗi trước đó) → KHÔNG còn gặp lỗi "invalid argument" — nếu vẫn gặp, ghi lại `ffprobe` đầy đủ của file đó (đặc biệt `pix_fmt`, `width`/`height`) để đối chiếu với fixture đã tái hiện được lúc vá.
- [x] **"invalid argument" TÁI DIỄN 2026-09-15 — hoá ra KHÔNG PHẢI bug pix_fmt/kích thước ở trên, mà là bug audio khác, ở nhánh Hạng C (`remux(reencode_audio_to_aac=true)`) — verify 2026-09-15, ĐẠT (user xác nhận qua `cargo tauri dev`, "fix work"):** user báo lỗi thật khi remux một file MKV H.264/AC3 (`The Big Bang Theory S01E05`, ~20 phút). Tái hiện được bằng ví dụ chạy tay (`ingest-ffmpeg/examples/repro_invalid_argument.rs`, đã xoá sau khi debug xong): track AC3 đổi channel layout GIỮA file (mở đầu stereo, phát hiện đúng 1 frame cuối nhảy sang 5.1(side)) — `ffprobe` chỉ đọc packet đầu nên báo nhầm "stereo" cả file. `abuffer` (nguồn audio filter graph ở `remux.rs`/`reencode.rs`) khoá cứng định dạng lúc dựng graph, KHÔNG hỗ trợ đổi định dạng giữa chừng như video (nổ đúng "Changing audio frame properties on the fly is not supported" = `AVERROR(EINVAL)` = "Invalid argument"). **Đã vá:** thêm một `resampling::Context` bắt buộc (cùng chủ đích với `scaling::Context` bắt buộc của video Hạng D — luôn chạy, không điều kiện) chuẩn hoá MỌI frame audio giải mã về đúng định dạng đã dùng để dựng graph, dựng lại resampler khi tín hiệu nguồn đổi thật — áp dụng CẢ HAI `remux.rs::drain_audio_transcode` VÀ `reencode.rs::drain_audio_decoder` (code audio trùng lặp có chủ đích giữa hai file, xem doc comment đầu file). Verify tay ngoài Tauri trước đó: build lại output từ đúng file gây lỗi → `ffprobe` đọc lại OK, duration audio/video khớp gốc (~1209s cả hai, sai lệch <1s), không còn log lỗi. Chưa có chi tiết riêng việc nghe lại bằng tai đoạn cuối file (đoạn 5.1→stereo downmix qua `swresample`) — không chặn, để mở nếu cần đối chiếu sau.

**PR2 — hydration/singleton store/guard rời màn/dialog Hạng D gộp (thêm 2026-09-13, [ADR-0018](./adr/0018-task-id-lam-khoa-tuong-quan-ipc-ingest-desktop.md) § addendum PR2, CHƯA verify):**

- [x] Thả 2-3 file → KHÔNG bấm "Upload", điền dở metadata một dòng → bấm nút back (Chọn kênh) → dialog "Rời khỏi Workspace?" hiện đúng số "N file nháp chưa upload" → bấm "Ở lại" → vẫn ở Workspace, dữ liệu KHÔNG mất.
- [x] Lặp lại, lần này bấm "Rời khỏi" → điều hướng sang `/channel` thành công, bảng metadata mất hết (đã xoá đúng thiết kế).
- [x] Bấm "Upload (N)" với ít nhất 1 file → NGAY LÚC đang "Đang upload video…", bấm nút back → dialog hiện đúng "N tác vụ đang chạy" (không phải "N file nháp") → bấm "Rời khỏi" → điều hướng sang `/channel` → quay lại `/workspace` (chọn LẠI đúng kênh cũ) → hàng đợi vẫn hiện đúng dòng đang chạy, KHÔNG rỗng, tiến trình tiếp tục cập nhật % (không đứng yên ở giá trị lúc rời màn) — đây là phép thử chính của `QueueStore` root-provided + `get_current_task()` hydration.
- [x] Trong lúc đang có file đang chạy (như trên), bấm nút X đóng cửa sổ Tauri → dialog "Đóng ứng dụng?" hiện ra (khác hẳn dialog "Rời khỏi Workspace?" — text khác, cảnh báo dừng tiến trình NGAY LẬP TỨC) → bấm "Ở lại" → app KHÔNG đóng, vẫn dùng được bình thường.
- [x] Bấm X lần nữa, lần này bấm "Đóng ứng dụng" → app đóng thật (không bị kẹt lại, không phải bấm X hai lần).
- [x] **Verify 2026-09-13, ĐẠT (user xác nhận "confirmed").** Không có gì đang chạy/nháp (bảng trống, hàng đợi trống) → bấm back HOẶC bấm X → không có dialog nào hiện ra, chuyển màn/đóng app ngay lập tức (như hành vi cũ trước ADR-0018) — đây chính là nhánh từng gây bug thật "không đóng được app" (thiếu quyền `core:window:allow-destroy`), nay đã vá đúng. Nhánh CÓ cảnh báo (dòng 2 mục ở trên, đang chạy tác vụ) chưa có xác nhận riêng.
- [x] Chọn 2+ file Hạng D lẫn với vài file A/B/C → bấm "Upload (N)" → hiện MỘT dialog "Re-encode video Hạng D?" liệt kê TẤT CẢ file D (không phải nhiều dialog liên tiếp), mỗi dòng có checkbox mặc định TICK sẵn, kèm số phút ước tính riêng từng file.
- [x] Trong dialog đó, bỏ tick MỘT file D rồi bấm "Xác nhận chạy" → batch chạy: file D còn tick + mọi file A/B/C đều vào hàng đợi và upload bình thường; file D bị bỏ tick VẪN NẰM LẠI bảng metadata (không mất, không tự động thử lại).

### Đường hỏng

- [ ] Bấm "Huỷ" (icon vuông) khi một file ĐANG ở stage "Đang upload video…" → lưu lượng mạng dừng trong vài giây (SPIKE-10 M5: ≤ 3s), dòng đó chuyển "Lỗi" (tooltip "Đã huỷ thao tác."), CÁC FILE CÒN LẠI trong batch (nếu có) vẫn tiếp tục xử lý bình thường — không dừng cả batch.
- [ ] Cố tình kích `FLOOD_WAIT` (nếu gặp tự nhiên — KHÔNG chủ động spam để né/kích, CLAUDE.md tôn trọng FLOOD_WAIT tuyệt đối): dòng đang upload hiện đúng "FLOOD_WAIT Ns", đếm ngược sống từng giây, hết đếm ngược TỰ động thử lại (không cần bấm gì) — nếu FLOOD_WAIT rơi vào lúc publish catalog, footer bảng hiện đúng "Đang publish catalog — FLOOD_WAIT Ns…".
- [ ] Một file bị lỗi giữa chừng (vd xoá tay file gốc khỏi đĩa sau khi đã probe xong nhưng trước khi bấm "Bắt đầu upload") → dòng đó "Lỗi" với thông báo hợp lý, CÁC FILE KHÁC trong batch vẫn upload/publish bình thường (không có file nào upload thành công thì bỏ qua bước publish, xem mục dưới).
- [ ] TẤT CẢ file trong batch đều lỗi (0 file upload thành công) → KHÔNG gọi `publish_catalog` (footer không hiện trạng thái publish nào) — catalog kênh giữ nguyên, không ghi đè bằng danh sách rỗng.
- [ ] Rời màn Workspace (bấm nút back) NGAY TRONG LÚC đang upload → không rõ hành vi thiết kế (chưa có logic huỷ/cảnh báo khi rời màn giữa chừng) — quan sát THẬT xảy ra gì (có thể tiến trình nền vẫn chạy ngầm dù đã rời màn) và ghi lại, đây là gap đã biết trước (xem "Nếu có gì vỡ").
- [x] **Verify 2026-09-13, ĐẠT (user xác nhận "confirmed").** Thả một file THẬT nặng hơn 4GB (fixture gốc `tools/spike-10/sample-4gb.mp4` đã xoá cùng đợt dọn spike — dùng file thật bất kỳ >4GB khác nếu cần lặp lại) → tick chọn → bấm "Upload" → dòng đó chuyển "Lỗi" NGAY (không đợi remux/upload chạy xong) với thông báo cụ thể "File nặng X GB, vượt trần 4.00 GB..." — KHÔNG phải lỗi giao thức thô `FILE_PARTS_INVALID` như trước bản vá. CÁC FILE KHÁC trong batch (dưới trần) vẫn upload bình thường. **Lưu ý còn hở:** ngưỡng `4_000_000_000` hiện áp dụng CHUNG cho mọi tài khoản — tài khoản KHÔNG Premium thật ra chỉ có trần ~2GB (số liệu thật, xem ADR-0017 § addendum 2026-09-13) nên vẫn có thể dính `FILE_PARTS_INVALID` thô với file 2-4GB — chưa vá (roadmap).

### Nếu có gì vỡ

- Rời màn Workspace giữa lúc đang upload rồi quay lại → tiến trình cũ (nếu còn chạy) không có gì hiển thị nữa (state cũ đã mất theo component bị huỷ) — đây là ĐƠN GIẢN HOÁ CÓ CHỦ ĐÍCH của slice này (`startUpload()` không có cơ chế abort khi component destroy) — không phải bug cần vá ngay, nhưng nếu gây khó chịu thật khi test, ghi lại làm gap cho slice sau.
- `upload_video` lỗi "chưa chọn kênh" dù đã chọn kênh xong → kiểm `state.selected_channel` có bị `submit_otp`/`submit_password` sai reset mất theo `ConnState::Disconnected` không (cùng lớp bug đã ghi ở mục "Chọn kênh" phía trên).
- `prepare_upload` lỗi ffmpeg mơ hồ → đối chiếu trực tiếp bằng cách chạy `ingest_ffmpeg::remux()`/`extract_thumbnail()`/`extract_subtitles()`/`reencode_to_mp4()` qua một ví dụ Rust độc lập (như đã làm lúc code, xem changelog) trên ĐÚNG file gây lỗi, tách biệt khỏi toàn bộ pipeline Tauri/MTProto để cô lập nguyên nhân.
- App CRASH hẳn (không phải lỗi `Result` bắt được) lúc "Đang re-encode video…" → ĐÂY LÀ RỦI RO ĐÃ GHI NHẬN TRƯỚC (ADR-0013 § addendum 2026-09-03: native FFI encode có thể segfault khi buffer/format mismatch, đã gặp thật ở audio lúc SPIKE-09) — lần đầu áp dụng cho VIDEO encode (`reencode.rs`). Ghi lại CHÍNH XÁC file gây crash (đặc biệt: codec gốc, độ phân giải, pixel format nếu biết) để tái hiện bằng ví dụ Rust độc lập tách khỏi Tauri — đây là bug cần addendum ADR-0013 mới, không phải "thử lại là được".
- **Bug thật đã gặp + vá (2026-09-12):** `reencode_to_mp4()` lỗi `"invalid argument"` trên một file Hạng D thật (user report) — ĐÚNG rủi ro đã ghi ở dòng trên nhưng KHÔNG phải crash, là lỗi `Result::Err` bắt được (`avcodec_open2` từ chối format/kích thước). Nguyên nhân: `encoder.set_format(decoder.format())` + kích thước gốc gán thẳng, không qua `scaling::Context` — pixel format không phải 4:2:0 phẳng chuẩn (vd `yuvj444p`) hoặc chiều rộng/cao LẺ đều bị `libx264` từ chối. Đã vá bằng `scaling::Context` BẮT BUỘC ép `Pixel::YUV420P` + kích thước làm tròn xuống số chẵn TRƯỚC khi encode — verify bằng fixture TÁI HIỆN ĐƯỢC lỗi gốc (`ffmpeg -f lavfi ... -vf "scale=641:361" -pix_fmt yuvj444p -c:v mjpeg ... .avi`, đúng cả hai đặc điểm lẻ+format lạ) chạy sạch, regression-check fixture Xvid cũ (đã verify trước đó) vẫn đúng. Nếu vẫn gặp "invalid argument" SAU bản vá này → đây là lỗi MỚI, không phải cùng nguyên nhân — ghi lại chính xác thông tin file (codec/pixel format/kích thước qua `ffprobe`) để tái hiện riêng, đừng giả định lại cùng gốc.
- **Open issue đã vá 2026-09-13 ([ADR-0018](./adr/0018-task-id-lam-khoa-tuong-quan-ipc-ingest-desktop.md)) — verify 2026-09-13, ĐẠT: progress upload từng luôn `indeterminate` với Hạng B/C/D** do lệch correlation id `path` giữa `upload.rs::upload_video()` (bắn `path` = file TẠM sau remux) và `workspace.ts::onUploadProgress()` (so khớp theo `item.path` = file GỐC). Vá bằng Task ID (UUID sinh phía Angular lúc đẩy vào hàng đợi) thay `path` làm khoá tương quan cho toàn bộ `upload_video`/`prepare_upload`/`cancel_upload` + hai event `"upload-progress"`/`"pipeline-stage"`. Nếu vẫn thấy `indeterminate` mãi với Hạng B/C/D SAU bản vá này → đây là lỗi MỚI (có thể `taskId` không được truyền đúng ở một lời gọi nào đó trong `processItem()`), không phải cùng nguyên nhân — kiểm lại `item.taskId` có được dùng NHẤT QUÁN ở mọi chỗ gọi `updateQueueItem()`/`prepareUpload()`/`uploadVideo()` trong `processItem()` không. Chi tiết: [docs/changelog.md § 2026-09-13](./changelog.md#2026-09-13--gui-ingest-desktop-vá-bug-progress-indeterminate--task-id-uuid-thay-path-làm-khoá-tương-quan-ipc-adr-0018).
- **Bug thật đã gặp + vá (2026-09-13):** thả `tools/spike-10/sample-4gb.mp4` (4 645 817 639 byte) vào Workspace thật → upload thất bại với lỗi giao thức thô `FILE_PARTS_INVALID` (RPC 400) thay vì thông báo dễ hiểu. **Không phải bug mới** — đúng file/đúng lỗi SPIKE-10 M7 đã đo (ADR-0017), nhưng khuyến nghị của spike ("client phải tự tính total_parts, chặn TRƯỚC khi mở kết nối, không phụ thuộc server phản hồi nhanh hay chậm") CHƯA từng được port vào `ingest-grammers` thật — `IngestRpcError::FileTooLarge` tồn tại sẵn trong trait từ lúc scaffold nhưng không nơi nào từng ném ra nó. Vá bằng hằng số `MAX_UPLOAD_BYTES = 4_000_000_000` (`ingest-grammers/src/rpc.rs`), chặn ngay đầu `upload_video()` (đã có sẵn `total` từ `tokio::fs::metadata`) trước khi gọi `multi_connection_upload()`. 5 file còn lại trong đợt test (dưới trần) upload thành công — vùng bảng metadata verify đúng. Thông báo Angular (`describeIngestError()`) cũng đổi từ câu chung chung sang hiện số GB cụ thể cả hai chiều (nặng bao nhiêu / trần bao nhiêu). **CHƯA verify lại bằng tài khoản thật sau bản vá** (checklist ở trên) — và **CHƯA kiểm chứng ngưỡng cho tài khoản không Premium** (có thể thấp hơn 4GB, ví dụ 2GB theo tài liệu công khai Telegram — hằng số hiện tại chỉ bảo vệ đúng trường hợp Premium đã đo thật). Chi tiết: [ADR-0017 § addendum 2026-09-13](./adr/0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-09-13-đóng-gap-thật-của-m7--chặn-kích-thước-file-trước-khi-upload), [docs/changelog.md § 2026-09-13](./changelog.md#2026-09-13--gui-ingest-desktop-chặn-kích-thước-file-trước-khi-upload--đóng-gap-thật-của-spike-10-m7-adr-0017).
- Catalog publish xong nhưng THIẾU item cũ đã có trước đó → kiểm `readPinnedCatalog()` có gọi lại NGAY TRƯỚC LÚC publish (không dùng bản đã đọc lúc chọn kênh, có thể cũ) và `parseExistingCatalogItems()` có parse đúng JSON thật của kênh đó không (JSON lỗi/khác `spec` → trả mảng rỗng thầm lặng, đúng thiết kế phòng thủ nhưng dễ nhầm là "quên gộp" nếu không kiểm tra kỹ).
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0013/ADR-0017 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — đóng gói bản phân phối `.exe`/installer trên máy sạch (2026-09-13)

Liên quan: [ADR-0013 § addendum 2026-09-13](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-09-13-trả-lời-đ2--đóng-gói-dll-ffmpeg-thật-lần-đầu), [docs/spikes/README.md § SPIKE-10 Đ1](./spikes/README.md#spike-10). Khác mọi mục ingest desktop khác ở trên (đều verify bằng `cargo tauri dev` trên MÁY DEV, có sẵn vcpkg) — mục này verify **bản đã đóng gói** (`cargo tauri build` → MSI/NSIS) trên một máy **KHÔNG có** `vcpkg`/LLVM/Rust/Node cài sẵn, đúng tiêu chí Đ1 của SPIKE-10 còn để ngỏ.

### Chuẩn bị

- [x] `cargo tauri build` chạy trọn trên máy dev, ra cả MSI (16.8MB) lẫn NSIS setup (12MB), 7 DLL FFmpeg xuất hiện đúng cạnh `.exe` trong `target/release/` — verify 2026-09-13 (máy dev, CÓ vcpkg — không phải bằng chứng máy sạch).
- [x] Grep configure string trong `avcodec-61.dll` xác nhận `--disable-libx264` + `cargo run --example check_h264_encoder` xác nhận encoder thật là `h264_mf` — giữ LGPL, không kéo GPL (Đ2 ĐẠT) — verify 2026-09-13.

### Các bước (máy sạch — KHÔNG cài `vcpkg`/LLVM/Rust/Node)

- [x] **Verify 2026-09-13, ĐẠT ("chạy được hết")** — cài đặt + mở app từ bản đóng gói chạy đúng trên máy sạch, không còn lỗi "thiếu library cần thiết của ffmpeg" đã gặp trước bản vá; Hạng D (re-encode qua `h264_mf`) cũng chạy đúng trên máy đó. Chỉ còn thiếu số liệu tham khảo (dung lượng cài đặt, danh sách file) — không chặn tiến độ:
  - [x] **Verify 2026-09-13, ĐẠT ("chạy được hết").** Copy file `.msi` (hoặc `...-setup.exe` của NSIS) sang một máy Windows khác/VM sạch → chạy installer → cài đặt xong không báo lỗi.
  - [x] **Verify 2026-09-13, ĐẠT ("chạy được hết").** Thử riêng Hạng D (re-encode) trên máy sạch này → xác nhận `h264_mf` (Windows Media Foundation) hoạt động đúng mà không cần cài thêm gì.
  - [ ] Ghi lại **tổng dung lượng cài đặt** (Đ1 yêu cầu: "ghi tổng MB installer + số file runtime") và danh sách file thật nằm trong thư mục cài đặt — đối chiếu đúng 7 DLL, không thiếu/thừa file lạ. (Chưa có số liệu cụ thể, chỉ mang tính tham khảo — không chặn tiến độ.)

### Nếu có gì vỡ

- App vẫn báo thiếu DLL trên máy sạch dù đã cài từ installer → kiểm thư mục cài đặt thật (`$INSTDIR`, thường `%LOCALAPPDATA%\tsmc-ingest-desktop` hoặc `Program Files\tsmc-ingest-desktop`) có đủ 7 file `.dll` cạnh `.exe` không — nếu thiếu, `tauri.conf.json::bundle.resources` hoặc `build.rs` (chạy lúc build, không phải lúc cài) có vấn đề, cần build lại trên máy có `FFMPEG_DIR` đúng rồi đóng gói lại, không sửa được bằng cách cài lại app.
- Máy sạch không có Visual C++ Redistributable (MSVC runtime) → lỗi hoàn toàn khác (DLL hệ thống C++, không phải FFmpeg) — WiX/NSIS của Tauri thường tự bundle hoặc yêu cầu cài kèm, kiểm log installer nếu gặp.
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0013 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — tích hợp tra cứu TMDB (PR3, 2026-09-13)

Liên quan: [ADR-0019](./adr/0019-tich-hop-tra-cuu-tmdb-o-buoc-draft.md). Cần **API key TMDB thật** (đăng ký miễn phí tại themoviedb.org) — agent không có key để tự verify, admin tự làm.

### Chuẩn bị

- [x] `cargo build`/`cargo clippy --workspace` (0 warning) + `ng build` sạch — verify 2026-09-13 (chỉ build, chưa gọi API thật).

### Các bước

- [x] **Verify 2026-09-13, ĐẠT (user xác nhận "đã verify và work")** — luồng TMDB hoạt động đúng bằng API key thật. Chưa có chi tiết từng bước riêng (dòng con dưới đây VẪN mở, để xác nhận từng nhánh cụ thể sau nếu cần):
  - [ ] Chưa từng lưu key (xoá tay `tmdb_api_key.json` ở app-data nếu đã test trước đó) → bấm nút "Tra TMDB" (icon kính lúp) ở một dòng bảng metadata → hiện dialog "Nhập TMDB API Key" kèm link lấy key → dán key thật → bấm "Lưu" → dialog tìm kiếm mở NGAY SAU ĐÓ (không phải bấm lại nút TMDB lần nữa).
  - [ ] Sửa lại ô tìm kiếm trong dialog (vd gõ tên chính xác hơn) → bấm "Tìm" (hoặc Enter) → danh sách kết quả cập nhật đúng theo query mới.
  - [x] **Verify 2026-09-13, ĐẠT.** Với item `kind: 'episode'` (tên file có `SxxExx`) → tra TMDB phải tìm TV show (`search/tv`) chứ không phải phim lẻ — xác nhận bằng kết quả trả về đúng là series, không phải phim.
  - [x] **Verify 2026-09-13, ĐẠT.** Đóng dialog tìm kiếm bằng Esc/bấm ra ngoài (không chọn gì) → Title/Năm dòng đó GIỮ NGUYÊN, không bị xoá/đổi thành rỗng.
  - [x] **Verify 2026-09-14, ĐẠT (user xác nhận "đã check, hoạt động đúng").** Key sai → dialog tìm kiếm hiện đúng thông báo `InvalidKey`, không còn lẫn với lỗi mạng chung chung.

### Nếu có gì vỡ

- Dialog nhập key không tự mở dialog tìm kiếm sau khi lưu → kiểm `onTmdbLookup()` (`workspace.ts`) có gọi `tmdbSaveKey()` rồi tiếp tục xuống `dialogService.searchTmdb()` trong CÙNG một lần gọi hàm, không return sớm.
- Lỗi mạng/key sai → dialog tìm kiếm phải hiện thông báo lỗi rõ ràng (`describeTmdbError()`), không phải màn hình trắng/treo. **Vá 2026-09-14:** `fetch_tmdb()` giờ kiểm `response.status() == 401` TRƯỚC `error_for_status()`, trả `TmdbErrorDto::InvalidKey` riêng — nếu vẫn thấy thông báo lỗi mạng chung chung khi key sai (thay vì câu "API Key không hợp lệ"), đây là bug MỚI (có thể TMDB đổi mã lỗi khác 401 cho key sai, hoặc field response 401 không như tài liệu) — ghi lại chính xác status code + body TMDB trả về.
- Field TMDB trả về khác tài liệu đã giả định (`title`/`name`/`release_date`/`first_air_date`/`poster_path` đổi tên hoặc cấu trúc) → `tmdb.rs` deserialize thất bại, lỗi hiện ra qua nhánh `TmdbErrorDto::Other` — ghi lại chính xác response JSON thật (DevTools Network nếu debug được, hoặc log Rust) để sửa struct cho khớp, đừng đoán lại từ tài liệu.
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0019 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — tier-aware upload threshold (2026-09-14)

Liên quan: [ADR-0017 § addendum 2026-09-14](./adr/0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-09-14-vá-tier-aware-upload-threshold), [docs/changelog.md § 2026-09-14](./changelog.md#2026-09-14--gui-ingest-desktop-vá-tier-aware-upload-threshold-premium-4gb--thường-2gb-adr-0017), [docs/roadmap.md § Ingest](./roadmap.md#ingest). Cùng ghi chú môi trường như các mục Workspace/upload phía trên — "thiết bị thật" nghĩa là `cargo tauri dev` + tài khoản Telegram thật, gồm **cả một tài khoản Premium lẫn một tài khoản KHÔNG Premium** (khác mọi mục trước đó chỉ cần một tài khoản bất kỳ).

**KHÔNG chạy hộ bằng agent/Claude.** Admin tự chạy.

### Chuẩn bị

- [x] `cargo build --workspace`/`cargo clippy --workspace` (0 warning) sau khi đổi `GrammersIngestRpc::new()` thành async + đọc `get_me().premium` — verify 2026-09-14.

### Các bước

- [x] **Verify 2026-09-14, ĐẠT (tài khoản Premium).** Đăng nhập bằng tài khoản Premium → upload vẫn thành công như hành vi cũ (trần 4GB, không bị hạ nhầm xuống 2GB) — user xác nhận qua `cargo tauri dev` + tài khoản thật.
- [ ] **Hoãn — không có tài khoản KHÔNG Premium để test (2026-09-14, user xác nhận).** Đăng nhập bằng tài khoản KHÔNG Premium → thả file trong khoảng 2-4GB (dưới trần cũ 4GB, trên trần mới 2GB) → tick chọn → bấm "Upload" → dòng đó phải chuyển "Lỗi" NGAY với thông báo `FileTooLarge` hiện đúng "trần 2.00 GB" (không phải 4.00 GB như trước bản vá), KHÔNG dính `FILE_PARTS_INVALID` thô. Nhánh code đọc đúng `is_premium() == false` → dùng `MAX_UPLOAD_BYTES_FREE` (xem `rpc.rs`) — logic đối xứng với nhánh Premium đã verify, nhưng CHƯA có bằng chứng thật cho tài khoản thường vì hiện không có tài khoản loại này để test. Để mở tới khi có tài khoản không Premium.
- [ ] **Hoãn — cùng lý do trên.** Cùng tài khoản KHÔNG Premium → thả file dưới 2GB → upload thành công bình thường (không bị chặn nhầm).
- [ ] Nếu `get_me()` lỗi ngay sau đăng nhập (khó chủ động tái hiện — network flake) → quan sát app vẫn dùng được, trần áp dụng là 2GB (nhánh mặc định an toàn) thay vì app treo/crash.

### Nếu có gì vỡ

- Trần vẫn hiện 4GB dù tài khoản KHÔNG Premium → kiểm `client.get_me().await` có thật sự được gọi TRƯỚC khi `GrammersIngestRpc` được dùng để upload hay không (3 call site ở `commands.rs`) — hoặc kiểm trực tiếp field `premium` trả về từ Telegram cho tài khoản đó (đối chiếu Settings → Premium trong app Telegram gốc).
- Trần hiện SAI cho tài khoản Premium (bị hạ xuống 2GB) → nghi ngờ đầu tiên: `is_premium()` match nhầm biến thể `tl::enums::User` (kiểm log/`dbg!` giá trị `me.raw` thật trả về).
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0017 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — màn Cài đặt (2026-09-14)

Liên quan: [docs/changelog.md § 2026-09-14, màn Cài đặt](./changelog.md#2026-09-14--gui-ingest-desktop-màn-cài-đặt-mới-ngoài-mockup-a4-gốc--quản-lý-tmdb-key--xem-thông-tin-tài-khoản), [docs/ux-design.md § Phụ lục A.4](./ux-design.md#a4-các-màn-còn-lại), [docs/roadmap.md § Ingest](./roadmap.md#ingest). Cùng ghi chú môi trường như các mục Workspace phía trên — "thiết bị thật" nghĩa là `cargo tauri dev` + tài khoản đã đăng nhập (đọc `credentials.json` thật) và một API key TMDB thật (nhánh đổi/xoá key).

**KHÔNG chạy hộ bằng agent/Claude.** Admin tự chạy.

### Chuẩn bị

- [x] `cargo build --workspace`/`cargo clippy --workspace` (0 warning) sau khi thêm `tmdb_delete_key` — verify 2026-09-14.
- [x] `ng build`/`npm run lint` sạch sau khi thêm route `/settings` + icon ⚙ ở topbar Workspace — verify 2026-09-14, môi trường dev (không phải `cargo tauri dev`).

### Các bước

- [x] **Verify 2026-09-14, ĐẠT (tổng quát).** User xác nhận đã chạy `cargo tauri dev` + tài khoản thật, màn Cài đặt hoạt động đúng thiết kế. Chưa có xác nhận riêng từng bước con bên dưới (nhánh Esc dialog, tương tác với `canDeactivateWorkspace`...) — các dòng đó VẪN mở, coi như chưa verify riêng lẻ.
- [ ] Đã đăng nhập + đã chọn kênh, vào `/workspace` → bấm icon ⚙ góc phải topbar → sang màn Cài đặt, thấy đúng số điện thoại (`+<dial_code> <national_number>`) và API_ID/API_HASH CHE MỘT PHẦN (không hiện trọn vẹn) khớp giá trị thật đã đăng nhập.
- [ ] Bấm nút back (mũi tên trái đầu topbar) → quay đúng về `/workspace`, KHÔNG mất Draft/hàng đợi đang có (đi thẳng `/settings` → back không đi qua `canDeactivateWorkspace`, guard đó chỉ chặn lúc RỜI `/workspace`, không chặn lúc VÀO lại).
- [ ] Chưa có TMDB key nào lưu sẵn → khối TMDB hiện "chưa cấu hình", nút "Xoá key" bị khoá (disabled), nút hiện chữ "Nhập key" (không phải "Đổi key").
- [ ] Bấm "Nhập key" → dialog `TmdbKeyDialog` quen thuộc (cùng dialog màn Workspace) → nhập key thật → Lưu → khối TMDB tự cập nhật ngay thành "✓ đã cấu hình", nút đổi chữ "Đổi key", nút "Xoá key" bật lên.
- [ ] Quay lại `/workspace`, bấm "Tra TMDB" ở một dòng bảng metadata → gọi thẳng `tmdb_search` (KHÔNG hiện lại dialog nhập key) — xác nhận key vừa nhập ở Cài đặt được tầng `tmdb.rs` đọc đúng, không cần nhập lại.
- [ ] Bấm "Đổi key" (đã có key từ trước) → dialog mở lên TRỐNG (không prefill key cũ — `tmdb_has_key()` không trả key ra ngoài, xem doc comment `tmdb.rs`) → nhập key khác → Lưu → `tmdb_search` sau đó dùng key MỚI (kiểm bằng cách đổi sang key sai rồi tra thử, phải ra lỗi `InvalidKey`).
- [ ] Bấm "Xoá key" → dialog `ConfirmDialog` (nút xác nhận tô warn) → bấm "Xoá key" → khối TMDB về lại "chưa cấu hình", nút "Xoá key" khoá lại. Quay lại Workspace, bấm "Tra TMDB" → dialog nhập key lại hiện ra (đúng hành vi `tmdbHasKey()` trả `false`).
- [ ] Bấm "Xoá key" rồi đóng `ConfirmDialog` bằng Esc/bấm ra ngoài (không bấm nút nào) → KHÔNG có gì đổi — trạng thái TMDB giữ nguyên, file `tmdb_api_key.json` vẫn còn.
- [ ] Vào `/workspace` khi có ≥1 dòng ở bảng metadata (Draft chưa upload), bấm icon ⚙ → dialog "Rời khỏi Workspace?" hiện ra ĐÚNG NHƯ bấm "Chọn kênh khác" (canDeactivate guard áp dụng đều cho mọi điều hướng rời `/workspace`, không có ngoại lệ riêng cho Cài đặt) — bấm "Ở lại" thì vẫn ở `/workspace`, Draft giữ nguyên; bấm "Rời khỏi" thì sang `/settings` VÀ Draft bị xoá (đúng thiết kế ADR-0018, không phải bug mới).

### Nếu có gì vỡ

- Số điện thoại/API_ID/API_HASH hiện "Không đọc được thông tin đăng nhập" dù đã đăng nhập bằng `credentials.json` có thật → kiểm `load_saved_credentials()` có đang đọc đúng `app_data_dir()` của phiên `cargo tauri dev` hiện tại không (cùng lớp bug đã gặp ở màn Đăng nhập — origin webview không liên quan ở đây vì đọc app-data, nhưng vẫn kiểm nếu build debug/release trỏ khác thư mục app-data).
- "Đổi key" hiện lại key CŨ trong dialog → sai thiết kế, `tmdb_has_key()` chỉ được trả `bool`, không được trả key thật — kiểm `TmdbKeyDialog`/`promptTmdbApiKey()` không bị truyền `data` chứa key có sẵn.
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0019 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — mã hoá app-data qua OS keyring (2026-09-14)

Liên quan: [ADR-0020](./adr/0020-ma-hoa-bi-mat-app-data-qua-os-keyring.md), [docs/changelog.md § 2026-09-14, mã hoá app-data](./changelog.md#2026-09-14--gui-ingest-desktop-mã-hoá-credentialsjsontmdb_api_keyjson-qua-os-keyring-adr-0020), [docs/roadmap.md § Ingest](./roadmap.md#ingest). "Thiết bị thật" ở đây nghĩa là `cargo tauri dev` + tài khoản Telegram thật cho nhánh `credentials.json` — nhánh `tmdb_api_key.json` chỉ cần một API key TMDB bất kỳ (thật hoặc giả để test cơ chế lưu, không cần gọi `tmdb_search` thành công).

**KHÔNG chạy hộ bằng agent/Claude phần đăng nhập MTProto.** Riêng roundtrip keyring THUẦN (không đụng MTProto) đã tự verify được — xem "Chuẩn bị" bên dưới.

### Chuẩn bị

- [x] `cargo build --workspace`/`cargo clippy --workspace` (0 warning) sau khi thêm crate `keyring` + `secret_store.rs` — verify 2026-09-14.
- [x] **Roundtrip keyring THẬT (không mock, không MTProto) — verify 2026-09-14, ĐẠT.** Unit test `#[ignore]` `secret_store::tests::keyring_roundtrip_writes_and_reads_back_without_touching_fallback_file` chạy `cargo test -- --ignored` PASS; `cmdkey /list` xác nhận không còn entry tồn dư sau test.

### Các bước

- [x] **Verify 2026-09-14, ĐẠT (tổng quát).** User xác nhận đã chạy `cargo tauri dev` + tài khoản thật — app hoạt động đúng thiết kế với keyring. Chưa có xác nhận riêng từng bước con bên dưới (nhánh di trú, xoá key, fallback...) — các dòng đó VẪN mở, coi như chưa verify riêng lẻ.
- [x] Xoá sạch `credentials.json` VÀ mọi entry Credential Manager tên `com.tsmc.ingestdesktop` (nếu có, qua `cmdkey /list` + `cmdkey /delete`) — đăng nhập lại từ đầu (API_ID/API_HASH/OTP) → sau khi xong, `credentials.json` ở app-data **KHÔNG xuất hiện** (hoặc xuất hiện rồi biến mất ngay) — kiểm bằng `cmdkey /list` thấy MỘT entry service `com.tsmc.ingestdesktop`, account `credentials` chứa đúng thông tin (Credential Manager UI không hiện password ở dạng đọc được, chỉ xác nhận entry tồn tại).
- [x] Đóng app, mở lại (không gõ gì) → `check_session()` tự nhận đúng session cũ như trước ADR-0020 (đọc `credentials.json` từ keyring, không phải file) — hành vi bên ngoài giống hệt trước khi có mã hoá.
- [ ] **Nhánh di trú:** trên một máy ĐANG có sẵn `credentials.json` plaintext từ bản cũ (trước 2026-09-14) — mở app (đọc đúng, rơi về fallback file) → làm một thao tác kích hoạt `save_credentials()` lại (vd đăng nhập lại) → `credentials.json` biến mất khỏi app-data, entry Credential Manager xuất hiện thay thế.
- [ ] Màn Cài đặt → "Nhập key"/"Đổi key" TMDB → Lưu → `tmdb_api_key.json` **KHÔNG xuất hiện** ở app-data (hoặc biến mất ngay) — `cmdkey /list` thấy entry account `tmdb_api_key`. Bấm "Tra TMDB" ở Workspace vẫn đọc đúng key (không hỏi lại).
- [ ] Màn Cài đặt → "Xoá key" → entry Credential Manager `tmdb_api_key` biến mất (`cmdkey /list` không còn thấy) — khớp hành vi UI đã verify ở mục "màn Cài đặt" phía trên (trạng thái về "chưa cấu hình").
- [ ] **Nhánh fallback (khó ép chủ động, ghi lại nếu gặp tự nhiên):** nếu Credential Manager không khả dụng vì lý do nào đó (policy nhóm, lỗi hệ thống...) → app vẫn lưu/đọc được bình thường qua file plaintext, KHÔNG bị treo/lỗi — không có cách chủ động tái hiện an toàn, chỉ verify nếu tự nhiên gặp.

### Nếu có gì vỡ

- Đăng nhập xong nhưng mở lại app vẫn hỏi lại từ đầu → kiểm `cmdkey /list` có entry `com.tsmc.ingestdesktop`/`credentials` không; nếu KHÔNG có và `credentials.json` cũng không có → `secret_store::save_json()` thất bại ở CẢ HAI nhánh (hiếm, kiểm quyền ghi thư mục app-data).
- Entry Credential Manager có nhưng app vẫn đọc sai/rỗng → kiểm `serde_json::from_slice()` trong `load_json()` — có thể entry chứa dữ liệu KHÔNG phải JSON hợp lệ (ghi tay/công cụ khác đụng vào entry cùng tên).
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0020 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — mã hoá `session.sqlite3` (2026-09-14)

Liên quan: [ADR-0021](./adr/0021-ma-hoa-session-sqlite-qua-session-tu-implement.md), [docs/changelog.md § 2026-09-14, mã hoá session.sqlite3](./changelog.md#2026-09-14--gui-ingest-desktop-mã-hoá-sessionsqlite3-qua-session-tự-implement-adr-0021), [docs/roadmap.md § Ingest](./roadmap.md#ingest). "Thiết bị thật" ở đây nghĩa là `cargo tauri dev` + tài khoản Telegram thật — khác mục "mã hoá app-data qua OS keyring" ở trên (đã verify riêng, không lặp lại).

**KHÔNG chạy hộ bằng agent/Claude phần đăng nhập MTProto.** Roundtrip mã hoá THUẦN (không đụng MTProto) đã tự verify được — xem "Chuẩn bị" bên dưới.

### Chuẩn bị

- [x] `cargo build --workspace`/`cargo clippy --workspace` (0 warning, cần `CMAKE_GENERATOR` trên máy có nhiều bản Visual Studio — xem [docs/lessons.md](./lessons.md)) sau khi thêm `encrypted_session.rs` — verify 2026-09-14.
- [x] **Roundtrip mã hoá THẬT (không mock, không MTProto) — verify 2026-09-14, ĐẠT.** `cargo test exercise_encrypted_sqlite_session` PASS: file thật không lộ header `"SQLite format 3\0"`, mở sai key → lỗi, mở đúng key → đọc lại đúng dữ liệu.
- [x] **`load_or_generate_key()` — verify 2026-09-14, ĐẠT.** `cargo test load_or_generate_key_is_stable_across_calls` PASS: sinh một lần, gọi lại đọc đúng key cũ.

### Các bước

- [x] **Verify 2026-09-14, ĐẠT (tổng quát).** User xác nhận đã chạy `cargo tauri dev` + tài khoản thật — đăng nhập/mở lại app hoạt động đúng với `session.sqlite3` mã hoá. Chưa có xác nhận riêng từng bước con bên dưới (mở file bằng công cụ SQLite thường phải lỗi, nhánh di trú từ file plaintext cũ, key ổn định qua nhiều phiên...) — các dòng đó VẪN mở, coi như chưa verify riêng lẻ.
- [x] Xoá sạch `session.sqlite3` VÀ entry Credential Manager account `session_encryption_key` (nếu có) — đăng nhập lại từ đầu (API_ID/API_HASH/OTP) → thành công như trước ADR-0021 (hành vi bên ngoài không đổi), `session.sqlite3` xuất hiện ở app-data nhưng KHÔNG mở được bằng công cụ SQLite thường (vd DB Browser for SQLite báo "file is not a database" — đúng thiết kế, xác nhận mã hoá thật trên tài khoản thật, không chỉ fixture test).
- [x] Đóng app, mở lại (không gõ gì) → `check_session()` nhận đúng session cũ, KHÔNG hỏi lại OTP — hành vi giống hệt trước khi có ADR-0021 (chỉ khác ở chỗ file giờ mã hoá).
- [x] **Nhánh di trú:** trên máy ĐANG có `session.sqlite3` PLAINTEXT từ bản cũ (trước 2026-09-14) — mở app bằng code MỚI → `EncryptedSqliteSession::open()` gọi kèm `encryption_config` trên một file KHÔNG mã hoá → dự kiến LỖI mở (SQLite thường không đọc được khi ép cipher lên file plaintext) — nếu gặp, KHÔNG phải mất dữ liệu (file `session.sqlite3` cũ vẫn còn nguyên trên đĩa) nhưng app sẽ coi như chưa đăng nhập, phải đăng nhập lại (session mới, mã hoá) — ghi lại đúng hành vi gặp phải, đối chiếu với dự kiến này.
- [x] Sau khi đăng nhập lại nhiều lần trong các phiên `cargo tauri dev` khác nhau → key mã hoá KHÔNG đổi giữa các lần (nếu đổi, mỗi lần mở app sẽ y hệt "nhánh di trú" ở trên — luôn phải đăng nhập lại) — xác nhận qua log/hành vi thực tế: chỉ hỏi OTP lại nếu Telegram tự hết hạn session, không phải mỗi lần mở app.

### Nếu có gì vỡ

- Đăng nhập xong nhưng mở lại app luôn hỏi lại OTP (dù chưa xoá gì) → nghi ngờ đầu tiên: `load_or_generate_key()` SINH KEY MỚI mỗi lần gọi thay vì đọc lại key cũ — kiểm entry Credential Manager `session_encryption_key` có ổn định qua `cmdkey /list` giữa các lần mở app không.
- `check_session()` lỗi ngay cả với session MỚI (vừa đăng nhập xong trong đúng phiên đó) → nghi ngờ: key truyền vào `EncryptedSqliteSession::open()` lúc TẠO khác key truyền vào lúc ĐỌC LẠI trong cùng process (bug logic, không phải vấn đề persist key) — kiểm `check_session()` luôn gọi `load_or_generate_key()` với ĐÚNG `key`/`path` mỗi lần, không có code path nào bỏ qua.
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0021 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — Đăng xuất (2026-09-14)

Liên quan: [ADR-0017 § addendum 2026-09-14](./adr/0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-09-14-thêm-sign_out-vào-ingestrpc), [docs/changelog.md § 2026-09-14, Đăng xuất](./changelog.md#2026-09-14--gui-ingest-desktop-thêm-đăng-xuất-sign_out-adr-0017--addendum), [docs/roadmap.md § Ingest](./roadmap.md#ingest). "Thiết bị thật" nghĩa là `cargo tauri dev` + tài khoản Telegram thật.

**KHÔNG chạy hộ bằng agent/Claude.** Đăng xuất là thao tác MTProto thật (gọi `auth.LogOut`), cùng mức nhạy cảm như đăng nhập — admin tự chạy.

### Chuẩn bị

- [x] `cargo build --workspace`/`cargo clippy --workspace -- -D warnings` (cần `CMAKE_GENERATOR`, xem [docs/lessons.md](./lessons.md)) sau khi thêm `sign_out` — verify 2026-09-14.
- [x] `ng build`/`npm run lint` sạch sau khi thêm nút "Đăng xuất" ở màn Cài đặt — verify 2026-09-14, môi trường dev (không phải `cargo tauri dev`).

### Các bước

- [x] **Verify 2026-09-15, ĐẠT (tổng quát).** User xác nhận đã chạy `cargo tauri dev` + tài khoản thật — Đăng xuất hoạt động đúng thiết kế. Chưa có xác nhận riêng từng bước con bên dưới (đối chiếu "Thiết bị đang hoạt động" trên app Telegram gốc, nhánh có upload chạy dở, nhánh huỷ dialog, nhánh lỗi server) — các dòng đó VẪN mở, coi như chưa verify riêng lẻ.
- [ ] Đã đăng nhập + đã chọn kênh, không có upload nào chạy → vào Cài đặt → bấm "Đăng xuất" → dialog xác nhận hiện đúng nội dung "thường" (không nhắc tới upload) → bấm "Đăng xuất" → điều hướng về `/login`, hiện lại Bước 1 **đã tự điền sẵn** API_ID/API_HASH/số điện thoại (từ `credentials.json` còn giữ nguyên) — chỉ cần bấm "Tiếp tục" rồi nhập OTP mới, KHÔNG cần gõ lại API_ID/HASH/SĐT.
- [ ] Mở app Telegram gốc (điện thoại/desktop khác) → Cài đặt → Thiết bị đang hoạt động → xác nhận phiên `tsmc-ingest-desktop` vừa đăng xuất **KHÔNG còn trong danh sách** (server-side `auth.LogOut` thật sự thu hồi session, không chỉ xoá cục bộ).
- [ ] Sau khi đăng xuất, kiểm tra `session.sqlite3` ở app-data → đã bị xoá (hoặc file mới/rỗng nếu đăng nhập lại ngay).
- [ ] Đăng nhập lại (OTP mới) → vào lại Workspace bình thường, đúng như một lần đăng nhập mới — không có gì "nửa vời" sót lại từ session cũ.
- [ ] **Nhánh có upload đang chạy:** thả 1 file, bấm Upload, TRONG LÚC đang upload → vào Cài đặt → bấm "Đăng xuất" → dialog xác nhận hiện đúng nội dung CẢNH BÁO KHÁC (nhắc tới upload đang chạy dở) → xác nhận đăng xuất → upload đang chạy chuyển "Lỗi" ngay (kết nối bị cắt), không phải treo vô thời hạn.
- [ ] **Nhánh huỷ dialog:** bấm "Đăng xuất" → dialog hiện ra → bấm "Huỷ"/Esc/bấm ra ngoài → KHÔNG có gì xảy ra, vẫn ở màn Cài đặt, vẫn đăng nhập bình thường.
- [ ] **Nhánh lỗi server (khó ép chủ động, ghi lại nếu gặp tự nhiên):** nếu `auth.LogOut` lỗi (FLOOD_WAIT, mất mạng) → hiện lỗi ngay tại màn Cài đặt (`signOutError`), KHÔNG điều hướng đi đâu, `session.sqlite3` VẪN CÒN, vào lại Workspace vẫn dùng được bình thường (chưa đăng xuất thật) — không có cách chủ động tái hiện an toàn.

### Nếu có gì vỡ

- Đăng xuất xong nhưng session vẫn còn trong "Thiết bị đang hoạt động" của Telegram gốc → `rpc.sign_out()` không thực sự được gọi, hoặc gọi nhưng lỗi bị nuốt thầm lặng — kiểm log/`describeIngestError()` ở `signOutError`.
- Đăng xuất xong app vẫn coi như đã đăng nhập (không về `/login`) → kiểm `*conn = ConnState::Disconnected` có chạy SAU `rpc.sign_out().await` thành công hay không (thứ tự đảo ngược = bug nghiêm trọng, có thể xoá session TRƯỚC khi server xác nhận).
- Form Bước 1 KHÔNG tự điền sau đăng xuất → kiểm `sign_out()` (Rust) có lỡ xoá cả `credentials.json`/entry keyring `credentials` không (thiết kế là KHÔNG được đụng vào) — `load_saved_credentials()` gọi lại phải vẫn thấy dữ liệu cũ.
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0017 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — Trình quản lý catalog (2026-09-15)

Liên quan: [ADR-0017 § addendum 2026-09-15](./adr/0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-09-15-trình-quản-lý-catalog-ingestrpc-thêm-2-thao-tác), [docs/changelog.md § 2026-09-15, Trình quản lý catalog](./changelog.md#2026-09-15--gui-ingest-desktop-thêm-trình-quản-lý-catalog-a4-adr-0017--addendum), [docs/roadmap.md § Ingest](./roadmap.md#ingest). "Thiết bị thật" nghĩa là `cargo tauri dev` + tài khoản Telegram thật.

**KHÔNG chạy hộ bằng agent/Claude.** `check_deleted_messages`/`delete_message`/`publish_catalog` đều là RPC MTProto thật trên kênh media của admin.

### Chuẩn bị

- [x] `cargo build --workspace`/`cargo clippy --workspace -- -D warnings` sạch — verify 2026-09-15.
- [x] `ng build`/`npm run lint` sạch sau khi thêm route `/catalog` + icon topbar Workspace — verify 2026-09-15, môi trường dev (không phải `cargo tauri dev`; build cục bộ bị chặn bởi tiến trình `cargo tauri dev` khác đang chạy sẵn lúc code slice này, chưa tự `cargo build`/`clippy` lại được — không liên quan tới đúng/sai của code, chỉ là file lock `ffmpeg-runtime/*.dll`).

### Các bước

- [x] Kênh có catalog đang ghim, lành mạnh (mọi message còn nguyên) → vào `/catalog` (icon cạnh ⚙ ở topbar Workspace) → bảng hiện đúng số item khớp `catalog: N item` ở Workspace, Title/Năm/Season/Ep hiện đúng giá trị đã lưu.
- [x] Bấm "Đối soát với kênh" → không có item nào bị gắn cờ "⚠ Message đã xoá" (catalog lành mạnh).
- [x] Tự tay xoá MỘT message video (dùng app Telegram gốc, xoá một item đang có trong catalog) → quay lại `/catalog`, bấm "Đối soát với kênh" lần nữa → ĐÚNG item đó (và chỉ item đó) hiện badge "⚠ Message đã xoá".
- [x] Sửa Title/Năm/Season/Ep một dòng bất kỳ (không phải dòng vừa phát hiện hỏng) → nút "Lưu catalog" chuyển từ disabled sang bấm được → bấm → catalog.v1.json mới ghim đúng giá trị vừa sửa, `catalog: N item` ở Workspace không đổi số lượng.
- [x] Menu dòng đã bị gắn cờ hỏng → "Xoá khỏi catalog" → dòng biến mất khỏi bảng NGAY (chưa đụng Telegram) → bấm "Lưu catalog" → catalog.v1.json mới KHÔNG còn item đó, `catalog: N-1 item`.
- [x] Menu MỘT dòng còn lành mạnh → "Xoá khỏi catalog + xoá message trên kênh" → dialog cảnh báo tone warn hiện đúng tên item, bấm "Huỷ" → KHÔNG có gì xảy ra (dòng vẫn còn, message vẫn còn trên kênh) → mở lại menu, xác nhận thật lần này → message biến mất khỏi kênh NGAY (kiểm bằng app Telegram gốc, trước cả khi bấm "Lưu catalog") → dòng biến mất khỏi bảng → bấm "Lưu catalog" → catalog.v1.json mới không còn item đó.
- [x] **Nhánh cập nhật đồng thời (đúng lý do tách `removedIds` khỏi "còn trong mảng đang sửa"):** mở `/catalog`, KHÔNG bấm Lưu ngay → mở `/workspace` ở route khác (hoặc để tab kia), upload thêm 1 item mới, publish xong → quay lại `/catalog` (không load lại trang) → sửa một dòng bất kỳ rồi bấm "Lưu catalog" → catalog.v1.json mới PHẢI có đủ cả item vừa upload từ Workspace LẪN thay đổi vừa sửa ở `/catalog` (không được làm mất item mới do đọc "bản catalog lúc mount" thay vì đọc lại lúc publish).
- [ ] FLOOD_WAIT rơi vào lúc "Lưu catalog" (nếu gặp tự nhiên — KHÔNG chủ động ép) → nút hiện "Đang lưu catalog — FLOOD_WAIT Ns…", tự đếm ngược rồi tự thử lại, không mất dữ liệu đã sửa.
- [x] Kênh CHƯA có catalog nào ghim → vào `/catalog` → hiện đúng thông báo trống ("Chưa có catalog nào ghim ở kênh này…"), không lỗi/màn trắng.

### Nếu có gì vỡ

- "Đối soát với kênh" luôn trả rỗng dù đã xoá message thật → **bug thật đã gặp + vá (2026-09-15, user report cùng ngày code slice này):** `channels.GetMessages` không lược bỏ message đã xoá, trả `tl::enums::Message::Empty` (tombstone) thay vì omit hẳn — `Message::peer_id()` của biến thể đó rơi về đúng peer đang truy vấn nên KHÔNG bị filter nội bộ của `get_messages_by_id()` loại, kết quả là `Some(Message)` chứ không phải `None`. Đã vá bằng kiểm thêm `matches!(message.raw, tl::enums::Message::Empty(_))` ở `check_deleted_messages()` — xem [ADR-0017 § addendum 2026-09-15](./adr/0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-09-15-trình-quản-lý-catalog-ingestrpc-thêm-2-thao-tác). Nếu vẫn gặp SAU bản vá này → nghi ngờ tiếp theo mới là peer/channel đang chọn sai (`state.selected_channel`) hoặc lỗi RPC bị nuốt thầm lặng.
- "Lưu catalog" làm MẤT item không liên quan gì tới thao tác vừa làm → nghi ngờ đầu tiên: `removedIds` (Angular) không được reset đúng lúc `load()`, hoặc `onPublish()` lỡ dùng lại logic cũ "loại theo còn/không còn trong `items()`" thay vì `removedIds` tường minh — xem doc comment `catalog-manager.ts::removedIds`.
- "Xoá khỏi catalog + xoá message trên kênh" xoá catalog nhưng KHÔNG xoá message thật (hoặc ngược lại) → kiểm thứ tự trong `removeFromCatalogAndChannel()`: `deleteMessage()` PHẢI thành công (RPC thật trả `Ok`) trước khi `removeFromCatalog()` chạy — nếu đảo ngược, một message đã bị coi là "xoá" trên UI dù RPC thật lỗi.
- Bất kỳ hành vi nào lệch thiết kế → ghi addendum vào ADR-0017 (không sửa Quyết định gốc), rồi cập nhật lại tài liệu này.

## GUI ingest desktop (`apps/tsmc-ingest-desktop`) — Nhật ký (2026-09-15)

Liên quan: [docs/ux-design.md § Phụ lục A.4](./ux-design.md#a4-các-màn-còn-lại), [docs/roadmap.md § Ingest](./roadmap.md#ingest). "Thiết bị thật" nghĩa là `cargo tauri dev` + tài khoản Telegram thật.

**KHÔNG chạy hộ bằng agent/Claude** — `read_app_log()` tự nó không đụng MTProto, nhưng verify cần log THẬT phát sinh từ một phiên đăng nhập/upload thật.

### Chuẩn bị

- [x] `cargo build --workspace` sạch — verify 2026-09-15.
- [x] `cargo clippy --workspace -- -D warnings` sạch — verify 2026-09-15 (chạy lại được sau khi phiên `cargo tauri dev` song song của user kết thúc, hết tranh chấp file lock `ffmpeg-runtime/*.dll` đã ghi ở lần trước).
- [x] `ng build`/`npm run lint` sạch sau khi thêm route `/logs` + icon topbar Workspace + `@tauri-apps/plugin-clipboard-manager` — verify 2026-09-15.

### Các bước

- [ ] Vào `/logs` (icon cạnh "Trình quản lý catalog" ở topbar Workspace) lần đầu, SAU khi đã đăng nhập/thao tác ít nhất một lần trong phiên `cargo tauri dev` này → nội dung file log (`app_log_dir()/<tên app>.log`) hiện ra, cuộn sẵn xuống dòng cuối cùng. **Bug thật đã gặp (2026-09-15, user report): KHÔNG cuộn xuống cuối** — `afterNextRender()` (trước đó là `queueMicrotask` trần) đăng ký một lần ở constructor chạy TRƯỚC khi `<pre #logBox>` tồn tại trong DOM (phần tử chỉ render ở nhánh `@else` sau khi hết `loading()`) — cùng lớp bug đã ghi ở `apps/web/src/app/browse/browse.ts::gridMeasure`. Đã vá bằng gọi `afterNextRender()` MỚI mỗi lần `load()` (kèm `Injector` tường minh vì gọi ngoài constructor) — xem `logs.ts::load()`. **CHƯA verify lại sau vá.**
- [x] Nội dung log KHÔNG chứa `auth_key`, session token, hay OTP/mật khẩu 2FA đã nhập — chỉ có thao tác giao thức cấp thấp (connect, salt, tên RPC...) — verify 2026-09-15, ĐẠT.
- [ ] Bấm "Làm mới" sau khi vừa phát sinh thêm hoạt động (vd thử "Đối soát với kênh" ở `/catalog`) → nội dung cập nhật, có thêm dòng mới ở cuối. **Bug thật đã gặp (2026-09-15, user report): nội dung KHÔNG đổi.** Điều tra ra đây KHÔNG phải lỗi `read_app_log()`/`onRefresh()` (logic đọc lại file đúng) mà do mức lọc `log::LevelFilter::Info` — sau lần connect/sinh `auth_key` đầu phiên, một RPC bình thường (vd `get_messages_by_id` của "Đối soát") chỉ sinh log ở mức `debug!`/`trace!` phía `grammers-mtsender`/`grammers-mtproto` (đối chiếu trực tiếp mã nguồn 0.10.0), bị lọc mất hoàn toàn ở `Info` — file thật sự không có gì mới để đọc. Đã nâng lên `Debug` (`lib.rs`, xem doc comment tại chỗ giải thích đã audit không có `debug!`/`trace!` nào in giá trị request nhạy cảm) để hành động thường ngày cũng sinh log. **CHƯA verify lại sau vá.**
- [x] Bấm "Sao chép" → dán vào một chỗ khác (Notepad...) → nội dung dán khớp y hệt nội dung đang hiện trên màn `/logs` — verify 2026-09-15, ĐẠT qua `cargo tauri dev`. Bản đóng gói (`cargo tauri build`) CHƯA verify riêng — webview có thể khác `cargo tauri dev`, đúng bài học đã gặp ở `localStorage` màn Đăng nhập 2026-09-11, để mở tới khi build bản đóng gói kế tiếp.
- [ ] File log chưa từng tồn tại (case hiếm — vd vừa xoá tay file này trong lúc app đang chạy) → `/logs` hiện "Chưa có gì được ghi.", KHÔNG lỗi/màn trắng. Chưa xác nhận.
- [ ] Log vượt trần rotation 40KB (nếu gặp tự nhiên khi test — không chủ động spam để ép) → file cũ bị xoá hẳn (`RotationStrategy::KeepOne` của `tauri_plugin_log`), `/logs` vẫn đọc được file mới không lỗi. Mức `Debug` mới sinh log nhiều hơn hẳn `Info` — nhánh này giờ dễ gặp tự nhiên hơn trước, ưu tiên test cùng đợt verify lại phía trên.
- [ ] Nội dung log ở mức `Debug` mới vẫn KHÔNG chứa số điện thoại/mã OTP/mật khẩu 2FA đã nhập (audit mã nguồn cho thấy các dòng `debug!`/`trace!` chỉ in `msg_id`/tên kiểu TL/số byte/mã lỗi RPC, không in giá trị trường request — nhưng audit mã nguồn thư viện ngoài không thay được một lượt quan sát log THẬT). Chưa xác nhận bằng log thật.

### Nếu có gì vỡ

- `/logs` hiện "Chưa có gì được ghi." dù chắc chắn đã có hoạt động → kiểm đúng tên file `read_app_log()` tự tái tạo (`src-tauri/src/logs.rs::log_file_path()`) có khớp `app.package_info().name` thật của build đó không — tên package đổi (vd đổi `productName` ở `tauri.conf.json`) sẽ làm lệch đường dẫn này, vì `tauri_plugin_log` không có API công khai để hỏi lại đường dẫn nó đang dùng.
- "Sao chép" không dán được gì (nhất là ở bản `cargo tauri build` đóng gói) → kiểm `capabilities/default.json` có đúng `clipboard-manager:allow-write-text` không, và plugin đã `.plugin(tauri_plugin_clipboard_manager::init())` ở `lib.rs::run()` chưa.
- Vẫn không cuộn xuống cuối sau bản vá → kiểm `afterNextRender()` có thật sự được gọi lại mỗi lần `load()` không (không phải chỉ một lần ở constructor), và `Injector` truyền vào có đúng instance của component đang sống không.
- "Làm mới" vẫn không thấy gì mới dù chắc chắn vừa có RPC chạy → kiểm mức lọc đang hiệu lực thật sự là `Debug` (không phải build cache cũ còn giữ `Info` — cần rebuild sạch `src-tauri`), và hành động vừa làm có thật sự gọi RPC MTProto nào không (vd đọc dữ liệu hoàn toàn từ cache cục bộ thì không có gì để log).
- Nếu phát hiện bất kỳ trường nhạy cảm nào (số điện thoại, OTP, mật khẩu, `auth_key`) lọt vào log thật ở mức `Debug` → HẠ NGAY về lại `Info` (`lib.rs`), coi đây là bug bảo mật ưu tiên cao nhất, ghi lại phát hiện vào tài liệu này và `docs/lessons.md`.
- Bất kỳ hành vi nào lệch thiết kế → cập nhật lại tài liệu này (mục này không có ADR riêng — `read_app_log()`/clipboard-manager là chi tiết triển khai, không phải quyết định kiến trúc).

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

> **CLI đã khai tử (2026-09-13)** — `apps/tsmc-ingest/` đã xoá khỏi repo, GUI ingest desktop (Tauri) thay thế hoàn toàn (xem [ADR-0013 § addendum tương ứng](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-09-13-khai-tử-tsmc-ingest-cli--tsmc_bot--chốt-ba-thành-phần-gốc-còn-đúng-một)). Mục này giữ lại THUẦN LÀM HỒ SƠ LỊCH SỬ (số liệu thật — vd baseline 40.8x realtime Hạng C vẫn được SPIKE-09 dùng làm mốc so sánh) — KHÔNG còn gì "pending" ở đây, không ai cần chạy lại các bước dưới.

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
