//! "Chuẩn bị upload" — remux + thumbnail + rút phụ đề CỤC BỘ (không đụng
//! MTProto/`AppState`), gộp ba bước thành MỘT command để Angular không phải
//! tự quản thư mục tạm — giống cách `apps/tsmc-ingest` CLI dùng `mkdtemp()`/
//! `finally { rm(tmpDir) }` (`commands/upload.ts`), chỉ khác nơi chạy (đây là
//! Rust của Tauri, không phải Node). Emit sự kiện "pipeline-stage" mỗi khi
//! đổi bước — mockup A.2 mục 4: "Tiến trình phải nói đang ở stage nào",
//! không phải chỉ một spinner câm.
//!
//! KHÔNG quyết luật nghiệp vụ: `mode` (suy từ hạng A/B/C/D đã
//! `classifyCompatRank()` phía TypeScript — `ReencodeAll` bắt buộc đã hỏi xác
//! nhận TRƯỚC ở Angular, mockup A.2 mục 1) và `subtitle_tracks` (đã lọc bỏ
//! track dạng ảnh phía Angular) đều do TẦNG GỌI quyết định rồi truyền vào —
//! command này chỉ THỰC THI (ADR-0017 điều kiện bắt buộc #4).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::dto::{CrfRateDto, CurrentTaskDto, EstimateSampleDto, IngestRpcErrorDto, PipelineProgressDto, PipelineStageDto, PreparedSubtitleDto, PreparedUploadDto, ProbeResultDto, RemuxModeDto, SubtitleTrackDto};
use crate::state::{AppState, CancelHandle};

/// 20-30s đầu chỉ hiện "đang đo" thay vì bịa một ETA từ quá ít mẫu (roadmap
/// § Progress event).
const MEASURING_WINDOW: Duration = Duration::from_secs(20);
/// Cảnh báo sớm dung lượng dự phóng chỉ bắt đầu có ý nghĩa sau ~10% tiến độ
/// (roadmap: "cảnh báo sớm ở ~10% nếu sẽ vượt trần") — trước đó số liệu quá
/// nhiễu để ngoại suy.
const PROJECTION_MIN_PERCENT: f64 = 10.0;

/// State nội bộ của closure `on_progress` — EMA tốc độ thực (x-realtime) qua
/// `std::sync::Mutex` (KHÔNG `RefCell`, vì `RefCell` không `Sync` — bắt buộc
/// bởi bound `Send + Sync` của `PipelineProgressSink`).
struct SpeedTracker {
    start: Instant,
    last_elapsed_sec: f64,
    last_instant: Instant,
    ema_speed: Option<f64>,
}

impl SpeedTracker {
    fn new() -> Self {
        let now = Instant::now();
        Self { start: now, last_elapsed_sec: 0.0, last_instant: now, ema_speed: None }
    }
}

/// Bắn `"pipeline-stage"` VÀ cập nhật `AppState.current_task` (ADR-0018 mục
/// 5) — hai việc luôn đi cùng nhau vì cùng một nguồn sự thật (stage hiện
/// tại của task). Gọi được từ closure ĐỒNG BỘ trong `spawn_blocking` (chỗ
/// duy nhất `emit_stage` được gọi hiện tại) vì `AppState.current_task` là
/// `std::sync::Mutex`, không phải `tokio::sync::Mutex` (xem doc comment ở
/// `state.rs`).
fn emit_stage(app: &AppHandle, task_id: &str, path: &str, stage: &str) {
    if let Ok(mut current) = app.state::<AppState>().current_task.lock() {
        *current = Some(CurrentTaskDto { task_id: task_id.to_string(), path: path.to_string(), stage: stage.to_string(), bytes_sent: None, total_bytes: None });
    }
    let _ = app.emit("pipeline-stage", PipelineStageDto { task_id: task_id.to_string(), path: path.to_string(), stage: stage.to_string() });
}

/// Gom tham số re-encode từ lệnh Tauri vào `ReencodeOptions` — một chỗ duy nhất để `prepare_upload` và `estimate_reencode`
/// không lệch nhau (ước tính phải chạy ĐÚNG tham số sẽ dùng thật).
fn reencode_options_from(target_video_bitrate: Option<u64>, crf: Option<CrfRateDto>, two_pass: bool, preset: Option<String>, max_height: Option<u32>, audio_bitrate: Option<u32>) -> ingest_ffmpeg::ReencodeOptions {
    ingest_ffmpeg::ReencodeOptions {
        target_video_bitrate_bps: target_video_bitrate,
        crf: crf.map(|c| ingest_ffmpeg::CrfRate { rf: c.rf, maxrate_bps: c.maxrate_bps, bufsize_bits: c.bufsize_bits }),
        two_pass,
        preset,
        max_height,
        audio_bitrate_bps: audio_bitrate,
        window: None
    }
}

fn unique_suffix() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{nanos}-{n}")
}

#[tauri::command]
pub async fn prepare_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    input_path: String,
    mode: RemuxModeDto,
    subtitle_tracks: Vec<SubtitleTrackDto>,
    target_video_bitrate: Option<u64>,
    crf: Option<CrfRateDto>,
    two_pass: Option<bool>,
    preset: Option<String>,
    max_height: Option<u32>,
    audio_bitrate: Option<u32>
) -> Result<PreparedUploadDto, IngestRpcErrorDto> {
    let reencode_options = reencode_options_from(target_video_bitrate, crf, two_pass.unwrap_or(false), preset, max_height, audio_bitrate);
    let cancel = ingest_ffmpeg::CancelFlag::new();
    *state.active_cancel.lock().await = Some((task_id.clone(), CancelHandle::Ffmpeg(cancel.clone())));

    let stage_label = if matches!(mode, RemuxModeDto::ReencodeAll) { "reencoding" } else { "remuxing" };
    let progress_task_id = task_id.clone();
    let progress_path = input_path.clone();
    let progress_app = app.clone();
    let tracker = StdMutex::new(SpeedTracker::new());
    // `move` NGUYÊN closure này VÀO trong closure `spawn_blocking` bên dưới
    // (không tạo ở ngoài rồi borrow `&on_progress`) — `spawn_blocking` đòi
    // closure `'static`, mượn từ ngoài sẽ không compile.
    let on_progress = move |p: ingest_ffmpeg::PipelineProgress| {
        let now = Instant::now();
        let (speed, measuring) = {
            let mut st = tracker.lock().unwrap();
            let dt_wall = now.duration_since(st.last_instant).as_secs_f64();
            let dt_media = p.elapsed_sec - st.last_elapsed_sec;
            let inst_speed = (dt_wall > 0.0).then(|| dt_media / dt_wall);
            st.ema_speed = match (st.ema_speed, inst_speed) {
                (Some(prev), Some(cur)) => Some(prev * 0.7 + cur * 0.3),
                (None, Some(cur)) => Some(cur),
                (prev, None) => prev,
            };
            st.last_elapsed_sec = p.elapsed_sec;
            st.last_instant = now;
            (st.ema_speed, now.duration_since(st.start) < MEASURING_WINDOW)
        };
        let percent = if p.duration_sec > 0.0 { (p.elapsed_sec / p.duration_sec * 100.0).clamp(0.0, 100.0) } else { 0.0 };
        let speed_x_realtime = if measuring { None } else { speed };
        let eta_sec = match speed_x_realtime {
            Some(s) if s > 0.0 && p.duration_sec > 0.0 => Some(((p.duration_sec - p.elapsed_sec) / s).max(0.0)),
            _ => None,
        };
        let projected_final_bytes = (percent >= PROJECTION_MIN_PERCENT && p.bytes_written > 0).then(|| (p.bytes_written as f64 / (percent / 100.0)) as u64);

        let dto = PipelineProgressDto {
            task_id: progress_task_id.clone(),
            path: progress_path.clone(),
            stage: stage_label.to_string(),
            percent,
            speed_x_realtime,
            eta_sec,
            projected_final_bytes
        };
        if let Ok(mut current) = progress_app.state::<AppState>().current_task.lock() {
            *current = Some(CurrentTaskDto { task_id: dto.task_id.clone(), path: dto.path.clone(), stage: dto.stage.clone(), bytes_sent: None, total_bytes: None });
        }
        let _ = progress_app.emit("pipeline-progress", dto);
    };

    let blocking_task_id = task_id.clone();
    let blocking_input_path = input_path.clone();
    let cancel_for_blocking = cancel.clone();
    let result = tokio::task::spawn_blocking(move || {
        // Native FFI của ffmpeg-next chạy IN-PROCESS, CPU-bound (remux/decode) —
        // `spawn_blocking` để không giữ một worker thread Tokio async bận chờ
        // suốt quá trình đó (KHÔNG phải để né rủi ro segfault đã ghi ở ADR-0013 §
        // addendum 2026-09-03 — rủi ro đó đứng nguyên, không có cách nào tránh
        // được từ phía Rust an toàn, đã chấp nhận theo điều kiện áp dụng addendum
        // đó, kể cả nhánh `ReencodeAll` (Hạng D) mới thêm — LẦN ĐẦU crate này gọi
        // `avcodec_send_frame()` cho VIDEO, cùng lớp rủi ro đã gặp thật ở audio
        // lúc SPIKE-09, xem doc comment `ingest-ffmpeg/src/reencode.rs`).
        prepare_upload_blocking(&app, &blocking_task_id, &blocking_input_path, mode, &subtitle_tracks, &reencode_options, &on_progress, &cancel_for_blocking)
    })
    .await
    .map_err(|e| IngestRpcErrorDto::other(format!("tác vụ chuẩn bị upload panic: {e}")))?;

    *state.active_cancel.lock().await = None;
    result
}

/// Tạo thư mục tạm rồi chuẩn bị upload trong đó; LỖI (kể cả huỷ) giữa chừng thì dọn luôn thư mục — trước đây chỉ
/// `processItem()` dọn sau khi `prepare_upload` thành công, nên mỗi lần remux/nén lỗi để lại file dở nặng hàng GB
/// trong `%TEMP%` (phát hiện 2026-10-07 khi thử file thật).
#[allow(clippy::too_many_arguments)]
fn prepare_upload_blocking(
    app: &AppHandle,
    task_id: &str,
    input_path: &str,
    mode: RemuxModeDto,
    subtitle_tracks: &[SubtitleTrackDto],
    reencode_options: &ingest_ffmpeg::ReencodeOptions,
    on_progress: ingest_ffmpeg::PipelineProgressSink<'_>,
    cancel: &ingest_ffmpeg::CancelFlag
) -> Result<PreparedUploadDto, IngestRpcErrorDto> {
    let temp_dir = std::env::temp_dir().join(format!("tsmc-ingest-desktop-{}", unique_suffix()));
    std::fs::create_dir_all(&temp_dir).map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;
    let result = prepare_upload_in(&temp_dir, app, task_id, input_path, mode, subtitle_tracks, reencode_options, on_progress, cancel);
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn prepare_upload_in(
    temp_dir: &std::path::Path,
    app: &AppHandle,
    task_id: &str,
    input_path: &str,
    mode: RemuxModeDto,
    subtitle_tracks: &[SubtitleTrackDto],
    reencode_options: &ingest_ffmpeg::ReencodeOptions,
    on_progress: ingest_ffmpeg::PipelineProgressSink<'_>,
    cancel: &ingest_ffmpeg::CancelFlag
) -> Result<PreparedUploadDto, IngestRpcErrorDto> {

    let stem = std::path::Path::new(input_path).file_stem().and_then(|s| s.to_str()).unwrap_or("item");

    // Probe TRƯỚC remux/reencode chỉ để lấy duration_sec (nhẹ, không
    // decode/encode frame nào — probe() chỉ mở demuxer + đọc
    // AVCodecParameters, xem doc comment lib.rs). `final_probe` (SAU remux,
    // đọc container/codec/size THẬT của output) vẫn giữ nguyên vị trí cũ bên
    // dưới, KHÔNG bị thay thế bằng pre-probe này.
    let pre_probe = ingest_ffmpeg::probe(input_path).map_err(|e| IngestRpcErrorDto::other(format!("probe trước remux lỗi: {e}")))?;

    emit_stage(app, task_id, input_path, if matches!(mode, RemuxModeDto::ReencodeAll) { "reencoding" } else { "remuxing" });
    let remuxed_path = temp_dir.join(format!("{stem}.mp4"));
    let remuxed_path_str = remuxed_path.to_string_lossy().into_owned();
    match mode {
        RemuxModeDto::Copy => ingest_ffmpeg::remux(input_path, &remuxed_path_str, false, pre_probe.duration_sec, on_progress, cancel),
        RemuxModeDto::ReencodeAudio => ingest_ffmpeg::remux(input_path, &remuxed_path_str, true, pre_probe.duration_sec, on_progress, cancel),
        RemuxModeDto::ReencodeAll => ingest_ffmpeg::reencode_with_options(input_path, &remuxed_path_str, reencode_options, pre_probe.duration_sec, on_progress, cancel)
    }
    .map_err(|e| match e {
        ingest_ffmpeg::ProcessError::Cancelled => IngestRpcErrorDto::Cancelled,
        other => IngestRpcErrorDto::other(format!("remux/re-encode lỗi: {other}"))
    })?;

    let final_probe = ingest_ffmpeg::probe(&remuxed_path_str).map_err(|e| IngestRpcErrorDto::other(format!("probe lại sau remux lỗi: {e}")))?;
    // Chuẩn hoá size (2026-09-19, option A của brainstorm) — đọc dung lượng
    // THẬT ngay sau remux/re-encode, để Angular so với `get_max_upload_bytes()`
    // TRƯỚC khi gọi `upload_video()` (chặn sớm, không đợi tới lúc Telegram từ
    // chối `FileTooLarge` sau khi đã tốn thời gian remux). `std::fs::metadata`
    // lỗi ở đây là bất thường thật (vừa ghi xong `remuxed_path_str`), không
    // che bằng giá trị mặc định 0 (0 sẽ vô tình luôn "qua" mọi trần).
    let file_size_bytes = std::fs::metadata(&remuxed_path_str).map_err(|e| IngestRpcErrorDto::other(format!("đọc dung lượng file sau remux lỗi: {e}")))?.len();

    emit_stage(app, task_id, input_path, "generating_thumbnail");
    let seek_secs = (final_probe.duration_sec / 2.0).floor().max(1.0);
    let thumbnail_path = temp_dir.join("thumb.jpg");
    let thumbnail_path_str = thumbnail_path.to_string_lossy().into_owned();
    ingest_ffmpeg::extract_thumbnail(&remuxed_path_str, &thumbnail_path_str, seek_secs, Some(320)).map_err(|e| IngestRpcErrorDto::other(format!("sinh thumbnail lỗi: {e}")))?;

    let mut subtitles = Vec::new();
    if !subtitle_tracks.is_empty() {
        emit_stage(app, task_id, input_path, "extracting_subtitles");
        for track in subtitle_tracks {
            let sub_path = temp_dir.join(format!("sub-{}.srt", track.index));
            let sub_path_str = sub_path.to_string_lossy().into_owned();
            ingest_ffmpeg::extract_subtitles(input_path, &sub_path_str, Some(track.index as usize)).map_err(|e| IngestRpcErrorDto::other(format!("rút phụ đề lỗi: {e}")))?;
            subtitles.push(PreparedSubtitleDto { lang: track.lang.clone(), path: sub_path_str });
        }
    }

    Ok(PreparedUploadDto {
        temp_dir: temp_dir.to_string_lossy().into_owned(),
        remuxed_path: remuxed_path_str,
        thumbnail_path: thumbnail_path_str,
        subtitles,
        final_probe: ProbeResultDto::from_probe(final_probe, file_size_bytes),
        file_size_bytes
    })
}

/// Dọn thư mục tạm sau khi upload xong (thành công hay lỗi) — best-effort,
/// KHÔNG trả lỗi ra UI: dọn thất bại chỉ để lại rác trong temp của HĐH,
/// không ảnh hưởng kết quả upload đã xong.
#[tauri::command]
pub fn cleanup_temp_dir(dir_path: String) {
    let _ = std::fs::remove_dir_all(dir_path);
}

/// "Ước tính chính xác" của dialog tiền kiểm (Giai đoạn 2) — encode thử vài
/// đoạn ngắn bằng ĐÚNG tham số sẽ dùng thật, trả số thô cho TS ngoại suy. Cùng
/// `active_cancel` với `prepare_upload` nên nút Huỷ/`cancel_upload` dùng chung
/// (dialog tiền kiểm chạy TRƯỚC batch nên hai việc không bao giờ trùng nhau).
#[tauri::command]
pub async fn estimate_reencode(
    state: State<'_, AppState>,
    task_id: String,
    input_path: String,
    target_video_bitrate: Option<u64>,
    crf: Option<CrfRateDto>,
    two_pass: Option<bool>,
    preset: Option<String>,
    max_height: Option<u32>,
    audio_bitrate: Option<u32>
) -> Result<Vec<EstimateSampleDto>, IngestRpcErrorDto> {
    let cancel = ingest_ffmpeg::CancelFlag::new();
    *state.active_cancel.lock().await = Some((task_id, CancelHandle::Ffmpeg(cancel.clone())));

    let options = reencode_options_from(target_video_bitrate, crf, two_pass.unwrap_or(false), preset, max_height, audio_bitrate);
    let result = tokio::task::spawn_blocking(move || {
        let duration_sec = ingest_ffmpeg::probe(&input_path).map_err(|e| IngestRpcErrorDto::other(format!("probe trước ước tính lỗi: {e}")))?.duration_sec;
        let work_dir = std::env::temp_dir().join(format!("tsmc-ingest-desktop-estimate-{}", unique_suffix()));
        std::fs::create_dir_all(&work_dir).map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;
        let samples = ingest_ffmpeg::estimate_reencode(&input_path, &options, duration_sec, &work_dir, &cancel);
        let _ = std::fs::remove_dir_all(&work_dir);
        samples.map_err(|e| match e {
            ingest_ffmpeg::ProcessError::Cancelled => IngestRpcErrorDto::Cancelled,
            other => IngestRpcErrorDto::other(format!("encode thử lỗi: {other}"))
        })
    })
    .await
    .map_err(|e| IngestRpcErrorDto::other(format!("tác vụ ước tính panic: {e}")))?;

    *state.active_cancel.lock().await = None;
    result.map(|v| v.into_iter().map(EstimateSampleDto::from).collect())
}
