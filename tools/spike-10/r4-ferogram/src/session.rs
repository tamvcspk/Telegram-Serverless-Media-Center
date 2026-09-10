//! Kết nối + đăng nhập MTProto qua `ferogram` 0.6.5. Khác grammers: builder
//! `Client::builder()...connect()` (không tự đăng nhập, chỉ mở kết nối —
//! xem `builder.rs` doc: "This method only establishes the connection. It
//! never prompts") — có sẵn `connect_and_login()` hỏi tay qua STDIN, nhưng
//! CỐ TÌNH không dùng ở đây: R4 mô phỏng ngữ cảnh GUI Tauri (không có
//! terminal cho stdin), nên phải tự dựng luồng phone/code/2FA thủ công qua
//! `auth.rs`, giống hệt cách viết cho R3/grammers — không phải giới hạn của
//! thư viện, chỉ là chọn đúng API cho đúng ngữ cảnh.

use std::io::Write as _;

use ferogram::{Client, LoginToken, PasswordToken, SendCodeOutcome, ShutdownToken, SignInError};

pub async fn connect(session_path: &str, api_id: i32, api_hash: &str) -> Result<(Client, ShutdownToken), Box<dyn std::error::Error + Send + Sync>> {
    let (client, shutdown) = Client::builder().api_id(api_id).api_hash(api_hash).session(session_path).connect().await?;
    Ok((client, shutdown))
}

fn prompt(label: &str) -> String {
    print!("{label}: ");
    std::io::stdout().flush().ok();
    let mut line = String::new();
    std::io::stdin().read_line(&mut line).expect("đọc stdin thất bại");
    line.trim().to_string()
}

/// Cùng khuôn với `session::ensure_logged_in` của r3-grammers — hai nhánh
/// PHẢI đối xứng để phép so sánh Đ3 (chi phí viết mới) có ý nghĩa.
pub async fn ensure_logged_in(client: &Client) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if client.is_authorized().await? {
        println!("Đã đăng nhập từ trước (session cũ còn hợp lệ).");
        return Ok(());
    }

    let phone = std::env::var("TSMC_PHONE").unwrap_or_else(|_| prompt("Số điện thoại (+84...)"));
    let token: LoginToken = match client.request_login_code(&phone).await? {
        SendCodeOutcome::AlreadyAuthorized(name) => {
            println!("Telegram tự nhận diện lại session cũ, không cần OTP — chào {name}.");
            return Ok(());
        }
        SendCodeOutcome::CodeRequired(token) => token,
    };

    let code = prompt("Mã OTP vừa nhận được qua Telegram/SMS");
    match client.sign_in(&token, &code).await {
        Ok(name) => {
            println!("Đăng nhập thành công (không cần 2FA) — chào {name}.");
            Ok(())
        }
        Err(SignInError::PasswordRequired(password_token)) => {
            let password_token: PasswordToken = *password_token;
            let password = prompt("Mật khẩu 2FA (Cloud Password)");
            client.check_password(password_token, password).await?;
            println!("Đăng nhập thành công (đã qua 2FA).");
            Ok(())
        }
        Err(err) => Err(Box::new(err) as Box<dyn std::error::Error + Send + Sync>),
    }
}

// FLOOD_WAIT (CLAUDE.md: tôn trọng tuyệt đối, không tự né bằng đổi DC) đọc
// thẳng qua `InvocationError::flood_wait_seconds()` có sẵn của ferogram
// (errors.rs) — tiện hơn hẳn grammers (phải tự so `RpcError.name ==
// "FLOOD_WAIT"` + `.value`, xem `r3-grammers/src/session.rs::flood_wait_seconds`)
// — điểm cộng thật cho Đ3, không cần hàm bọc riêng ở đây như bên grammers.
