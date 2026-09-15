//! Ba thao tác `IngestRpc` cho luồng upload đưa vào Tauri command —
//! `upload_video`/`upload_subtitle`/`publish_catalog` (`download_document`
//! vẫn để trống — đối soát ở "Trình quản lý catalog" dùng
//! `catalog.rs::check_deleted_messages`, không cần tải lại nội dung file).
//! Cộng
//! `cancel_upload`/`get_current_task`/`clear_current_task` — không thuộc
//! `IngestRpc` (thao tác điều khiển phía client, không phải RPC MTProto),
//! đọc/ghi `AppState::active_cancel`/`current_task` (ADR-0018).
//!
//! Luôn thao tác trên `state.selected_channel` (không nhận `ResolvedChannel`
//! qua IPC) — cùng quy ước với `check_write_permission`/`read_pinned_catalog`
//! ở `commands.rs`.

use ingest_rpc_trait::{CancelFlag, IngestRpc, SubtitleUploadInput, VideoUploadInput};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dto::{CurrentTaskDto, IngestRpcErrorDto, UploadProgressDto, UploadedRefDto};
use crate::state::{AppState, ConnState};

/// Upload video kèm `DocumentAttributeVideo`/thumbnail — thao tác DUY NHẤT
/// cần tiến trình/huỷ (đủ lớn/đủ lâu để cần, SPIKE-10 M4/M5). Tiến trình bắn
/// qua sự kiện `"upload-progress"` (không phải giá trị trả về — một lần gọi
/// có NHIỀU lần cập nhật); `task_id` (UUID Angular sinh) đóng vai correlation
/// id (ADR-0018) — KHÔNG còn `file_path`, vì path đổi tên/đổi đuôi qua từng
/// bước pipeline (remux → thumbnail...) nên không ổn định làm khoá.
// 10 tham số (2 cái đầu do Tauri tự bơm vào, không phải payload IPC thật) —
// giữ flat args thay vì gộp thành một struct request để nhất quán với các
// command khác trong file này (`select_channel` cũng flat args) thay vì chỉ
// một command dùng struct còn lại thì không.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn upload_video(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    file_path: String,
    file_name: String,
    width: u32,
    height: u32,
    duration_sec: u32,
    thumbnail_path: Option<String>,
    caption: Option<String>,
) -> Result<UploadedRefDto, IngestRpcErrorDto> {
    let cancel = CancelFlag::new();
    *state.active_cancel.lock().await = Some((task_id.clone(), cancel.clone()));

    let progress_task_id = task_id.clone();
    let progress_path = file_path.clone();
    // `app.state::<AppState>()` (không phải capture thẳng `state` tham số) —
    // closure này `move` cả `app`, và `state` (tham số hàm) còn cần dùng lại
    // NGAY SAU đây (`state.conn.lock()`...); mượn lại qua `AppHandle` (đã
    // move sẵn vào closure để `.emit()`) tránh xung đột borrow/move.
    let on_progress = move |p: ingest_rpc_trait::UploadProgress| {
        if let Ok(mut current) = app.state::<AppState>().current_task.lock() {
            *current = Some(CurrentTaskDto {
                task_id: progress_task_id.clone(),
                path: progress_path.clone(),
                stage: "uploading_video".to_string(),
                bytes_sent: Some(p.bytes_sent),
                total_bytes: Some(p.total_bytes)
            });
        }
        let _ = app.emit("upload-progress", UploadProgressDto::new(progress_task_id.clone(), progress_path.clone(), p));
    };

    let result = {
        let conn = state.conn.lock().await;
        let ConnState::Ready { rpc, .. } = &*conn else {
            return Err(IngestRpcErrorDto::other("chưa đăng nhập xong"));
        };
        let selected = state.selected_channel.lock().await;
        let channel = selected.as_ref().ok_or_else(|| IngestRpcErrorDto::other("chưa chọn kênh — gọi resolve_channel()/select_channel() trước upload_video()"))?;

        let input = VideoUploadInput {
            file_path: file_path.into(),
            file_name,
            mime_type: None,
            width,
            height,
            duration_sec,
            thumbnail_path: thumbnail_path.map(Into::into),
            caption
        };
        rpc.upload_video(channel, input, &on_progress, &cancel).await
    };

    *state.active_cancel.lock().await = None;
    result.map(UploadedRefDto::from).map_err(IngestRpcErrorDto::from)
}

/// Upload phụ đề (`forceDocument`, không có attribute streaming) — file nhỏ,
/// không cần tiến trình/huỷ riêng.
#[tauri::command]
pub async fn upload_subtitle(state: State<'_, AppState>, file_path: String, file_name: String) -> Result<UploadedRefDto, IngestRpcErrorDto> {
    let conn = state.conn.lock().await;
    let ConnState::Ready { rpc, .. } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập xong"));
    };
    let selected = state.selected_channel.lock().await;
    let channel = selected.as_ref().ok_or_else(|| IngestRpcErrorDto::other("chưa chọn kênh — gọi resolve_channel()/select_channel() trước upload_subtitle()"))?;

    let input = SubtitleUploadInput { file_path: file_path.into(), file_name };
    rpc.upload_subtitle(channel, input).await.map(UploadedRefDto::from).map_err(IngestRpcErrorDto::from)
}

/// `sendFile → pinMessage → deleteMessages(previous)` — ghim TRƯỚC, xoá bản
/// cũ SAU (kênh không bao giờ thiếu catalog dù chỉ một khoảnh khắc). Gọi
/// ĐÚNG MỘT LẦN cho cả batch (sau khi mọi item đã upload xong) — giảm cửa sổ
/// `FLOOD_WAIT` giữa 3 RPC so với publish từng item một (ADR-0013).
#[tauri::command]
pub async fn publish_catalog(state: State<'_, AppState>, json: String, previous_msg_id: Option<i64>) -> Result<UploadedRefDto, IngestRpcErrorDto> {
    let conn = state.conn.lock().await;
    let ConnState::Ready { rpc, .. } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập xong"));
    };
    let selected = state.selected_channel.lock().await;
    let channel = selected.as_ref().ok_or_else(|| IngestRpcErrorDto::other("chưa chọn kênh — gọi resolve_channel()/select_channel() trước publish_catalog()"))?;

    rpc.publish_catalog(channel, json.as_bytes(), previous_msg_id).await.map(UploadedRefDto::from).map_err(IngestRpcErrorDto::from)
}

/// Huỷ lần `upload_video()` ĐANG chạy, nếu `task_id` khớp — idempotent
/// (ADR-0018): no-op an toàn nếu không có gì đang upload, HOẶC nếu task đang
/// giữ cờ không khớp `task_id` truyền vào (task đó đã xong/lỗi, và lệnh huỷ
/// trễ này lỡ tới đúng lúc `active_cancel` đã được set lại cho file KẾ TIẾP
/// trong queue — so khớp id tránh huỷ nhầm file đó).
#[tauri::command]
pub async fn cancel_upload(state: State<'_, AppState>, task_id: String) -> Result<(), IngestRpcErrorDto> {
    if let Some((active_id, flag)) = state.active_cancel.lock().await.as_ref() {
        if *active_id == task_id {
            flag.cancel();
        }
    }
    Ok(())
}

/// Đọc snapshot task đang chạy (ADR-0018 mục 5) — Angular gọi lúc
/// `WorkspaceComponent` remount, SAU KHI đã đăng ký xong listener
/// `"upload-progress"`/`"pipeline-stage"` (thứ tự bắt buộc, tránh lọt mất
/// event phát ra đúng lúc đang chờ response lệnh này). `None` nếu không có
/// gì đang chạy (kể cả lúc đang ở giữa `uploading_subtitles`/`publish` —
/// những bước đó KHÔNG bắn event Rust nên không cập nhật snapshot, giữ
/// nguyên "uploading_video" cuối cùng đã biết; đây là giới hạn đã biết,
/// không phải bug — xem changelog slice thêm command này).
#[tauri::command]
pub fn get_current_task(state: State<'_, AppState>) -> Result<Option<CurrentTaskDto>, IngestRpcErrorDto> {
    state.current_task.lock().map(|guard| guard.clone()).map_err(|_| IngestRpcErrorDto::other("current_task lock poisoned"))
}

/// Xoá snapshot task — gọi bởi Angular NGAY khi một item hoàn tất (thành
/// công/lỗi/huỷ), không phải lúc `upload_video()` (Rust) trả về, vì item còn
/// có thể ở bước `uploading_subtitles` sau đó (Angular tự set stage, Rust
/// không biết) — xoá quá sớm sẽ khiến hydrate thấy "không có gì đang chạy"
/// dù item thật ra chưa xong. So khớp `task_id` trước khi xoá (idempotent,
/// cùng nguyên tắc `cancel_upload`): không xoá NHẦM snapshot của task MỚI
/// nếu lệnh này tới trễ sau khi task kế tiếp đã bắt đầu.
#[tauri::command]
pub fn clear_current_task(state: State<'_, AppState>, task_id: String) -> Result<(), IngestRpcErrorDto> {
    let mut current = state.current_task.lock().map_err(|_| IngestRpcErrorDto::other("current_task lock poisoned"))?;
    if current.as_ref().is_some_and(|t| t.task_id == task_id) {
        *current = None;
    }
    Ok(())
}
