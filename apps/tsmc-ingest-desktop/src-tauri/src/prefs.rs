//! Tuỳ chọn giao diện nhớ ở app-data (`ui_prefs.json`) — KHÔNG `localStorage`:
//! origin webview khác nhau giữa `cargo tauri dev` và bản release nên không
//! chia sẻ (bài học 2026-09-11, xem `SavedCredentialsDto`). Không bí mật nên
//! ghi file thường, không qua `secret_store`. Best-effort: lỗi đọc/ghi chỉ làm
//! mất tiện nghi nhớ lựa chọn, không chặn luồng nào.

use tauri::{AppHandle, Manager};

use crate::dto::UiPrefsDto;

fn prefs_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("ui_prefs.json"))
}

#[tauri::command]
pub fn load_ui_prefs(app: AppHandle) -> UiPrefsDto {
    prefs_path(&app).and_then(|p| std::fs::read_to_string(p).ok()).and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
}

#[tauri::command]
pub fn save_ui_prefs(app: AppHandle, prefs: UiPrefsDto) {
    let Some(path) = prefs_path(&app) else { return };
    if let Ok(raw) = serde_json::to_string_pretty(&prefs) {
        let _ = std::fs::write(path, raw);
    }
}
