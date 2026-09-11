//! Kiểu dữ liệu serde cho ranh giới IPC (Tauri command ↔ webview). Cố ý tách
//! khỏi `ingest-rpc-trait` — trait đó giữ "opinion-free" (không phụ thuộc
//! `serde`) vì nó là hợp đồng dùng chung, có thể còn tiêu thụ bởi một
//! implementation MTProto khác sau này (ADR-0017 điều kiện bắt buộc #2).

use ingest_rpc_trait::{IngestRpcError, PinnedCatalog, ResolvedChannel};
use serde::{Deserialize, Serialize};

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

/// Document đang ghim = catalog hiện hành. `raw` truyền NGUYÊN VĂN qua IPC —
/// đây là nội dung do một kênh (có thể cộng đồng) tự soạn, KHÔNG được tin
/// tưởng (CLAUDE.md bất biến #7); phía UI chỉ được `JSON.parse` phòng thủ để
/// đếm số item hiển thị, không được render bằng `[innerHTML]`.
#[derive(Debug, Serialize)]
pub struct PinnedCatalogDto {
    pub msg_id: i64,
    pub publisher_id: String,
    pub raw: String,
}

impl From<PinnedCatalog> for PinnedCatalogDto {
    fn from(c: PinnedCatalog) -> Self {
        Self { msg_id: c.msg_id, publisher_id: c.publisher_id, raw: c.raw }
    }
}

/// Credential người dùng tự cấp cho chính họ tại my.telegram.org — KHÔNG
/// phải secret bí mật server (CLAUDE.md bất biến #1), nên lưu thẳng
/// `credentials.json` ở app-data (cùng thư mục `session.sqlite3`) được chấp
/// nhận. Lưu ở đây (Rust/app-data) thay vì `localStorage` phía webview vì
/// `localStorage` tách theo ORIGIN phục vụ webview — `cargo tauri dev`
/// (`http://localhost:4300`) và bản release (protocol riêng của Tauri) là
/// hai origin khác nhau, không chia sẻ `localStorage` — phát hiện thật
/// 2026-09-11 (README.md § Chạy) khiến user bị bắt gõ lại form mỗi lần đổi
/// qua lại giữa hai cách chạy dù đã đăng nhập ở cách kia. `app_data_dir()`
/// không phụ thuộc origin nên không dính lỗi này.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedCredentialsDto {
    pub api_id: i32,
    pub api_hash: String,
    pub dial_code: String,
    pub national_number: String,
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
