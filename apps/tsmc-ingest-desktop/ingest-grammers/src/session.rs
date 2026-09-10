//! Kết nối MTProto qua `grammers-client` 0.10.0 — API thật của bản này khác
//! hẳn tutorial cũ (`Client::connect(Config)`): phải tự dựng `SenderPool`
//! rồi `Client::new(handle)`, xem `grammers-client-0.10.0/examples/echo.rs`
//! (đọc trực tiếp từ crate đã tải về `~/.cargo/registry/src/...` — docs.rs
//! không có trang chi tiết cho bản này). Ported từ
//! `tools/spike-10/r3-grammers/src/session.rs` (đã chạy thật, xem
//! `docs/spikes/README.md#spike-10`), CHỈ giữ lại `connect()` +
//! `flood_wait_seconds()` — bản spike còn có `ensure_logged_in()` chặn
//! stdin (phone/OTP/2FA qua terminal), nhưng đó là mẫu hình CLI, không có ý
//! nghĩa trong một Tauri command (không có terminal đính kèm). Luồng đăng
//! nhập thật (`request_login_code` → `sign_in` → xử lý
//! `SignInError::PasswordRequired` → `check_password`) được chuyển thành
//! một state machine nhiều bước ở `src-tauri/src/state.rs`/`commands.rs`,
//! gọi thẳng các method public của `grammers_client::Client` — không cần bọc
//! lại ở đây vì bản thân các method đó đã đủ mỏng.

use std::sync::Arc;

use grammers_client::{Client, InvocationError, SenderPool};
use grammers_session::storages::SqliteSession;

pub struct Connected {
    pub client: Client,
    /// Task chạy `runner.run()` — phải sống suốt vòng đời `client`, xem
    /// echo.rs: bỏ task này đi là mất kết nối ngay lập tức. `JoinHandle` bị
    /// drop không tự abort task trong Tokio, nên giữ nguyên field này (dù
    /// Tauri chạy runtime dài hạn, không tắt đột ngột như CLI) để có chỗ
    /// abort tường minh khi cần disconnect sau này.
    pub pool_task: tokio::task::JoinHandle<()>,
    /// Giữ nguyên `Arc` session dùng chung với `SenderPool` — cần đọc lại
    /// `dc_option()`/`home_dc_id()` (auth_key + địa chỉ DC) để tự mở thêm
    /// kết nối MTProto RAW song song, xem `rpc.rs::multi_connection_upload()`.
    pub session: Arc<SqliteSession>,
}

/// Mở/khôi phục session SQLite tại `session_path`, dựng `SenderPool` +
/// `Client`. KHÔNG tự đăng nhập — bên gọi tự kiểm `client.is_authorized()`
/// và chạy luồng đăng nhập nếu cần.
pub async fn connect(session_path: &str, api_id: i32) -> Result<Connected, Box<dyn std::error::Error + Send + Sync>> {
    let session = Arc::new(SqliteSession::open(session_path).await?);
    let SenderPool { runner, handle, .. } = SenderPool::new(Arc::clone(&session), api_id);
    let client = Client::new(handle.clone());
    let pool_task = tokio::spawn(async move {
        runner.run().await;
    });
    Ok(Connected { client, pool_task, session })
}

/// Đọc `FLOOD_WAIT` từ `InvocationError` — CLAUDE.md: tôn trọng tuyệt đối,
/// không bao giờ tự né bằng đổi DC. Trả `None` nếu không phải lỗi này.
pub fn flood_wait_seconds(err: &InvocationError) -> Option<u64> {
    match err {
        InvocationError::Rpc(rpc) if rpc.name == "FLOOD_WAIT" => Some(rpc.value.unwrap_or(0) as u64),
        _ => None,
    }
}
