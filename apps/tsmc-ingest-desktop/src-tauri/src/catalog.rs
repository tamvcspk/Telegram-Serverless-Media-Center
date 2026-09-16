//! Ba Tauri command cho "Trình quản lý catalog" (A.4, ADR-0017 § addendum
//! "Trình quản lý catalog") — `check_deleted_messages`/`delete_message`
//! (đối soát chiều xuôi + xoá message), cộng `scan_channel_videos` (đối
//! soát chiều ngược lại, 2026-09-16) — ba ngoại lệ `IngestRpc` không có
//! tương ứng 1-1 phía TS (xem doc comment `ingest-rpc-trait/src/lib.rs`). Cả
//! ba luôn thao tác trên `state.selected_channel` (không nhận
//! `ResolvedChannel` qua IPC), cùng quy ước với
//! `check_write_permission`/`read_pinned_catalog` ở `commands.rs`.
//!
//! `download_document` (đã có implementation ở `ingest-grammers`) VẪN
//! chưa wire — đối soát ở màn này chỉ cần biết message còn tồn tại hay
//! không (`check_deleted_messages`), không cần tải lại nội dung file; để
//! trống là có chủ đích, không phải bị bỏ quên.

use ingest_rpc_trait::IngestRpc;
use tauri::State;

use crate::dto::{ChannelVideoDocumentDto, IngestRpcErrorDto};
use crate::state::{AppState, ConnState};

/// Đối soát: kiểm tra tập `msg_id` mà catalog.json đang tham chiếu còn tồn
/// tại trên kênh không — trả đúng tập con KHÔNG còn tồn tại (rỗng nếu catalog
/// lành mạnh).
#[tauri::command]
pub async fn check_deleted_messages(state: State<'_, AppState>, msg_ids: Vec<i64>) -> Result<Vec<i64>, IngestRpcErrorDto> {
    let conn = state.conn.lock().await;
    let ConnState::Ready { rpc, .. } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập xong"));
    };
    let selected = state.selected_channel.lock().await;
    let channel = selected.as_ref().ok_or_else(|| IngestRpcErrorDto::other("chưa resolve_channel() — gọi trước check_deleted_messages()"))?;
    rpc.check_deleted_messages(channel, &msg_ids).await.map_err(IngestRpcErrorDto::from)
}

/// Xoá HẲN một message khỏi kênh — dùng khi user chọn "Xoá khỏi catalog +
/// xoá message trên kênh". KHÔNG tự đụng gì tới catalog.json — bên gọi
/// (Angular) tự gỡ entry khỏi mảng đang sửa rồi `publish_catalog` riêng, hai
/// bước tách biệt (xoá message là hành động mạng không hoàn tác được, xảy ra
/// ngay lúc xác nhận; catalog.json chỉ đổi thật khi bấm "Lưu catalog").
#[tauri::command]
pub async fn delete_message(state: State<'_, AppState>, msg_id: i64) -> Result<(), IngestRpcErrorDto> {
    let conn = state.conn.lock().await;
    let ConnState::Ready { rpc, .. } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập xong"));
    };
    let selected = state.selected_channel.lock().await;
    let channel = selected.as_ref().ok_or_else(|| IngestRpcErrorDto::other("chưa resolve_channel() — gọi trước delete_message()"))?;
    rpc.delete_message(channel, msg_id).await.map_err(IngestRpcErrorDto::from)
}

/// Đối soát chiều ngược lại: quét TOÀN BỘ lịch sử kênh, trả mọi video
/// document tìm thấy (thô, chưa so với catalog — Angular tự tính hiệu tập
/// hợp với `items()` đang sửa).
#[tauri::command]
pub async fn scan_channel_videos(state: State<'_, AppState>) -> Result<Vec<ChannelVideoDocumentDto>, IngestRpcErrorDto> {
    let conn = state.conn.lock().await;
    let ConnState::Ready { rpc, .. } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập xong"));
    };
    let selected = state.selected_channel.lock().await;
    let channel = selected.as_ref().ok_or_else(|| IngestRpcErrorDto::other("chưa resolve_channel() — gọi trước scan_channel_videos()"))?;
    let docs = rpc.scan_channel_videos(channel).await.map_err(IngestRpcErrorDto::from)?;
    Ok(docs.into_iter().map(Into::into).collect())
}
