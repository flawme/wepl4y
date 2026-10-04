mod audio;
mod db;
mod library;
mod media;
mod mini_player;
mod open_file;
mod settings;
mod tray;
mod watcher;

use std::sync::Arc;

use audio::PlaybackEngine;
use db::Database;
use mini_player::MiniPlayerWindowState;
use settings::SettingsState;
use tauri::Manager;

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

#[tauri::command]
fn switch_to_mini_player(app: tauri::AppHandle) -> Result<(), String> {
    mini_player::switch_to_mini_player(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn switch_to_full_player(app: tauri::AppHandle) -> Result<(), String> {
    mini_player::switch_to_full_player(&app).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        // Must be the first plugin: a second launch (e.g. double-clicking
        // another song) forwards its argv here instead of opening a new window.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths = open_file::audio_paths_from_args(args);
            open_file::deliver(app, paths);
        }))
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

            // Files handed to us by the OS (double-click / "Open with").
            // The frontend collects them via `take_pending_open_file`.
            app.manage(open_file::OpenFileState::default());
            let startup_paths =
                open_file::audio_paths_from_args(std::env::args().skip(1));
            if !startup_paths.is_empty() {
                open_file::deliver(app.handle(), startup_paths);
            }

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
            switch_to_mini_player,
            switch_to_full_player,
            mini_player::save_mini_player_position_cmd,
            mini_player::get_mini_player_mode_cmd,
            mini_player::set_mini_player_mode_cmd,
            // Settings commands
            settings::get_settings,
            settings::update_settings,
            settings::get_album_art,
            // OS file-open commands
            open_file::take_pending_open_file,
            open_file::play_paths,
            // Audio commands
            audio::commands::play_track,
            audio::commands::play_file_test,
            audio::commands::play_queue,
            audio::commands::play_random_track,
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
            library::commands::set_track_favorite,
            library::commands::get_favorite_tracks,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS delivers double-clicked files as `file://` URLs rather
            // than argv entries.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            {
                if let tauri::RunEvent::Opened { urls } = &event {
                    let paths =
                        open_file::audio_paths_from_args(urls.iter().map(|url| url.to_string()));
                    open_file::deliver(app, paths);
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            {
                let _ = (app, event);
            }
        });
}
