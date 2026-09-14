# `tsmc-ingest-desktop` — GUI ingest desktop (Tauri + grammers-client)

Ứng dụng desktop (Tauri v2) cho người **đăng** nội dung — không phải bản desktop của app xem. Thiết kế đầy đủ (workspace ba vùng, hàng đợi bền, sửa metadata theo lô...) ở [docs/ux-design.md § Phụ lục A](../../docs/ux-design.md#phụ-lục-a-công-cụ-ingest-desktop-gui-tauri). Quyết định kiến trúc: [ADR-0013](../../docs/adr/0013-bot-dong-hanh-va-pipeline-ingest.md) (ba thành phần CLI/bot/GUI + bảng phân hạng A/B/C/D), [ADR-0017](../../docs/adr/0017-grammers-cho-cong-cu-ingest-desktop.md) (chọn `grammers-client` làm MTProto library, tách biệt hoàn toàn khỏi GramJS của `apps/web`).

> **Trạng thái hiện tại: Đăng nhập + Chọn kênh là UI thật (Angular + Material), phần còn lại vẫn khung sườn.** `ui/` giờ là một app Angular 22 standalone/zoneless riêng (`@tsmc/tsmc-ingest-desktop-ui`, KHÔNG chung workspace build với `apps/web` dù cùng pnpm workspace) — hai màn khớp `docs/ux-design.md § Phụ lục A.4` (cảnh báo ADR-0011 §5, `MatStepper` 3 bước cho Đăng nhập; Chọn kênh có 3 cách — chọn từ danh sách kênh của admin, nhập ref trực tiếp, hoặc tạo kênh mới — chặn ID thô + chặn kênh không phải `is_own`). Workspace ba vùng (mockup A.3: hàng đợi, bảng metadata, tiến trình upload) và 2 màn A.4 còn lại (Trình quản lý catalog, Nhật ký) **chưa có UI**. 4/9 thao tác `IngestRpc` (upload video/subtitle, publish catalog, tải document) đã có implementation đầy đủ ở `ingest-grammers` nhưng CHƯA wire thành Tauri command.

> **KHÔNG chạy app này hộ ai bằng agent/AI, đặc biệt bước đăng nhập.** Đăng nhập ở đây là MTProto thật — session tương đương toàn quyền tài khoản Telegram (đọc/gửi tin nhắn, xoá tài khoản). Luôn tự chạy trong terminal/máy của chính bạn (CLAUDE.md).

## Cấu trúc

```
apps/tsmc-ingest-desktop/
  Cargo.toml            # workspace root — 3 crate thành viên
  ingest-rpc-trait/     # trait IngestRpc + kiểu dữ liệu dùng chung, KHÔNG chứa luật nghiệp vụ
  ingest-grammers/       # implementation IngestRpc bằng grammers-client 0.10.0
  src-tauri/             # Tauri backend: state machine đăng nhập + 12 command
  ui/                     # app Angular 22 riêng (package.json/angular.json của chính nó)
    src/app/core/         # ingest-rpc.ts — cổng DUY NHẤT gọi invoke() Tauri, khớp dto.rs
    src/app/login/         # màn Đăng nhập (A.4) — UI thật
    src/app/channel/       # màn Chọn kênh (A.4) — UI thật
```

`libs/core-ingest` (TypeScript, ADR-0013 đã verify thật) vẫn là nguồn sự thật duy nhất cho bảng phân hạng A/B/C/D, kế thừa metadata, gộp catalog — Rust ở đây KHÔNG port lại luật đó, chỉ thực thi RPC (điều kiện bắt buộc #4, ADR-0017).

## Yêu cầu trước khi dùng

- Rust + Cargo (bản đã dùng để dựng: `cargo 1.90.0`).
- Tauri CLI: `cargo install tauri-cli --version "^2" --locked` (một lần, có thể mất vài phút build).
- Windows: WebView2 Runtime (thường có sẵn trên Windows 11; nếu thiếu, Tauri sẽ báo lỗi rõ lúc `cargo tauri dev`).
- `pnpm install` đã chạy ở **root** repo ít nhất một lần (`ui/` là một package trong pnpm workspace chung, xem `pnpm-workspace.yaml`) — `cargo tauri dev`/`cargo tauri build` tự gọi `pnpm --dir ../ui run start`/`build` qua `beforeDevCommand`/`beforeBuildCommand` ở `tauri.conf.json`, nhưng KHÔNG tự chạy `pnpm install` hộ.
- `TSMC_API_ID`/`TSMC_API_HASH` — tự tạo tại https://my.telegram.org, nhập trực tiếp vào form trong app. Chỉ cần nhập tay ở lần đăng nhập ĐẦU TIÊN — từ lần sau app tự nhớ (`credentials.json`/OS keyring ở app-data, xem mục "Chạy") và tự nhận ra đã đăng nhập, không hỏi lại.
- **`cmake` trên `PATH`** (mới từ [ADR-0021](../../docs/adr/0021-ma-hoa-session-sqlite-qua-session-tu-implement.md), mã hoá `session.sqlite3`) — `libsql-ffi` build kèm feature `multiple-ciphers` qua `cmake::Config`, cần binary `cmake` thật (không chỉ Rust `cmake` crate). Nếu máy có NHIỀU bản Visual Studio (vd bản preview mới cạnh bản ổn định), `cmake` crate có thể tự chọn generator mà `cmake` binary đang cài KHÔNG nhận ra (`CMake Error: Could not create named generator Visual Studio NN 20XX`) — set biến môi trường `CMAKE_GENERATOR` trỏ đúng generator có thật, vd `CMAKE_GENERATOR="Visual Studio 17 2022" cargo build`.

## Chạy

Từ thư mục này (`apps/tsmc-ingest-desktop/`):

```bash
cargo build --workspace     # build cả 3 crate, không cần MTProto — catch lỗi wiring/kiểu dữ liệu
cargo tauri dev              # tự chạy `pnpm --dir ../ui run start` (dev server Angular, cổng 4300), mở cửa sổ app thật
```

Chạy riêng UI Angular (không mở cửa sổ Tauri, vd để xem layout nhanh trong trình duyệt — `invoke()` sẽ lỗi vì không có `window.__TAURI_INTERNALS__`, lỗi này được bắt và hiện gọn trong `errorMessage`, không crash trang):

```bash
cd ui && pnpm run start     # http://localhost:4300/login
```

**Build bản release: LUÔN dùng `cargo tauri build`, KHÔNG BAO GIỜ `cargo build --release` trực tiếp.**
`cargo build --release` chạy thẳng `cargo`, **bỏ qua `beforeBuildCommand`** (`pnpm --dir ../ui run build`) ở `tauri.conf.json` — Rust vẫn build được (không lỗi) nhưng nhúng NGUYÊN VẸN bất cứ thứ gì đang có sẵn ở `ui/dist/browser` lúc đó, kể cả một bản cũ/thiếu style. Triệu chứng thật đã gặp (2026-09-11): app mở ra "chỉ có plain html, không có style" — vì `.exe` nhúng bản `ui/dist/browser` từ trước khi UI Angular đầy đủ tồn tại. Dùng đúng:

```bash
cargo tauri build --no-bundle   # ng build fresh + build Rust + nhúng, ra thẳng .exe, không đóng gói installer — nhanh để test
cargo tauri build                # như trên, CỘNG đóng gói installer (MSI/NSIS) vào target/release/bundle/
```

**Lần đầu thật sự** (chưa từng đăng nhập trên máy này): điền API_ID + API_HASH + số điện thoại (Bước 1) → "Tiếp tục" → **check_session** trả `false` → **request_login_code** → nhập mã OTP (Bước 2) → **submit_otp** (tài khoản có 2FA thì thêm mật khẩu ở Bước 3 → **submit_password**) → tự điều hướng sang Chọn kênh. Ngay khi submit thành công lần này, UI tự lưu cả 4 giá trị (API_ID/API_HASH/mã vùng/số điện thoại) vào `credentials.json` ở app-data (KHÔNG phải `localStorage` — xem lý do "origin" ngay dưới).

**Mọi lần mở app SAU đó (bất kỳ cách chạy nào — `cargo tauri dev`, `.exe` release, kể cả đổi qua lại giữa hai cách): KHÔNG GÕ GÌ CẢ.** `tryAutoLogin()` tự đọc `credentials.json`, tự gọi **check_session** ngay trong constructor — session còn hợp lệ thì nhảy thẳng sang Chọn kênh trước khi kịp thấy form. Chỉ khi session đã hết hạn/không hợp lệ mới rơi về Bước 1, và lúc đó form đã **tự điền sẵn cả 4 ô** từ `credentials.json` — sửa/xác nhận rồi bấm "Tiếp tục" là đủ, không phải gõ lại từ đầu.

**Vì sao lưu ở app-data (Rust), không phải `localStorage`:** `localStorage` tách riêng theo **origin** phục vụ webview — `cargo tauri dev` (`http://localhost:4300`) và bản release (protocol riêng của Tauri) là hai origin khác nhau, không chia sẻ gì cả. Bản đầu (2026-09-11) chỉ nhớ `api_id` ở `localStorage`, sinh đúng bug "mỗi lần mở app lại phải gõ lại 3 ô" khi đổi qua lại giữa hai cách chạy. `app.path().app_data_dir()` không phụ thuộc origin nên không dính lỗi này — cùng thư mục chứa `session.sqlite3`.

**Vì sao `check_session()` không cần API_HASH/số điện thoại để nhận ra đã đăng nhập:** `check_session()` (`ingest-grammers/src/session.rs::connect()`) chỉ dùng `api_id` để mở lại `session.sqlite3` đã có sẵn — API_HASH/số điện thoại chỉ có ý nghĩa ở bước `request_login_code()` (đăng nhập MỚI, khi CHƯA có session hợp lệ). Đây không phải lỗ hổng: giống hệt Telegram Desktop không hỏi lại mật khẩu mỗi lần mở app đã đăng nhập trên máy đó — ranh giới bảo mật thật là quyền truy cập hệ điều hành vào `session.sqlite3`, không phải form này.

Còn một lớp phòng thủ debounce (`scheduleAutoCheck()`, `login.ts`) cho đúng MỘT trường hợp: `credentials.json` CHƯA từng tồn tại (bootstrap lần đầu tuyệt đối, hoặc file bị xoá tay) — gõ API_ID xong 500ms tự thử `check_session()` ngầm dù chưa điền API_HASH/số điện thoại, phòng khi user nhớ đúng API_ID nhưng vì lý do gì đó `credentials.json` không còn.

**Màn Chọn kênh — UI kiểu Telegram** (`channel.ts`/`.html`): vào màn là thấy ngay danh sách kênh của admin (**list_own_channels**, tải ngay lúc vào màn, không phải bấm mới tải), một ô lọc trên cùng + nút "+" (icon button) cạnh ô lọc. Ba cách ra kết quả, cả ba đổ vào cùng một chỗ (**check_write_permission** + **read_pinned_catalog**, chỉ khi `is_own`):
1. **Gõ vào ô lọc** — lọc TẠI CHỖ danh sách kênh của admin theo tên (substring, không phân biệt hoa/thường), đồng thời debounce 500ms thử **resolve_channel** (không dùng ID thô — bị chặn tại ô lọc) — nếu gõ đúng @username/link của một kênh khác, kết quả hiện thêm một dòng "kết quả tìm kiếm" ngay trong cùng danh sách.
2. **Bấm một dòng trong danh sách** — dòng từ `list_own_channels()` thì **select_channel** (không resolve lại, peer cache Rust đã có sẵn); dòng "kết quả tìm kiếm" thì dùng thẳng object đã resolve lúc debounce (không gọi RPC lần hai).
3. **Bấm nút "+"** → mở panel "Tạo kênh mới" → gõ tên → **create_channel** (`broadcast: true`, `megagroup: false` — đúng loại kênh media của ADR-0013), tự chọn luôn làm kênh đang làm việc.

## 12 command đã wire (`src-tauri/src/commands.rs`)

| Command | Việc gì | Yêu cầu state trước đó |
|---|---|---|
| `check_session(apiId)` | Mở/khôi phục session SQLite (thư mục app-data của HĐH, không phải cwd), kiểm tra đã đăng nhập chưa | — |
| `request_login_code(apiHash, phone)` | Gửi mã OTP | `check_session` đã chạy và trả `false` |
| `submit_otp(code)` | Xác nhận OTP — trả `LoggedIn` hoặc `PasswordRequired` | `request_login_code` đã chạy |
| `submit_password(password)` | Xác nhận mật khẩu 2FA | `submit_otp` trả `PasswordRequired` |
| `load_saved_credentials()` | Đọc `credentials.json` ở app-data (nếu có) — `Option`, không lỗi khi chưa có gì | — |
| `save_credentials(apiId, apiHash, dialCode, nationalNumber)` | Ghi `credentials.json` — best-effort, không trả lỗi ra UI | — |
| `resolve_channel(channelRef)` | Resolve username kênh → id/access_hash/title/is_own, nhớ lại làm "kênh đang chọn" | đã đăng nhập xong (`Ready`) |
| `list_own_channels()` | Liệt kê channel/broadcast **+ supergroup** mà tài khoản là creator (quét `iter_dialogs()`, lọc `is_own`; group nhỏ chưa nâng cấp supergroup KHÔNG hiện — khác họ RPC, không tương thích với `read_pinned_catalog`/`upload_video`/...) | đã đăng nhập xong (`Ready`) |
| `create_channel(title)` | Tạo channel/broadcast media mới, tự chọn luôn làm "kênh đang chọn" | đã đăng nhập xong (`Ready`) |
| `select_channel(id, title, isOwn)` | Chọn một kênh đã có trong kết quả `list_own_channels()` làm "kênh đang chọn" — KHÔNG resolve lại | `list_own_channels()` đã liệt kê đúng kênh đó |
| `check_write_permission()` | Đọc `is_own` của kênh đang chọn | một trong ba lệnh chọn kênh ở trên đã chạy thành công |
| `read_pinned_catalog()` | Đọc document đang ghim của kênh đang chọn, nếu có | một trong ba lệnh chọn kênh ở trên đã chạy thành công |

**Đơn giản hoá có chủ đích:** nếu `submit_otp`/`submit_password` thất bại (sai mã/sai mật khẩu), state reset về `Disconnected` — không có retry tại chỗ (`PasswordToken` của grammers-client không `Clone`). UI (`ui/src/app/login/login.ts`, `resetAfterAuthFailure()`) che gap này bằng cách tự gọi lại `check_session()` với `api_id` đã biết ngay sau lỗi, rồi đưa user về Bước 1 (giá trị API_HASH/số điện thoại vẫn còn trong ô) thay vì bắt gõ lại toàn bộ.

## Ghim phiên bản (ADR-0017 điều kiện bắt buộc #1)

Toàn bộ 5 crate `grammers-*` ghim cứng `=0.10.0` (không `^`) trong `[workspace.dependencies]` ở `Cargo.toml` gốc — cùng lý do CLAUDE.md bất biến #9 ghim `telegram@2.26.22`: thư viện community-maintained, đổi version ngoài ý muốn là rủi ro thật.

## Bảo mật & nơi lưu dữ liệu

- Session MTProto: `session.sqlite3` ở thư mục app-data do HĐH quản lý (Windows: `%APPDATA%/com.tsmc.ingestdesktop/`, xem `identifier` trong `src-tauri/tauri.conf.json`) — ngoài repo hoàn toàn. **Mã hoá TOÀN BỘ file** (auth_key, DC options, peer cache, update state) qua `EncryptedSqliteSession` (`ingest-grammers/src/encrypted_session.rs`, [ADR-0021](../../docs/adr/0021-ma-hoa-session-sqlite-qua-session-tu-implement.md)) — key AES-256 sinh một lần bằng CSPRNG, lưu qua OS keyring (fallback file `session_key.json` nếu keyring không dùng được).
- Credential (API_ID/API_HASH/mã vùng/số điện thoại) và TMDB API key: ưu tiên lưu qua OS keyring (Windows Credential Manager), fallback file plaintext (`credentials.json`/`tmdb_api_key.json`) ở CÙNG thư mục app-data nếu keyring không dùng được — [ADR-0020](../../docs/adr/0020-ma-hoa-bi-mat-app-data-qua-os-keyring.md). Credential API_ID/API_HASH/số điện thoại vốn KHÔNG phải secret bí mật server (CLAUDE.md bất biến #1) — là thông tin người dùng tự cấp cho chính họ tại my.telegram.org — nhưng vẫn được ưu tiên mã hoá cùng cơ chế cho nhất quán.

## Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| `error: no such command: 'tauri'` | Chưa cài Tauri CLI — `cargo install tauri-cli --version "^2" --locked` |
| `cargo build` lỗi `mismatched types ... BigUint` trong `grammers-crypto` (`two_factor_auth.rs`) | Bug thật đã ghi ở [SPIKE-10](../../docs/spikes/README.md#spike-10): `grammers-crypto` pin `num-bigint ^0.4.6` nhưng bắc cầu qua `glass_pumpkin` (pin lỏng, tự trôi lên `2.0.0-rc1`) kéo theo `num-bigint 0.5.1` xung đột kiểu. Vá: `cargo update -p glass_pumpkin --precise 2.0.0-rc0` (đúng version đã ghim trong `tools/spike-10/Cargo.lock`) |
| `cargo tauri dev` báo thiếu WebView2 (Windows) | Cài WebView2 Runtime — thường có sẵn Windows 11, thiếu trên một số bản Windows 10/Server |
| `cargo build` lỗi `CMake Error: Could not create named generator Visual Studio NN 20XX` (build `libsql-ffi`) | Máy có nhiều bản Visual Studio, `cmake` crate tự chọn generator mà `cmake` binary đang cài chưa nhận ra — set `CMAKE_GENERATOR` trỏ đúng bản đã cài, vd `Visual Studio 17 2022` (xem mục "Yêu cầu trước khi dùng") |
| `cargo tauri dev` treo/lỗi ở bước load `devUrl` | `beforeDevCommand` (`pnpm --dir ../ui run start`) chưa chạy xong dev server Angular ở cổng 4300 trước khi Tauri thử nạp — kiểm `pnpm install` đã chạy ở root repo chưa, và cổng 4300 có bị process khác chiếm không |
| `invoke()` trong UI không trả gì / lỗi "command not found" | Kiểm `capabilities/default.json` còn permission `core:default`, và tên command trong `generate_handler!` (`src-tauri/src/lib.rs`) khớp đúng tên hàm `#[tauri::command]` |
| `gọi check_session() trước request_login_code()` (hoặc tương tự) | Đúng như thông báo — các command đăng nhập phải gọi ĐÚNG THỨ TỰ, xem bảng "12 command đã wire" ở trên |
| Bản release mở ra chỉ có plain HTML, không style Material | Đã build bằng `cargo build --release` trực tiếp (bỏ qua `beforeBuildCommand`, nhúng `ui/dist/browser` cũ) — build lại bằng `cargo tauri build --no-bundle`/`cargo tauri build`, xem mục "Chạy" ở trên |
| Mở app vẫn hiện form Bước 1 dù đã đăng nhập thành công ít nhất một lần trước đó | Kiểm `credentials.json` có tồn tại ở app-data không (đường dẫn ở mục "Bảo mật & nơi lưu dữ liệu"); nếu không có, `save_credentials()` chưa từng chạy thành công (vd lần đăng nhập trước dùng bản code cũ hơn 2026-09-11, trước khi tính năng này tồn tại) — gõ lại Bước 1 đầy đủ một lần để tạo file, từ lần sau tự nhận ra |
| `chưa resolve_channel() — gọi trước check_write_permission()/read_pinned_catalog()` dù đã resolve thành công | `AppState.selected_channel` bị bỏ trống lại — kiểm có đăng nhập lại (OTP/mật khẩu sai reset `ConnState::Disconnected`, xoá `GrammersIngestRpc` cùng peer cache) mà chưa `resolve_channel()` lại chưa |
| Muốn xem chi tiết đã verify thật những gì, còn thiếu gì | [docs/pending-device-tests.md](../../docs/pending-device-tests.md) — checklist verify trên tài khoản/kênh thật |
