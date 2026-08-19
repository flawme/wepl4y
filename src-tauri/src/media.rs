//! Media key and global shortcut integration.
//!
//! Registers global shortcuts for media keys:
//! - MediaPlayPause → toggle play/pause
//! - MediaNextTrack → next track
//! - MediaPreviousTrack → previous track
//! - MediaStop → stop playback
//!
//! On Linux, MPRIS D-Bus integration provides "Now Playing" info
//! to GNOME/KDE media widgets. This is handled separately.

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::audio::PlaybackEngine;

/// Register media key shortcuts.
pub fn setup_media_keys(app: &AppHandle) {
    let media_keys = [
        "MediaPlayPause",
        "MediaNextTrack",
        "MediaPreviousTrack",
        "MediaStop",
    ];

    for key in &media_keys {
        let shortcut: Shortcut = match key.parse() {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Failed to parse shortcut '{key}': {e}");
                continue;
            }
        };

        let key_owned = key.to_string();
        let app_clone = app.clone();
        if let Err(e) = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                handle_media_key(&app_clone, &key_owned);
            }
        }) {
            log::warn!("Failed to register shortcut '{key}': {e}");
        }
    }

    log::info!("Media key shortcuts registered");
}

fn handle_media_key(app: &AppHandle, key: &str) {
    let engine = app.state::<PlaybackEngine>();
    let mut state = match engine.state.lock() {
        Ok(s) => s,
        Err(_) => return,
    };

    match key {
        "MediaPlayPause" => {
            state.toggle_play();
        }
        "MediaNextTrack" => {
            let _ = state.next();
        }
        "MediaPreviousTrack" => {
            let _ = state.prev();
        }
        "MediaStop" => {
            state.stop();
        }
        _ => {}
    }
}
