use std::sync::Arc;

use tauri::State;

use crate::db::{Database, Playlist, Track};

/// Create a new playlist.
#[tauri::command]
pub fn create_playlist(
    db: State<'_, Arc<Database>>,
    name: String,
    is_smart: bool,
    rules_json: Option<String>,
) -> Result<Playlist, String> {
    db.create_playlist(&name, is_smart, rules_json.as_deref())
}

/// Get all playlists.
#[tauri::command]
pub fn get_playlists(db: State<'_, Arc<Database>>) -> Result<Vec<Playlist>, String> {
    db.get_playlists()
}

/// Delete a playlist.
#[tauri::command]
pub fn delete_playlist(db: State<'_, Arc<Database>>, id: String) -> Result<(), String> {
    db.delete_playlist(&id)
}

/// Add a track to a manual playlist.
#[tauri::command]
pub fn add_track_to_playlist(
    db: State<'_, Arc<Database>>,
    playlist_id: String,
    track_id: String,
    position: Option<i32>,
) -> Result<(), String> {
    // If no position given, append to end
    let pos = match position {
        Some(p) => p,
        None => {
            let tracks = db.get_playlist_tracks(&playlist_id)?;
            tracks.len() as i32
        }
    };
    db.add_track_to_playlist(&playlist_id, &track_id, pos)
}

/// Get all tracks in a playlist.
#[tauri::command]
pub fn get_playlist_tracks(
    db: State<'_, Arc<Database>>,
    playlist_id: String,
) -> Result<Vec<Track>, String> {
    db.get_playlist_tracks(&playlist_id)
}

/// Evaluate a smart playlist's rules and return matching tracks.
/// Rules are JSON with a structure like:
/// { "match": "all", "rules": [ { "field": "artist", "op": "equals", "value": "Daft Punk" }, ... ] }
#[tauri::command]
pub fn evaluate_smart_playlist(
    db: State<'_, Arc<Database>>,
    rules_json: String,
) -> Result<Vec<Track>, String> {
    let rules: SmartPlaylistRules = serde_json::from_str(&rules_json)
        .map_err(|e| format!("Failed to parse rules: {e}"))?;

    let all_tracks = db.get_all_tracks()?;
    let filtered: Vec<Track> = all_tracks
        .into_iter()
        .filter(|t| rules.matches(t))
        .collect();

    Ok(filtered)
}

/// Smart playlist rule definition.
#[derive(Debug, Clone, serde::Deserialize)]
struct SmartPlaylistRules {
    #[serde(default = "default_match_all")]
    pub r#match: String, // "all" or "any"
    pub rules: Vec<SmartPlaylistRule>,
}

fn default_match_all() -> String {
    "all".to_string()
}

impl SmartPlaylistRules {
    fn matches(&self, track: &Track) -> bool {
        match self.r#match.as_str() {
            "any" => self.rules.iter().any(|r| r.matches(track)),
            _ => self.rules.iter().all(|r| r.matches(track)),
        }
    }
}

/// A single rule in a smart playlist.
#[derive(Debug, Clone, serde::Deserialize)]
struct SmartPlaylistRule {
    pub field: String,   // artist, album, genre, title, year
    pub op: String,      // equals, contains, starts_with, greater_than, less_than
    pub value: String,
}

impl SmartPlaylistRule {
    fn matches(&self, track: &Track) -> bool {
        let field_value = match self.field.as_str() {
            "artist" => &track.artist,
            "album" => &track.album,
            "genre" => &track.genre,
            "title" => &track.title,
            "album_artist" => &track.album_artist,
            "year" => {
                let year = track.year.map(|y| y.to_string()).unwrap_or_default();
                return self.compare(&year);
            }
            _ => return false,
        };

        self.compare(field_value)
    }

    fn compare(&self, field_value: &str) -> bool {
        let fv = field_value.to_lowercase();
        let val = self.value.to_lowercase();

        match self.op.as_str() {
            "equals" => fv == val,
            "not_equals" => fv != val,
            "contains" => fv.contains(&val),
            "starts_with" => fv.starts_with(&val),
            "ends_with" => fv.ends_with(&val),
            "greater_than" => {
                let a: f64 = field_value.parse().unwrap_or(0.0);
                let b: f64 = self.value.parse().unwrap_or(0.0);
                a > b
            }
            "less_than" => {
                let a: f64 = field_value.parse().unwrap_or(0.0);
                let b: f64 = self.value.parse().unwrap_or(0.0);
                a < b
            }
            _ => false,
        }
    }
}
