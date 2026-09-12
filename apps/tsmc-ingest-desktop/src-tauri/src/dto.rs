//! Kiểu dữ liệu serde cho ranh giới IPC (Tauri command ↔ webview). Cố ý tách
//! khỏi `ingest-rpc-trait` — trait đó giữ "opinion-free" (không phụ thuộc
//! `serde`) vì nó là hợp đồng dùng chung, có thể còn tiêu thụ bởi một
//! implementation MTProto khác sau này (ADR-0017 điều kiện bắt buộc #2).

use ingest_ffmpeg::{Container, ProbeAudioStream, ProbeResult, ProbeSubtitleStream, ProbeVideoStream};
use ingest_rpc_trait::{IngestRpcError, PinnedCatalog, ResolvedChannel, UploadProgress, UploadedRef};
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

/// Khớp `Container` của `ingest-ffmpeg` — `rename_all = "lowercase"` cho ra
/// ĐÚNG bốn chuỗi mà `Container` (`libs/core-ingest/src/compat-rank.ts`)
/// định nghĩa ("mp4"/"matroska"/"mpegts"/"avi"/"other"), để phía Angular gán
/// thẳng field này vào `ProbeResult` của core-ingest mà không cần map chuỗi.
#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ContainerDto {
    Mp4,
    Matroska,
    Mpegts,
    Avi,
    Other,
}

impl From<Container> for ContainerDto {
    fn from(c: Container) -> Self {
        match c {
            Container::Mp4 => Self::Mp4,
            Container::Matroska => Self::Matroska,
            Container::Mpegts => Self::Mpegts,
            Container::Avi => Self::Avi,
            Container::Other => Self::Other,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ProbeVideoStreamDto {
    pub codec: String,
    pub width: u32,
    pub height: u32,
}

impl From<ProbeVideoStream> for ProbeVideoStreamDto {
    fn from(v: ProbeVideoStream) -> Self {
        Self { codec: v.codec, width: v.width, height: v.height }
    }
}

#[derive(Debug, Serialize)]
pub struct ProbeAudioStreamDto {
    pub codec: String,
    pub lang: Option<String>,
    pub index: i64,
}

impl From<ProbeAudioStream> for ProbeAudioStreamDto {
    fn from(a: ProbeAudioStream) -> Self {
        Self { codec: a.codec, lang: a.lang, index: a.index }
    }
}

#[derive(Debug, Serialize)]
pub struct ProbeSubtitleStreamDto {
    pub codec: String,
    pub lang: Option<String>,
    pub index: i64,
}

impl From<ProbeSubtitleStream> for ProbeSubtitleStreamDto {
    fn from(s: ProbeSubtitleStream) -> Self {
        Self { codec: s.codec, lang: s.lang, index: s.index }
    }
}

/// Khớp NGUYÊN VẸN field-cho-field `ProbeResult` của
/// `libs/core-ingest/src/compat-rank.ts` NGOẠI TRỪ tên field
/// `duration_sec` (giữ snake_case đúng quy ước DTO ở file này — dto.rs không
/// `rename_all = "camelCase"`, xem đầu file) — phía Angular tự map sang
/// `durationSec` bằng một hàm chuyển đổi một dòng trước khi gọi
/// `classifyCompatRank()`, không đổi quy ước DTO chỉ vì một field.
#[derive(Debug, Serialize)]
pub struct ProbeResultDto {
    pub container: ContainerDto,
    pub duration_sec: f64,
    pub video: Option<ProbeVideoStreamDto>,
    pub audio: Vec<ProbeAudioStreamDto>,
    pub subtitles: Vec<ProbeSubtitleStreamDto>,
}

impl From<ProbeResult> for ProbeResultDto {
    fn from(p: ProbeResult) -> Self {
        Self {
            container: p.container.into(),
            duration_sec: p.duration_sec,
            video: p.video.map(ProbeVideoStreamDto::from),
            audio: p.audio.into_iter().map(ProbeAudioStreamDto::from).collect(),
            subtitles: p.subtitles.into_iter().map(ProbeSubtitleStreamDto::from).collect(),
        }
    }
}

/// Khớp `UploadedRef` — kết quả một lần `sendFile` (video/subtitle/catalog),
/// `msg_id` là message ID thật Telegram vừa cấp.
#[derive(Debug, Serialize)]
pub struct UploadedRefDto {
    pub msg_id: i64,
}

impl From<UploadedRef> for UploadedRefDto {
    fn from(r: UploadedRef) -> Self {
        Self { msg_id: r.msg_id }
    }
}

/// Sự kiện tiến trình upload video — bắn qua `app.emit("upload-progress", ..)`
/// (không phải giá trị trả về của `invoke()`, vì một lần upload có NHIỀU lần
/// cập nhật). `path` là khoá tương quan (CLAUDE.md: "mọi message xuyên luồng
/// phải có correlation id") — UI chỉ áp dụng update cho đúng dòng đang
/// upload, phòng trường hợp một event trễ tới sau khi item đã chuyển dòng
/// khác (dù pipeline hiện tại chạy tuần tự, không có hai upload chồng nhau).
#[derive(Debug, Clone, Serialize)]
pub struct UploadProgressDto {
    pub path: String,
    pub bytes_sent: u64,
    pub total_bytes: u64,
}

impl UploadProgressDto {
    pub fn new(path: String, p: UploadProgress) -> Self {
        Self { path, bytes_sent: p.bytes_sent, total_bytes: p.total_bytes }
    }
}

/// Cách xử lý video ở bước đầu `prepare_upload` — do TẦNG GỌI quyết định dựa
/// trên hạng đã `classifyCompatRank()` (ADR-0017 điều kiện bắt buộc #4,
/// crate/command này không tự quyết): `Copy` (Hạng A/B, `remux()` stream-copy
/// cả hai track) — `ReencodeAudio` (Hạng C, `remux()` copy video/encode AAC)
/// — `ReencodeAll` (Hạng D, `reencode_to_mp4()` — ĐẮT, decode+encode CẢ
/// video, tầng gọi phải hỏi xác nhận TRƯỚC khi gửi mode này, mockup A.2 mục 1).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemuxModeDto {
    Copy,
    ReencodeAudio,
    ReencodeAll
}

/// Track phụ đề TEXT cần rút — Angular tự lọc bỏ track dạng ẢNH (PGS/DVD
/// subtitle, xem `apps/tsmc-ingest/src/ffmpeg.ts::IMAGE_SUBTITLE_CODECS`,
/// lặp lại có chủ đích ở `workspace.ts`) trước khi gửi mảng này —
/// `prepare_upload` không tự quyết codec nào là "ảnh" (ADR-0017 điều kiện
/// bắt buộc #4).
#[derive(Debug, Clone, Deserialize)]
pub struct SubtitleTrackDto {
    pub index: i64,
    pub lang: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PreparedSubtitleDto {
    pub lang: Option<String>,
    pub path: String,
}

/// Kết quả `prepare_upload` — remux/thumbnail/rút phụ đề CỤC BỘ xong, sẵn
/// sàng cho `upload_video()`/`upload_subtitle()`. `final_probe` là probe LẠI
/// file ĐÃ remux (không phải file gốc) — Angular tự `deriveCompat()` từ đây
/// để biết nhãn `compat` thật ghi vào catalog (ADR-0017 điều kiện bắt buộc
/// #4: crate/command không tự quyết compat).
#[derive(Debug, Serialize)]
pub struct PreparedUploadDto {
    pub temp_dir: String,
    pub remuxed_path: String,
    pub thumbnail_path: String,
    pub subtitles: Vec<PreparedSubtitleDto>,
    pub final_probe: ProbeResultDto,
}

/// Sự kiện đổi stage của `prepare_upload` — bắn qua `app.emit("pipeline-stage",
/// ..)`, khớp mockup A.2 mục 4 ("Tiến trình phải nói đang ở stage nào").
#[derive(Debug, Clone, Serialize)]
pub struct PipelineStageDto {
    pub path: String,
    pub stage: String,
}
