mod commands;
mod dto;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::check_session,
            commands::request_login_code,
            commands::submit_otp,
            commands::submit_password,
            commands::resolve_channel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
