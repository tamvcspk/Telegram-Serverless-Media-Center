mod commands;
mod dto;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Bật cả ở release, không chỉ debug — công cụ desktop nội bộ của
            // admin (không phải đường chạy người xem, ADR-0001 không áp
            // dụng), log chỉ ghi thao tác giao thức MTProto cấp thấp (connect,
            // salt...), không có auth_key/session token. Gỡ gate
            // `cfg!(debug_assertions)` sau khi phát hiện thật: thiếu log ở
            // bản release khiến không debug được lỗi đăng nhập report qua
            // `cargo tauri build` (2026-09-11) — xem README.md § Xử lý sự cố.
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            Ok(())
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::check_session,
            commands::request_login_code,
            commands::submit_otp,
            commands::submit_password,
            commands::load_saved_credentials,
            commands::save_credentials,
            commands::resolve_channel,
            commands::list_own_channels,
            commands::create_channel,
            commands::select_channel,
            commands::check_write_permission,
            commands::read_pinned_catalog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
