mod audio;
mod db;
mod library;
mod media;
mod mini_player;
mod settings;
mod tray;
mod watcher;

use std::sync::Arc;

use audio::PlaybackEngine;
use db::Database;
use mini_player::{MiniPlayerWindowState, DockEdge};
use settings::SettingsState;
use tauri::{Manager, WindowEvent};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! wepl4y is running.", name)
}

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Toggle the floating mini-player window.
#[tauri::command]
fn toggle_mini_player(app: tauri::AppHandle) -> Result<(), String> {
    mini_player::toggle_mini_player(&app).map_err(|e| e.to_string())
}

/// Dock the mini-player to a screen edge.
#[tauri::command]
fn dock_mini_player(app: tauri::AppHandle, edge: DockEdge) -> Result<(), String> {
    mini_player::dock_mini_player(&app, edge).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Initialize the database in the app data directory
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir)
                .map_err(|e| format!("Failed to create app data dir: {e}"))?;

            let db_path = app_data_dir.join("wepl4y.db");
            log::info!("Database path: {}", db_path.display());

            let database = Database::open(&db_path).expect("failed to open database");
            app.manage(Arc::new(database));

            // Start the playback polling thread
            let engine = app.state::<PlaybackEngine>();
            engine.start_poll_thread(app.handle().clone());

            // Set up the system tray
            tray::setup_tray(app.handle())?;

            // Register media key shortcuts
            media::setup_media_keys(app.handle());

            // Start the library file watcher for auto-rescan
            if let Some(w) = watcher::start_library_watcher(app.handle()) {
                app.manage(w);
            }

            // Load mini-player window state from disk
            app.manage(MiniPlayerWindowState::load(app.handle()));

            // Load settings from disk
            app.manage(SettingsState::load(app.handle()));

            Ok(())
        })
        .manage(PlaybackEngine::new())
        .on_window_event(|window, event| {
            if window.label() == "main" {
                tray::on_window_close(window.app_handle(), event);
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            app_version,
            toggle_mini_player,
            dock_mini_player,
            mini_player::check_snap_edge,
            mini_player::save_mini_player_position_cmd,
            // Settings commands
            settings::get_settings,
            settings::update_settings,
            settings::get_album_art,
            // Audio commands
            audio::commands::play_track,
            audio::commands::play_file_test,
            audio::commands::play_queue,
            audio::commands::play_pause,
            audio::commands::pause,
            audio::commands::resume,
            audio::commands::stop,
            audio::commands::next,
            audio::commands::prev,
            audio::commands::set_volume,
            audio::commands::seek,
            audio::commands::set_repeat,
            audio::commands::set_shuffle,
            audio::commands::clear_queue,
            audio::commands::get_playback_state,
            // Library commands
            library::commands::add_library_folder,
            library::commands::get_library_folders,
            library::commands::remove_library_folder,
            library::commands::rescan_library,
            library::commands::get_tracks,
            library::commands::get_track_count,
            library::commands::pick_library_folder,
            // Playlist commands
            library::playlist_commands::create_playlist,
            library::playlist_commands::get_playlists,
            library::playlist_commands::delete_playlist,
            library::playlist_commands::add_track_to_playlist,
            library::playlist_commands::get_playlist_tracks,
            library::playlist_commands::evaluate_smart_playlist,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
