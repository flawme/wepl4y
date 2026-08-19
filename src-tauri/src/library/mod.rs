//! Library scanning and tag reading.
//!
//! Walks library folders recursively, reads audio file tags with `lofty`,
//! detects album art, and writes tracks to the SQLite database.
//! Runs on a background thread with progress events emitted to the frontend.

pub mod commands;
pub mod playlist_commands;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::{Accessor, ItemKey};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::db::{Database, Track};

/// Supported audio file extensions (lowercase, no dot).
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "ogg", "opus", "aac", "m4a", "m4b", "wma", "aiff", "aif",
];

/// Album art filenames to look for in the folder.
const ART_FILENAMES: &[&str] = &[
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "folder.jpg",
    "folder.jpeg",
    "folder.png",
    "album.jpg",
    "album.jpeg",
    "album.png",
    "front.jpg",
    "front.jpeg",
    "front.png",
];

/// Progress event payload sent to the frontend during scanning.
#[derive(Debug, Clone, Serialize)]
pub struct ScanProgress {
    pub phase: String, // "scanning" | "reading_tags" | "done" | "error"
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

/// Result of a scan operation.
#[derive(Debug, Clone, Serialize)]
pub struct ScanResult {
    pub tracks_added: usize,
    pub tracks_updated: usize,
    pub tracks_removed: usize,
    pub errors: Vec<String>,
}

/// Check if a file has a supported audio extension.
pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Find album art in the same directory as the audio file.
fn find_folder_art(dir: &Path) -> Option<String> {
    for name in ART_FILENAMES {
        let art_path = dir.join(name);
        if art_path.exists() {
            return art_path.to_str().map(|s| s.to_string());
        }
    }
    None
}

/// Read tags from an audio file using lofty, returning a Track ready for DB insertion.
pub fn read_track_tags(file_path: &Path) -> Result<Track, String> {
    let tagged_file = lofty::read_from_path(file_path)
        .map_err(|e| format!("Failed to read tags from {:?}: {e}", file_path))?;

    // Try primary tag, fall back to first available
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let (title, artist, album, album_artist, genre, year, track_number) = match tag {
        Some(t) => {
            let title = t
                .title()
                .map(|s| s.to_string())
                .unwrap_or_else(|| {
                    file_path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("Unknown")
                        .to_string()
                });
            let artist = t.artist().map(|s| s.to_string()).unwrap_or_default();
            let album = t.album().map(|s| s.to_string()).unwrap_or_default();
            let album_artist = t
                .get_string(&ItemKey::AlbumArtist)
                .map(|s| s.to_string())
                .unwrap_or_default();
            let genre = t.genre().map(|s| s.to_string()).unwrap_or_default();
            let year = t.year().map(|y| y as i32);
            let track_number = t.track().map(|n| n as i32);
            (
                title,
                artist,
                album,
                album_artist,
                genre,
                year,
                track_number,
            )
        }
        None => (
            file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            None,
            None,
        ),
    };

    // Duration from the probe
    let duration_secs = tagged_file
        .properties()
        .duration()
        .as_secs_f64()
        .into();

    // File size
    let file_size = std::fs::metadata(file_path)
        .ok()
        .and_then(|m| m.len().try_into().ok());

    // Album art: check embedded first, then folder
    let art_path = find_folder_art(file_path.parent().unwrap_or(Path::new("")));

    let id = uuid::Uuid::new_v4().to_string();

    Ok(Track {
        id,
        file_path: file_path.to_string_lossy().to_string(),
        title,
        artist,
        album,
        album_artist,
        genre,
        year,
        track_number,
        duration_secs,
        file_size,
        art_path,
        date_added: String::new(), // DB default handles this
    })
}

/// Scan a single folder: walk it, read tags, upsert tracks.
/// Emits progress events to the frontend via the AppHandle.
pub fn scan_folder(
    app: &AppHandle,
    db: &Arc<Database>,
    folder_path: &str,
) -> Result<ScanResult, String> {
    let mut errors = Vec::new();
    let mut tracks_added = 0usize;
    let mut tracks_updated = 0usize;

    // Phase 1: Walk the directory and collect audio files
    let audio_files: Vec<PathBuf> = WalkDir::new(folder_path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && is_audio_file(e.path()))
        .map(|e| e.into_path())
        .collect();

    let total = audio_files.len();
    let folder_label = Path::new(folder_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(folder_path);

    log::info!("Scanning {folder_path}: {total} audio files found");

    // Phase 2: Read tags and upsert
    for (i, file_path) in audio_files.iter().enumerate() {
        // Emit progress every 5 files or on first/last
        if i % 5 == 0 || i == total - 1 {
            let _ = app.emit(
                "scan-progress",
                ScanProgress {
                    phase: "reading_tags".to_string(),
                    current: i + 1,
                    total,
                    current_file: file_path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string(),
                },
            );
        }

        // Check if we need to re-read: compare file mtime to DB
        let mtime = std::fs::metadata(file_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);

        let file_path_str = file_path.to_string_lossy().to_string();
        let existing_mtime = db.get_track_mtime(&file_path_str).unwrap_or(None);

        let is_new = existing_mtime.is_none();
        let needs_update = existing_mtime.map_or(true, |db_mtime| (mtime - db_mtime).abs() > 1.0);

        if !is_new && !needs_update {
            continue;
        }

        match read_track_tags(file_path) {
            Ok(mut track) => {
                // Set date_added only for new tracks; DB default handles it
                if !is_new {
                    // Preserve existing date_added by not setting it (upsert keeps it)
                    track.date_added = String::new();
                }
                if let Err(e) = db.upsert_track(&track, mtime) {
                    errors.push(format!("DB error for {file_path_str}: {e}"));
                } else if is_new {
                    tracks_added += 1;
                } else {
                    tracks_updated += 1;
                }
            }
            Err(e) => {
                errors.push(e);
            }
        }
    }

    // Phase 3: Remove tracks that no longer exist on disk
    let all_tracks = db.get_all_tracks().unwrap_or_default();
    let mut removed = 0usize;
    let mut existing_paths: Vec<String> = Vec::new();
    for track in &all_tracks {
        if Path::new(&track.file_path).exists() {
            existing_paths.push(track.file_path.clone());
        } else {
            removed += 1;
        }
    }

    if removed > 0 {
        let _ = db.remove_missing_tracks(&existing_paths);
    }

    let _ = app.emit(
        "scan-progress",
        ScanProgress {
            phase: "done".to_string(),
            current: total,
            total,
            current_file: String::new(),
        },
    );

    log::info!(
        "Scan complete for {folder_label}: +{tracks_added} new, ~{tracks_updated} updated, -{removed} removed, {} errors",
        errors.len()
    );

    Ok(ScanResult {
        tracks_added,
        tracks_updated,
        tracks_removed: removed,
        errors,
    })
}

/// Scan all configured library folders.
pub fn scan_all_folders(
    app: &AppHandle,
    db: &Arc<Database>,
) -> Result<ScanResult, String> {
    let folders = db.get_folders()?;
    let mut combined = ScanResult {
        tracks_added: 0,
        tracks_updated: 0,
        tracks_removed: 0,
        errors: Vec::new(),
    };

    for folder in &folders {
        match scan_folder(app, db, &folder.path) {
            Ok(result) => {
                combined.tracks_added += result.tracks_added;
                combined.tracks_updated += result.tracks_updated;
                combined.tracks_removed += result.tracks_removed;
                combined.errors.extend(result.errors);
            }
            Err(e) => {
                combined.errors.push(format!(
                    "Failed to scan folder {}: {e}",
                    folder.path
                ));
            }
        }
    }

    Ok(combined)
}
