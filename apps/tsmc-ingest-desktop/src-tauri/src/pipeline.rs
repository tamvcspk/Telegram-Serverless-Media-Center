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
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};

use crate::dto::{CurrentTaskDto, IngestRpcErrorDto, PipelineStageDto, PreparedSubtitleDto, PreparedUploadDto, ProbeResultDto, RemuxModeDto, SubtitleTrackDto};
use crate::state::AppState;

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

fn unique_suffix() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{nanos}-{n}")
}

#[tauri::command]
pub async fn prepare_upload(app: AppHandle, task_id: String, input_path: String, mode: RemuxModeDto, subtitle_tracks: Vec<SubtitleTrackDto>) -> Result<PreparedUploadDto, IngestRpcErrorDto> {
    // Native FFI của ffmpeg-next chạy IN-PROCESS, CPU-bound (remux/decode) —
    // `spawn_blocking` để không giữ một worker thread Tokio async bận chờ
    // suốt quá trình đó (KHÔNG phải để né rủi ro segfault đã ghi ở ADR-0013 §
    // addendum 2026-09-03 — rủi ro đó đứng nguyên, không có cách nào tránh
    // được từ phía Rust an toàn, đã chấp nhận theo điều kiện áp dụng addendum
    // đó, kể cả nhánh `ReencodeAll` (Hạng D) mới thêm — LẦN ĐẦU crate này gọi
    // `avcodec_send_frame()` cho VIDEO, cùng lớp rủi ro đã gặp thật ở audio
    // lúc SPIKE-09, xem doc comment `ingest-ffmpeg/src/reencode.rs`).
    tokio::task::spawn_blocking(move || prepare_upload_blocking(&app, &task_id, &input_path, mode, &subtitle_tracks))
        .await
        .map_err(|e| IngestRpcErrorDto::other(format!("tác vụ chuẩn bị upload panic: {e}")))?
}

fn prepare_upload_blocking(app: &AppHandle, task_id: &str, input_path: &str, mode: RemuxModeDto, subtitle_tracks: &[SubtitleTrackDto]) -> Result<PreparedUploadDto, IngestRpcErrorDto> {
    let temp_dir = std::env::temp_dir().join(format!("tsmc-ingest-desktop-{}", unique_suffix()));
    std::fs::create_dir_all(&temp_dir).map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;

    let stem = std::path::Path::new(input_path).file_stem().and_then(|s| s.to_str()).unwrap_or("item");

    emit_stage(app, task_id, input_path, if matches!(mode, RemuxModeDto::ReencodeAll) { "reencoding" } else { "remuxing" });
    let remuxed_path = temp_dir.join(format!("{stem}.mp4"));
    let remuxed_path_str = remuxed_path.to_string_lossy().into_owned();
    match mode {
        RemuxModeDto::Copy => ingest_ffmpeg::remux(input_path, &remuxed_path_str, false),
        RemuxModeDto::ReencodeAudio => ingest_ffmpeg::remux(input_path, &remuxed_path_str, true),
        RemuxModeDto::ReencodeAll => ingest_ffmpeg::reencode_to_mp4(input_path, &remuxed_path_str)
    }
    .map_err(|e| IngestRpcErrorDto::other(format!("remux/re-encode lỗi: {e}")))?;

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
        final_probe: ProbeResultDto::from(final_probe),
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
