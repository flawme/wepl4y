//! App settings persistence.
//!
//! Stores user preferences in a JSON file in the app data directory.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// User-configurable settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub volume: f32,
    pub crossfade_enabled: bool,
    pub crossfade_secs: f64,
    pub repeat: String,
    pub shuffle: bool,
    pub theme: String,
    #[serde(default = "default_entry_animation")]
    pub entry_animation: bool,
}

fn default_entry_animation() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            volume: 0.8,
            crossfade_enabled: false,
            crossfade_secs: 3.0,
            repeat: "off".to_string(),
            shuffle: false,
            theme: "dark".to_string(),
            entry_animation: true,
        }
    }
}

/// Managed state holding the settings.
pub struct SettingsState {
    pub settings: Mutex<Settings>,
    pub path: PathBuf,
}

impl SettingsState {
    pub fn load(app: &AppHandle) -> Self {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let path = app_data_dir.join("settings.json");

        let settings = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            Settings::default()
        };

        Self {
            settings: Mutex::new(settings),
            path,
        }
    }

    pub fn save(&self) {
        if let Ok(s) = self.settings.lock() {
            if let Ok(json) = serde_json::to_string_pretty(&*s) {
                let _ = std::fs::write(&self.path, json);
            }
        }
    }
}

/// Get the current settings.
#[tauri::command]
pub fn get_settings(state: tauri::State<'_, SettingsState>) -> Result<Settings, String> {
    let s = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(s.clone())
}

/// Update settings and persist to disk.
#[tauri::command]
pub fn update_settings(
    state: tauri::State<'_, SettingsState>,
    settings: Settings,
) -> Result<(), String> {
    {
        let mut s = state.settings.lock().map_err(|e| e.to_string())?;
        *s = settings;
    }
    state.save();
    Ok(())
}

/// Read an album art file and return it as a data URL.
/// Used by the frontend to display album art images.
#[tauri::command]
pub fn get_album_art(path: String) -> Result<Option<String>, String> {
    if path.is_empty() {
        return Ok(None);
    }

    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Ok(None);
    }

    let data = std::fs::read(p).map_err(|e| format!("Failed to read art: {e}"))?;

    // Detect mime type from extension
    let mime = match p.extension().and_then(|e| e.to_str()) {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/jpeg",
    };

    // Encode as base64 data URL
    use std::fmt::Write;
    let mut data_url = String::with_capacity(data.len() * 4 / 3 + 64);
    let _ = write!(data_url, "data:{};base64,", mime);

    // Simple base64 encoding
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        data_url.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        data_url.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            data_url.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            data_url.push('=');
        }
        if chunk.len() > 2 {
            data_url.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            data_url.push('=');
        }
    }

    Ok(Some(data_url))
}
