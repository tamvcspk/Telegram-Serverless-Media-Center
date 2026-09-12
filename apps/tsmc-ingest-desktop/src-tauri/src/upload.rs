//! Ba thao tác `IngestRpc` cuối cùng đưa vào Tauri command — `upload_video`/
//! `upload_subtitle`/`publish_catalog` (`download_document` để dành khi màn
//! "Trình quản lý catalog" cần đối soát, chưa cần cho luồng upload). Cộng
//! `cancel_upload` — không thuộc `IngestRpc` (thao tác điều khiển phía
//! client, không phải RPC MTProto), đọc/`cancel()` `AppState::active_cancel`.
//!
//! Luôn thao tác trên `state.selected_channel` (không nhận `ResolvedChannel`
//! qua IPC) — cùng quy ước với `check_write_permission`/`read_pinned_catalog`
//! ở `commands.rs`.

use ingest_rpc_trait::{CancelFlag, IngestRpc, SubtitleUploadInput, VideoUploadInput};
use tauri::{AppHandle, Emitter, State};

use crate::dto::{IngestRpcErrorDto, UploadProgressDto, UploadedRefDto};
use crate::state::{AppState, ConnState};

/// Upload video kèm `DocumentAttributeVideo`/thumbnail — thao tác DUY NHẤT
/// cần tiến trình/huỷ (đủ lớn/đủ lâu để cần, SPIKE-10 M4/M5). Tiến trình bắn
/// qua sự kiện `"upload-progress"` (không phải giá trị trả về — một lần gọi
/// có NHIỀU lần cập nhật); `file_path` đóng vai correlation id (CLAUDE.md).
// 9 tham số (2 cái đầu do Tauri tự bơm vào, không phải payload IPC thật) —
// giữ flat args thay vì gộp thành một struct request để nhất quán với các
// command khác trong file này (`select_channel` cũng flat args) thay vì chỉ
// một command dùng struct còn lại thì không.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn upload_video(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    file_name: String,
    width: u32,
    height: u32,
    duration_sec: u32,
    thumbnail_path: Option<String>,
    caption: Option<String>,
) -> Result<UploadedRefDto, IngestRpcErrorDto> {
    let cancel = CancelFlag::new();
    *state.active_cancel.lock().await = Some(cancel.clone());

    let progress_path = file_path.clone();
    let on_progress = move |p: ingest_rpc_trait::UploadProgress| {
        let _ = app.emit("upload-progress", UploadProgressDto::new(progress_path.clone(), p));
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

/// Huỷ lần `upload_video()` ĐANG chạy, nếu có — no-op an toàn nếu không có
/// gì đang upload (vd bấm huỷ đúng lúc RPC vừa xong). KHÔNG cần tham số nào:
/// pipeline hiện tại tuần tự, chỉ có tối đa MỘT upload video sống một lúc.
#[tauri::command]
pub async fn cancel_upload(state: State<'_, AppState>) -> Result<(), IngestRpcErrorDto> {
    if let Some(flag) = state.active_cancel.lock().await.as_ref() {
        flag.cancel();
    }
    Ok(())
}
