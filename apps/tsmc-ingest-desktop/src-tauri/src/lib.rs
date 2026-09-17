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
            //
            // Mức `Debug` (đổi từ `Info` ban đầu, 2026-09-15) — bug thật phát
            // hiện lúc verify màn "Nhật ký": ở mức `Info`, sau lần
            // connect/sinh auth_key đầu phiên, MỌI request/response MTProto
            // bình thường (`get_messages_by_id`, `sendFile`...) không sinh
            // dòng log nào — `grammers-mtsender`/`grammers-mtproto` chỉ log
            // các bước gửi/nhận/lỗi TỪNG request ở mức `debug!`/`trace!`
            // (`sender.rs::on_net_write/process_result/process_error`), Info
            // chỉ còn bắt được sự kiện hiếm (connect, sinh auth_key, cảnh
            // báo/lỗi) — khiến nút "Làm mới" trông như không hoạt động dù
            // code đúng. Đã ĐỐI CHIẾU TRỰC TIẾP mã nguồn `grammers-mtsender`/
            // `grammers-mtproto`/`grammers-client` 0.10.0 trước khi đổi: các
            // dòng `debug!`/`trace!` chỉ in `msg_id`/tên kiểu TL (`tl::
            // name_for_id`)/số byte/mã lỗi RPC — KHÔNG có dòng nào in giá trị
            // trường request (số điện thoại, mã OTP, mật khẩu 2FA) hay
            // `auth_key`, giữ đúng cam kết "không log session/token" của
            // mockup A.4. KHÔNG bật `Trace` (thêm cả nội dung buffer byte
            // thô, không cần thiết cho mục đích "dán khi báo lỗi").
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Debug)
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
            catalog::scan_channel_videos,
            catalog::edit_message_caption,
            probe::list_media_files,
            probe::probe_media,
            probe::list_dir_entries,
            pipeline::prepare_upload,
            pipeline::cleanup_temp_dir,
            upload::upload_video,
            upload::upload_subtitle,
            upload::upload_tmdb_poster,
            upload::publish_catalog,
            upload::cancel_upload,
            upload::get_current_task,
            upload::clear_current_task,
            tmdb::tmdb_has_key,
            tmdb::tmdb_save_key,
            tmdb::tmdb_delete_key,
            tmdb::tmdb_search,
            tmdb::tmdb_details,
            logs::read_app_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
