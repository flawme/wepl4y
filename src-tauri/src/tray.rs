//! System tray integration.
//!
//! Creates a tray icon with a context menu for playback control.
//! The tray keeps playback controls available while the app is running.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

use crate::audio::PlaybackEngine;
use crate::mini_player;

/// Menu item IDs
const ID_PLAY_PAUSE: &str = "tray_play_pause";
const ID_NEXT: &str = "tray_next";
const ID_PREV: &str = "tray_prev";
const ID_SHOW_MAIN: &str = "tray_show_main";
const ID_SHOW_MINI: &str = "tray_show_mini";
const ID_QUIT: &str = "tray_quit";

/// Build and install the system tray icon.
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let play_pause = MenuItem::with_id(app, ID_PLAY_PAUSE, "Play/Pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, ID_NEXT, "Next", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, ID_PREV, "Previous", true, None::<&str>)?;
    let show_main = MenuItem::with_id(app, ID_SHOW_MAIN, "Show Full Player", true, None::<&str>)?;
    let show_mini = MenuItem::with_id(app, ID_SHOW_MINI, "Show Mini Player", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&prev, &next, &play_pause, &show_main, &show_mini, &quit],
    )?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("wepl4y")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let should_start_random = app
                    .state::<PlaybackEngine>()
                    .state
                    .lock()
                    .map(|state| state.current_index.is_none())
                    .unwrap_or(true);
                if should_start_random {
                    let _ = crate::audio::commands::play_random_track_from_app(app);
                }
                let _ = mini_player::switch_to_full_player(app);
            }
        })
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();

            match id {
                ID_PLAY_PAUSE => {
                    let engine = app.state::<PlaybackEngine>();
                    let should_start_random = engine
                        .state
                        .lock()
                        .map(|state| state.current_index.is_none())
                        .unwrap_or(true);
                    if should_start_random {
                        let _ = crate::audio::commands::play_random_track_from_app(app);
                    } else if let Ok(mut state) = engine.state.lock() {
                        let _ = state.toggle_play();
                    }
                }
                ID_NEXT => {
                    let engine = app.state::<PlaybackEngine>();
                    if let Ok(mut state) = engine.state.lock() {
                        let _ = state.next();
                    };
                }
                ID_PREV => {
                    let engine = app.state::<PlaybackEngine>();
                    if let Ok(mut state) = engine.state.lock() {
                        let _ = state.prev();
                    };
                }
                ID_SHOW_MAIN => {
                    let _ = mini_player::switch_to_full_player(app);
                }
                ID_SHOW_MINI => {
                    let _ = mini_player::switch_to_mini_player(app);
                }
                ID_QUIT => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

/// Handle the main window close event by exiting the application completely.
pub fn on_window_close(app: &AppHandle, _event: &WindowEvent) {
    if matches!(_event, WindowEvent::CloseRequested { .. }) {
        app.exit(0);
    }
}
