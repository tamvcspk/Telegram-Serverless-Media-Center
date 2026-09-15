//! "Nhật ký" (A.4, docs/ux-design.md § Phụ lục A.4) — đọc lại file log kỹ
//! thuật mà `tauri_plugin_log` đã ghi từ lâu (`lib.rs::run()`, bật cả ở
//! release, không chỉ debug — log chỉ ghi thao tác giao thức MTProto cấp
//! thấp: connect, salt, request/response... KHÔNG có `auth_key`/session
//! token, xem doc comment ở đó). Trước slice này, log chỉ xem được bằng cách
//! tự mở file ở app-data — màn này chỉ HIỂN THỊ + cho copy, không đổi cách
//! ghi log đã có.
//!
//! Đường dẫn phải TỰ TÁI TẠO đúng công thức nội bộ của plugin — không có API
//! công khai để hỏi lại nó (`Target::LogDir { file_name: None }` tự đặt tên
//! `app_log_dir()/<package_info().name>.log`, xem
//! `tauri-plugin-log-2.9.1/src/lib.rs` — `file_name.unwrap_or(app_name)` với
//! `app_name = app_handle.package_info().name`, cùng giá trị ta đọc lại ở
//! dưới). Rotation mặc định của plugin là `KeepOne` (giữ đúng MỘT file, xoá
//! hẳn bản cũ khi vượt 40KB) — nên đọc trọn file không cần tự giới hạn thêm.

use tauri::{AppHandle, Manager};

fn log_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{}.log", app.package_info().name)))
}

/// Đọc toàn bộ file log hiện tại. Trả chuỗi rỗng (không phải lỗi) nếu file
/// chưa tồn tại — chưa có gì được ghi (app vừa cài, hoặc chưa gặp sự kiện nào
/// đáng log) là trạng thái bình thường, không phải sự cố.
#[tauri::command]
pub fn read_app_log(app: AppHandle) -> Result<String, String> {
    let path = log_file_path(&app)?;
    match std::fs::read(&path) {
        Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string())
    }
}
