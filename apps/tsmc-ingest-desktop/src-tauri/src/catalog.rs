//! Năm Tauri command cho "Trình quản lý catalog" (A.4, ADR-0017 § addendum
//! "Trình quản lý catalog") — `check_deleted_messages`/`delete_message`
//! (đối soát chiều xuôi + xoá message), `scan_channel_videos` (đối soát
//! chiều ngược lại, 2026-09-16), `edit_message_caption` (sync hashtag
//! caption khi sửa metadata sau publish, 2026-09-18), cộng `download_document`
//! (2026-09-18, wire nốt cho ảnh xem trước poster ở dialog Sửa nâng cao —
//! ADR-0019 § addendum "Advanced Metadata Edit") — năm ngoại lệ `IngestRpc`
//! không có tương ứng 1-1 phía TS (xem doc comment `ingest-rpc-trait/src/lib.rs`).
//! Cả năm luôn thao tác trên `state.selected_channel` (không nhận
//! `ResolvedChannel` qua IPC), cùng quy ước với
//! `check_write_permission`/`read_pinned_catalog` ở `commands.rs`.

use base64::Engine;
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

/// Sửa lại caption của MỘT message đã upload — dùng để đồng bộ lại hashtag
/// khi admin sửa Title/Season/Ep/Năm ở bảng catalog SAU lúc publish ban đầu
/// (ADR-0019 § addendum 2026-09-18). Angular tự quyết dòng nào cần gọi
/// (diff `composeCaption()` cũ/mới theo `msgId`, không phải mọi lần Lưu đều
/// gọi cho toàn catalog) — command này chỉ thực thi ĐÚNG một lần sửa, không
/// tự so sánh gì.
#[tauri::command]
pub async fn edit_message_caption(state: State<'_, AppState>, msg_id: i64, caption: String) -> Result<(), IngestRpcErrorDto> {
    let conn = state.conn.lock().await;
    let ConnState::Ready { rpc, .. } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập xong"));
    };
    let selected = state.selected_channel.lock().await;
    let channel = selected.as_ref().ok_or_else(|| IngestRpcErrorDto::other("chưa resolve_channel() — gọi trước edit_message_caption()"))?;
    rpc.edit_message_caption(channel, msg_id, caption).await.map_err(IngestRpcErrorDto::from)
}

/// Tải nguyên byte của một document theo `msg_id` — dùng để hiện ảnh xem
/// trước poster ở dialog "Sửa nâng cao" (item ĐÃ có `poster.msgId` từ một
/// lần upload trước, Trình quản lý catalog). Trả về base64 (không phải
/// `Vec<u8>` trần) — ranh giới IPC của Tauri serialize `Vec<u8>` thành mảng
/// số JSON, phình gấp nhiều lần so với base64 cho ảnh vài trăm KB.
#[tauri::command]
pub async fn download_document(state: State<'_, AppState>, msg_id: i64) -> Result<String, IngestRpcErrorDto> {
    let conn = state.conn.lock().await;
    let ConnState::Ready { rpc, .. } = &*conn else {
        return Err(IngestRpcErrorDto::other("chưa đăng nhập xong"));
    };
    let selected = state.selected_channel.lock().await;
    let channel = selected.as_ref().ok_or_else(|| IngestRpcErrorDto::other("chưa resolve_channel() — gọi trước download_document()"))?;
    let bytes = rpc.download_document(channel, msg_id).await.map_err(IngestRpcErrorDto::from)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}
