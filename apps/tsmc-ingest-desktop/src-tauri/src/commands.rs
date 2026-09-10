//! Năm Tauri command cho khung sườn này — `check_session` +
//! `request_login_code`/`submit_otp`/`submit_password` (đăng nhập, chia
//! nhiều bước vì webview không có stdin để chặn chờ OTP như CLI
//! `tools/spike-10/r3-grammers`) + `resolve_channel` (chứng minh đường IPC
//! chạy hết tới `IngestRpc` thật). Bốn thao tác còn lại của `IngestRpc`
//! (check_write_permission, read_pinned_catalog, download_document,
//! upload_video, upload_subtitle, publish_catalog) ĐÃ có implementation đầy
//! đủ ở `ingest-grammers` nhưng CHƯA wire thành command — để dành cho slice
//! UI thật (mockup A.3, docs/ux-design.md § Phụ lục A).
//!
//! **Đơn giản hoá có chủ đích của khung sườn này:** nếu `submit_otp`/
//! `submit_password` thất bại (sai mã/sai mật khẩu), state bị reset về
//! `Disconnected` thay vì cho retry tại chỗ — `PasswordToken` không `Clone`
//! nên không giữ lại được sau một lần `check_password` thất bại. Người dùng
//! phải bấm lại từ `request_login_code`. Chấp nhận được cho khung sườn chứng
//! minh đường IPC; UI thật nên cân nhắc cải thiện trải nghiệm này sau.

use grammers_client::client::SignInError;
use ingest_grammers::connect;
use ingest_rpc_trait::IngestRpc;
use tauri::{AppHandle, Manager, State};

use crate::dto::{IngestRpcErrorDto, LoginOutcomeDto, ResolvedChannelDto};
use crate::state::{AppState, ConnState};

/// Session SQLite lưu ở thư mục app-data do HĐH quản lý (KHÔNG phải cwd như
/// mặc định của CLI `tools/spike-10/r3-grammers` — một app desktop thật
/// không nên phụ thuộc thư mục làm việc lúc khởi động).
fn session_path(app: &AppHandle) -> Result<String, IngestRpcErrorDto> {
    let dir = app.path().app_data_dir().map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;
    Ok(dir.join("session.sqlite3").to_string_lossy().into_owned())
}

/// Mở/khôi phục session, kiểm tra đã đăng nhập chưa. LUÔN gọi trước các
/// command đăng nhập khác trong một lần chạy app.
#[tauri::command]
pub async fn check_session(app: AppHandle, state: State<'_, AppState>, api_id: i32) -> Result<bool, IngestRpcErrorDto> {
    let path = session_path(&app)?;
    let connected = connect(&path, api_id).await.map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;
    let authorized = connected.client.is_authorized().await.map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;

    let mut conn = state.conn.lock().await;
    *conn = if authorized {
        let rpc = ingest_grammers::GrammersIngestRpc::new(connected.client, connected.session, api_id);
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
            let rpc = ingest_grammers::GrammersIngestRpc::new(client, session, api_id);
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
            let rpc = ingest_grammers::GrammersIngestRpc::new(client, session, api_id);
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
    Ok(ResolvedChannelDto::from(resolved))
}
