# `tsmc-ingest-desktop` — GUI ingest desktop (Tauri + grammers-client)

Ứng dụng desktop (Tauri v2) cho người **đăng** nội dung — không phải bản desktop của app xem. Thiết kế đầy đủ (workspace ba vùng, hàng đợi bền, sửa metadata theo lô...) ở [docs/ux-design.md § Phụ lục A](../../docs/ux-design.md#phụ-lục-a-công-cụ-ingest-desktop-gui-tauri). Quyết định kiến trúc: [ADR-0013](../../docs/adr/0013-bot-dong-hanh-va-pipeline-ingest.md) (ba thành phần CLI/bot/GUI + bảng phân hạng A/B/C/D), [ADR-0017](../../docs/adr/0017-grammers-cho-cong-cu-ingest-desktop.md) (chọn `grammers-client` làm MTProto library, tách biệt hoàn toàn khỏi GramJS của `apps/web`).

> **Trạng thái hiện tại: màn Đăng nhập là UI thật (Angular + Material), phần còn lại vẫn khung sườn.** `ui/` giờ là một app Angular 22 standalone/zoneless riêng (`@tsmc/tsmc-ingest-desktop-ui`, KHÔNG chung workspace build với `apps/web` dù cùng pnpm workspace) — màn Đăng nhập khớp `docs/ux-design.md § Phụ lục A.4` (cảnh báo ADR-0011 §5, `MatStepper` 3 bước: API Credential → Mã xác nhận → Mật khẩu 2FA). Workspace ba vùng (mockup A.3: hàng đợi, bảng metadata, tiến trình upload) và các màn A.4 còn lại (Chọn kênh, Trình quản lý catalog, Nhật ký) **chưa có UI** — chỉ `resolve_channel` đã wire ở Rust, chưa có màn nào gọi nó. 4/7 thao tác `IngestRpc` (upload video/subtitle, publish catalog, đọc catalog đang ghim, tải document, kiểm tra quyền ghi) đã có implementation đầy đủ ở `ingest-grammers` nhưng CHƯA wire thành Tauri command.

> **KHÔNG chạy app này hộ ai bằng agent/AI, đặc biệt bước đăng nhập.** Đăng nhập ở đây là MTProto thật — session tương đương toàn quyền tài khoản Telegram (đọc/gửi tin nhắn, xoá tài khoản). Luôn tự chạy trong terminal/máy của chính bạn (CLAUDE.md).

## Cấu trúc

```
apps/tsmc-ingest-desktop/
  Cargo.toml            # workspace root — 3 crate thành viên
  ingest-rpc-trait/     # trait IngestRpc + kiểu dữ liệu dùng chung, KHÔNG chứa luật nghiệp vụ
  ingest-grammers/       # implementation IngestRpc bằng grammers-client 0.10.0
  src-tauri/             # Tauri backend: state machine đăng nhập + 5 command
  ui/                     # app Angular 22 riêng (package.json/angular.json của chính nó)
    src/app/core/         # ingest-rpc.ts — cổng DUY NHẤT gọi invoke() Tauri, khớp dto.rs
    src/app/login/         # màn Đăng nhập (A.4) — UI thật
```

`libs/core-ingest` (TypeScript, ADR-0013 đã verify thật) vẫn là nguồn sự thật duy nhất cho bảng phân hạng A/B/C/D, kế thừa metadata, gộp catalog — Rust ở đây KHÔNG port lại luật đó, chỉ thực thi RPC (điều kiện bắt buộc #4, ADR-0017).

## Yêu cầu trước khi dùng

- Rust + Cargo (bản đã dùng để dựng: `cargo 1.90.0`).
- Tauri CLI: `cargo install tauri-cli --version "^2" --locked` (một lần, có thể mất vài phút build).
- Windows: WebView2 Runtime (thường có sẵn trên Windows 11; nếu thiếu, Tauri sẽ báo lỗi rõ lúc `cargo tauri dev`).
- `pnpm install` đã chạy ở **root** repo ít nhất một lần (`ui/` là một package trong pnpm workspace chung, xem `pnpm-workspace.yaml`) — `cargo tauri dev`/`cargo tauri build` tự gọi `pnpm --dir ../ui run start`/`build` qua `beforeDevCommand`/`beforeBuildCommand` ở `tauri.conf.json`, nhưng KHÔNG tự chạy `pnpm install` hộ.
- `TSMC_API_ID`/`TSMC_API_HASH` — tự tạo tại https://my.telegram.org, nhập trực tiếp vào form trong app (chưa có `.env`/config file ở khung sườn này — nhập tay mỗi lần chạy `cargo tauri dev`).

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

Mở app lần đầu: nhập API ID + API Hash + số điện thoại (Bước 1) → app tự gọi **check_session**, nếu `false` thì gọi tiếp **request_login_code** → nhập mã OTP vừa nhận (Bước 2) → **submit_otp** (nếu tài khoản có 2FA, nhập thêm mật khẩu ở Bước 3 → **submit_password**). Sai OTP/mật khẩu: UI tự gọi lại `check_session()` bằng API_ID đã nhập rồi đưa bạn về lại Bước 1 với ô API_HASH/số điện thoại còn giữ nguyên giá trị — bấm "Tiếp tục" lại là đủ, không cần gõ lại từ đầu (xem "Đơn giản hoá có chủ đích" trong `commands.rs`). Mở app lần sau: UI tự nhớ API_ID ở `localStorage` (không nhớ API_HASH/số điện thoại) và tự gọi lại `check_session()` — nếu session cũ còn hợp lệ, nhảy thẳng "Đã đăng nhập", không hỏi lại OTP. Màn Chọn kênh (**resolve_channel**) và các màn sau chưa có UI.

## Năm command đã wire (`src-tauri/src/commands.rs`)

| Command | Việc gì | Yêu cầu state trước đó |
|---|---|---|
| `check_session(apiId)` | Mở/khôi phục session SQLite (thư mục app-data của HĐH, không phải cwd), kiểm tra đã đăng nhập chưa | — |
| `request_login_code(apiHash, phone)` | Gửi mã OTP | `check_session` đã chạy và trả `false` |
| `submit_otp(code)` | Xác nhận OTP — trả `LoggedIn` hoặc `PasswordRequired` | `request_login_code` đã chạy |
| `submit_password(password)` | Xác nhận mật khẩu 2FA | `submit_otp` trả `PasswordRequired` |
| `resolve_channel(channelRef)` | Resolve username kênh → id/access_hash/title/is_own | đã đăng nhập xong (`Ready`) |

**Đơn giản hoá có chủ đích:** nếu `submit_otp`/`submit_password` thất bại (sai mã/sai mật khẩu), state reset về `Disconnected` — không có retry tại chỗ (`PasswordToken` của grammers-client không `Clone`). UI (`ui/src/app/login/login.ts`, `resetAfterAuthFailure()`) che gap này bằng cách tự gọi lại `check_session()` với `api_id` đã biết ngay sau lỗi, rồi đưa user về Bước 1 (giá trị API_HASH/số điện thoại vẫn còn trong ô) thay vì bắt gõ lại toàn bộ.

## Ghim phiên bản (ADR-0017 điều kiện bắt buộc #1)

Toàn bộ 5 crate `grammers-*` ghim cứng `=0.10.0` (không `^`) trong `[workspace.dependencies]` ở `Cargo.toml` gốc — cùng lý do CLAUDE.md bất biến #9 ghim `telegram@2.26.22`: thư viện community-maintained, đổi version ngoài ý muốn là rủi ro thật.

## Bảo mật & nơi lưu dữ liệu

- Session MTProto: SQLite ở thư mục app-data do HĐH quản lý (Windows: `%APPDATA%/com.tsmc.ingestdesktop/`, xem `identifier` trong `src-tauri/tauri.conf.json`) — ngoài repo hoàn toàn.
- Chưa có `.env`/config file — API ID/Hash nhập tay qua form mỗi lần chạy dev. Cân nhắc lưu ở slice sau (không phải secret bí mật server — CLAUDE.md bất biến #1, đây là credential người dùng tự cấp cho chính họ).

## Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| `error: no such command: 'tauri'` | Chưa cài Tauri CLI — `cargo install tauri-cli --version "^2" --locked` |
| `cargo build` lỗi `mismatched types ... BigUint` trong `grammers-crypto` (`two_factor_auth.rs`) | Bug thật đã ghi ở [SPIKE-10](../../docs/spikes/README.md#spike-10): `grammers-crypto` pin `num-bigint ^0.4.6` nhưng bắc cầu qua `glass_pumpkin` (pin lỏng, tự trôi lên `2.0.0-rc1`) kéo theo `num-bigint 0.5.1` xung đột kiểu. Vá: `cargo update -p glass_pumpkin --precise 2.0.0-rc0` (đúng version đã ghim trong `tools/spike-10/Cargo.lock`) |
| `cargo tauri dev` báo thiếu WebView2 (Windows) | Cài WebView2 Runtime — thường có sẵn Windows 11, thiếu trên một số bản Windows 10/Server |
| `cargo tauri dev` treo/lỗi ở bước load `devUrl` | `beforeDevCommand` (`pnpm --dir ../ui run start`) chưa chạy xong dev server Angular ở cổng 4300 trước khi Tauri thử nạp — kiểm `pnpm install` đã chạy ở root repo chưa, và cổng 4300 có bị process khác chiếm không |
| `invoke()` trong UI không trả gì / lỗi "command not found" | Kiểm `capabilities/default.json` còn permission `core:default`, và tên command trong `generate_handler!` (`src-tauri/src/lib.rs`) khớp đúng tên hàm `#[tauri::command]` |
| `gọi check_session() trước request_login_code()` (hoặc tương tự) | Đúng như thông báo — các command đăng nhập phải gọi ĐÚNG THỨ TỰ, xem bảng "Năm command đã wire" ở trên |
| Muốn xem chi tiết đã verify thật những gì, còn thiếu gì | [docs/pending-device-tests.md](../../docs/pending-device-tests.md) — checklist verify trên tài khoản/kênh thật |
