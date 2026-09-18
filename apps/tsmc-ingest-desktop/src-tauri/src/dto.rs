//! Kiểu dữ liệu serde cho ranh giới IPC (Tauri command ↔ webview). Cố ý tách
//! khỏi `ingest-rpc-trait` — trait đó giữ "opinion-free" (không phụ thuộc
//! `serde`) vì nó là hợp đồng dùng chung, có thể còn tiêu thụ bởi một
//! implementation MTProto khác sau này (ADR-0017 điều kiện bắt buộc #2).

use ingest_ffmpeg::{Container, ProbeAudioStream, ProbeResult, ProbeSubtitleStream, ProbeVideoStream};
use ingest_rpc_trait::{ChannelVideoDocument, IngestRpcError, PinnedCatalog, ResolvedChannel, UploadProgress, UploadedRef};
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

/// Khớp `ChannelVideoDocument` — một video document tìm thấy khi quét TOÀN
/// BỘ lịch sử kênh (`scan_channel_videos`, đối soát chiều ngược lại ở Trình
/// quản lý catalog). Chưa so với catalog — phía Angular tự tính hiệu tập
/// hợp với `msgId` đang có trong `items()`.
#[derive(Debug, Serialize)]
pub struct ChannelVideoDocumentDto {
    pub msg_id: i64,
    pub file_name: Option<String>,
    pub size: u64,
    pub mime_type: Option<String>,
    pub duration_sec: Option<f64>,
}

impl From<ChannelVideoDocument> for ChannelVideoDocumentDto {
    fn from(d: ChannelVideoDocument) -> Self {
        Self { msg_id: d.msg_id, file_name: d.file_name, size: d.size, mime_type: d.mime_type, duration_sec: d.duration_sec }
    }
}

/// Sự kiện tiến trình upload video — bắn qua `app.emit("upload-progress", ..)`
/// (không phải giá trị trả về của `invoke()`, vì một lần upload có NHIỀU lần
/// cập nhật). `task_id` (UUID sinh phía Angular lúc đẩy item vào hàng đợi) là
/// khoá tương quan (ADR-0018) — trước đây dùng `path`, nhưng path đổi tên/đổi
/// đuôi qua từng bước pipeline (remux → thumbnail → ...) nên không ổn định
/// (bug thật: event mang path file tạm sau remux, UI so khớp bằng path file
/// gốc, không bao giờ khớp). `path` vẫn giữ lại CHỈ để hiển thị/log, KHÔNG
/// còn là khoá so khớp.
#[derive(Debug, Clone, Serialize)]
pub struct UploadProgressDto {
    pub task_id: String,
    pub path: String,
    pub bytes_sent: u64,
    pub total_bytes: u64,
}

impl UploadProgressDto {
    pub fn new(task_id: String, path: String, p: UploadProgress) -> Self {
        Self { task_id, path, bytes_sent: p.bytes_sent, total_bytes: p.total_bytes }
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
/// #4: crate/command không tự quyết compat). `file_size_bytes` (thêm
/// 2026-09-19, chuẩn hoá size) là dung lượng THẬT của `remuxed_path` trên
/// đĩa — Angular tự so với `get_max_upload_bytes()` TRƯỚC khi gọi
/// `upload_video()`, không tự quyết trần ở tầng Rust (ADR-0017 điều kiện bắt
/// buộc #4, cùng nguyên tắc `compat`).
#[derive(Debug, Serialize)]
pub struct PreparedUploadDto {
    pub temp_dir: String,
    pub remuxed_path: String,
    pub thumbnail_path: String,
    pub subtitles: Vec<PreparedSubtitleDto>,
    pub final_probe: ProbeResultDto,
    pub file_size_bytes: u64,
}

/// Snapshot của task upload/pipeline ĐANG chạy — dùng để hydrate lại UI khi
/// `WorkspaceComponent` remount trong cùng phiên Tauri còn sống (ADR-0018
/// mục 5, đọc bằng `get_current_task()`). CHỈ MỘT slot (khớp mô hình tuần
/// tự thật — `AppState.active_cancel` cũng chỉ có một, xem `state.rs`),
/// KHÔNG phải danh sách nhiều task. `bytes_sent`/`total_bytes` `None` ở mọi
/// stage KHÔNG phải `uploading_video` (không có số byte thật để hiện).
#[derive(Debug, Clone, Serialize)]
pub struct CurrentTaskDto {
    pub task_id: String,
    pub path: String,
    pub stage: String,
    pub bytes_sent: Option<u64>,
    pub total_bytes: Option<u64>,
}

/// Sự kiện đổi stage của `prepare_upload` — bắn qua `app.emit("pipeline-stage",
/// ..)`, khớp mockup A.2 mục 4 ("Tiến trình phải nói đang ở stage nào").
/// `task_id` là khoá tương quan (ADR-0018, cùng quy ước với `UploadProgressDto`
/// — xem doc comment ở đó); `path` chỉ còn để hiển thị/log.
#[derive(Debug, Clone, Serialize)]
pub struct PipelineStageDto {
    pub task_id: String,
    pub path: String,
    pub stage: String,
}

/// Tra cứu TMDB (ADR-0019) — `kind` do tầng gọi (Angular) quyết dựa trên
/// `item.metadata.kind` ('episode' → `search/tv`, còn lại → `search/movie'),
/// `tmdb.rs` không tự suy luận. Khớp union `'movie' | 'episode'` phía TS.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TmdbKindDto {
    Movie,
    Episode,
}

/// Lỗi tra cứu TMDB — TÁCH RIÊNG khỏi `IngestRpcErrorDto` vì đây không phải
/// lỗi RPC MTProto (không có `FloodWait`/`NotAuthorized` kiểu Telegram).
/// `NoApiKey` để Angular tự mở dialog nhập key thay vì hiện lỗi mạng mơ hồ.
/// `InvalidKey` (HTTP 401 từ TMDB — key SAI, khác `NoApiKey` là CHƯA CÓ key
/// nào) tách riêng khỏi `Network` từ 2026-09-14: trước đó cả hai gộp chung
/// qua `error_for_status()`, user không phân biệt được "gõ sai key" với
/// "mất mạng"/TMDB sập.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum TmdbErrorDto {
    NoApiKey,
    InvalidKey,
    Network(String),
    Other(String),
}

/// Một kết quả tìm kiếm TMDB đã chuẩn hoá — `tmdb.rs` gộp field khác nhau
/// của `search/movie` (`title`/`release_date`) và `search/tv`
/// (`name`/`first_air_date`) về CÙNG một shape cho Angular, không phân biệt
/// movie/tv nữa ở tầng UI. `poster_url` đã ghép sẵn base URL ảnh TMDB THU NHỎ
/// (`w92`) — Angular chỉ cần gán thẳng vào `<img src>` cho dialog tìm kiếm.
/// `poster_path` là đường dẫn THÔ (`/xxxx.jpg`) — giữ riêng để
/// `upload_tmdb_poster` (`upload.rs`) tự ghép base URL CỠ LỚN (`w500`) khi
/// admin chọn kết quả, không tái dùng `poster_url` cỡ nhỏ cho ảnh poster thật
/// sẽ lưu vào kênh (TMDB nâng cao, 2026-09-17).
#[derive(Debug, Clone, Serialize)]
pub struct TmdbSearchResultDto {
    pub id: i64,
    pub title: String,
    pub year: Option<i32>,
    pub poster_url: Option<String>,
    pub poster_path: Option<String>,
}

/// Metadata nâng cao TMDB (genres/cast/director) — ADR-0019 § addendum
/// 2026-09-17. `cast` đã cắt về top N theo `order` (billing order TMDB trả
/// sẵn, không cần tự sắp lại). `director`: phim lấy từ `credits.crew` (job
/// "Director"); phim bộ dùng `created_by[0]` (TMDB không có "director" một
/// người cho cả series — `created_by` là tương đương gần nhất, lấy người đầu
/// nếu có nhiều hơn một, xem `tmdb.rs::tmdb_details()`).
#[derive(Debug, Clone, Serialize)]
pub struct TmdbDetailsDto {
    pub genres: Vec<String>,
    pub cast: Vec<String>,
    pub director: Option<String>,
}
