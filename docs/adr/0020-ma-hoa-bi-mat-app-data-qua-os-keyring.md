# ADR-0020: Mã hoá bí mật lưu ở app-data qua OS keyring, fallback plaintext — `tsmc-ingest-desktop`

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-14
- **Liên quan:** [ADR-0017](./0017-grammers-cho-cong-cu-ingest-desktop.md) (kiến trúc `apps/tsmc-ingest-desktop`, chọn `grammers-client`), [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md) (mô hình bảo mật session của `apps/web` — khác app, khác kỹ thuật, nhưng cùng mối quan tâm), [ADR-0019](./0019-tich-hop-tra-cuu-tmdb-o-buoc-draft.md) (nơi `tmdb_api_key.json` được tạo ra lần đầu, cùng lưu plaintext lúc đó), [ADR-0021](./0021-ma-hoa-session-sqlite-qua-session-tu-implement.md) (đóng gap `session.sqlite3` mà ADR này cố ý để ngỏ, tái dùng `secret_store.rs`)

## Bối cảnh

`apps/tsmc-ingest-desktop` lưu hai file JSON plaintext ở thư mục app-data do hệ điều hành quản lý:

- `credentials.json` (`commands.rs`) — API_ID/API_HASH tự cấp tại my.telegram.org + số điện thoại, ghi từ lúc dựng khung sườn app (2026-09-11).
- `tmdb_api_key.json` (`tmdb.rs`) — TMDB API key, ghi từ [ADR-0019](./0019-tich-hop-tra-cuu-tmdb-o-buoc-draft.md) (2026-09-13).

Cả hai được chấp nhận **tạm thời** ở dạng plaintext với lý do "không phải secret server" (CLAUDE.md bất biến #1 — hai file này không phải bí mật hạ tầng, chỉ là thông tin tự admin cung cấp cho chính họ). Nhưng đây luôn là một khoảng nợ kỹ thuật đã ghi rõ từ [SPIKE-10](../spikes/README.md#spike-10) § Tech stack (mở 2026-09-05): *"Lưu session ... R3/R4: file mã hoá hoặc keychain OS qua Tauri"* — lúc code khung sườn đã đơn giản hoá thành plaintext, và gap này được [docs/roadmap.md](../roadmap.md) theo dõi riêng kể từ đó.

`session.sqlite3` (session MTProto thật, do `grammers-session` tự đọc/ghi trực tiếp qua đường dẫn file, không phải JSON app tự serialize) **NGOÀI phạm vi ADR này** — app không kiểm soát I/O layer của nó, mã hoá file đó đòi một hướng khác hẳn (vd SQLCipher, hoặc thay hẳn cơ chế lưu session của `grammers-session`), chưa xét ở đây.

## Các phương án

### A. Windows DPAPI (`CryptProtectData`/`CryptUnprotectData`)
- ✅ Không thêm dependency mới — crate `windows` (Microsoft chính thức) đã có sẵn TRANSITIVELY qua `tauri`/`webview2-com-sys` (xác nhận version 0.61.3 trong `Cargo.lock` trước khi thêm bất kỳ gì).
- ✅ Gắn với tài khoản Windows đang đăng nhập, không cần user nhập mật khẩu riêng — giữ đúng UX auto-login hiện có.
- ❌ **Chỉ chạy trên Windows.** App hiện tại đã là Windows-only trong thực tế (README/mọi bước verify device test đều giả định `cargo tauri dev` trên Windows, DLL FFmpeg đóng gói là DLL Windows) — nhưng `tauri.conf.json::bundle.targets` đang để `"all"`, để ngỏ khả năng build cho macOS/Linux sau này mà chưa có kế hoạch cụ thể. Chọn DPAPI nghĩa là nếu port sau này phải viết lại toàn bộ cơ chế này theo từng OS.
- **Loại** — vì hướng B cho cùng lợi ích (passwordless, gắn OS) với chi phí thêm không lớn mà lại sẵn sàng đa nền tảng ngay.

### B. Crate `keyring` (Windows Credential Manager / macOS Keychain / Linux Secret Service qua API chung) (**được chọn**)
- ✅ Cross-platform sẵn từ đầu qua MỘT API (`keyring::Entry`), vẫn passwordless (bí mật gắn với tài khoản OS, không phải mật khẩu app tự quản).
- ✅ Crate trưởng thành, nhiều người bảo trì (khác rủi ro đã trả giá ở [ADR-0003](./0003-chon-thu-vien-mtproto-gramjs.md) với `telegram` package bị archive) — `keyring` 3.6.3 tại thời điểm viết ADR này.
- ⚠️ Thêm dependency ngoài mới (khác phương án A) — chấp nhận được, cùng mức độ với `reqwest` đã thêm ở ADR-0019.
- ⚠️ Backend Linux (Secret Service qua D-Bus/`kwallet`) cần một daemon đang chạy — có thể không khả dụng trên một số máy/môi trường (headless, minimal desktop). **Giải quyết bằng fallback plaintext bên dưới**, không chặn app.
- **Được chọn**, kèm yêu cầu bắt buộc: **fallback về file plaintext nếu keyring không dùng được** — app tuyệt đối không được "không lưu được gì" chỉ vì thiếu backend OS.

### C. Passphrase tự quản + AES-GCM
- ✅ Hoàn toàn cross-platform, không phụ thuộc OS keyring nào cả.
- ❌ Bắt buộc thêm một bước UX (nhập mật khẩu mỗi lần) — trái nguyên tắc auto-login hiện tại của app (đăng nhập lại không cần gõ gì nếu còn session, xem `docs/pending-device-tests.md § nhớ credential ở app-data`).
- ❌ Rủi ro mất vĩnh viễn nếu quên mật khẩu — không có backend nào khôi phục hộ (khác OS keyring, nơi tài khoản Windows/macOS/Linux của user là "chìa khoá" đã có sẵn, không thêm gì mới để nhớ).
- **Loại.**

## Quyết định

Thêm crate `keyring = "3.6.3"` (`Cargo.lock` tự chọn 3.6.3 thay vì 4.x mới nhất — bản 4.x đòi `rustc ≥ 1.88.0`, cao hơn `rust-version = "1.77.2"` đã ghim ở workspace), bật DUY NHẤT feature `windows-native` (`--no-default-features --features windows-native`) — khớp thực tế app hiện chỉ build/verify trên Windows; bật thêm `apple-native`/backend Linux khi thật sự có kế hoạch porting, không bật "phòng hờ" trước.

### Module `secret_store.rs` — cổng DUY NHẤT gọi crate `keyring`

`apps/tsmc-ingest-desktop/src-tauri/src/secret_store.rs`, ba hàm public:

```rust
pub fn save_json<T: Serialize>(key: &str, path: &Path, value: &T);
pub fn load_json<T: DeserializeOwned>(key: &str, path: &Path) -> Option<T>;
pub fn delete(key: &str, path: &Path);
```

- **`save_json()`**: thử ghi OS keyring TRƯỚC (service `com.tsmc.ingestdesktop` — trùng `identifier` ở `tauri.conf.json`, "account" = `key` phân biệt `"credentials"`/`"tmdb_api_key"` trong cùng service). **Thành công** → xoá luôn file plaintext cũ ở `path` nếu còn sót (không để hai bản sao của cùng một bí mật tồn tại song song). **Thất bại** (backend không khả dụng, lỗi quyền...) → ghi file `path` y hệt hành vi cũ trước ADR này — best-effort, không throw ra UI (giữ nguyên triết lý `save_credentials()`/`tmdb_save_key()` gốc: lỗi lưu chỉ mất tiện nghi lần sau, không được chặn luồng đăng nhập/tra cứu đang chạy).
- **`load_json()`**: thử đọc keyring TRƯỚC, rơi về đọc file `path` nếu không thấy/lỗi. **Đây là toàn bộ cơ chế "di trú"** — không cần code migration chạy một lần riêng: máy đã có sẵn `credentials.json`/`tmdb_api_key.json` từ bản cũ (trước ADR này) vẫn đọc được ngay (qua nhánh fallback file), và lần GHI kế tiếp tự chuyển bí mật đó sang keyring + xoá file cũ.
- **`delete()`**: xoá CẢ hai nơi có thể chứa bí mật (keyring lẫn file) — dùng cho nút "Xoá key" (màn Cài đặt).

`commands.rs` (`load_saved_credentials`/`save_credentials`) và `tmdb.rs` (`tmdb_has_key`/`tmdb_save_key`/`tmdb_delete_key`, hàm nội bộ `load_key()`) đổi sang gọi qua ba hàm trên thay vì tự `std::fs::read`/`write` trực tiếp — **hành vi bên ngoài không đổi** (chữ ký Tauri command, format JSON của `SavedCredentialsDto`/`TmdbKeyFile`) — chỉ đổi NƠI lưu.

## Hệ quả

**Tích cực**
- Đóng đúng gap đã ghi từ [SPIKE-10](../spikes/README.md#spike-10) (2026-09-05) — bí mật admin không còn nằm trần trên đĩa nếu Windows Credential Manager khả dụng (mặc định có sẵn trên mọi máy Windows).
- Không đổi UX — vẫn passwordless, vẫn auto-điền form đăng nhập/tự nhận diện đã có TMDB key.
- Tự di trú ngầm cho máy đã cài bản cũ, không cần bước cài đặt/nút bấm riêng.
- Không khoá cứng vào một OS — `keyring` đã sẵn API cho macOS/Linux nếu sau này thật sự porting, chỉ cần bật thêm feature + build/verify trên OS đó.

**Tiêu cực / phải chấp nhận**
- Thêm một dependency ngoài mới (`keyring` + `windows-sys`/`windows-targets` kéo theo) — bề mặt build tăng nhẹ, cùng mức chấp nhận đã có với `reqwest` (ADR-0019).
- **Chỉ verify được nhánh Windows** ở ADR này — nhánh macOS/Linux (feature `apple-native`/Secret Service) hoàn toàn chưa bật, chưa build, chưa test. Nếu porting, đây là việc CẦN LÀM LẠI, không phải "đã có sẵn chỉ cần bật cờ".
- `session.sqlite3` (bí mật nhạy cảm NHẤT — chứa auth_key, tương đương toàn quyền tài khoản Telegram) vẫn KHÔNG được mã hoá — ADR này không đụng tới, để ngỏ cho một quyết định riêng nếu cần (đòi hướng khác hẳn, vd SQLCipher hoặc thay cơ chế lưu session của `grammers-session`).
- Fallback về plaintext (theo yêu cầu) nghĩa là mức bảo vệ thật sự **không đồng đều** giữa các máy — máy có Credential Manager hoạt động thì bí mật được bảo vệ, máy nào đó (hiếm trên Windows, dễ gặp hơn trên Linux nếu sau này porting) mà backend lỗi thì lặng lẽ rơi về plaintext y như trước ADR này, không có cảnh báo nào cho admin biết chuyện đó đang xảy ra.

## Verify

**Đã verify (2026-09-14, KHÔNG đụng MTProto/tài khoản Telegram — an toàn để tự chạy, khác các bước đăng nhập MTProto CLAUDE.md cấm agent chạy hộ):** unit test `#[ignore]` `secret_store::tests::keyring_roundtrip_writes_and_reads_back_without_touching_fallback_file` chạy roundtrip THẬT qua Windows Credential Manager (không mock) — `cargo test -- --ignored` PASS; đối chiếu `cmdkey /list` xác nhận không còn entry tồn dư sau test (dọn đúng). `cargo build`/`cargo clippy --workspace` (0 warning) sạch.

**Verify 2026-09-14, ĐẠT (tổng quát)** — user xác nhận chạy `cargo tauri dev` + tài khoản thật, đăng nhập/TMDB key hoạt động đúng qua OS keyring; chưa có xác nhận riêng từng bước con (nhánh di trú, xoá key, fallback). Checklist ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--mã-hoá-app-data-qua-os-keyring-2026-09-14).
