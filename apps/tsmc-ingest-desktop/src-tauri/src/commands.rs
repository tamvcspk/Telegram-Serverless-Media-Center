//! Mười ba Tauri command — `check_session` + `request_login_code`/`submit_otp`/
//! `submit_password` (đăng nhập, chia nhiều bước vì webview không có stdin để
//! chặn chờ OTP như CLI `tools/spike-10/r3-grammers`) + `load_saved_credentials`/
//! `save_credentials` (nhớ API_ID/API_HASH/số điện thoại ở app-data, KHÔNG
//! phải `localStorage` — xem doc comment `SavedCredentialsDto`) +
//! `resolve_channel`/`list_own_channels`/`create_channel`/`select_channel`/
//! `check_write_permission`/`read_pinned_catalog` (màn "Chọn kênh", A.4) +
//! `sign_out` (màn Cài đặt, ADR-0017 § addendum 2026-09-14). `upload_video`/
//! `upload_subtitle`/`publish_catalog` wire ở `upload.rs`,
//! `check_deleted_messages`/`delete_message` (màn "Trình quản lý catalog")
//! wire ở `catalog.rs`. Còn đúng một thao tác `IngestRpc` chưa wire:
//! `download_document` — ĐÃ có implementation đầy đủ ở `ingest-grammers`
//! nhưng chưa có UI nào cần tới (đối soát ở "Trình quản lý catalog" chỉ cần
//! biết message còn tồn tại hay không, không cần tải lại nội dung file).
//!
//! **Đơn giản hoá có chủ đích của khung sườn này:** nếu `submit_otp`/
//! `submit_password` thất bại (sai mã/sai mật khẩu), state bị reset về
//! `Disconnected` thay vì cho retry tại chỗ — `PasswordToken` không `Clone`
//! nên không giữ lại được sau một lần `check_password` thất bại. Người dùng
//! phải bấm lại từ `request_login_code`. Chấp nhận được cho khung sườn chứng
//! minh đường IPC; UI thật nên cân nhắc cải thiện trải nghiệm này sau.

use grammers_client::client::SignInError;
use ingest_grammers::connect;
use ingest_rpc_trait::{IngestRpc, ResolvedChannel};
use tauri::{AppHandle, Manager, State};

use crate::dto::{IngestRpcErrorDto, LoginOutcomeDto, PinnedCatalogDto, ResolvedChannelDto, SavedCredentialsDto};
use crate::secret_store;
use crate::state::{AppState, ConnState};

/// Session SQLite (MÃ HOÁ — ADR-0021) lưu ở thư mục app-data do HĐH quản lý
/// (KHÔNG phải cwd như mặc định của CLI `tools/spike-10/r3-grammers` — một
/// app desktop thật không nên phụ thuộc thư mục làm việc lúc khởi động).
fn session_path(app: &AppHandle) -> Result<String, IngestRpcErrorDto> {
    let dir = app.path().app_data_dir().map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;
    Ok(dir.join("session.sqlite3").to_string_lossy().into_owned())
}

/// Đường dẫn file FALLBACK cho key mã hoá `session.sqlite3` — xem doc comment
/// `secret_store::load_or_generate_key()`/`credentials_path()`.
fn session_key_path(app: &AppHandle) -> Result<std::path::PathBuf, IngestRpcErrorDto> {
    let dir = app.path().app_data_dir().map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;
    Ok(dir.join("session_key.json"))
}

/// AES-256 → key 32 byte (`Cipher::Aes256Cbc`, xem `encrypted_session.rs`).
const SESSION_ENCRYPTION_KEY_LEN: usize = 32;

/// Đường dẫn file FALLBACK — `secret_store` (2026-09-14) ưu tiên lưu qua OS
/// keyring, chỉ ghi file plaintext ở đây nếu keyring không dùng được. Tên
/// file/vị trí giữ NGUYÊN so với trước slice đó (không đổi để tương thích
/// ngược với bản cài cũ đã có file này).
fn credentials_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("credentials.json"))
}

/// Đọc credential đã nhớ (nếu có) — dùng để UI tự điền form Bước 1 + tự
/// `check_session()` ngay lúc mở app mà KHÔNG cần user gõ gì, bất kể origin
/// webview đang phục vụ UI (`localStorage` tách theo origin, xem
/// `SavedCredentialsDto`). `None` nếu chưa từng lưu hoặc hỏng/thiếu ở CẢ hai
/// nơi (keyring lẫn file) — coi như chưa có gì nhớ, không phải lỗi cần báo
/// (best-effort). Ưu tiên đọc OS keyring trước, rơi về file plaintext cũ nếu
/// không thấy — xem doc comment `secret_store.rs` (2026-09-14, mã hoá app-data).
#[tauri::command]
pub fn load_saved_credentials(app: AppHandle) -> Option<SavedCredentialsDto> {
    let path = credentials_path(&app).ok()?;
    secret_store::load_json("credentials", &path)
}

/// Ghi credential — best-effort (không trả lỗi ra UI): lỗi ghi chỉ làm mất
/// tiện nghi tự điền lần sau, không được phép chặn luồng đăng nhập đang chạy.
/// Ưu tiên OS keyring, fallback file plaintext nếu keyring không dùng được —
/// xem doc comment `secret_store.rs`.
#[tauri::command]
pub fn save_credentials(app: AppHandle, api_id: i32, api_hash: String, dial_code: String, national_number: String) {
    let Ok(path) = credentials_path(&app) else { return };
    let data = SavedCredentialsDto { api_id, api_hash, dial_code, national_number };
    secret_store::save_json("credentials", &path, &data);
}

/// Mở/khôi phục session (MÃ HOÁ — ADR-0021), kiểm tra đã đăng nhập chưa.
/// LUÔN gọi trước các command đăng nhập khác trong một lần chạy app.
#[tauri::command]
pub async fn check_session(app: AppHandle, state: State<'_, AppState>, api_id: i32) -> Result<bool, IngestRpcErrorDto> {
    let path = session_path(&app)?;
    // `get_or_init()` — chỉ đọc/sinh key ĐÚNG MỘT LẦN cho cả vòng đời tiến
    // trình app, tránh TOCTOU race nếu `check_session()` bị gọi nhiều lần
    // (xem doc comment `AppState::session_encryption_key`).
    let key_path = session_key_path(&app)?;
    let encryption_key = state.session_encryption_key.get_or_init(|| secret_store::load_or_generate_key("session_encryption_key", &key_path, SESSION_ENCRYPTION_KEY_LEN)).clone();
    let connected = connect(&path, api_id, encryption_key.into()).await.map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;
    let authorized = connected.client.is_authorized().await.map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;

    let mut conn = state.conn.lock().await;
    *conn = if authorized {
        let rpc = ingest_grammers::GrammersIngestRpc::new(connected.client, connected.session, api_id).await;
        ConnState::Ready { rpc, pool_task: connected.pool_task }
    } else {
        ConnState::Connected { client: connected.client, pool_task: connected.pool_task, session: connected.session, api_id }
    };
    Ok(authorized)
}

/// Bước 1 đăng nhập — gửi mã OTP tới Telegram/SMS của số điện thoại đưa vào.
/// Yêu cầu đã `check_session()` trước (state phải là `Connected`).
#[tauri::command]
pub async fn request_login_code(state: State<'_, AppState>, api_hash: String, phone: String) -> Result<(), IngestRpcErrorDto> {
    let mut conn = state.conn.lock().await;
    let ConnState::Connected { client, pool_task, session, api_id } = std::mem::take(&mut *conn) else {
        return Err(IngestRpcErrorDto::other("gọi check_session() trước request_login_code()"));
    };

    match client.request_login_code(&phone, &api_hash).await {
        Ok(login_token) => {
            *conn = ConnState::AwaitingOtp { client, pool_task, session, api_id, login_token };
            Ok(())
        }
        Err(err) => {
            *conn = ConnState::Connected { client, pool_task, session, api_id };
            Err(IngestRpcErrorDto::other(err.to_string()))
        }
    }
}

/// Bước 2 đăng nhập — xác nhận mã OTP người dùng vừa nhận được. Trả
/// `PasswordRequired` nếu tài khoản có 2FA (gọi `submit_password` tiếp),
/// `LoggedIn` nếu xong luôn.
#[tauri::command]
pub async fn submit_otp(state: State<'_, AppState>, code: String) -> Result<LoginOutcomeDto, IngestRpcErrorDto> {
    let mut conn = state.conn.lock().await;
    let ConnState::AwaitingOtp { client, pool_task, session, api_id, login_token } = std::mem::take(&mut *conn) else {
        return Err(IngestRpcErrorDto::other("gọi request_login_code() trước submit_otp()"));
    };

    match client.sign_in(&login_token, &code).await {
        Ok(_user) => {
            let rpc = ingest_grammers::GrammersIngestRpc::new(client, session, api_id).await;
            *conn = ConnState::Ready { rpc, pool_task };
            Ok(LoginOutcomeDto::LoggedIn)
        }
        Err(SignInError::PasswordRequired(password_token)) => {
            *conn = ConnState::AwaitingPassword { client, pool_task, session, api_id, password_token: Box::new(password_token) };
            Ok(LoginOutcomeDto::PasswordRequired)
        }
        Err(err) => {
            // Mã OTP sai/hết hạn — không có cách xin thử lại với CÙNG
            // login_token một cách an toàn, bắt người dùng bấm lại từ đầu
            // (xem ghi chú "Đơn giản hoá có chủ đích" ở đầu file).
            *conn = ConnState::Disconnected;
            let _ = (pool_task, session, api_id);
            Err(IngestRpcErrorDto::other(err.to_string()))
        }
    }
}

/// Bước 3 đăng nhập (chỉ khi `submit_otp` trả `PasswordRequired`) — xác nhận
/// mật khẩu 2FA (Cloud Password).
#[tauri::command]
pub async fn submit_password(state: State<'_, AppState>, password: String) -> Result<(), IngestRpcErrorDto> {
    let mut conn = state.conn.lock().await;
    let ConnState::AwaitingPassword { client, pool_task, session, api_id, password_token } = std::mem::take(&mut *conn) else {
        return Err(IngestRpcErrorDto::other("gọi submit_otp() (với kết quả PasswordRequired) trước submit_password()"));
    };

    match client.check_password(*password_token, password).await {
        Ok(_user) => {
            let rpc = ingest_grammers::GrammersIngestRpc::new(client, session, api_id).await;
            *conn = ConnState::Ready { rpc, pool_task };
            Ok(())
        }
        Err(err) => {
            *conn = ConnState::Disconnected;
            let _ = (pool_task, session, api_id);
            Err(IngestRpcErrorDto::other(err.to_string()))
        }
    }
}

/// Chứng minh đường IPC chạy hết tới `IngestRpc` thật — resolve một kênh
/// bằng username/id, khớp CLAUDE.md bất biến #10 (không dùng id thô làm định
/// danh chia sẻ được, access_hash khác nhau theo tài khoản).
#[tauri::command]
pub async fn resolve_channel(state: State<'_, AppState>, channel_ref: String) -> Result<ResolvedChannelDto, IngestRpcErrorDto> {
    let conn = state.conn.lock().await;
    let ConnState::Ready { rpc, .. } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập xong — gọi check_session()/luồng đăng nhập trước resolve_channel()"));
    };
    let resolved = rpc.resolve_channel(&channel_ref).await.map_err(IngestRpcErrorDto::from)?;
    // Nhớ lại channel vừa resolve — check_write_permission()/
    // read_pinned_catalog() đọc lại từ đây (xem doc comment AppState::
    // selected_channel: peer cache của GrammersIngestRpc chỉ có đúng channel
    // của lần resolve gần nhất).
    *state.selected_channel.lock().await = Some(resolved.clone());
    Ok(ResolvedChannelDto::from(resolved))
}

/// Liệt kê channel/broadcast mà tài khoản đang đăng nhập là creator — nguồn
/// cho picker ở màn "Chọn kênh" (A.4), thay vì bắt user tự gõ username.
#[tauri::command]
pub async fn list_own_channels(state: State<'_, AppState>) -> Result<Vec<ResolvedChannelDto>, IngestRpcErrorDto> {
    let conn = state.conn.lock().await;
    let ConnState::Ready { rpc, .. } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập xong"));
    };
    let channels = rpc.list_own_channels().await.map_err(IngestRpcErrorDto::from)?;
    Ok(channels.into_iter().map(ResolvedChannelDto::from).collect())
}

/// Tạo một channel/broadcast media MỚI rồi chọn luôn làm kênh đang làm việc
/// (cùng hiệu ứng `selected_channel` như `resolve_channel`) — gộp "tạo" +
/// "chọn" thành một bước cho UI, vì sau khi tạo xong không có lý do gì để
/// KHÔNG chọn kênh vừa tạo.
#[tauri::command]
pub async fn create_channel(state: State<'_, AppState>, title: String) -> Result<ResolvedChannelDto, IngestRpcErrorDto> {
    let conn = state.conn.lock().await;
    let ConnState::Ready { rpc, .. } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập xong"));
    };
    let resolved = rpc.create_channel(&title).await.map_err(IngestRpcErrorDto::from)?;
    *state.selected_channel.lock().await = Some(resolved.clone());
    Ok(ResolvedChannelDto::from(resolved))
}

/// Chọn một channel đã có trong kết quả `list_own_channels()` làm kênh đang
/// làm việc — KHÔNG gọi lại `resolve_channel()` (không cần, peer cache của
/// `GrammersIngestRpc` đã có entry từ lần `list_own_channels()` liệt kê nó).
/// `access_hash` luôn rỗng ở implementation grammers (không dùng tới, xem
/// doc comment `resolve_channel`) nên dựng lại `ResolvedChannel` từ đúng 3
/// field DTO mang qua IPC là đủ, không mất thông tin.
#[tauri::command]
pub async fn select_channel(state: State<'_, AppState>, id: String, title: String, is_own: bool) -> Result<(), IngestRpcErrorDto> {
    *state.selected_channel.lock().await = Some(ResolvedChannel { id, access_hash: String::new(), title, is_own });
    Ok(())
}

/// Màn "Chọn kênh" (docs/ux-design.md § Phụ lục A.4) — kiểm tra quyền ghi
/// của channel vừa `resolve_channel()`. Không nhận tham số: luôn thao tác
/// trên `selected_channel` để không bắt UI gửi lại `ResolvedChannel` (kể cả
/// `access_hash`) qua IPC.
#[tauri::command]
pub async fn check_write_permission(state: State<'_, AppState>) -> Result<bool, IngestRpcErrorDto> {
    let conn = state.conn.lock().await;
    let ConnState::Ready { rpc, .. } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập xong"));
    };
    let selected = state.selected_channel.lock().await;
    let channel = selected.as_ref().ok_or_else(|| IngestRpcErrorDto::other("chưa resolve_channel() — gọi trước check_write_permission()"))?;
    rpc.check_write_permission(channel).await.map_err(IngestRpcErrorDto::from)
}

/// Đọc document đang ghim của channel vừa `resolve_channel()`, nếu có — dùng
/// để hiện "tình trạng catalog đã ghim" ở màn Chọn kênh (A.4).
#[tauri::command]
pub async fn read_pinned_catalog(state: State<'_, AppState>) -> Result<Option<PinnedCatalogDto>, IngestRpcErrorDto> {
    let conn = state.conn.lock().await;
    let ConnState::Ready { rpc, .. } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập xong"));
    };
    let selected = state.selected_channel.lock().await;
    let channel = selected.as_ref().ok_or_else(|| IngestRpcErrorDto::other("chưa resolve_channel() — gọi trước read_pinned_catalog()"))?;
    let pinned = rpc.read_pinned_catalog(channel).await.map_err(IngestRpcErrorDto::from)?;
    Ok(pinned.map(PinnedCatalogDto::from))
}

/// Đăng xuất (màn Cài đặt, ADR-0017 § addendum 2026-09-14) — gọi
/// `IngestRpc::sign_out()` (server-side `auth.LogOut`) TRƯỚC, chỉ xoá
/// `session.sqlite3` cục bộ SAU KHI thành công (đúng thứ tự bắt buộc, xem
/// doc comment `IngestRpc::sign_out()`). Lỗi ở bước server (FLOOD_WAIT, mất
/// mạng...) → trả lỗi ngay, KHÔNG xoá gì cả, `ConnState` giữ nguyên `Ready`
/// (user có thể thử lại). `credentials.json`/`tmdb_api_key.json` CỐ Ý không
/// đụng tới — giữ để đăng nhập lại nhanh (chỉ cần OTP), đúng hành vi
/// `tryAutoLogin()` (`login.ts`) đã có sẵn cho case "session hết hạn".
#[tauri::command]
pub async fn sign_out(app: AppHandle, state: State<'_, AppState>) -> Result<(), IngestRpcErrorDto> {
    let mut conn = state.conn.lock().await;
    let ConnState::Ready { rpc, pool_task } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập — không có gì để đăng xuất"));
    };
    rpc.sign_out().await.map_err(IngestRpcErrorDto::from)?;
    pool_task.abort();

    *conn = ConnState::Disconnected;
    *state.selected_channel.lock().await = None;
    drop(conn);

    // Xoá session cục bộ — best-effort, không chặn nếu lỗi (server-side đã
    // đăng xuất xong, đây chỉ là dọn dẹp). Xoá cả sidecar -wal/-shm nếu
    // libSQL từng tạo (EncryptedSqliteSession, ADR-0021).
    if let Ok(path) = session_path(&app) {
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{path}-wal"));
        let _ = std::fs::remove_file(format!("{path}-shm"));
    }
    Ok(())
}
