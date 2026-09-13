//! State của một cửa sổ Tauri duy nhất — một kết nối MTProto tại một thời
//! điểm. Một `tokio::sync::Mutex<ConnState>` DUY NHẤT (không phải hai
//! `Option` song song kiểu "đã connect" + "đã có rpc") để "đã kết nối" và
//! "đã có `GrammersIngestRpc` sẵn sàng" không bao giờ lệch pha nhau — nếu
//! tách hai field, không có gì ngăn một field `Some` trong khi field kia vẫn
//! `None`.

use std::sync::Arc;

use grammers_client::Client;
use grammers_client::client::{LoginToken, PasswordToken};
use grammers_session::storages::SqliteSession;
use ingest_grammers::GrammersIngestRpc;
use ingest_rpc_trait::{CancelFlag, ResolvedChannel};

use crate::dto::CurrentTaskDto;

#[derive(Default)]
pub enum ConnState {
    /// Chưa gọi `check_session()` lần nào trong phiên chạy app này.
    #[default]
    Disconnected,
    /// Đã mở session SQLite + `SenderPool`, xác nhận CHƯA đăng nhập
    /// (`is_authorized() == false`). Sẵn sàng cho `request_login_code`.
    Connected { client: Client, pool_task: tokio::task::JoinHandle<()>, session: Arc<SqliteSession>, api_id: i32 },
    /// Đã gọi `request_login_code`, đang chờ mã OTP người dùng nhập ở UI.
    AwaitingOtp { client: Client, pool_task: tokio::task::JoinHandle<()>, session: Arc<SqliteSession>, api_id: i32, login_token: LoginToken },
    /// `sign_in` trả `SignInError::PasswordRequired` — tài khoản có 2FA
    /// (Cloud Password), đang chờ mật khẩu người dùng nhập ở UI.
    /// `password_token` boxed để không kéo kích thước biến thể lớn nhất của
    /// enum lên các biến thể nhỏ hơn (`clippy::large_enum_variant`).
    AwaitingPassword { client: Client, pool_task: tokio::task::JoinHandle<()>, session: Arc<SqliteSession>, api_id: i32, password_token: Box<PasswordToken> },
    /// Đã đăng nhập, `GrammersIngestRpc` sẵn sàng nhận lệnh. `pool_task`
    /// chưa được đọc lại ở khung sườn này (dropping `JoinHandle` không tự
    /// abort task trong Tokio — task vẫn sống detached) — giữ field lại có
    /// chủ đích cho một đường disconnect/abort tường minh sau này thay vì
    /// xoá đi rồi phải thêm lại.
    #[allow(dead_code)]
    Ready { rpc: GrammersIngestRpc, pool_task: tokio::task::JoinHandle<()> },
}

#[derive(Default)]
pub struct AppState {
    pub conn: tokio::sync::Mutex<ConnState>,
    /// Kênh vừa `resolve_channel()` gần nhất — `check_write_permission`/
    /// `read_pinned_catalog` đọc lại từ đây thay vì bắt UI gửi lại
    /// `ResolvedChannel` qua IPC. Bắt buộc vì `GrammersIngestRpc::peer_for()`
    /// tra cứu `Peer` từ cache nội bộ theo `channel.id` — cache đó chỉ được
    /// điền bởi lần `resolve_channel()` tương ứng, nên hai lệnh này CHỈ hợp
    /// lệ sau một `resolve_channel()` thành công trong cùng phiên `Ready`.
    pub selected_channel: tokio::sync::Mutex<Option<ResolvedChannel>>,
    /// Cờ huỷ của lần `upload_video()` ĐANG chạy, nếu có, kèm `task_id` (UUID
    /// Angular sinh — ADR-0018) của chính task đó. Pipeline hiện tại chạy
    /// TUẦN TỰ, không bao giờ có 2 lần upload video chồng nhau (SPIKE-10 M5
    /// "huỷ dừng lưu lượng ≤ 3s" chỉ cần đúng MỘT cờ sống tại một thời điểm)
    /// — nên KHÔNG cần map/registry đa tác vụ, chỉ một slot. `task_id` đi kèm
    /// để `cancel_upload(task_id)` so khớp trước khi `.cancel()`: nếu
    /// `task_id` không khớp (task đã xong, hoặc lệnh huỷ trễ tới đúng lúc
    /// giao ca sang file kế tiếp trong queue) thì no-op — tránh huỷ NHẦM file
    /// kế tiếp, một race có thật khi `cancel_upload()` cũ không nhận tham số.
    /// `None` khi không có upload video nào đang chạy.
    pub active_cancel: tokio::sync::Mutex<Option<(String, CancelFlag)>>,
    /// Snapshot task đang chạy — đọc bằng `get_current_task()` để hydrate UI
    /// khi `WorkspaceComponent` remount (ADR-0018 mục 5). `std::sync::Mutex`
    /// (KHÔNG phải `tokio::sync::Mutex`) có chủ đích: ghi vào đây xảy ra từ
    /// CẢ closure đồng bộ trong `spawn_blocking` (`pipeline.rs::emit_stage`)
    /// LẪN closure bất đồng bộ chạy trên Tokio runtime
    /// (`upload.rs::on_progress`, gọi từ trong `async fn upload_video()` của
    /// `ingest-grammers`) — `tokio::sync::Mutex::blocking_lock()` PANIC nếu
    /// gọi từ ngữ cảnh async, nên không dùng được ở cả hai nơi bằng MỘT kiểu
    /// khoá. Giữ tay khoá trong thời gian NGẮN, không bao giờ `.await` khi
    /// đang giữ, nên `std::sync::Mutex` an toàn ở cả hai ngữ cảnh.
    pub current_task: std::sync::Mutex<Option<CurrentTaskDto>>,
}
