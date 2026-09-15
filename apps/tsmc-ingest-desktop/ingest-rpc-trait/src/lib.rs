//! Trait `IngestRpc` — hợp đồng RPC MTProto dùng chung cho công cụ ingest
//! desktop (ADR-0017). Bảy trong mười thao tác khớp 1-1 với
//! `libs/core-mtproto/src/gateway-index.ts` + `gateway-ingest.ts` (bản
//! TypeScript đã verify thật ở ADR-0013) — implementation Rust KHÔNG được
//! phát minh lại tập hợp thao tác đó, chỉ đổi thư viện MTProto bên dưới.
//! `list_own_channels`/`create_channel` (thêm 2026-09-11) và `sign_out`
//! (thêm 2026-09-14) là NGOẠI LỆ có chủ đích, xem doc comment ở `trait
//! IngestRpc` ngay dưới.
//!
//! Crate này KHÔNG chứa luật nghiệp vụ (bảng phân hạng A/B/C/D,
//! inheritMetadata, catalog merge) — luật đó ở lại `libs/core-ingest`
//! (TypeScript), một nguồn sự thật duy nhất bất kể implementation Rust nào
//! đứng sau trait này (điều kiện bắt buộc #4, ADR-0017). Crate này cũng cố ý
//! không phụ thuộc `serde` — ranh giới serialize hoá cho IPC (Tauri) là việc
//! của app tiêu thụ trait này (`src-tauri/src/dto.rs`), không phải của trait.
//!
//! Đã chứng minh khả thi + chạy thật trên tài khoản Telegram thật ở
//! [SPIKE-10](../../../docs/spikes/README.md#spike-10) (`tools/spike-10/rpc-trait`)
//! trước khi port sang đây.

use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use thiserror::Error;

/// Cờ huỷ chia sẻ được giữa task gọi upload và UI (M5 của SPIKE-10: "bấm huỷ
/// thì lưu lượng mạng về 0 trong ≤ 3s").
#[derive(Clone, Default)]
pub struct CancelFlag(Arc<AtomicBool>);

impl CancelFlag {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Tiến trình upload — M5 (SPIKE-10) yêu cầu báo tiến trình ≤ 2s/lần cập nhật.
#[derive(Debug, Clone, Copy)]
pub struct UploadProgress {
    pub bytes_sent: u64,
    pub total_bytes: u64,
}

/// Callback tiến trình — `Send` vì có thể gọi từ task nền khác thread UI.
pub type ProgressSink<'a> = &'a (dyn Fn(UploadProgress) + Send + Sync);

/// Lỗi phân biệt được — "thư viện trả lỗi phân biệt được + đọc ra số giây"
/// (FLOOD_WAIT) và "ghi rõ ngưỡng thật gặp phải" (FileTooLarge), đúng tiêu chí
/// M6/M7 đã đo ở SPIKE-10. KHÔNG có biến thể tự động đổi DC để né FloodWait
/// (CLAUDE.md: tôn trọng FLOOD_WAIT tuyệt đối) — bên gọi phải tự chờ đúng
/// `seconds` rồi thử lại nếu muốn.
#[derive(Debug, Error)]
pub enum IngestRpcError {
    #[error("FLOOD_WAIT {seconds}s")]
    FloodWait { seconds: u64 },

    #[error("file vượt trần {max_bytes} byte (đo được {actual_bytes} byte)")]
    FileTooLarge { max_bytes: u64, actual_bytes: u64 },

    #[error("chưa đăng nhập — cần đăng nhập trước khi gọi RPC")]
    NotAuthorized,

    #[error("thao tác bị huỷ giữa chừng")]
    Cancelled,

    #[error("lỗi MTProto: {0}")]
    Other(String),
}

/// Kênh media đã resolve — khớp `ResolvedIndexChannel` (gateway-index.ts).
/// `access_hash` là chuỗi thập phân (đủ lớn cho `i64`/`u64` tuỳ thư viện bên
/// dưới) — CLAUDE.md bất biến #10: KHÔNG được coi id/access_hash này là định
/// danh chia sẻ được cho tài khoản khác.
#[derive(Debug, Clone)]
pub struct ResolvedChannel {
    pub id: String,
    pub access_hash: String,
    pub title: String,
    /// `creator == true` phía Telegram — đứng vai "quyền ghi" trong bảng 7
    /// thao tác dưới đây; không có RPC riêng nào tách biệt "kiểm tra quyền
    /// ghi" khỏi việc resolve, giống hệt bản TypeScript (ADR-0010 §3: kênh
    /// private của user tin toàn bộ). `check_write_permission()` tồn tại như
    /// một bước riêng để implementation có chỗ làm thêm kiểm tra thật (vd
    /// `channels.GetParticipant` cho quyền admin của một tài khoản KHÔNG phải
    /// chủ kênh) nếu use-case sau này cần, không bắt buộc gọi RPC mới nếu
    /// `is_own` đã đủ trả lời.
    pub is_own: bool,
}

/// Document đang ghim = catalog hiện hành — khớp `PinnedCatalogDocument`.
#[derive(Debug, Clone)]
pub struct PinnedCatalog {
    pub msg_id: i64,
    pub publisher_id: String,
    pub raw: String,
}

/// Khớp `VideoUploadInput` (gateway-ingest.ts) — `width`/`height`/
/// `duration_sec` dùng để dựng `DocumentAttributeVideo(supportsStreaming:
/// true)`, điều kiện bắt buộc cho playback qua HTTP Range (ADR-0005).
#[derive(Debug, Clone)]
pub struct VideoUploadInput {
    pub file_path: PathBuf,
    pub file_name: String,
    pub mime_type: Option<String>,
    pub width: u32,
    pub height: u32,
    pub duration_sec: u32,
    pub thumbnail_path: Option<PathBuf>,
    pub caption: Option<String>,
}

/// Khớp `SubtitleUploadInput`.
#[derive(Debug, Clone)]
pub struct SubtitleUploadInput {
    pub file_path: PathBuf,
    pub file_name: String,
}

/// Khớp `UploadedVideoRef`/kết quả `publishCatalogDocument`.
#[derive(Debug, Clone, Copy)]
pub struct UploadedRef {
    pub msg_id: i64,
}

/// Mười hai thao tác RPC mà implementation MTProto phải đáp ứng — bọc cổng
/// theo đúng nguyên tắc `TelegramGateway` của ADR-0003: đổi thư viện MTProto
/// sau này (nếu cần) là đổi implementation của trait này, không lan ra toàn
/// bộ app (điều kiện bắt buộc #2, ADR-0017). Bảy thao tác đầu khớp 1-1 với
/// bản TypeScript đã verify (`gateway-index.ts`/`gateway-ingest.ts`, xem doc
/// comment gốc của module này) — `list_own_channels`/`create_channel`
/// (2026-09-11), `sign_out` (2026-09-14), và `check_deleted_messages`/
/// `delete_message` (2026-09-15, Trình quản lý catalog) là NGOẠI LỆ có chủ
/// đích: năm thao tác desktop-only, không có tương ứng 1-1 phía TS.
/// `sign_out` khác về bản chất so với hai cái đầu (những cái đó là "kênh",
/// cái này là "tài khoản") — `apps/web` có đăng xuất riêng
/// (`logout-confirm-sheet.ts`) nhưng đó là một luồng client-heavy phức tạp
/// hơn hẳn (flush outbox, xoá IndexedDB) vì còn state đồng bộ cục bộ để dọn;
/// ingest desktop không có state đó, chỉ cần gọi `auth.LogOut` rồi xoá
/// `session.sqlite3` — xem [ADR-0017 § addendum
/// 2026-09-14](../../../docs/adr/0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-09-14-thêm-sign_out-vào-ingestrpc).
/// `check_deleted_messages`/`delete_message` phục vụ đối soát/dọn catalog ở
/// Trình quản lý catalog — xem [ADR-0017 § addendum
/// 2026-09-15](../../../docs/adr/0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-09-15-trình-quản-lý-catalog-ingestrpc-thêm-2-thao-tác).
#[async_trait]
pub trait IngestRpc: Send + Sync {
    /// 1. Resolve username/invite-link/id nội bộ thành channel + access_hash
    /// thật của TÀI KHOẢN ĐANG ĐĂNG NHẬP (CLAUDE.md bất biến #10).
    async fn resolve_channel(&self, channel_ref: &str) -> Result<ResolvedChannel, IngestRpcError>;

    /// 1b. Liệt kê channel/broadcast mà TÀI KHOẢN ĐANG ĐĂNG NHẬP là creator —
    /// nguồn cho picker ở màn "Chọn kênh", thay cho việc bắt user tự gõ/nhớ
    /// username. KHÔNG liệt kê kênh cộng đồng đã join nhưng không sở hữu —
    /// CLAUDE.md bất biến #5 (không bao giờ ghi vào kênh người khác) nghĩa
    /// là không có lý do hiện những kênh đó ra để chọn nhầm.
    async fn list_own_channels(&self) -> Result<Vec<ResolvedChannel>, IngestRpcError>;

    /// 1c. Tạo một channel/broadcast MỚI (`broadcast: true`, `megagroup:
    /// false` — đúng loại kênh media hiện có theo ADR-0013, khác kênh state
    /// riêng tư của ADR-0014 dù dùng chung RPC `channels.CreateChannel`),
    /// trả về đã resolve sẵn — sẵn sàng dùng ngay cho các thao tác tiếp theo.
    async fn create_channel(&self, title: &str) -> Result<ResolvedChannel, IngestRpcError>;

    /// 2. Kiểm tra quyền ghi vào kênh — mặc định chỉ cần đọc `is_own` đã có
    /// từ bước resolve (xem doc comment ở `ResolvedChannel::is_own`).
    async fn check_write_permission(&self, channel: &ResolvedChannel) -> Result<bool, IngestRpcError>;

    /// 3. Đọc document đang ghim, nếu đúng là catalog (tên file khớp
    /// `catalog.v1*.json`) — trả `None` nếu không có gì ghim hoặc ghim thứ
    /// khác không phải catalog.
    async fn read_pinned_catalog(&self, channel: &ResolvedChannel) -> Result<Option<PinnedCatalog>, IngestRpcError>;

    /// 4. Tải nguyên byte của một document theo `msg_id` — dùng khi cần đọc
    /// lại chính xác những gì vừa publish (đối soát catalog ↔ kênh).
    async fn download_document(&self, channel: &ResolvedChannel, msg_id: i64) -> Result<Vec<u8>, IngestRpcError>;

    /// 5. Upload video kèm `DocumentAttributeVideo`/thumbnail — đây là thao
    /// tác duy nhất cần `progress`/`cancel`, vì là thao tác duy nhất đủ
    /// lớn/đủ lâu để RAM phồng hoặc cần huỷ giữa chừng.
    async fn upload_video(
        &self,
        channel: &ResolvedChannel,
        input: VideoUploadInput,
        progress: ProgressSink<'_>,
        cancel: &CancelFlag,
    ) -> Result<UploadedRef, IngestRpcError>;

    /// 6. Upload phụ đề (`forceDocument: true`, không streaming attrs).
    async fn upload_subtitle(&self, channel: &ResolvedChannel, input: SubtitleUploadInput) -> Result<UploadedRef, IngestRpcError>;

    /// 7. `sendFile → pinMessage → deleteMessages(previous)` — ghim TRƯỚC,
    /// xoá bản cũ SAU (không để kênh thiếu catalog dù chỉ một khoảnh khắc).
    async fn publish_catalog(
        &self,
        channel: &ResolvedChannel,
        json_bytes: &[u8],
        previous_msg_id: Option<i64>,
    ) -> Result<UploadedRef, IngestRpcError>;

    /// 8. Đăng xuất — gọi `auth.LogOut` PHÍA SERVER TRƯỚC (thu hồi session
    /// khỏi danh sách thiết bị Telegram thật). Bên gọi (`src-tauri/src/
    /// commands.rs::sign_out()`) chỉ được xoá `session.sqlite3` cục bộ SAU
    /// KHI method này trả `Ok` — xoá cục bộ trước mà lỡ lỗi ở bước server sẽ
    /// để lại một session còn SỐNG mà app không còn cách nào thu hồi nữa
    /// (cùng thứ tự đã verify đúng ở `apps/web`, xem ADR-0011).
    async fn sign_out(&self) -> Result<(), IngestRpcError>;

    /// 9. Đối soát "Trình quản lý catalog" (A.4, ADR-0017 § addendum
    /// "Trình quản lý catalog") — kiểm tra tập `msg_id` mà catalog.json đang
    /// tham chiếu còn tồn tại trên kênh không (vd bị xoá tay bằng app
    /// Telegram gốc). Trả đúng tập con KHÔNG còn tồn tại — rỗng nếu catalog
    /// lành mạnh. NGOẠI LỆ thứ tư không tương ứng 1-1 phía TS:
    /// `gateway-index.ts` không có nhu cầu này (web app không có màn quản lý
    /// catalog tương đương).
    async fn check_deleted_messages(&self, channel: &ResolvedChannel, msg_ids: &[i64]) -> Result<Vec<i64>, IngestRpcError>;

    /// 10. Xoá HẲN một message khỏi kênh (`deleteMessages`) — dùng khi user
    /// chọn "Xoá khỏi catalog + xoá message trên kênh" ở Trình quản lý
    /// catalog. NGOẠI LỆ thứ năm không tương ứng 1-1 phía TS:
    /// `gateway-index.ts` chỉ gọi `deleteMessages()` NỘI BỘ trong
    /// `publishCatalogDocument()` (dọn catalog cũ), không lộ ra thành một
    /// RPC độc lập — nhu cầu "xoá một message bất kỳ theo yêu cầu admin"
    /// chỉ tồn tại ở công cụ desktop.
    async fn delete_message(&self, channel: &ResolvedChannel, msg_id: i64) -> Result<(), IngestRpcError>;
}
