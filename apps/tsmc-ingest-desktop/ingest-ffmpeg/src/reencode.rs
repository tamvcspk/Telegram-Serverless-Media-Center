//! Re-encode video THẬT (Hạng D — ADR-0013: container/codec trình duyệt
//! không giải được, remux không đủ) sang H.264/AAC MP4 +faststart. ĐẮT hơn
//! hẳn `remux()` (decode + encode VIDEO, không chỉ audio) — mockup A.2 mục 1
//! bắt buộc hỏi xác nhận TRƯỚC khi gọi hàm này (tầng gọi/Angular lo, không
//! phải ở đây).
//!
//! Khung video: port gần nguyên văn ví dụ CHÍNH THỨC của `ffmpeg-next`
//! (`examples/transcode-x264.rs` trong crate — decode → `send_frame`/
//! `receive_packet`). Khung audio: giữ NGUYÊN cách dựng encoder AAC + filter
//! graph `anull` đã verify thật ở `remux.rs`/SPIKE-09 (không refactor dùng
//! chung để tránh rủi ro đổi hành vi ở một chỗ đã chứng minh chạy đúng — hai
//! file trùng lặp một đoạn ngắn, có chủ đích).
//!
//! **Encoder video là `libx264`, tìm THEO TÊN ([ADR-0023](../../../../docs/adr/0023-libx264-cho-re-encode-hang-d-chap-nhan-gpl-cho-ingest.md)).**
//! Trước 2026-10-10 file này gọi `encoder::find(codec::Id::H264)` — "một
//! encoder H264 nào đó" — và build vcpkg `--disable-libx264` nên thật ra chạy
//! `h264_mf` của Windows, còn option `preset` bị bỏ qua thầm lặng (phát hiện
//! 2026-09-13, ADR-0013 § addendum). Giờ thiếu x264 là LỖI RÕ
//! (`ProcessError::EncoderMissing`), không lặng lẽ lui về `h264_mf`: "tưởng
//! đang chạy x264, thật ra là `h264_mf`" đúng là cái bẫy đã dính một lần.
//! Chọn rate control (CRF + trần VBV hay ABR) là việc của tầng gọi qua
//! `ReencodeOptions` (ADR-0017 điều kiện bắt buộc #4) — file này chỉ thực thi.
//!
//! **Đa luồng phải bật tường minh:** `AVCodecContext.thread_count` mặc định
//! là 1 khi gọi qua API (CLI `ffmpeg` mới tự đặt auto). Đo 2026-10-10 x264
//! `fast` trên nguồn WMV thật: 1 luồng 0.5× thời gian thực, 2 luồng 0.9×, 4
//! luồng 1.6×, 8 luồng 2.0×, tự động 4.0× (ADR-0023 § 4c.1).
//!
//! **Rủi ro đã ghi ở ADR-0013 § addendum 2026-09-03 áp dụng NGUYÊN VẸN ở
//! đây, khác `remux()`/`extract_thumbnail()`/`extract_subtitles()`:** đây là
//! lần ĐẦU TIÊN crate này gọi `avcodec_send_frame()` cho VIDEO (encode thật,
//! không chỉ audio) — segfault đã gặp ở SPIKE-09 nằm ở audio, nhưng cùng
//! LỚP rủi ro (buffer/format mismatch khi encode) có thể lặp lại ở video.
//!
//! **Sửa sau phát hiện thật (2026-09-12, user report "invalid argument" khi
//! re-encode một file Hạng D thật):** bản đầu gán THẲNG
//! `encoder.set_format(decoder.format())`/kích thước gốc — `avcodec_open2`
//! của `libx264` từ chối (a) pixel format decoder trả về nếu KHÁC 4:2:0
//! phẳng chuẩn (vd `yuvj420p` dải đủ của nhiều file MJPEG/AVI cũ, hay
//! 4:2:2/4:4:4 của vài codec khác) — CLI shell-out cũ không gặp lỗi này vì
//! `ffmpeg` binary tự chèn ngầm một bước `scale`/`format` filter khi cần,
//! native API thì KHÔNG tự làm hộ; (b) chiều rộng/cao LẺ (4:2:0 cần chẵn cả
//! hai chiều để chia đôi chroma) — một số AVI cũ có kích thước lẻ thật. Vá
//! bằng MỘT `scaling::Context` bắt buộc (không điều kiện — luôn chạy, kể cả
//! khi định dạng nguồn tình cờ đã là `yuv420p`, để không phải đoán "trường
//! hợp nào cần") ép mọi frame về đúng `Pixel::YUV420P` + kích thước làm tròn
//! XUỐNG số chẵn gần nhất (mất tối đa 1px mỗi chiều, không đáng kể so với
//! rủi ro lỗi cứng) TRƯỚC khi đưa vào encoder — cùng pattern đã dùng ở
//! `thumbnail.rs`, chỉ khác là dùng cho MỌI frame của cả video, không phải
//! một frame duy nhất.

use std::time::Instant;

use ffmpeg_next::{self as ffmpeg, channel_layout::ChannelLayout, codec, encoder, filter, format, format::Pixel, frame, media::Type as MediaType, software::{resampling, scaling}, util::dictionary::Owned as Dictionary, Rational};

use crate::audio_layout::{ensure_decoder_layout, ensure_frame_layout, aac_target_layout, aformat_filter_spec, ensure_frame_matches_encoder};
use crate::ensure_init;
use crate::progress::{maybe_tick, CancelFlag, PipelineProgress, PipelineProgressSink};
use crate::ProcessError;

/// 4:2:0 (chroma nửa độ phân giải cả hai chiều) yêu cầu width/height CHẴN —
/// làm tròn XUỐNG số chẵn gần nhất, không làm tròn LÊN (tránh vẽ thêm viền
/// ngoài khung hình gốc).
fn round_down_even(value: u32) -> u32 {
    value & !1
}

/// Frame rate TRUNG BÌNH đo từ tối đa `FRAME_RATE_PROBE_PACKETS` packet video đầu (số packet / khoảng pts) — chỉ dùng khi
/// container không khai frame rate dùng được. `None` nếu quá ít packet hoặc kết quả ngoài [1, 120] fps (không đáng tin).
/// Làm tròn về phân số quen thuộc (24000/1001, 30000/1001, 60000/1001...) để encoder nhận số "đẹp".
fn measure_frame_rate(input_path: &str, video_index: usize) -> Option<Rational> {
    const FRAME_RATE_PROBE_PACKETS: u32 = 900;
    let mut ictx = format::input(input_path).ok()?;
    let tb = f64::from(ictx.stream(video_index)?.time_base());
    let (mut min_ts, mut max_ts, mut count) = (i64::MAX, i64::MIN, 0u32);
    for (stream, packet) in ictx.packets() {
        if stream.index() != video_index {
            continue;
        }
        let Some(ts) = packet.pts().or_else(|| packet.dts()) else { continue };
        min_ts = min_ts.min(ts);
        max_ts = max_ts.max(ts);
        count += 1;
        if count >= FRAME_RATE_PROBE_PACKETS {
            break;
        }
    }
    let span = (max_ts - min_ts) as f64 * tb;
    if count < 10 || span <= 0.0 {
        return None;
    }
    let fps = f64::from(count - 1) / span;
    if !(1.0..=120.0).contains(&fps) {
        return None;
    }
    for (target, num) in [(23.976, 24000), (29.97, 30000), (59.94, 60000)] {
        if (fps - target).abs() < 0.03 {
            return Some(Rational(num, 1001));
        }
    }
    Some(Rational((fps * 1000.0).round() as i32, 1000))
}

/// `target_video_bitrate_bps`: `None` = không đặt bitrate (x264 rơi về CRF mặc
/// định của nó — tầng gọi nên truyền `ReencodeOptions::crf` thay vì dựa vào
/// đây). `Some(bps)` là nhánh Option C (docs/roadmap.md § Ingest, "chuẩn hoá
/// dung lượng vượt trần upload") — dùng khi file VẪN vượt trần upload sau
/// remux/re-encode bình thường, tầng gọi (Angular,
/// `computeTargetVideoBitrateBps()` ở `@tsmc/core-ingest`) đã tính sẵn số bps
/// mục tiêu từ trần byte cho phép + `duration_sec`, hàm này chỉ THỰC THI
/// (ADR-0017 điều kiện bắt buộc #4 — crate không tự quyết công thức).
pub fn reencode_to_mp4(
    input_path: &str,
    output_path: &str,
    target_video_bitrate_bps: Option<u64>,
    duration_sec: f64,
    progress: PipelineProgressSink<'_>,
    cancel: &CancelFlag,
) -> Result<(), ProcessError> {
    let options = ReencodeOptions { target_video_bitrate_bps, ..ReencodeOptions::default() };
    reencode_with_options(input_path, output_path, &options, duration_sec, progress, cancel)
}

/// Tên encoder video — ADR-0023 quyết định 1. Tìm theo TÊN, không theo codec id.
pub const VIDEO_ENCODER_NAME: &str = "libx264";

/// Preset mặc định = "Fast" của HandBrake (ADR-0023 quyết định 3).
pub const DEFAULT_X264_PRESET: &str = "fast";

/// Các preset x264 hợp lệ (`x264 --help`, `placebo` cố ý không có: chậm gấp
/// nhiều lần, không có nghĩa với công cụ này).
const X264_PRESETS: [&str; 9] = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"];

fn is_known_x264_preset(name: &str) -> bool {
    X264_PRESETS.contains(&name)
}

/// Chất lượng không đổi (CRF) kèm trần VBV — ADR-0023 quyết định 4. VBV giới
/// hạn bitrate trung bình trên mọi cửa sổ dài bằng `bufsize_bits`, nên dung
/// lượng không vượt trần dù dự đoán RF sai.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CrfRate {
    /// Rate factor (HandBrake "RF"; 18–28, thấp hơn = đẹp hơn).
    pub rf: f32,
    /// `maxrate` của x264 (bps). 0 = không đặt trần VBV.
    pub maxrate_bps: u64,
    /// `bufsize` của x264 (bit).
    pub bufsize_bits: u64,
}

/// Bật đa luồng cho một codec context CHƯA mở (decoder lẫn encoder). Mặc định
/// của `AVCodecContext` khi gọi qua API là 1 luồng — xem doc đầu file.
/// `FF_THREAD_FRAME | FF_THREAD_SLICE` (không dùng `set_threading` của
/// `ffmpeg-next`: kiểu `Type` của nó chỉ chọn MỘT trong hai, mà codec cũ như
/// MPEG-4/WMV chỉ hỗ trợ slice).
fn enable_auto_threads(ctx: &mut codec::context::Context) {
    // SAFETY: `ctx` là context hợp lệ, chưa mở; hai field này chỉ đọc lúc `avcodec_open2`.
    unsafe {
        let raw = ctx.as_mut_ptr();
        (*raw).thread_count = 0;
        (*raw).thread_type = (ffmpeg::ffi::FF_THREAD_FRAME | ffmpeg::ffi::FF_THREAD_SLICE) as i32;
    }
}

/// Tham số một lần re-encode do tầng gọi quyết (Giai đoạn 2, dialog tiền kiểm
/// — công thức ở `libs/core-ingest/src/reencode-plan.ts`, crate này chỉ thực
/// thi). `Default` = hành vi Hạng D thường.
#[derive(Debug, Clone, Default)]
pub struct ReencodeOptions {
    /// Xem doc `reencode_to_mp4()`. Bị bỏ qua khi `crf` có giá trị.
    pub target_video_bitrate_bps: Option<u64>,
    /// Chế độ chất lượng không đổi (CRF) + trần VBV. Ưu tiên hơn
    /// `target_video_bitrate_bps`.
    pub crf: Option<CrfRate>,
    /// 2-pass ABR (ADR-0023 § 4c.2): chạy thêm một vòng decode→scale→encode không mux, không audio
    /// để x264 ghi thống kê, rồi pass 2 nhắm đúng `target_video_bitrate_bps`. Chỉ có nghĩa khi có
    /// bitrate đích và không có `crf`; bỏ qua nếu không. Kèm `maxrate` 2× / `bufsize` 4× target.
    pub two_pass: bool,
    /// Preset x264; `None` = `DEFAULT_X264_PRESET`. Chỉ nhận tên preset đã biết
    /// (`is_known_x264_preset`), tên lạ → lỗi — giá trị này đi vào AVOption.
    pub preset: Option<String>,
    /// Hạ độ phân giải về chiều cao này (giữ tỉ lệ, không phóng to).
    pub max_height: Option<u32>,
    /// Bitrate AAC; `None` = 160 kbps như trước.
    pub audio_bitrate_bps: Option<u32>,
    /// `(bắt đầu, độ dài)` giây — CHỈ encode một đoạn (encode thử để ước tính
    /// dung lượng/tốc độ, `estimate_reencode()`). Seek về keyframe gần nhất
    /// trước `start` nên đoạn thật có thể dài hơn một chút.
    pub window: Option<(f64, f64)>,
}

/// Pass nào của x264 — `Single` = 1-pass (CRF hoặc ABR), `First` ghi thống kê, `Second` đọc thống kê.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pass {
    Single,
    First,
    Second,
}

/// Phần THỜI GIAN của cả việc 2-pass mà pass 1 chiếm — đo 2026-10-10 trên WMV VC-1 1080p, 120 s đầu,
/// x264 `fast`, máy 8 nhân: pass 1 ≈ 45% (cả hai pass 2.43× thời gian thực, 1-pass 4.8×). Giải mã
/// nguồn VC-1 là phần lớn chi phí và lặp lại ở cả hai pass nên pass 1 không rẻ hơn nhiều. Sai số
/// chỉ làm thanh tiến trình nhảy, không hỏng kết quả.
const FIRST_PASS_PROGRESS_SHARE: f64 = 0.45;

/// Pass 1 chiếm đầu trục tiến trình gộp; chưa có file đầu ra nên `bytes_written = 0`.
fn first_pass_progress(p: PipelineProgress) -> PipelineProgress {
    PipelineProgress { elapsed_sec: p.elapsed_sec * FIRST_PASS_PROGRESS_SHARE, duration_sec: p.duration_sec, bytes_written: 0 }
}

/// Pass 2 chiếm phần còn lại. `projected_final_bytes` ở tầng gọi = bytes_written / %, mà % giờ là phần
/// của CẢ HAI pass — quy bytes về đúng tỉ lệ của pass 2 để phép chia đó vẫn ra dung lượng cuối của file.
fn second_pass_progress(p: PipelineProgress) -> PipelineProgress {
    let real = if p.duration_sec > 0.0 { (p.elapsed_sec / p.duration_sec).clamp(0.0, 1.0) } else { 0.0 };
    let overall = FIRST_PASS_PROGRESS_SHARE + (1.0 - FIRST_PASS_PROGRESS_SHARE) * real;
    let bytes_written = if real > 0.0 { (p.bytes_written as f64 * overall / real) as u64 } else { 0 };
    PipelineProgress { elapsed_sec: overall * p.duration_sec, duration_sec: p.duration_sec, bytes_written }
}

/// Đường dẫn file thống kê 2-pass của x264 (cùng thư mục file đầu ra; x264 còn ghi kèm `<đường dẫn>.mbtree`).
fn stats_path_for(output_path: &str) -> String {
    format!("{output_path}.x264stats")
}

fn remove_stats_files(stats_path: &str) {
    let _ = std::fs::remove_file(stats_path);
    let _ = std::fs::remove_file(format!("{stats_path}.mbtree"));
    // x264 ghi file tạm `<stats>.temp` rồi đổi tên khi đóng; dọn phòng khi huỷ giữa chừng.
    let _ = std::fs::remove_file(format!("{stats_path}.temp"));
    let _ = std::fs::remove_file(format!("{stats_path}.mbtree.temp"));
}

/// Mở input, seek về keyframe gần nhất TRƯỚC điểm bắt đầu nếu encode thử một đoạn (cùng cách
/// `thumbnail.rs`; vòng packet dừng khi vượt điểm kết thúc). Seek lỗi → bỏ qua (encode từ đầu
/// file) — vẫn cho ra mẫu, chỉ kém đại diện.
fn open_input_window(input_path: &str, window: Option<(f64, f64)>) -> Result<format::context::Input, ffmpeg::Error> {
    let mut in_opts = Dictionary::new();
    in_opts.set("fflags", "+genpts");
    let mut ictx = format::input_with_dictionary(input_path, in_opts)?;
    if let Some((start, _)) = window {
        if start > 0.0 {
            let target_ts = (start * f64::from(ffmpeg::ffi::AV_TIME_BASE)) as i64;
            let _ = ictx.seek(target_ts, ..target_ts);
        }
    }
    Ok(ictx)
}

/// Frame rate cho encoder. WMV/VC-1: decoder không báo frame_rate (None) → h264_mf "could not set output type"
/// (lỗi STAR-505/502, 2026-10-05); rơi về avg_frame_rate của stream. Container VFR như ASF/WMV có thể khai CẢ hai
/// đều vô dụng (`avg_frame_rate = 0/0`, `r_frame_rate = 1000/1` vì time_base 1/1000 — lỗi Caribbean
/// 070307-487.wmv, 2026-10-07): lúc đó đo từ chính các packet đầu.
fn resolve_frame_rate(decoder: &codec::decoder::Video, ictx: &format::context::Input, video_index: usize, input_path: &str) -> Option<Rational> {
    decoder
        .frame_rate()
        .or_else(|| Some(ictx.stream(video_index).unwrap().avg_frame_rate()).filter(|r| r.numerator() > 0 && r.denominator() > 0))
        .or_else(|| measure_frame_rate(input_path, video_index))
}

const ENC_PIXEL_FORMAT: Pixel = Pixel::YUV420P;

/// Hình học + nhịp của video đầu ra — giống hệt giữa pass 1 và pass 2.
struct VideoGeometry {
    width: u32,
    height: u32,
    aspect: Rational,
    frame_rate: Option<Rational>,
    time_base: Rational,
}

fn check_preset(options: &ReencodeOptions) -> Result<&str, ProcessError> {
    let preset = options.preset.as_deref().unwrap_or(DEFAULT_X264_PRESET);
    if is_known_x264_preset(preset) {
        Ok(preset)
    } else {
        Err(ProcessError::InvalidOption(format!("preset x264 không hợp lệ: {preset:?}")))
    }
}

/// Dựng + mở encoder `libx264` cho một pass. `stats_path` chỉ dùng khi `pass != Single`.
fn open_video_encoder(codec: ffmpeg::Codec, geom: &VideoGeometry, options: &ReencodeOptions, preset: &str, global_header: bool, pass: Pass, stats_path: &str) -> Result<encoder::Video, ProcessError> {
    let mut base = codec::context::Context::new_with_codec(codec);
    enable_auto_threads(&mut base);
    let mut ctx = base.encoder().video()?;
    ctx.set_height(geom.height);
    ctx.set_width(geom.width);
    ctx.set_aspect_ratio(geom.aspect);
    ctx.set_format(ENC_PIXEL_FORMAT);
    ctx.set_frame_rate(geom.frame_rate);
    ctx.set_time_base(geom.time_base);

    // `set_flags` GHI ĐÈ cả bitmask — gom hết rồi đặt một lần.
    let mut flags = codec::flag::Flags::empty();
    if global_header && pass != Pass::First {
        flags |= codec::flag::Flags::GLOBAL_HEADER;
    }
    match pass {
        Pass::First => flags |= codec::flag::Flags::PASS1,
        Pass::Second => flags |= codec::flag::Flags::PASS2,
        Pass::Single => {}
    }
    if !flags.is_empty() {
        ctx.set_flags(flags);
    }

    let mut x264_opts = ffmpeg::Dictionary::new();
    x264_opts.set("preset", preset);
    // `high` thay vì `main` của HandBrake: HandBrake chọn `main` vì thiết bị phần cứng cũ,
    // mọi trình duyệt đích đều giải mã được High (ADR-0023 quyết định 3).
    x264_opts.set("profile", "high");
    if let Some(crf) = options.crf {
        x264_opts.set("crf", &format!("{:.1}", crf.rf));
        // `maxrate_bps == 0` = tầng gọi không biết thời lượng nên không có ngân sách để làm trần.
        if crf.maxrate_bps > 0 {
            x264_opts.set("maxrate", &crf.maxrate_bps.to_string());
            x264_opts.set("bufsize", &crf.bufsize_bits.to_string());
        }
    } else if let Some(bps) = options.target_video_bitrate_bps {
        ctx.set_bit_rate(bps as usize);
        if pass != Pass::Single {
            // ADR-0023 quyết định 4: trần 2× / bufsize 4× target không tốn VMAF, giữ được đỉnh cho stream.
            x264_opts.set("maxrate", &bps.saturating_mul(2).to_string());
            x264_opts.set("bufsize", &bps.saturating_mul(4).to_string());
        }
    }
    if pass != Pass::Single {
        x264_opts.set("stats", stats_path);
    }
    Ok(ctx.open_with(x264_opts)?)
}

/// Kích thước đầu ra khi hạ về `max_height` — PHẢI khớp `scaledSize()` ở
/// `libs/core-ingest/src/reencode-plan.ts`: giữ tỉ lệ, cả hai chiều làm tròn
/// XUỐNG số chẵn (yêu cầu của 4:2:0), không phóng to.
fn scaled_dimensions(src_width: u32, src_height: u32, max_height: Option<u32>) -> (u32, u32) {
    match max_height {
        Some(max_h) if max_h > 0 && src_height > 0 && max_h < src_height => {
            let width = (f64::from(src_width) * f64::from(max_h) / f64::from(src_height)).floor() as u32;
            (round_down_even(width).max(2), round_down_even(max_h).max(2))
        }
        _ => (round_down_even(src_width).max(2), round_down_even(src_height).max(2)),
    }
}

/// Re-encode Hạng D. `options.two_pass` + bitrate đích → chạy pass 1 (không mux) rồi pass 2; ngược
/// lại một lượt. Tiến trình của hai pass được gộp vào MỘT trục 0..duration (xem
/// `FIRST_PASS_PROGRESS_SHARE`) để tầng gọi tính %/ETA như một lượt, không phải đổi gì.
pub fn reencode_with_options(
    input_path: &str,
    output_path: &str,
    options: &ReencodeOptions,
    duration_sec: f64,
    progress: PipelineProgressSink<'_>,
    cancel: &CancelFlag,
) -> Result<(), ProcessError> {
    ensure_init();
    let preset = check_preset(options)?;
    let two_pass = options.two_pass && options.crf.is_none() && options.target_video_bitrate_bps.is_some();
    if !two_pass {
        return reencode_pass(input_path, output_path, options, duration_sec, progress, cancel, Pass::Single, "");
    }

    let stats_path = stats_path_for(output_path);
    remove_stats_files(&stats_path);
    let result = (|| {
        let first_sink = |p: PipelineProgress| progress(first_pass_progress(p));
        first_pass(input_path, options, preset, duration_sec, &stats_path, &first_sink, cancel)?;
        if cancel.is_cancelled() {
            return Err(ProcessError::Cancelled);
        }
        let second_sink = |p: PipelineProgress| progress(second_pass_progress(p));
        reencode_pass(input_path, output_path, options, duration_sec, &second_sink, cancel, Pass::Second, &stats_path)
    })();
    remove_stats_files(&stats_path);
    result
}

/// Pass 1 của 2-pass: decode → scale → encode (PASS1) mà KHÔNG mux, KHÔNG audio — chỉ để x264 ghi
/// file thống kê. Cùng cách mở input / seek cửa sổ / chuẩn hoá khung như pass 2 (hai pass phải thấy
/// CHÍNH XÁC cùng dãy khung hình, nếu không thống kê lệch với pass 2).
fn first_pass(
    input_path: &str,
    options: &ReencodeOptions,
    preset: &str,
    duration_sec: f64,
    stats_path: &str,
    progress: PipelineProgressSink<'_>,
    cancel: &CancelFlag,
) -> Result<(), ProcessError> {
    let mut ictx = open_input_window(input_path, options.window)?;
    let window_end = options.window.map(|(start, len)| start + len);
    let video_in_index = ictx.streams().best(MediaType::Video).ok_or(ffmpeg::Error::StreamNotFound)?.index();
    let ist_time_base = ictx.stream(video_in_index).unwrap().time_base();

    let mut dec_ctx = codec::context::Context::from_parameters(ictx.stream(video_in_index).unwrap().parameters())?;
    enable_auto_threads(&mut dec_ctx);
    let mut decoder = dec_ctx.decoder().video()?;
    let (width, height) = scaled_dimensions(decoder.width(), decoder.height(), options.max_height);
    let mut scaler = scaling::Context::get(decoder.format(), decoder.width(), decoder.height(), ENC_PIXEL_FORMAT, width, height, scaling::Flags::BILINEAR)?;
    let geom = VideoGeometry {
        width,
        height,
        aspect: decoder.aspect_ratio(),
        frame_rate: resolve_frame_rate(&decoder, &ictx, video_in_index, input_path),
        time_base: ist_time_base,
    };
    let codec = encoder::find_by_name(VIDEO_ENCODER_NAME).ok_or(ProcessError::EncoderMissing(VIDEO_ENCODER_NAME))?;
    let mut video_encoder = open_video_encoder(codec, &geom, options, preset, false, Pass::First, stats_path)?;

    let mut last_emit = Instant::now();
    let mut drain = |decoder: &mut codec::decoder::Video, encoder_ctx: &mut encoder::Video| -> Result<(), ProcessError> {
        let mut decoded = frame::Video::empty();
        while decoder.receive_frame(&mut decoded).is_ok() {
            if cancel.is_cancelled() {
                return Err(ProcessError::Cancelled);
            }
            let ts = decoded.timestamp();
            if let Some(ts) = ts {
                maybe_tick(&mut last_emit, ts as f64 * f64::from(ist_time_base), duration_sec, "", progress);
            }
            let mut scaled = frame::Video::empty();
            scaler.run(&decoded, &mut scaled)?;
            scaled.set_pts(ts);
            encoder_ctx.send_frame(&scaled)?;
            // Gói của pass 1 bị bỏ — chỉ rút để encoder không đầy hàng đợi.
            let mut discarded = ffmpeg::Packet::empty();
            while encoder_ctx.receive_packet(&mut discarded).is_ok() {}
        }
        Ok(())
    };

    for (stream, packet) in ictx.packets() {
        if stream.index() != video_in_index {
            continue;
        }
        if let Some(end) = window_end {
            if packet.pts().is_some_and(|pts| pts as f64 * f64::from(ist_time_base) >= end) {
                break;
            }
        }
        decoder.send_packet(&packet)?;
        drain(&mut decoder, &mut video_encoder)?;
    }
    decoder.send_eof()?;
    drain(&mut decoder, &mut video_encoder)?;
    video_encoder.send_eof()?;
    let mut discarded = ffmpeg::Packet::empty();
    while video_encoder.receive_packet(&mut discarded).is_ok() {}
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn reencode_pass(
    input_path: &str,
    output_path: &str,
    options: &ReencodeOptions,
    duration_sec: f64,
    progress: PipelineProgressSink<'_>,
    cancel: &CancelFlag,
    pass: Pass,
    stats_path: &str,
) -> Result<(), ProcessError> {
    let audio_bitrate_bps = options.audio_bitrate_bps.unwrap_or(160_000);

    let mut ictx = open_input_window(input_path, options.window)?;
    let mut octx = format::output(output_path)?;
    let window_end = options.window.map(|(start, len)| start + len);

    let video_in_index = ictx.streams().best(MediaType::Video).ok_or(ffmpeg::Error::StreamNotFound)?.index();
    let audio_in_index = ictx.streams().best(MediaType::Audio).ok_or(ffmpeg::Error::StreamNotFound)?.index();
    let video_ist_time_base = ictx.stream(video_in_index).unwrap().time_base();
    let audio_ist_time_base = ictx.stream(audio_in_index).unwrap().time_base();

    let global_header = octx.format().flags().contains(format::flag::Flags::GLOBAL_HEADER);

    // --- Video: decode -> scale (chuẩn hoá format/kích thước) -> encode H.264
    // (khung port từ examples/transcode-x264.rs của chính ffmpeg-next, thêm
    // bước scale sau phát hiện thật — xem doc comment đầu file) ---
    let mut video_dec_ctx = codec::context::Context::from_parameters(ictx.stream(video_in_index).unwrap().parameters())?;
    enable_auto_threads(&mut video_dec_ctx);
    let mut video_decoder = video_dec_ctx.decoder().video()?;

    let (enc_width, enc_height) = scaled_dimensions(video_decoder.width(), video_decoder.height(), options.max_height);
    // Bắt buộc theo dõi dts cuối đã mux của VIDEO (khác chuẩn hoá format/pts
    // của audio ở trên) — phát hiện thật 2026-09-17, file AVI Xvid "packed
    // B-frames" (`ffmpeg` tự cảnh báo "non-standard and wasteful way to
    // store B-frames"): một packet đóng gói CẢ P-frame lẫn B-frame trễ,
    // decoder tách ra 2 `receive_frame()` từ 1 `send_packet()` nhưng B-frame
    // tách ra kế thừa TRÙNG pts với frame kế tiếp → sau khi encode lại
    // H.264, hai packet output liên tiếp trùng dts → mp4 muxer chặn cứng
    // ("Application provided invalid, non monotonically increasing dts",
    // `AVERROR(EINVAL)` = "Invalid argument" đúng như user báo, khác hẳn bug
    // AC3 audio đã vá — đây là VIDEO, không phải audio). CLI `ffmpeg` chính
    // thức tự bơm dts lên `last_mux_dts + 1` khi gặp case này thay vì lỗi
    // cứng (`ffmpeg.c::bump_dts`) — API native không tự làm hộ, phải làm tay
    // ở `drain_video_encoder`.
    let mut last_video_dts: Option<i64> = None;
    let mut video_scaler = scaling::Context::get(
        video_decoder.format(),
        video_decoder.width(),
        video_decoder.height(),
        ENC_PIXEL_FORMAT,
        enc_width,
        enc_height,
        scaling::Flags::BILINEAR
    )?;

    let preset = check_preset(options)?;
    let h264 = encoder::find_by_name(VIDEO_ENCODER_NAME).ok_or(ProcessError::EncoderMissing(VIDEO_ENCODER_NAME))?;
    let mut vost = octx.add_stream(Some(h264))?;
    let geom = VideoGeometry {
        width: enc_width,
        height: enc_height,
        aspect: video_decoder.aspect_ratio(),
        frame_rate: resolve_frame_rate(&video_decoder, &ictx, video_in_index, input_path),
        time_base: video_ist_time_base,
    };
    let mut video_encoder = open_video_encoder(h264, &geom, options, preset, global_header, pass, stats_path)?;
    vost.set_parameters(&video_encoder);
    let video_out_index = 0i32;

    // --- Audio: decode -> filter (anull) -> encode AAC (giữ NGUYÊN cách dựng của remux.rs/SPIKE-09) ---
    let audio_ist_params = ictx.stream(audio_in_index).unwrap().parameters();
    let audio_dec_ctx = codec::context::Context::from_parameters(audio_ist_params)?;
    let mut audio_decoder = audio_dec_ctx.decoder().audio()?;
    ensure_decoder_layout(&mut audio_decoder);

    let aac = encoder::find(codec::Id::AAC).ok_or(ffmpeg::Error::EncoderNotFound)?.audio()?;
    let mut aost = octx.add_stream(aac)?;
    let aectx = codec::context::Context::from_parameters(aost.parameters())?;
    let mut audio_enc_ctx = aectx.encoder().audio()?;

    // Xem doc comment `audio_layout.rs` — `aac.channel_layouts()` là `None` trên
    // FFmpeg 7.1 nên cách chọn cũ luôn ra STEREO, nguồn mono segfault.
    let (channel_layout, channel_layout_name) = aac_target_layout(audio_decoder.channel_layout().channels());

    if global_header {
        audio_enc_ctx.set_flags(codec::flag::Flags::GLOBAL_HEADER);
    }
    audio_enc_ctx.set_rate(audio_decoder.rate() as i32);
    audio_enc_ctx.set_channel_layout(channel_layout);
    audio_enc_ctx.set_format(aac.formats().expect("aac formats").next().unwrap());
    audio_enc_ctx.set_bit_rate(audio_bitrate_bps as usize);
    audio_enc_ctx.set_time_base((1, audio_decoder.rate() as i32));
    aost.set_time_base((1, audio_decoder.rate() as i32));

    let mut audio_encoder = audio_enc_ctx.open_as(aac)?;
    aost.set_parameters(&audio_encoder);
    let audio_out_index = 1i32;

    let audio_norm_format = audio_decoder.format();
    let audio_norm_channel_layout = audio_decoder.channel_layout();
    let audio_norm_rate = audio_decoder.rate() as i32;

    let args = format!(
        "time_base={}:sample_rate={}:sample_fmt={}:channel_layout=0x{:x}",
        audio_decoder.time_base(),
        audio_norm_rate,
        audio_norm_format.name(),
        audio_norm_channel_layout.bits()
    );
    let mut audio_filter = filter::Graph::new();
    audio_filter.add(&filter::find("abuffer").unwrap(), "in", &args)?;
    audio_filter.add(&filter::find("abuffersink").unwrap(), "out", "")?;
    {
        let mut out = audio_filter.get("out").unwrap();
        out.set_sample_format(audio_encoder.format());
        out.set_channel_layout(audio_encoder.channel_layout());
        out.set_sample_rate(audio_encoder.rate());
    }
    audio_filter.output("in", 0)?.input("out", 0)?.parse(&aformat_filter_spec(channel_layout_name))?;
    audio_filter.validate()?;
    if !aac.capabilities().contains(codec::capabilities::Capabilities::VARIABLE_FRAME_SIZE) {
        audio_filter.get("out").unwrap().sink().set_frame_size(audio_encoder.frame_size());
    }
    let audio_dec_time_base = audio_decoder.time_base();
    // Bắt buộc, cùng lý do đã ghi ở `remux.rs::drain_audio_transcode` (phát
    // hiện thật 2026-09-15, AC3 đổi channel layout GIỮA file) — chuẩn hoá
    // MỌI frame audio về đúng định dạng đã dựng `audio_filter` trước khi đẩy
    // vào `abuffer`, tránh "Changing audio frame properties on the fly is
    // not supported" (EINVAL) nếu Hạng D cũng gặp track đổi định dạng giữa
    // chừng như Hạng C đã gặp thật.
    let mut audio_resampler = resampling::Context::get(audio_norm_format, audio_norm_channel_layout, audio_norm_rate as u32, audio_norm_format, audio_norm_channel_layout, audio_norm_rate as u32)?;
    let mut audio_resampler_src = (audio_norm_rate, audio_norm_format, audio_norm_channel_layout);

    octx.set_metadata(ictx.metadata().to_owned());
    let mut header_opts = Dictionary::new();
    header_opts.set("movflags", "faststart");
    octx.write_header_with(header_opts)?;

    let mut last_emit = Instant::now();

    for (stream, packet) in ictx.packets() {
        let in_index = stream.index();
        if let Some(end) = window_end {
            // Dừng khi packet VIDEO đã vượt điểm kết thúc đoạn thử; audio đi
            // trước/sau video chỉ vài trăm ms do interleave nên không cần đợi.
            if in_index == video_in_index && packet.pts().is_some_and(|pts| pts as f64 * f64::from(video_ist_time_base) >= end) {
                break;
            }
        }
        if in_index == video_in_index {
            video_decoder.send_packet(&packet)?;
            drain_video(&mut video_decoder, &mut video_scaler, &mut video_encoder, &mut octx, video_ist_time_base, video_out_index, &mut last_video_dts, duration_sec, output_path, progress, cancel, &mut last_emit)?;
        } else if in_index == audio_in_index {
            let mut packet = packet;
            packet.rescale_ts(audio_ist_time_base, audio_dec_time_base);
            audio_decoder.send_packet(&packet)?;
            drain_audio_decoder(&mut audio_decoder, &mut audio_filter, &mut audio_encoder, &mut octx, audio_dec_time_base, audio_out_index, &mut audio_resampler, &mut audio_resampler_src, audio_norm_format, audio_norm_channel_layout, audio_norm_rate)?;
        }
    }

    // Flush video: decoder -> scaler -> encoder.
    video_decoder.send_eof()?;
    drain_video(&mut video_decoder, &mut video_scaler, &mut video_encoder, &mut octx, video_ist_time_base, video_out_index, &mut last_video_dts, duration_sec, output_path, progress, cancel, &mut last_emit)?;
    video_encoder.send_eof()?;
    drain_video_encoder(&mut video_encoder, &mut octx, video_ist_time_base, video_out_index, &mut last_video_dts)?;

    // Flush audio: decoder -> filter -> encoder.
    audio_decoder.send_eof()?;
    drain_audio_decoder(&mut audio_decoder, &mut audio_filter, &mut audio_encoder, &mut octx, audio_dec_time_base, audio_out_index, &mut audio_resampler, &mut audio_resampler_src, audio_norm_format, audio_norm_channel_layout, audio_norm_rate)?;
    audio_filter.get("in").unwrap().source().flush()?;
    drain_audio_filter_and_encode(&mut audio_filter, &mut audio_encoder, &mut octx, audio_dec_time_base, audio_out_index)?;
    audio_encoder.send_eof()?;
    drain_audio_encoder(&mut audio_encoder, &mut octx, audio_dec_time_base, audio_out_index)?;

    octx.write_trailer()?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn drain_video(
    decoder: &mut codec::decoder::Video,
    scaler: &mut scaling::Context,
    encoder_ctx: &mut encoder::Video,
    octx: &mut format::context::Output,
    ist_time_base: Rational,
    out_index: i32,
    last_dts: &mut Option<i64>,
    duration_sec: f64,
    output_path: &str,
    progress: PipelineProgressSink<'_>,
    cancel: &CancelFlag,
    last_emit: &mut Instant,
) -> Result<(), ProcessError> {
    let mut decoded = frame::Video::empty();
    while decoder.receive_frame(&mut decoded).is_ok() {
        // Check huỷ TRONG vòng receive_frame (không chỉ ở vòng packet ngoài)
        // — lúc flush EOF, một lần gọi drain_video() có thể rút ra NHIỀU
        // frame đã buffer trong decoder, check ở ngoài sẽ bỏ lỡ đúng lúc đó.
        if cancel.is_cancelled() {
            return Err(ProcessError::Cancelled);
        }
        let ts = decoded.timestamp();
        if let Some(ts) = ts {
            maybe_tick(last_emit, ts as f64 * f64::from(ist_time_base), duration_sec, output_path, progress);
        }
        // `scaler.run()` sinh frame MỚI (không giữ pts của frame nguồn) —
        // phải gán lại pts SAU khi scale, không phải trước.
        let mut scaled = frame::Video::empty();
        scaler.run(&decoded, &mut scaled)?;
        scaled.set_pts(ts);
        encoder_ctx.send_frame(&scaled)?;
        drain_video_encoder(encoder_ctx, octx, ist_time_base, out_index, last_dts)?;
    }
    Ok(())
}

fn drain_video_encoder(
    encoder_ctx: &mut encoder::Video,
    octx: &mut format::context::Output,
    ist_time_base: Rational,
    out_index: i32,
    last_dts: &mut Option<i64>,
) -> Result<(), ffmpeg::Error> {
    let out_tb = octx.stream(out_index as usize).unwrap().time_base();
    let mut encoded = ffmpeg::Packet::empty();
    while encoder_ctx.receive_packet(&mut encoded).is_ok() {
        encoded.set_stream(out_index as usize);
        encoded.rescale_ts(ist_time_base, out_tb);
        // Xem doc comment ở `reencode_to_mp4` (khai báo `last_video_dts`) —
        // "packed B-frames" của Xvid/DivX cũ có thể khiến 2 packet output
        // liên tiếp trùng dts sau rescale. Bơm dts lên tối thiểu
        // `last_dts + 1` (giữ nguyên bất biến dts <= pts của H.264) đúng
        // cách `ffmpeg` CLI chính thức tự làm, thay vì để muxer trả
        // `AVERROR(EINVAL)`.
        if let Some(dts) = encoded.dts() {
            let fixed_dts = match *last_dts {
                Some(prev) if dts <= prev => prev + 1,
                _ => dts,
            };
            if fixed_dts != dts {
                encoded.set_dts(Some(fixed_dts));
                if encoded.pts().is_none_or(|pts| pts < fixed_dts) {
                    encoded.set_pts(Some(fixed_dts));
                }
            }
            *last_dts = Some(fixed_dts);
        }
        encoded.write_interleaved(octx)?;
    }
    Ok(())
}

fn drain_audio_encoder(encoder_ctx: &mut codec::encoder::Audio, octx: &mut format::context::Output, dec_time_base: Rational, out_index: i32) -> Result<(), ffmpeg::Error> {
    let out_tb = octx.stream(out_index as usize).unwrap().time_base();
    let mut encoded = ffmpeg::Packet::empty();
    while encoder_ctx.receive_packet(&mut encoded).is_ok() {
        encoded.set_stream(out_index as usize);
        encoded.rescale_ts(dec_time_base, out_tb);
        encoded.write_interleaved(octx)?;
    }
    Ok(())
}

fn drain_audio_filter_and_encode(
    filter_graph: &mut filter::Graph,
    encoder_ctx: &mut codec::encoder::Audio,
    octx: &mut format::context::Output,
    dec_time_base: Rational,
    out_index: i32,
) -> Result<(), ffmpeg::Error> {
    let mut filtered = frame::Audio::empty();
    while filter_graph.get("out").unwrap().sink().frame(&mut filtered).is_ok() {
        ensure_frame_matches_encoder(&filtered, encoder_ctx)?;
        encoder_ctx.send_frame(&filtered)?;
        drain_audio_encoder(encoder_ctx, octx, dec_time_base, out_index)?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn drain_audio_decoder(
    decoder: &mut codec::decoder::Audio,
    filter_graph: &mut filter::Graph,
    encoder_ctx: &mut codec::encoder::Audio,
    octx: &mut format::context::Output,
    dec_time_base: Rational,
    out_index: i32,
    resampler: &mut resampling::Context,
    resampler_src: &mut (i32, format::Sample, ChannelLayout),
    norm_format: format::Sample,
    norm_channel_layout: ChannelLayout,
    norm_rate: i32
) -> Result<(), ffmpeg::Error> {
    let mut decoded = frame::Audio::empty();
    while decoder.receive_frame(&mut decoded).is_ok() {
        let ts = decoded.timestamp();
        decoded.set_pts(ts);
        ensure_frame_layout(&mut decoded);

        let frame_sig = (decoded.rate() as i32, decoded.format(), decoded.channel_layout());
        if frame_sig != *resampler_src {
            *resampler = resampling::Context::get(decoded.format(), decoded.channel_layout(), decoded.rate(), norm_format, norm_channel_layout, norm_rate as u32)?;
            *resampler_src = frame_sig;
        }

        let mut normalized = frame::Audio::empty();
        resampler.run(&decoded, &mut normalized)?;

        filter_graph.get("in").unwrap().source().add(&normalized)?;
        drain_audio_filter_and_encode(filter_graph, encoder_ctx, octx, dec_time_base, out_index)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{first_pass_progress, is_known_x264_preset, remove_stats_files, second_pass_progress, stats_path_for, DEFAULT_X264_PRESET, FIRST_PASS_PROGRESS_SHARE};
    use crate::progress::PipelineProgress;

    fn tick(elapsed: f64, bytes: u64) -> PipelineProgress {
        PipelineProgress { elapsed_sec: elapsed, duration_sec: 100.0, bytes_written: bytes }
    }

    #[test]
    fn progress_is_monotonic_across_both_passes() {
        let first_end = first_pass_progress(tick(100.0, 0));
        let second_start = second_pass_progress(tick(0.0, 0));
        let second_end = second_pass_progress(tick(100.0, 1_000));
        assert!((first_end.elapsed_sec - 100.0 * FIRST_PASS_PROGRESS_SHARE).abs() < 1e-9);
        assert!((second_start.elapsed_sec - first_end.elapsed_sec).abs() < 1e-9);
        assert!((second_end.elapsed_sec - 100.0).abs() < 1e-9);
        assert_eq!(first_end.bytes_written, 0);
    }

    #[test]
    fn second_pass_bytes_project_to_final_size() {
        // Qua nửa pass 2 đã ghi 500 byte → dung lượng cuối ~1000. Tầng gọi tính bytes / (elapsed/duration).
        let p = second_pass_progress(tick(50.0, 500));
        let percent = p.elapsed_sec / p.duration_sec;
        let projected = p.bytes_written as f64 / percent;
        assert!((projected - 1000.0).abs() < 1.0, "projected = {projected}");
    }

    #[test]
    fn stats_files_are_removed() {
        let dir = std::env::temp_dir().join(format!("tsmc-stats-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("x.mp4");
        let stats = stats_path_for(&out.to_string_lossy());
        for suffix in ["", ".mbtree", ".temp", ".mbtree.temp"] {
            std::fs::write(format!("{stats}{suffix}"), b"x").unwrap();
        }
        remove_stats_files(&stats);
        let left: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).collect();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(left.is_empty(), "còn lại: {left:?}");
    }

    #[test]
    fn default_preset_is_known() {
        assert!(is_known_x264_preset(DEFAULT_X264_PRESET));
    }

    #[test]
    fn unknown_preset_rejected() {
        assert!(!is_known_x264_preset("placebo"));
        assert!(!is_known_x264_preset("fast:crf=0"));
        assert!(!is_known_x264_preset(""));
    }
}
