//! Kết nối + đăng nhập MTProto qua `grammers-client` 0.10.0 — API thật của
//! bản này khác hẳn tutorial cũ (`Client::connect(Config)`): phải tự dựng
//! `SenderPool` rồi `Client::new(handle)`, xem
//! `grammers-client-0.10.0/examples/echo.rs` (đọc trực tiếp từ crate đã tải
//! về `~/.cargo/registry/src/...` — docs.rs không có trang chi tiết cho bản
//! này khi kiểm tra 2026-09-05).
//!
//! Người dùng tự chạy `login` trong terminal của họ (CLAUDE.md: Claude không
//! chạy hộ đăng nhập MTProto) — mã OTP luôn gõ tay qua stdin, không có cách
//! nào lưu lại.

use std::io::Write as _;
use std::sync::Arc;

use grammers_client::client::{LoginToken, PasswordToken, SignInError};
use grammers_client::{Client, InvocationError, SenderPool};
use grammers_session::storages::SqliteSession;

pub struct Connected {
    pub client: Client,
    /// Task chạy `runner.run()` — phải sống suốt vòng đời `client`, xem
    /// echo.rs: bỏ task này đi là mất kết nối ngay lập tức.
    pub pool_task: tokio::task::JoinHandle<()>,
    /// Giữ nguyên `Arc` session dùng chung với `SenderPool` — cần đọc lại
    /// `dc_option()`/`home_dc_id()` (auth_key + địa chỉ DC) để tự mở thêm
    /// kết nối MTProto RAW song song, xem `rpc.rs::upload_video()` (điều
    /// tra M4 "mở đồng thời nhiều request" — 2026-09-06).
    pub session: Arc<SqliteSession>,
}

/// Mở/khôi phục session SQLite tại `session_path`, dựng `SenderPool` +
/// `Client`. KHÔNG tự đăng nhập — gọi `ensure_logged_in()` sau đó nếu
/// `client.is_authorized()` trả `false`.
pub async fn connect(session_path: &str, api_id: i32) -> Result<Connected, Box<dyn std::error::Error + Send + Sync>> {
    let session = Arc::new(SqliteSession::open(session_path).await?);
    let SenderPool { runner, handle, .. } = SenderPool::new(Arc::clone(&session), api_id);
    let client = Client::new(handle.clone());
    let pool_task = tokio::spawn(async move {
        runner.run().await;
    });
    Ok(Connected { client, pool_task, session })
}

fn prompt(label: &str) -> String {
    print!("{label}: ");
    std::io::stdout().flush().ok();
    let mut line = String::new();
    std::io::stdin().read_line(&mut line).expect("đọc stdin thất bại");
    line.trim().to_string()
}

/// Luồng đăng nhập phone + code + 2FA tuỳ chọn — khuôn giống hệt
/// `apps/tsmc-ingest/src/commands/login.ts` (đọc `TSMC_PHONE`/`.env` nếu có,
/// không thì hỏi tay), chỉ khác thư viện MTProto bên dưới.
pub async fn ensure_logged_in(client: &Client, api_hash: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if client.is_authorized().await? {
        println!("Đã đăng nhập từ trước (session cũ còn hợp lệ).");
        return Ok(());
    }

    let phone = std::env::var("TSMC_PHONE").unwrap_or_else(|_| prompt("Số điện thoại (+84...)"));
    let token: LoginToken = client.request_login_code(&phone, api_hash).await?;

    let code = prompt("Mã OTP vừa nhận được qua Telegram/SMS");
    match client.sign_in(&token, &code).await {
        Ok(_user) => {
            println!("Đăng nhập thành công (không cần 2FA).");
            Ok(())
        }
        Err(SignInError::PasswordRequired(password_token)) => {
            let password_token: PasswordToken = password_token;
            let password = prompt("Mật khẩu 2FA (Cloud Password)");
            client.check_password(password_token, password).await?;
            println!("Đăng nhập thành công (đã qua 2FA).");
            Ok(())
        }
        Err(err) => Err(Box::new(err) as Box<dyn std::error::Error + Send + Sync>),
    }
}

/// Đọc `FLOOD_WAIT` từ `InvocationError` — CLAUDE.md: tôn trọng tuyệt đối,
/// không bao giờ tự né bằng đổi DC. Trả `None` nếu không phải lỗi này.
pub fn flood_wait_seconds(err: &InvocationError) -> Option<u64> {
    match err {
        InvocationError::Rpc(rpc) if rpc.name == "FLOOD_WAIT" => Some(rpc.value.unwrap_or(0) as u64),
        _ => None,
    }
}
