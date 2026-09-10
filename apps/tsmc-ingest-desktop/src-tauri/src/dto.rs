//! Kiểu dữ liệu serde cho ranh giới IPC (Tauri command ↔ webview). Cố ý tách
//! khỏi `ingest-rpc-trait` — trait đó giữ "opinion-free" (không phụ thuộc
//! `serde`) vì nó là hợp đồng dùng chung, có thể còn tiêu thụ bởi một
//! implementation MTProto khác sau này (ADR-0017 điều kiện bắt buộc #2).

use ingest_rpc_trait::{IngestRpcError, ResolvedChannel};
use serde::Serialize;

/// KHÔNG collapse lỗi về `String` trần — `FloodWait` phải giữ nguyên số giây
/// để phía UI tự quyết định chờ/hiển thị đếm ngược thay vì mất thông tin ở
/// ranh giới IPC (CLAUDE.md: tôn trọng `FLOOD_WAIT` tuyệt đối).
#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum IngestRpcErrorDto {
    FloodWait { seconds: u64 },
    FileTooLarge { max_bytes: u64, actual_bytes: u64 },
    NotAuthorized,
    Cancelled,
    Other(String),
}

impl From<IngestRpcError> for IngestRpcErrorDto {
    fn from(err: IngestRpcError) -> Self {
        match err {
            IngestRpcError::FloodWait { seconds } => Self::FloodWait { seconds },
            IngestRpcError::FileTooLarge { max_bytes, actual_bytes } => Self::FileTooLarge { max_bytes, actual_bytes },
            IngestRpcError::NotAuthorized => Self::NotAuthorized,
            IngestRpcError::Cancelled => Self::Cancelled,
            IngestRpcError::Other(msg) => Self::Other(msg),
        }
    }
}

impl IngestRpcErrorDto {
    pub fn other(msg: impl Into<String>) -> Self {
        Self::Other(msg.into())
    }
}

#[derive(Debug, Serialize)]
pub struct ResolvedChannelDto {
    pub id: String,
    pub title: String,
    pub is_own: bool,
}

impl From<ResolvedChannel> for ResolvedChannelDto {
    fn from(c: ResolvedChannel) -> Self {
        Self { id: c.id, title: c.title, is_own: c.is_own }
    }
}

/// Kết quả `submit_otp` — hai đường rẽ thật của `grammers_client::Client::
/// sign_in()`: đăng nhập xong ngay, hoặc tài khoản có 2FA (Cloud Password)
/// nên cần thêm bước `submit_password`.
#[derive(Debug, Serialize)]
#[serde(tag = "outcome")]
pub enum LoginOutcomeDto {
    LoggedIn,
    PasswordRequired,
}
