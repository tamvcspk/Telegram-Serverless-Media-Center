# `tsmc-ingest-desktop` — GUI ingest desktop (Tauri + grammers-client)

Ứng dụng desktop (Tauri v2) cho người **đăng** nội dung — không phải bản desktop của app xem. Thiết kế đầy đủ (workspace ba vùng, hàng đợi bền, sửa metadata theo lô...) ở [docs/ux-design.md § Phụ lục A](../../docs/ux-design.md#phụ-lục-a-công-cụ-ingest-desktop-gui-tauri). Quyết định kiến trúc: [ADR-0013](../../docs/adr/0013-bot-dong-hanh-va-pipeline-ingest.md) (ba thành phần CLI/bot/GUI + bảng phân hạng A/B/C/D), [ADR-0017](../../docs/adr/0017-grammers-cho-cong-cu-ingest-desktop.md) (chọn `grammers-client` làm MTProto library, tách biệt hoàn toàn khỏi GramJS của `apps/web`).

> **Trạng thái hiện tại: khung sườn, KHÔNG phải UI thật.** `ui/index.html` chỉ là một trang thuần HTML/JS chứng minh đường Tauri IPC → Rust → `grammers-client` chạy đúng cho 5 command (đăng nhập + resolve kênh) — không phải mockup A.3 ở ux-design.md. 4/7 thao tác `IngestRpc` (upload video/subtitle, publish catalog, đọc catalog đang ghim, tải document, kiểm tra quyền ghi) đã có implementation đầy đủ ở `ingest-grammers` nhưng CHƯA wire thành Tauri command — để dành cho slice UI thật.

> **KHÔNG chạy app này hộ ai bằng agent/AI, đặc biệt bước đăng nhập.** Đăng nhập ở đây là MTProto thật — session tương đương toàn quyền tài khoản Telegram (đọc/gửi tin nhắn, xoá tài khoản). Luôn tự chạy trong terminal/máy của chính bạn (CLAUDE.md).

## Cấu trúc

```
apps/tsmc-ingest-desktop/
  Cargo.toml            # workspace root — 3 crate thành viên
  ingest-rpc-trait/     # trait IngestRpc + kiểu dữ liệu dùng chung, KHÔNG chứa luật nghiệp vụ
  ingest-grammers/       # implementation IngestRpc bằng grammers-client 0.10.0
  src-tauri/             # Tauri backend: state machine đăng nhập + 5 command
  ui/                     # placeholder HTML/JS — chưa phải UI thật
```

`libs/core-ingest` (TypeScript, ADR-0013 đã verify thật) vẫn là nguồn sự thật duy nhất cho bảng phân hạng A/B/C/D, kế thừa metadata, gộp catalog — Rust ở đây KHÔNG port lại luật đó, chỉ thực thi RPC (điều kiện bắt buộc #4, ADR-0017).

## Yêu cầu trước khi dùng

- Rust + Cargo (bản đã dùng để dựng: `cargo 1.90.0`).
- Tauri CLI: `cargo install tauri-cli --version "^2" --locked` (một lần, có thể mất vài phút build).
- Windows: WebView2 Runtime (thường có sẵn trên Windows 11; nếu thiếu, Tauri sẽ báo lỗi rõ lúc `cargo tauri dev`).
- `TSMC_API_ID`/`TSMC_API_HASH` — tự tạo tại https://my.telegram.org, nhập trực tiếp vào form trong app (chưa có `.env`/config file ở khung sườn này — nhập tay mỗi lần chạy `cargo tauri dev`).

## Chạy

Từ thư mục này (`apps/tsmc-ingest-desktop/`):

```bash
cargo build --workspace     # build cả 3 crate, không cần MTProto — catch lỗi wiring/kiểu dữ liệu
cargo tauri dev              # mở cửa sổ app thật, nạp ui/index.html
```

Trong cửa sổ app: nhập API ID → **check_session** → nếu `false`, nhập API Hash + số điện thoại → **request_login_code** → nhập mã OTP vừa nhận → **submit_otp** (nếu tài khoản có 2FA, nhập thêm mật khẩu → **submit_password**) → nhập username kênh → **resolve_channel**.

## Năm command đã wire (`src-tauri/src/commands.rs`)

| Command | Việc gì | Yêu cầu state trước đó |
|---|---|---|
| `check_session(apiId)` | Mở/khôi phục session SQLite (thư mục app-data của HĐH, không phải cwd), kiểm tra đã đăng nhập chưa | — |
| `request_login_code(apiHash, phone)` | Gửi mã OTP | `check_session` đã chạy và trả `false` |
| `submit_otp(code)` | Xác nhận OTP — trả `LoggedIn` hoặc `PasswordRequired` | `request_login_code` đã chạy |
| `submit_password(password)` | Xác nhận mật khẩu 2FA | `submit_otp` trả `PasswordRequired` |
| `resolve_channel(channelRef)` | Resolve username kênh → id/access_hash/title/is_own | đã đăng nhập xong (`Ready`) |

**Đơn giản hoá có chủ đích:** nếu `submit_otp`/`submit_password` thất bại (sai mã/sai mật khẩu), state reset về `Disconnected` — phải bấm lại từ `request_login_code`, không có retry tại chỗ (`PasswordToken` của grammers-client không `Clone`). Chấp nhận được cho khung sườn chứng minh IPC; UI thật nên cải thiện sau.

## Ghim phiên bản (ADR-0017 điều kiện bắt buộc #1)

Toàn bộ 5 crate `grammers-*` ghim cứng `=0.10.0` (không `^`) trong `[workspace.dependencies]` ở `Cargo.toml` gốc — cùng lý do CLAUDE.md bất biến #9 ghim `telegram@2.26.22`: thư viện community-maintained, đổi version ngoài ý muốn là rủi ro thật.

## Bảo mật & nơi lưu dữ liệu

- Session MTProto: SQLite ở thư mục app-data do HĐH quản lý (Windows: `%APPDATA%/com.tsmc.ingestdesktop/`, xem `identifier` trong `src-tauri/tauri.conf.json`) — ngoài repo hoàn toàn.
- Chưa có `.env`/config file ở khung sườn này — API ID/Hash nhập tay qua form mỗi lần chạy dev. UI thật nên cân nhắc lưu (không phải secret bí mật server — CLAUDE.md bất biến #1, đây là credential người dùng tự cấp cho chính họ).

## Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| `error: no such command: 'tauri'` | Chưa cài Tauri CLI — `cargo install tauri-cli --version "^2" --locked` |
| `cargo build` lỗi `mismatched types ... BigUint` trong `grammers-crypto` (`two_factor_auth.rs`) | Bug thật đã ghi ở [SPIKE-10](../../docs/spikes/README.md#spike-10): `grammers-crypto` pin `num-bigint ^0.4.6` nhưng bắc cầu qua `glass_pumpkin` (pin lỏng, tự trôi lên `2.0.0-rc1`) kéo theo `num-bigint 0.5.1` xung đột kiểu. Vá: `cargo update -p glass_pumpkin --precise 2.0.0-rc0` (đúng version đã ghim trong `tools/spike-10/Cargo.lock`) |
| `cargo tauri dev` báo thiếu WebView2 (Windows) | Cài WebView2 Runtime — thường có sẵn Windows 11, thiếu trên một số bản Windows 10/Server |
| `invoke()` trong `ui/index.html` không trả gì / lỗi "command not found" | Kiểm `capabilities/default.json` còn permission `core:default`, và tên command trong `generate_handler!` (`src-tauri/src/lib.rs`) khớp đúng tên hàm `#[tauri::command]` |
| `gọi check_session() trước request_login_code()` (hoặc tương tự) | Đúng như thông báo — các command đăng nhập phải gọi ĐÚNG THỨ TỰ, xem bảng "Năm command đã wire" ở trên |
| Muốn xem chi tiết đã verify thật những gì, còn thiếu gì | [docs/pending-device-tests.md](../../docs/pending-device-tests.md) — checklist verify trên tài khoản/kênh thật |
