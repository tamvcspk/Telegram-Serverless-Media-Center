//! Trait `IngestRpc` — hợp đồng RPC dùng chung cho r3-grammers/r4-ferogram
//! (SPIKE-10, xem docs/spikes/README.md#spike-10 bảng "Tech stack": "Ranh
//! giới RPC ... bắt buộc áp dụng cho cả 4 nhánh, để lựa chọn thư viện sau
//! này đổi được trong một file").
//!
//! Bảy thao tác này khớp 1-1 với `libs/core-mtproto/src/gateway-index.ts` +
//! `gateway-ingest.ts` (bản TypeScript đã verify thật ở ADR-0013) — R3/R4
//! KHÔNG được phát minh lại tập hợp thao tác, chỉ đổi thư viện MTProto bên
//! dưới. Crate này KHÔNG chứa luật nghiệp vụ (bảng phân hạng A/B/C/D,
//! inheritMetadata, catalog merge) — luật đó ở lại `libs/core-ingest`
//! (TypeScript), một nguồn sự thật duy nhất bất kể nhánh runtime nào thắng.

use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use thiserror::Error;

/// Cờ huỷ chia sẻ được giữa task gọi upload và UI (M5: "bấm huỷ thì lưu
/// lượng mạng về 0 trong ≤ 3s"). Không dùng `tokio_util::CancellationToken`
/// để tránh thêm dependency cho một crate chỉ tồn tại trong lúc spike.
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

/// Tiến trình upload — M5 yêu cầu báo tiến trình ≤ 2s/lần cập nhật.
#[derive(Debug, Clone, Copy)]
pub struct UploadProgress {
    pub bytes_sent: u64,
    pub total_bytes: u64,
}

/// Callback tiến trình — `Send` vì có thể gọi từ task nền khác thread UI.
pub type ProgressSink<'a> = &'a (dyn Fn(UploadProgress) + Send + Sync);

/// Lỗi phân biệt được theo đúng tinh thần tiêu chí M6/M7 — "thư viện trả
/// lỗi phân biệt được + đọc ra số giây" (FLOOD_WAIT) và "ghi rõ ngưỡng thật
/// gặp phải" (FileTooLarge). KHÔNG có biến thể tự động đổi DC để né
/// FloodWait (CLAUDE.md: tôn trọng FLOOD_WAIT tuyệt đối) — bên gọi phải tự
/// chờ đúng `seconds` rồi thử lại nếu muốn.
#[derive(Debug, Error)]
pub enum IngestRpcError {
    #[error("FLOOD_WAIT {seconds}s")]
    FloodWait { seconds: u64 },

    #[error("file vượt trần {max_bytes} byte (đo được {actual_bytes} byte)")]
    FileTooLarge { max_bytes: u64, actual_bytes: u64 },

    #[error("chưa đăng nhập — cần login() trước khi gọi RPC")]
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
    /// thao tác của spike; không có RPC riêng nào tách biệt "kiểm tra quyền
    /// ghi" khỏi việc resolve, giống hệt bản TypeScript (ADR-0010 §3: kênh
    /// private của user tin toàn bộ). `check_write_permission()` dưới đây
    /// tồn tại như một bước riêng để R3/R4 có chỗ làm thêm kiểm tra thật
    /// (vd `channels.GetParticipant` cho quyền admin của một tài khoản
    /// KHÔNG phải chủ kênh) nếu use-case sau này cần, không bắt buộc gọi
    /// RPC mới nếu `is_own` đã đủ trả lời.
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

/// Bảy thao tác RPC mà cả bốn nhánh runtime (R1-R4) phải đáp ứng — R1/R2
/// hiện thực bằng TypeScript (không implement trait Rust này, vì R1 chạy
/// GramJS trong webview và R2 tái dùng thẳng `apps/tsmc-ingest`), R3/R4
/// BẮT BUỘC dùng chung trait này để phép so sánh "đổi thư viện = đổi một
/// file" có giá trị (xem docs/spikes/README.md#spike-10 mục "Bàn thử
/// nghiệm": "R3 và R4 bắt buộc dùng chung một trait — nếu không, phép so
/// sánh mất giá trị").
#[async_trait]
pub trait IngestRpc: Send + Sync {
    /// 1. Resolve username/invite-link/id nội bộ thành channel + access_hash
    /// thật của TÀI KHOẢN ĐANG ĐĂNG NHẬP (CLAUDE.md bất biến #10).
    async fn resolve_channel(&self, channel_ref: &str) -> Result<ResolvedChannel, IngestRpcError>;

    /// 2. Kiểm tra quyền ghi vào kênh — mặc định chỉ cần đọc `is_own` đã có
    /// từ bước resolve (xem doc comment ở `ResolvedChannel::is_own`).
    async fn check_write_permission(&self, channel: &ResolvedChannel) -> Result<bool, IngestRpcError>;

    /// 3. Đọc document đang ghim, nếu đúng là catalog (tên file khớp
    /// `catalog.v1*.json`) — trả `None` nếu không có gì ghim hoặc ghim thứ
    /// khác không phải catalog.
    async fn read_pinned_catalog(&self, channel: &ResolvedChannel) -> Result<Option<PinnedCatalog>, IngestRpcError>;

    /// 4. Tải nguyên byte của một document theo `msg_id` — dùng khi cần đọc
    /// lại chính xác những gì vừa publish (M8: "đọc lại byte-chính-xác").
    async fn download_document(&self, channel: &ResolvedChannel, msg_id: i64) -> Result<Vec<u8>, IngestRpcError>;

    /// 5. Upload video kèm `DocumentAttributeVideo`/thumbnail — đây là thao
    /// tác duy nhất cần `progress`/`cancel` (M3/M5), vì là thao tác duy nhất
    /// đủ lớn/đủ lâu để RAM phồng hoặc cần huỷ giữa chừng.
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
}
