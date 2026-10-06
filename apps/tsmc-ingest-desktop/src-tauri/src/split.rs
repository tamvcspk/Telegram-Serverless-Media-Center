//! Chia file thành nhiều phần — các command của Giai đoạn 4 (ADR-0022). Chỉ
//! THỰC THI: điểm cắt do TypeScript chọn (`planSplit()` ở `libs/core-ingest`,
//! ADR-0017 điều kiện bắt buộc #4); phụ đề được rebase ở TypeScript
//! (`rebaseSubtitle()`), phía Rust chỉ đọc/ghi hộ file text trong thư mục tạm.

use std::time::Instant;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::dto::{CurrentTaskDto, IngestRpcErrorDto, PipelineProgressDto, ProbeResultDto, SplitPartDto, SplitScanDto};
use crate::state::{AppState, CancelHandle};

/// Phụ đề lớn hơn mức này là bất thường (file SRT thật chỉ vài trăm KB).
const MAX_SUBTITLE_BYTES: u64 = 20 * 1024 * 1024;
const TEMP_DIR_PREFIX: &str = "tsmc-ingest-desktop-";

fn map_process_error(context: &str, e: ingest_ffmpeg::ProcessError) -> IngestRpcErrorDto {
    match e {
        ingest_ffmpeg::ProcessError::Cancelled => IngestRpcErrorDto::Cancelled,
        other => IngestRpcErrorDto::other(format!("{context}: {other}")),
    }
}

fn set_current_stage(app: &AppHandle, task_id: &str, path: &str) {
    if let Ok(mut current) = app.state::<AppState>().current_task.lock() {
        *current = Some(CurrentTaskDto { task_id: task_id.to_string(), path: path.to_string(), stage: "splitting".to_string(), bytes_sent: None, total_bytes: None });
    }
}

/// Liệt kê keyframe làm ứng viên điểm cắt của `input_path` (file đã remux).
/// Cùng `active_cancel` với `prepare_upload` nên `cancel_upload` dùng chung.
#[tauri::command]
pub async fn scan_split_candidates(app: AppHandle, state: State<'_, AppState>, task_id: String, input_path: String) -> Result<SplitScanDto, IngestRpcErrorDto> {
    let cancel = ingest_ffmpeg::CancelFlag::new();
    *state.active_cancel.lock().await = Some((task_id.clone(), CancelHandle::Ffmpeg(cancel.clone())));
    set_current_stage(&app, &task_id, &input_path);
    let result = tokio::task::spawn_blocking(move || ingest_ffmpeg::scan_keyframes(&input_path, &cancel))
        .await
        .map_err(|e| IngestRpcErrorDto::other(format!("tác vụ quét keyframe panic: {e}")))?;
    *state.active_cancel.lock().await = None;
    result.map(SplitScanDto::from).map_err(|e| map_process_error("quét keyframe lỗi", e))
}

/// Cắt `input_path` tại `cut_times_sec` (phải lấy từ `scan_split_candidates`) ra
/// `temp_dir` rồi probe + sinh thumbnail cho từng phần. `temp_dir` là thư mục tạm
/// của `prepare_upload` — dọn chung bằng `cleanup_temp_dir`.
#[tauri::command]
pub async fn split_video(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    input_path: String,
    temp_dir: String,
    stem: String,
    cut_times_sec: Vec<f64>,
) -> Result<Vec<SplitPartDto>, IngestRpcErrorDto> {
    ensure_temp_dir(&temp_dir)?;
    let cancel = ingest_ffmpeg::CancelFlag::new();
    *state.active_cancel.lock().await = Some((task_id.clone(), CancelHandle::Ffmpeg(cancel.clone())));
    set_current_stage(&app, &task_id, &input_path);

    let progress_app = app.clone();
    let progress_task = task_id.clone();
    let progress_path = input_path.clone();
    let result = tokio::task::spawn_blocking(move || -> Result<Vec<SplitPartDto>, IngestRpcErrorDto> {
        let duration_sec = ingest_ffmpeg::probe(&input_path).map_err(|e| IngestRpcErrorDto::other(format!("probe trước khi cắt lỗi: {e}")))?.duration_sec;
        let started = Instant::now();
        let on_progress = move |p: ingest_ffmpeg::PipelineProgress| {
            let percent = if p.duration_sec > 0.0 { (p.elapsed_sec / p.duration_sec * 100.0).clamp(0.0, 100.0) } else { 0.0 };
            let wall = started.elapsed().as_secs_f64();
            let speed = (wall > 0.0).then(|| p.elapsed_sec / wall);
            let _ = progress_app.emit(
                "pipeline-progress",
                PipelineProgressDto {
                    task_id: progress_task.clone(),
                    path: progress_path.clone(),
                    stage: "splitting".to_string(),
                    percent,
                    speed_x_realtime: speed,
                    eta_sec: speed.filter(|s| *s > 0.0).map(|s| ((p.duration_sec - p.elapsed_sec) / s).max(0.0)),
                    projected_final_bytes: None,
                },
            );
        };
        let paths = ingest_ffmpeg::split_at(&input_path, &temp_dir, &stem, &cut_times_sec, duration_sec, &on_progress, &cancel).map_err(|e| map_process_error("cắt file lỗi", e))?;

        let mut parts = Vec::with_capacity(paths.len());
        for path in paths {
            let probe = ingest_ffmpeg::probe(&path).map_err(|e| IngestRpcErrorDto::other(format!("probe phần đã cắt lỗi: {e}")))?;
            let file_size_bytes = std::fs::metadata(&path).map_err(|e| IngestRpcErrorDto::other(format!("đọc dung lượng phần đã cắt lỗi: {e}")))?.len();
            let thumbnail_path = format!("{path}.jpg");
            let seek_secs = (probe.duration_sec / 2.0).floor().max(1.0);
            ingest_ffmpeg::extract_thumbnail(&path, &thumbnail_path, seek_secs, Some(320)).map_err(|e| IngestRpcErrorDto::other(format!("sinh thumbnail phần đã cắt lỗi: {e}")))?;
            parts.push(SplitPartDto { path, thumbnail_path, file_size_bytes, final_probe: ProbeResultDto::from_probe(probe, file_size_bytes) });
        }
        Ok(parts)
    })
    .await
    .map_err(|e| IngestRpcErrorDto::other(format!("tác vụ cắt file panic: {e}")))?;

    *state.active_cancel.lock().await = None;
    result
}

/// Chỉ nhận thư mục tạm do `prepare_upload` tạo (`<temp>/tsmc-ingest-desktop-*`)
/// — webview không được dùng command này để ghi/đọc đường dẫn tuỳ ý.
fn ensure_temp_dir(dir: &str) -> Result<(), IngestRpcErrorDto> {
    let path = std::path::Path::new(dir);
    let in_temp = path.parent() == Some(std::env::temp_dir().as_path());
    let named_ok = path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(TEMP_DIR_PREFIX));
    if in_temp && named_ok && path.is_dir() {
        Ok(())
    } else {
        Err(IngestRpcErrorDto::other("thư mục không phải thư mục tạm của ứng dụng"))
    }
}

/// Đọc phụ đề text (.srt/.vtt) để TypeScript rebase theo phần. Từ chối đuôi
/// khác và file quá lớn.
#[tauri::command]
pub fn read_subtitle_text(path: String) -> Result<String, IngestRpcErrorDto> {
    let p = std::path::Path::new(&path);
    let ext_ok = p.extension().and_then(|e| e.to_str()).is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "srt" | "vtt"));
    if !ext_ok {
        return Err(IngestRpcErrorDto::other("chỉ đọc được phụ đề .srt/.vtt"));
    }
    let len = std::fs::metadata(p).map_err(|e| IngestRpcErrorDto::other(format!("đọc phụ đề lỗi: {e}")))?.len();
    if len > MAX_SUBTITLE_BYTES {
        return Err(IngestRpcErrorDto::other("file phụ đề quá lớn"));
    }
    let bytes = std::fs::read(p).map_err(|e| IngestRpcErrorDto::other(format!("đọc phụ đề lỗi: {e}")))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Ghi phụ đề đã rebase vào thư mục tạm của `prepare_upload`, trả đường dẫn để
/// `upload_subtitle`. `file_name` chỉ là tên file (không có dấu phân cách đường dẫn).
#[tauri::command]
pub fn write_temp_text_file(temp_dir: String, file_name: String, content: String) -> Result<String, IngestRpcErrorDto> {
    ensure_temp_dir(&temp_dir)?;
    if file_name.is_empty() || file_name.contains(['/', '\\', ':']) || file_name == "." || file_name == ".." {
        return Err(IngestRpcErrorDto::other("tên file không hợp lệ"));
    }
    let path = std::path::Path::new(&temp_dir).join(file_name);
    std::fs::write(&path, content).map_err(|e| IngestRpcErrorDto::other(format!("ghi file tạm lỗi: {e}")))?;
    Ok(path.to_string_lossy().into_owned())
}
