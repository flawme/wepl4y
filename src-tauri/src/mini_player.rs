//! Single floating mini-player window management.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const MINI_WINDOW_LABEL: &str = "mini-player";
const STATE_FILE: &str = "mini-player-state.json";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MiniPlayerMode {
    Compact,
    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MiniPlayerState {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
    /// None lets older state files derive their mode from their saved height.
    #[serde(default)]
    pub mode: Option<MiniPlayerMode>,
}

impl Default for MiniPlayerState {
    fn default() -> Self {
        Self {
            x: 100.0,
            y: 100.0,
            width: 360.0,
            height: 92.0,
            visible: false,
            mode: Some(MiniPlayerMode::Compact),
        }
    }
}

pub struct MiniPlayerWindowState {
    pub state: Mutex<MiniPlayerState>,
    pub path: PathBuf,
}

impl MiniPlayerWindowState {
    pub fn load(app: &AppHandle) -> Self {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let path = app_data_dir.join(STATE_FILE);

        let state = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|contents| serde_json::from_str(&contents).ok())
                .unwrap_or_default()
        } else {
            MiniPlayerState::default()
        };

        Self {
            state: Mutex::new(state),
            path,
        }
    }

    pub fn save(&self) {
        if let Ok(state) = self.state.lock() {
            if let Ok(json) = serde_json::to_string_pretty(&*state) {
                let _ = std::fs::write(&self.path, json);
            }
        }
    }

    pub fn geometry(&self) -> (f64, f64, f64, f64) {
        let state = self.state.lock().expect("mini-player state poisoned");
        (state.x, state.y, state.width, state.height)
    }

    pub fn mode(&self) -> MiniPlayerMode {
        let state = self.state.lock().expect("mini-player state poisoned");
        state.mode.unwrap_or_else(|| {
            if state.height > 200.0 {
                MiniPlayerMode::Full
            } else {
                MiniPlayerMode::Compact
            }
        })
    }

    pub fn set_mode(&self, mode: MiniPlayerMode) {
        if let Ok(mut state) = self.state.lock() {
            state.mode = Some(mode);
        }
        self.save();
    }

    pub fn set_visible(&self, visible: bool) {
        if let Ok(mut state) = self.state.lock() {
            state.visible = visible;
        }
        self.save();
    }

    pub fn update_geometry(&self, x: f64, y: f64, width: f64, height: f64) {
        if let Ok(mut state) = self.state.lock() {
            state.x = x;
            state.y = y;
            state.width = width;
            state.height = height;
        }
        self.save();
    }
}

impl Default for MiniPlayerWindowState {
    fn default() -> Self {
        Self {
            state: Mutex::new(MiniPlayerState::default()),
            path: PathBuf::from(STATE_FILE),
        }
    }
}

fn create_window(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<MiniPlayerWindowState>();
    let (x, y, width, height) = state.geometry();

    WebviewWindowBuilder::new(
        app,
        MINI_WINDOW_LABEL,
        WebviewUrl::App("/mini-player.html".into()),
    )
    .title("wepl4y Mini Player")
    .inner_size(width, height)
    .position(x, y)
    .min_inner_size(220.0, 68.0)
    .max_inner_size(600.0, 700.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .resizable(true)
    .skip_taskbar(true)
    .visible(false)
    .build()?;

    Ok(())
}

fn ensure_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(MINI_WINDOW_LABEL).is_none() {
        create_window(app)?;
    }
    Ok(())
}

pub fn show_mini_player(app: &AppHandle) -> tauri::Result<()> {
    ensure_window(app)?;
    if let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        window.show()?;
        window.set_focus()?;
    }
    if let Some(state) = app.try_state::<MiniPlayerWindowState>() {
        state.set_visible(true);
    }
    Ok(())
}

pub fn hide_mini_player(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        window.hide()?;
    }
    if let Some(state) = app.try_state::<MiniPlayerWindowState>() {
        state.set_visible(false);
    }
    Ok(())
}

pub fn toggle_mini_player(app: &AppHandle) -> tauri::Result<()> {
    let visible = app
        .get_webview_window(MINI_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    if visible {
        hide_mini_player(app)
    } else {
        show_mini_player(app)
    }
}

/// Switch from the full player window to the one floating mini-player.
pub fn switch_to_mini_player(app: &AppHandle) -> tauri::Result<()> {
    show_mini_player(app)?;
    if let Some(window) = app.get_webview_window("main") {
        window.hide()?;
    }
    Ok(())
}

/// Switch from the mini-player back to the full player window.
pub fn switch_to_full_player(app: &AppHandle) -> tauri::Result<()> {
    hide_mini_player(app)?;
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

pub fn get_mini_player_mode(app: &AppHandle) -> MiniPlayerMode {
    app.try_state::<MiniPlayerWindowState>()
        .map(|state| state.mode())
        .unwrap_or(MiniPlayerMode::Compact)
}

pub fn set_mini_player_mode(app: &AppHandle, mode: MiniPlayerMode) -> tauri::Result<()> {
    let (width, height) = match mode {
        MiniPlayerMode::Compact => (360.0, 92.0),
        MiniPlayerMode::Full => (340.0, 440.0),
    };

    if let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        window.set_size(tauri::LogicalSize::new(width, height))?;
    }
    if let Some(state) = app.try_state::<MiniPlayerWindowState>() {
        state.set_mode(mode);
    }
    save_mini_player_position(app)
}

pub fn save_mini_player_position(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) else {
        return Ok(());
    };
    let Some(state) = app.try_state::<MiniPlayerWindowState>() else {
        return Ok(());
    };

    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let scale = window.scale_factor()?;
    state.update_geometry(
        position.x as f64 / scale,
        position.y as f64 / scale,
        size.width as f64 / scale,
        size.height as f64 / scale,
    );
    Ok(())
}

#[tauri::command]
pub fn save_mini_player_position_cmd(app: AppHandle) -> Result<(), String> {
    save_mini_player_position(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_mini_player_mode_cmd(app: AppHandle) -> MiniPlayerMode {
    get_mini_player_mode(&app)
}

#[tauri::command]
pub fn set_mini_player_mode_cmd(
    app: AppHandle,
    mode: MiniPlayerMode,
) -> Result<(), String> {
    set_mini_player_mode(&app, mode).map_err(|error| error.to_string())
}
