//! Adapter probe file bằng `ffmpeg-next` (native FFI, SPIKE-09/ADR-0013 §
//! addendum 2026-09-03) — vai trò giống hệt `apps/tsmc-ingest/src/ffprobe.ts`
//! (đọc file, chuẩn hoá thành `ProbeResult`), nhưng chạy trong tiến trình
//! Rust của Tauri thay vì shell-out binary `ffprobe` — mockup A.5
//! (docs/ux-design.md § Phụ lục A): "Không có bước cài ffmpeg" cho GUI này,
//! khác `tsmc-ingest` CLI vốn bắt admin tự cài `ffmpeg`/`ffprobe` lên PATH.
//!
//! Crate này CHỈ đọc metadata (container/codec/duration) — không
//! remux/encode/decode frame nào, để dành khi wire upload thật (roadmap "GUI
//! ingest desktop"). Không chứa luật phân hạng A/B/C/D:
//! `classifyCompatRank()` (TypeScript, `libs/core-ingest`) vẫn là nguồn sự
//! thật duy nhất bất kể adapter probe nào đứng trước nó (điều kiện bắt buộc
//! #4, ADR-0017) — phía Angular gọi lại hàm đó sau khi nhận `ProbeResult` này
//! qua IPC (`src-tauri/src/dto.rs` chuyển đổi sang DTO serde).
//!
//! Rủi ro đã ghi nhận ở ADR-0013 § addendum 2026-09-03 ("native FFI không có
//! ranh giới tiến trình bảo vệ khi tham số sai, khác shell-out CLI — một bug
//! có thể segfault thẳng tiến trình") áp dụng cho encode (đã xác nhận thật ở
//! addendum đó). `probe()` ở đây chỉ mở demuxer + đọc `AVCodecParameters` +
//! mở decoder video để đọc kích thước khung hình — không gọi
//! `avcodec_send_frame`/`avcodec_send_packet` nào, nên không chạm đúng đường
//! code đã gây segfault, nhưng input vẫn là file trên đĩa của admin — coi là
//! không tin tưởng như mọi input khác (lỗi trả `Result`, không `unwrap()`).

mod reencode;
mod remux;
mod subtitles;
mod thumbnail;

pub use reencode::reencode_to_mp4;
pub use remux::remux;
pub use subtitles::extract_subtitles;
pub use thumbnail::extract_thumbnail;

use std::sync::Once;

use ffmpeg_next::{self as ffmpeg, media::Type as MediaType};
use thiserror::Error;

static FFMPEG_INIT: Once = Once::new();

pub(crate) fn ensure_init() {
    FFMPEG_INIT.call_once(|| {
        ffmpeg::init().expect("ffmpeg::init");
        ffmpeg::log::set_level(ffmpeg::log::Level::Warning);
    });
}

#[derive(Debug, Error)]
pub enum ProbeError {
    #[error("ffmpeg lỗi: {0}")]
    Ffmpeg(#[from] ffmpeg::Error),
}

/// Khớp `Container` của `libs/core-ingest/src/compat-rank.ts` — năm biến thể
/// đúng bằng đó, KHÔNG thêm biến thể nào ngoài tập đó (mở rộng tập này là sửa
/// luật phân hạng, việc của ADR-0013, không phải của adapter probe).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Container {
    Mp4,
    Matroska,
    Mpegts,
    Avi,
    Other,
}

#[derive(Debug, Clone)]
pub struct ProbeVideoStream {
    pub codec: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone)]
pub struct ProbeAudioStream {
    pub codec: String,
    pub lang: Option<String>,
    pub index: i64,
}

#[derive(Debug, Clone)]
pub struct ProbeSubtitleStream {
    pub codec: String,
    pub lang: Option<String>,
    pub index: i64,
}

#[derive(Debug, Clone)]
pub struct ProbeResult {
    pub container: Container,
    pub duration_sec: f64,
    pub video: Option<ProbeVideoStream>,
    pub audio: Vec<ProbeAudioStream>,
    pub subtitles: Vec<ProbeSubtitleStream>,
}

/// Mirror `normalizeContainer()` của `apps/tsmc-ingest/src/ffprobe.ts` — PHẢI
/// khớp cùng luật phân loại vì cùng đổ vào `classifyCompatRank()` phía TS.
/// Nguồn chuỗi khác nhau (ffprobe đọc JSON `format.format_name`, đây đọc
/// `AVInputFormat.name` qua `format::Input::name()`) nhưng cả hai cùng trỏ
/// thẳng field C `iformat->name` — chuỗi thật giống hệt nhau (vd
/// "mov,mp4,m4a,3gp,3g2,mj2" cho MP4, "matroska,webm" cho MKV).
fn normalize_container(format_name: &str) -> Container {
    let name = format_name.to_lowercase();
    if name.contains("mp4") || name.contains("mov") || name.contains("m4a") || name.contains("3gp") || name.contains("3g2") || name.contains("mj2") {
        Container::Mp4
    } else if name.contains("matroska") || name.contains("webm") {
        Container::Matroska
    } else if name.contains("mpegts") {
        Container::Mpegts
    } else if name.contains("avi") {
        Container::Avi
    } else {
        Container::Other
    }
}

pub fn probe(path: &str) -> Result<ProbeResult, ProbeError> {
    ensure_init();
    let ictx = ffmpeg::format::input(path)?;

    let container = normalize_container(ictx.format().name());
    let duration_sec = if ictx.duration() > 0 {
        ictx.duration() as f64 / f64::from(ffmpeg::ffi::AV_TIME_BASE)
    } else {
        0.0
    };

    let mut video = None;
    let mut audio = Vec::new();
    let mut subtitles = Vec::new();

    for stream in ictx.streams() {
        let params = stream.parameters();
        let lang = stream.metadata().get("language").map(|s| s.to_string());
        let index = stream.index() as i64;

        match params.medium() {
            MediaType::Video if video.is_none() => {
                let codec_name = params.id().name().to_string();
                // Kích thước khung hình không nằm trong getter an toàn của
                // `codec::Parameters` (chỉ có `medium()`/`id()`) — phải mở
                // decoder để đọc, đúng cách `tools/spike-09/src/main.rs::
                // extract_thumbnail()` đã làm. Mở decoder KHÔNG gọi
                // `avcodec_send_*` (chỉ đọc field đã parse sẵn từ
                // `avcodec_open2`), không chạm đường code đã segfault ở
                // addendum 2026-09-03 (đường đó ở bước encode audio AAC).
                let dimensions = ffmpeg::codec::context::Context::from_parameters(params)
                    .and_then(|ctx| ctx.decoder().video())
                    .map(|dec| (dec.width(), dec.height()))
                    .unwrap_or((0, 0));
                video = Some(ProbeVideoStream { codec: codec_name, width: dimensions.0, height: dimensions.1 });
            }
            MediaType::Audio => {
                audio.push(ProbeAudioStream { codec: params.id().name().to_string(), lang, index });
            }
            MediaType::Subtitle => {
                subtitles.push(ProbeSubtitleStream { codec: params.id().name().to_string(), lang, index });
            }
            _ => {}
        }
    }

    Ok(ProbeResult { container, duration_sec, video, audio, subtitles })
}
