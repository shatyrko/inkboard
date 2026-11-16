//! Inkboard: a desktop app for a Sony DPT-RP1 reader. The window (`src/` in the repository root) talks to the reader through
//! the commands below; `dpt-client` implements the reader's protocol.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adb;
mod conn;
mod dashboards;
#[cfg(test)]
mod ipc_tests;
mod library;
mod mtp;
mod pdf;
mod pngout;
mod settings;
mod state;
mod stats;
mod store;
mod util;

use std::sync::Arc;

use tauri::Manager;

fn main() {
    // overlay scrollbars cost frames on WebKitGTK; the page draws its own thin ones
    #[cfg(target_os = "linux")]
    if std::env::var_os("GTK_OVERLAY_SCROLLING").is_none() {
        std::env::set_var("GTK_OVERLAY_SCROLLING", "0");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = store::config_dir();
            std::fs::create_dir_all(&dir).ok();
            app.manage(Arc::new(state::AppState::new(dir)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            conn::connection_state,
            conn::discover_devices,
            conn::probe_device,
            conn::pair_start,
            conn::pair_finish,
            conn::import_legacy_credentials,
            conn::connect,
            conn::forget_device,
            conn::device_status,
            conn::device_screenshot,
            conn::device_config,
            conn::device_set_config,
            conn::device_sync_clock,
            conn::wifi_list,
            conn::wifi_scan,
            conn::wifi_connect,
            conn::wifi_forget,
            conn::wifi_set_enabled,
            library::library_list,
            library::library_upload,
            library::library_download,
            library::library_delete,
            library::library_new_folder,
            library::library_move,
            library::library_copy,
            library::library_open,
            library::templates_list,
            library::templates_upload,
            library::templates_delete,
            dashboards::dashboards_list,
            dashboards::dashboards_load,
            dashboards::dashboards_save,
            dashboards::dashboards_delete,
            dashboards::system_stats,
            dashboards::fetch_text,
            dashboards::run_command,
            dashboards::read_image,
            dashboards::dashboard_publish,
            dashboards::dashboard_export_pdf,
            adb::adb_status,
            adb::adb_connect,
            adb::adb_disconnect,
            adb::adb_screenshot,
            adb::adb_open,
            mtp::readers_list,
            mtp::mtp_status,
            mtp::mtp_list,
            mtp::mtp_upload,
            mtp::mtp_download,
            mtp::mtp_delete,
            mtp::mtp_new_folder,
            mtp::mtp_rename,
            mtp::mtp_move,
            settings::settings_get,
            settings::settings_set,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Inkboard")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<Arc<state::AppState>>() {
                    tauri::async_runtime::block_on(state.mtp.close_all());
                }
            }
        });
}
