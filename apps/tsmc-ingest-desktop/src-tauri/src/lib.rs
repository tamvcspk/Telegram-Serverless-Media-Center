mod catalog;
mod commands;
mod dto;
mod logs;
mod pipeline;
mod probe;
mod secret_store;
mod state;
mod tmdb;
mod upload;

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
        .plugin(tauri_plugin_clipboard_manager::init())
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
            commands::sign_out,
            catalog::check_deleted_messages,
            catalog::delete_message,
            probe::list_media_files,
            probe::probe_media,
            probe::list_dir_entries,
            pipeline::prepare_upload,
            pipeline::cleanup_temp_dir,
            upload::upload_video,
            upload::upload_subtitle,
            upload::publish_catalog,
            upload::cancel_upload,
            upload::get_current_task,
            upload::clear_current_task,
            tmdb::tmdb_has_key,
            tmdb::tmdb_save_key,
            tmdb::tmdb_delete_key,
            tmdb::tmdb_search,
            logs::read_app_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
