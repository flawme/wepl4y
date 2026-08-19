//! Mini-player (Picture-in-Picture) window management.
//!
//! Creates and toggles a separate always-on-top, borderless window.
//! Supports:
//! - Drag-to-snap edge-docking (top/left/right/bottom)
//! - Persistent position/size remembered across relaunches
//! - Collapsible to a slim strip
//! - State sync with the main window via Tauri events

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const MINI_WINDOW_LABEL: &str = "mini-player";
const STATE_FILE: &str = "mini-player-state.json";

/// Which edge the mini-player is docked to.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DockEdge {
    Floating,
    Top,
    Left,
    Right,
    Bottom,
}

/// Persisted mini-player window geometry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MiniPlayerState {
    pub docked: DockEdge,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
}

impl Default for MiniPlayerState {
    fn default() -> Self {
        Self {
            docked: DockEdge::Floating,
            x: 100.0,
            y: 100.0,
            width: 320.0,
            height: 420.0,
            visible: false,
        }
    }
}

/// Managed state holding the mini-player's saved geometry,
/// loaded from and persisted to disk.
pub struct MiniPlayerWindowState {
    pub state: Mutex<MiniPlayerState>,
    pub path: PathBuf,
}

impl MiniPlayerWindowState {
    /// Load from disk if it exists, otherwise use defaults.
    pub fn load(app: &AppHandle) -> Self {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let path = app_data_dir.join(STATE_FILE);

        let state = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            MiniPlayerState::default()
        };

        Self {
            state: Mutex::new(state),
            path,
        }
    }

    /// Persist current state to disk.
    pub fn save(&self) {
        if let Ok(s) = self.state.lock() {
            if let Ok(json) = serde_json::to_string_pretty(&*s) {
                let _ = std::fs::write(&self.path, json);
            }
        }
    }

    /// Update geometry and persist.
    pub fn update(&self, docked: DockEdge, x: f64, y: f64, w: f64, h: f64) {
        if let Ok(mut s) = self.state.lock() {
            s.docked = docked;
            s.x = x;
            s.y = y;
            s.width = w;
            s.height = h;
        }
        self.save();
    }
}

impl Default for MiniPlayerWindowState {
    fn default() -> Self {
        // This is only used as a fallback; the real init happens in setup()
        Self {
            state: Mutex::new(MiniPlayerState::default()),
            path: PathBuf::from("mini-player-state.json"),
        }
    }
}

/// Toggle the mini-player window: create if it doesn't exist,
/// show/hide if it does. Playback is never interrupted.
pub fn toggle_mini_player(app: &AppHandle) -> tauri::Result<()> {
    // If the window already exists, just toggle visibility.
    if let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            // Persist visibility
            if let Some(ws) = app.try_state::<MiniPlayerWindowState>() {
                if let Ok(mut s) = ws.state.lock() {
                    s.visible = false;
                }
                ws.save();
            }
        } else {
            let _ = window.show();
            let _ = window.set_focus();
            if let Some(ws) = app.try_state::<MiniPlayerWindowState>() {
                if let Ok(mut s) = ws.state.lock() {
                    s.visible = true;
                }
                ws.save();
            }
        }
        return Ok(());
    }

    // First-time creation: load saved geometry.
    let saved = {
        let ws = app.state::<MiniPlayerWindowState>();
        let s = ws.state.lock().expect("mini-player state poisoned");
        s.clone()
    };

    let url = WebviewUrl::App("/mini-player.html".into());

    log::info!(
        "Creating mini-player window: {}x{} at ({},{})",
        saved.width,
        saved.height,
        saved.x,
        saved.y
    );

    let window = WebviewWindowBuilder::new(app, MINI_WINDOW_LABEL, url)
        .title("wepl4y Mini")
        .inner_size(saved.width, saved.height)
        .position(saved.x, saved.y)
        .min_inner_size(120.0, 48.0)   // small/pill minimum
        .max_inner_size(600.0, 800.0)  // large maximum
        .decorations(false)
        .always_on_top(true)
        .resizable(true)
        .skip_taskbar(true)
        .visible(true)
        .build()?;

    let _ = window.set_focus();

    // Mark visible and persist
    if let Some(ws) = app.try_state::<MiniPlayerWindowState>() {
        if let Ok(mut s) = ws.state.lock() {
            s.visible = true;
        }
        ws.save();
    }

    log::info!("Mini-player window created successfully");
    Ok(())
}

/// Snap-dock the mini-player to a screen edge.
/// Computes the target geometry based on the monitor the window is on.
pub fn dock_mini_player(app: &AppHandle, edge: DockEdge) -> tauri::Result<()> {
    let window = match app.get_webview_window(MINI_WINDOW_LABEL) {
        Some(w) => w,
        None => return Ok(()),
    };

    let monitor = match window.current_monitor()? {
        Some(m) => m,
        None => return Ok(()),
    };

    let mon_size = monitor.size();
    let mon_pos = monitor.position();
    let scale = monitor.scale_factor();

    // Work in logical pixels
    let mw = mon_size.width as f64 / scale;
    let mh = mon_size.height as f64 / scale;
    let mx = mon_pos.x as f64 / scale;
    let my = mon_pos.y as f64 / scale;

    // Window dimensions for each dock mode
    let (w, h) = match edge {
        DockEdge::Top | DockEdge::Bottom => (mw, 100.0),
        DockEdge::Left | DockEdge::Right => (340.0, mh),
        DockEdge::Floating => (320.0, 420.0),
    };

    let (x, y) = match edge {
        DockEdge::Top => (mx, my),
        DockEdge::Bottom => (mx, my + mh - h),
        DockEdge::Left => (mx, my),
        DockEdge::Right => (mx + mw - w, my),
        DockEdge::Floating => (mx + 100.0, my + 100.0),
    };

    window.set_size(tauri::LogicalSize::new(w, h))?;
    window.set_position(tauri::LogicalPosition::new(x, y))?;

    // Persist
    if let Some(ws) = app.try_state::<MiniPlayerWindowState>() {
        ws.update(edge, x, y, w, h);
    }

    log::info!("Mini-player docked to {:?}", edge);
    Ok(())
}

/// Called from the frontend when the window is moved or resized.
/// Saves the current geometry so it persists across relaunches.
pub fn save_mini_player_position(app: &AppHandle) -> tauri::Result<()> {
    let window = match app.get_webview_window(MINI_WINDOW_LABEL) {
        Some(w) => w,
        None => return Ok(()),
    };

    let pos = window.outer_position()?;
    let size = window.outer_size()?;
    let scale = window.scale_factor()?;

    let x = pos.x as f64 / scale;
    let y = pos.y as f64 / scale;
    let w = size.width as f64 / scale;
    let h = size.height as f64 / scale;

    if let Some(ws) = app.try_state::<MiniPlayerWindowState>() {
        ws.update(DockEdge::Floating, x, y, w, h);
    }

    Ok(())
}

/// Check if the window is near a screen edge and return the edge to snap to.
/// Called from the frontend during drag to determine if we should show a
/// snap-dock preview.
#[tauri::command]
pub fn check_snap_edge(app: AppHandle) -> Result<Option<DockEdge>, String> {
    let window = match app.get_webview_window(MINI_WINDOW_LABEL) {
        Some(w) => w,
        None => return Ok(None),
    };

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("no monitor")?;

    let scale = window.scale_factor().map_err(|e| e.to_string())?;

    let mon_size = monitor.size();
    let mon_pos = monitor.position();

    // Work in logical pixels
    let win_x = pos.x as f64 / scale;
    let win_y = pos.y as f64 / scale;
    let mon_x = mon_pos.x as f64 / scale;
    let mon_y = mon_pos.y as f64 / scale;
    let mon_w = mon_size.width as f64 / scale;
    let mon_h = mon_size.height as f64 / scale;

    // Snap threshold: 20 logical pixels from an edge
    const THRESHOLD: f64 = 20.0;

    let dist_top = (win_y - mon_y).abs();
    let dist_bottom = (win_y - (mon_y + mon_h)).abs();
    let dist_left = (win_x - mon_x).abs();
    let dist_right = (win_x - (mon_x + mon_w)).abs();

    let edge = if dist_top < THRESHOLD {
        Some(DockEdge::Top)
    } else if dist_bottom < THRESHOLD {
        Some(DockEdge::Bottom)
    } else if dist_left < THRESHOLD {
        Some(DockEdge::Left)
    } else if dist_right < THRESHOLD {
        Some(DockEdge::Right)
    } else {
        None
    };

    Ok(edge)
}

/// Tauri command wrapper: save the mini-player's current position to disk.
#[tauri::command]
pub fn save_mini_player_position_cmd(app: AppHandle) -> Result<(), String> {
    save_mini_player_position(&app).map_err(|e| e.to_string())
}
