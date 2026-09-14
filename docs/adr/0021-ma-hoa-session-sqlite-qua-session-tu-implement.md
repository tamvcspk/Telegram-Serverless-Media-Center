# ADR-0021: Mã hoá `session.sqlite3` qua `Session` tự implement (libSQL encryption-at-rest) — `tsmc-ingest-desktop`

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-14
- **Liên quan:** [ADR-0020](./0020-ma-hoa-bi-mat-app-data-qua-os-keyring.md) (đã mã hoá `credentials.json`/`tmdb_api_key.json`, cố ý để ngỏ `session.sqlite3`, giờ đóng gap đó — tái dùng nguyên `secret_store.rs`), [ADR-0017](./0017-grammers-cho-cong-cu-ingest-desktop.md) (kiến trúc `apps/tsmc-ingest-desktop`, điều kiện bắt buộc #1 ghim cứng `grammers-*` — ADR này áp dụng thêm cho `libsql`, lý do giống hệt)

## Bối cảnh

[ADR-0020](./0020-ma-hoa-bi-mat-app-data-qua-os-keyring.md) mã hoá `credentials.json`/`tmdb_api_key.json` nhưng cố ý để ngỏ `session.sqlite3` — file chứa `auth_key` (bí mật nhạy cảm NHẤT trong toàn app, tương đương toàn quyền tài khoản Telegram: đọc/gửi tin nhắn, xoá tài khoản) cộng DC options, peer/access_hash cache, update state. File này do `grammers_session::storages::SqliteSession::open(path)` tự quản I/O hoàn toàn — không có tham số, cờ, hay hook nào để truyền cấu hình mã hoá từ bên ngoài.

Sau đó brainstorm ba phương án với user (câu hỏi trực tiếp, không phải giả định):

- **A.** Custom `Session` implementation dùng tính năng encryption-at-rest có sẵn của `libsql` (fork `sqlite.rs` gốc).
- **B.** Windows EFS (Encrypting File System) trên cả thư mục app-data — transparent, zero code chạm `grammers-session`.
- **C.** Không làm gì thêm — dựa vào quyền thư mục app-data theo tài khoản Windows (baseline hiện có).

**User trả lời dứt khoát: "Không thể sử dụng phương án 2 và 3. Chỉ có thể sử dụng phương án 1."** — loại B và C, chỉ còn A khả thi. Kèm hai ràng buộc bắt buộc: **(a)** ghim chặt version dependency để tránh lỗi silent, **(b)** khi nâng cấp phải có quy trình kiểm tra lại và vá nếu cần — cả hai được ghi thành quy tắc thực thi cụ thể ở mục "Quyết định" bên dưới, không phải khẩu hiệu.

## Các phương án

### A. Custom `Session` implementation, dùng libSQL encryption-at-rest (**được chọn**)
- ✅ Mã hoá thật TOÀN BỘ file (`auth_key` + mọi bảng khác) — `grammers_session::Session` là trait CÔNG KHAI với doc comment gốc thẳng thắn: *"If none fit your needs, you can also implement [`crate::Session`] yourself"* — đây đúng là đường đó, không phải hack ngoài ý định thiết kế của thư viện.
- ✅ `grammers-session` 0.10.0 dùng `libsql` 0.9.30 nội bộ (`features = ["core"], default-features = false`) — `libsql` có feature `encryption` THẬT (`libsql-sys/encryption` → `libsql-ffi/multiple-ciphers`, bundle SQLite3 Multiple Ciphers/wxSQLite3 tự build bằng `cmake`, KHÔNG cần OpenSSL hệ thống). API: `libsql::Builder::new_local(path).encryption_config(EncryptionConfig::new(Cipher::Aes256Cbc, key: bytes::Bytes)).build()`.
- ❌ Effort lớn nhất trong app này — fork tay ~400 dòng (schema SQL + 8 method của trait), rủi ro drift nếu `grammers-session`/`libsql` đổi version mà không đối chiếu lại (xem "Quy trình bắt buộc khi nâng cấp" bên dưới).
- **User chọn — đây là phương án DUY NHẤT được phép dùng.**

### B. Windows EFS trên thư mục app-data
- ✅ Gần như zero code — Windows tự mã hoá minh bạch mọi file trong thư mục đã đánh dấu, không đụng `grammers-session`.
- ❌ Chỉ Windows Pro/Enterprise/Education (KHÔNG có ở Windows Home); mất khả năng đọc nếu đổi máy/khôi phục profile mất key.
- **User loại — "không thể sử dụng phương án 2".**

### C. Không làm gì thêm (dựa vào quyền thư mục app-data)
- ✅ Rẻ nhất, không rủi ro regression.
- ❌ Bí mật nhạy cảm nhất app nằm trần — bất kỳ tiến trình nào chạy dưới quyền user đó (kể cả malware) đọc thẳng được.
- **User loại — "không thể sử dụng phương án 3".**

## Quyết định

### 1. `EncryptedSqliteSession` — fork có kiểm soát, không phải viết mới

`ingest-grammers/src/encrypted_session.rs` (module mới) — struct `EncryptedSqliteSession` implement `grammers_session::Session`, **copy tay nguyên vẹn** schema SQL (5 bảng: `dc_home`/`dc_option`/`peer_info`/`update_state`/`channel_state`) và logic 8 method (`home_dc_id`/`set_home_dc_id`/`dc_option`/`set_dc_option`/`peer`/`cache_peer`/`updates_state`/`set_update_state`) từ `grammers-session-0.10.0/src/storages/sqlite.rs` (Apache-2.0 OR MIT — cùng giấy phép của chính `grammers-session`, permissive, cho phép copy-adapt). **Chỉ khác đúng một chỗ:** `SqliteSession::open()` gọi `.build()` trần, còn `EncryptedSqliteSession::open()` gọi `.encryption_config(EncryptionConfig::new(Cipher::Aes256Cbc, key)).build()` trước đó.

`DEFAULT_DC`/`KNOWN_DC_OPTIONS` (5 địa chỉ IP datacenter Telegram — dữ liệu công khai từ `functions::help::GetConfig`, KHÔNG phải bí mật) phải **copy tay riêng** vì `pub(crate)` ở crate gốc (`grammers_session::dc_options`), không import được từ ngoài crate.

### 2. Key mã hoá — sinh một lần, lưu qua hạ tầng `secret_store` đã có

AES-256 (32 byte), sinh **một lần** bằng CSPRNG (`rand::rngs::OsRng`), lưu qua hàm mới `secret_store::load_or_generate_key()` (`src-tauri/src/secret_store.rs`) — **tái dùng nguyên vẹn** `save_json()`/`load_json()` đã có từ [ADR-0020](./0020-ma-hoa-bi-mat-app-data-qua-os-keyring.md) (keyring ưu tiên, fallback file `session_key.json` nếu keyring không dùng được — cùng cơ chế, không phát minh lại). Account `"session_encryption_key"`, cùng service `com.tsmc.ingestdesktop`.

`commands.rs::check_session()` gọi `load_or_generate_key()` **trước** `connect()`, truyền key vào làm tham số — tách bạch rõ ràng: `ingest-grammers` (thuần MTProto, không biết gì về Tauri/keyring) chỉ **nhận** key, không tự quản lý nó. Đúng ranh giới đã có giữa hai crate này từ đầu (ADR-0017).

### 3. Đổi chữ ký `connect()` và các type liên quan

`ingest-grammers::connect()` thêm tham số `encryption_key: bytes::Bytes`. `Connected.session`, `GrammersIngestRpc.session`, và ba biến thể `ConnState::{Connected, AwaitingOtp, AwaitingPassword}` (`src-tauri/src/state.rs`) đổi type `Arc<SqliteSession>` → `Arc<EncryptedSqliteSession>`. Bỏ hẳn dependency `grammers-session` trực tiếp khỏi `src-tauri/Cargo.toml` — không còn gì import từ đó nữa, chỉ dùng qua `ingest-grammers`.

### 4. Ghim cứng version — điều kiện bắt buộc theo yêu cầu user

`libsql = "=0.9.30"` (không `^`) trong `[workspace.dependencies]` (`apps/tsmc-ingest-desktop/Cargo.toml`) — **đúng version mà `grammers-session` 0.10.0 dùng nội bộ**, feature `["core", "encryption"]`. Cùng lý do CLAUDE.md bất biến #9/điều kiện bắt buộc #1 của [ADR-0017](./0017-grammers-cho-cong-cu-ingest-desktop.md#quyết-định) áp dụng cho toàn bộ `grammers-*`: khác version tiềm ẩn khác schema/API mà module fork **không có cách nào tự dò** — không có compiler warning, không có runtime error rõ ràng, chỉ vỡ lặng lẽ (đọc sai cột, hoặc tệ hơn, đọc "được" nhưng sai dữ liệu).

`rand = "=0.8.8"` (`src-tauri/Cargo.toml`, sinh key CSPRNG) cũng ghim cứng — dù đã có sẵn transitively qua `keyring`/`libsql` ở đúng version này, ghim tường minh để `cargo update` không âm thầm đổi phiên bản RNG dùng cho mục đích bảo mật.

### 5. Quy trình bắt buộc khi nâng cấp `grammers-session` hoặc `libsql`

Theo đúng yêu cầu user ("khi nào update phải kiểm tra lại và fix nếu cần") — **bắt buộc**, không phải khuyến nghị:

1. **Trước khi** đổi version (`cargo update -p grammers-session`, hoặc sửa tay `libsql = "=X.Y.Z"`), tải lại source `grammers-session-<version-mới>/src/storages/sqlite.rs` + `src/dc_options.rs` (registry cache `~/.cargo/registry/src/`, hoặc GitHub `Lonami/grammers`).
2. **Đối chiếu tay** với `encrypted_session.rs` hiện tại — đặc biệt: schema SQL (`CREATE TABLE`, tên cột, kiểu), thứ tự cột trong mọi `SELECT *`/`INSERT`, giá trị `VERSION`/logic migration, và `DEFAULT_DC`/`KNOWN_DC_OPTIONS`.
3. **Áp mọi thay đổi khớp NGUYÊN VẸN** với bản mới — không tự "cải tiến" hay viết lại logic theo ý riêng, kể cả khi trông có vẻ tối ưu hơn.
4. **Chạy lại** `cargo test exercise_encrypted_sqlite_session` **VÀ** verify thật qua tài khoản Telegram thật (`cargo tauri dev`, không chỉ unit test cục bộ) **trước khi merge**.

Bỏ qua quy trình này khi nâng `grammers-session`/`libsql` là vi phạm trực tiếp yêu cầu của ADR này.

### 6. Bug thật phát hiện lúc verify: TOCTOU race ở `load_or_generate_key()` — vá bằng cache `OnceLock`

`secret_store::load_or_generate_key()` (đọc-hoặc-sinh key) có race lý thuyết: hai lần gọi ĐỒNG THỜI đều thấy "chưa có key" (đọc trước khi cái nào kịp ghi) → cả hai tự sinh key NGẪU NHIÊN KHÁC NHAU → bản ghi sau cùng thắng, giá trị trả về cho lần gọi thua cuộc không khớp giá trị đã persist. **Tái hiện được thật** (không phải lý thuyết suông) lúc chạy `cargo test --workspace -- --include-ignored` — nhiều test binary động vào cùng entry Credential Manager gần như đồng thời, `load_or_generate_key_is_stable_across_calls` FAIL với hai mảng byte khác nhau hẳn.

Vá bằng `AppState::session_encryption_key: std::sync::OnceLock<Vec<u8>>` (`state.rs`) — `check_session()` gọi `get_or_init()` thay vì gọi thẳng `load_or_generate_key()`, đảm bảo CHỈ MỘT lần đọc/sinh key cho suốt vòng đời một tiến trình app, bất kể `check_session()` bị gọi lại bao nhiêu lần. **Không giải quyết** trường hợp HAI TIẾN TRÌNH app khác nhau chạy đồng thời cùng trỏ vào cùng `session.sqlite3` — đó là hazard đã có sẵn từ trước (dùng chung một file SQLite cục bộ), không phải rủi ro MỚI do ADR này tạo ra, và nằm ngoài phạm vi vá ở đây.

### 7. Phát hiện môi trường build mới — `cmake` bắt buộc

Bật feature `encryption` của `libsql` lần đầu đòi `cmake` build `libsql-ffi` (trước đó KHÔNG cần — bản chỉ có `core` dùng thẳng `cc::Build`, không qua `cmake`). Máy dev viết ADR này cài **cả** Visual Studio "18" (bản preview/2026) **lẫn** Visual Studio 2022 — Rust `cmake` crate tự chọn generator `"Visual Studio 18 2026"` mà `cmake` binary (bản 4.1.1) chưa nhận diện tên đó, lỗi `CMake Error: Could not create named generator`. Vá bằng set biến môi trường `CMAKE_GENERATOR="Visual Studio 17 2022"` trước khi `cargo build`/`cargo clippy`/`cargo test`. Đã cập nhật `apps/tsmc-ingest-desktop/README.md` (mục "Yêu cầu trước khi dùng" + bảng "Xử lý sự cố thường gặp") và [docs/lessons.md](../lessons.md).

## Hệ quả

**Tích cực**
- Bí mật nhạy cảm nhất app (`auth_key`) không còn nằm trần trên đĩa nếu keyring khả dụng — đóng đúng gap [ADR-0020](./0020-ma-hoa-bi-mat-app-data-qua-os-keyring.md) đã cố ý để ngỏ.
- Tái dùng 100% hạ tầng `secret_store` đã có (không phát minh cơ chế lưu key thứ hai) — nhất quán với `credentials.json`/`tmdb_api_key.json`.
- Ranh giới `ingest-grammers`/`src-tauri` giữ nguyên (MTProto thuần túy vs quản lý bí mật app) — không làm rối kiến trúc đã có.

**Tiêu cực / phải chấp nhận**
- **Effort/rủi ro lớn nhất trong toàn app này** — một fork tay ~400 dòng logic SQL của một thư viện bên thứ ba, phải tự bảo trì song song, không có compiler nào cảnh báo nếu lệch khỏi schema/API thật của bản `grammers-session`/`libsql` đang dùng.
- Rủi ro drift nếu quy trình nâng cấp ở mục 5 KHÔNG được tuân thủ nghiêm — đây là lý do chính khiến phương án A "đắt" hơn nhiều so với B/C, user đã chấp nhận đánh đổi này một cách tường minh.
- Thêm dependency build MỚI (`cmake` binary phải có trên `PATH`) — chỉ cần khi build feature `encryption`, trước đây không cần cho toàn bộ pipeline build của app này.
- **Chưa verify bằng tài khoản Telegram thật** — chỉ verify được cơ chế mã hoá cục bộ (roundtrip đúng/sai key, file không lộ header SQLite plaintext), chưa verify luồng đăng nhập đầy đủ qua `cargo tauri dev` (CLAUDE.md: agent không được chạy đăng nhập MTProto hộ).

## Verify

**Đã verify (2026-09-14, KHÔNG đụng MTProto/tài khoản Telegram — an toàn để tự chạy):**
- `cargo test exercise_encrypted_sqlite_session` (`ingest-grammers`, port nguyên bộ test `exercise_sqlite_session` gốc + 2 assert mới) — PASS. Xác nhận: (a) file thật **KHÔNG lộ** header `"SQLite format 3\0"` — bằng chứng mã hoá thật, không phải "có tham số nhưng không tác dụng"; (b) mở lại bằng **SAI** key → lỗi (`is_err()`); (c) mở lại bằng **ĐÚNG** key → đọc lại đúng dữ liệu đã ghi.
- `cargo test load_or_generate_key_is_stable_across_calls` (`secret_store.rs`) — PASS. Sinh một lần, gọi lại đọc đúng key cũ, không lộ ra file fallback khi keyring hoạt động.
- `cargo build --workspace`/`cargo clippy --workspace` (0 warning, cần `CMAKE_GENERATOR` như mục 7) sạch.
- `cargo test --workspace -- --include-ignored` chạy lặp lại 3 lần liên tiếp, sạch cả 3 — xác nhận TOCTOU race ở mục 6 đã vá (trước khi vá, tái hiện được lỗi ngay ở lần chạy đầu).

**Verify 2026-09-14, ĐẠT (tổng quát)** — user xác nhận chạy `cargo tauri dev` + tài khoản thật, đăng nhập/mở lại app hoạt động đúng với `session.sqlite3` mã hoá; chưa có xác nhận riêng từng bước con (mở file bằng công cụ SQLite thường phải lỗi, nhánh di trú từ file plaintext cũ, key ổn định qua nhiều phiên). Checklist ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--mã-hoá-sessionsqlite3-2026-09-14).
