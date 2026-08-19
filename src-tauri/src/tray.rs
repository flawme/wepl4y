//! System tray integration.
//!
//! Creates a tray icon with a context menu for playback control.
//! When the main window is closed, the app minimizes to the tray
//! instead of quitting — background playback continues.

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WindowEvent,
};

use crate::audio::PlaybackEngine;

/// Menu item IDs
const ID_PLAY_PAUSE: &str = "tray_play_pause";
const ID_NEXT: &str = "tray_next";
const ID_PREV: &str = "tray_prev";
const ID_SHOW: &str = "tray_show";
const ID_QUIT: &str = "tray_quit";

/// Build and install the system tray icon.
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let play_pause = MenuItem::with_id(app, ID_PLAY_PAUSE, "Play/Pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, ID_NEXT, "Next", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, ID_PREV, "Previous", true, None::<&str>)?;
    let show = MenuItem::with_id(app, ID_SHOW, "Show Window", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&prev, &next, &play_pause, &show, &quit])?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("wepl4y")
        .menu(&menu)
        .menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            let engine = app.state::<PlaybackEngine>();
            let mut state = match engine.state.lock() {
                Ok(s) => s,
                Err(_) => return,
            };

            match id {
                ID_PLAY_PAUSE => {
                    state.toggle_play();
                }
                ID_NEXT => {
                    let _ = state.next();
                }
                ID_PREV => {
                    let _ = state.prev();
                }
                ID_SHOW => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
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

/// Handle window close event — hide to tray instead of quitting.
pub fn on_window_close(app: &AppHandle, _event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = _event {
        // Prevent the window from actually closing
        api.prevent_close();
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
}
