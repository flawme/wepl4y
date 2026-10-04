//! Opening audio files handed to us by the operating system.
//!
//! A double-click in the file manager can reach the app through three paths:
//!
//! - First launch on Linux/Windows: the file path arrives in `std::env::args()`.
//! - Later launches while we are already running: `tauri-plugin-single-instance`
//!   forwards the second process' argv to the running instance.
//! - macOS: `RunEvent::Opened` delivers `file://` URLs.
//!
//! All three funnel into [`deliver`], which either emits the `open-file` event
//! to a frontend that is already listening, or parks the path in
//! [`OpenFileState`] until the frontend asks for it with `take_pending_open_file`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::audio::{PlaybackEngine, QueueTrack};

/// Event emitted to the frontend when the OS opens an audio file.
pub const OPEN_FILE_EVENT: &str = "open-file";

/// A file opened before the UI was ready, plus the readiness handshake flag.
#[derive(Default)]
pub struct OpenFileState {
    pending: Mutex<Option<String>>,
    frontend_ready: AtomicBool,
}

impl OpenFileState {
    fn park(&self, path: String) {
        if let Ok(mut pending) = self.pending.lock() {
            *pending = Some(path);
        }
    }

    fn take(&self) -> Option<String> {
        self.frontend_ready.store(true, Ordering::SeqCst);
        self.pending.lock().ok().and_then(|mut pending| pending.take())
    }
}

/// Convert a command-line argument or `file://` URL into a local path.
///
/// Returns `None` for flags and empty arguments so that `--flag` style
/// switches never get mistaken for a file.
pub fn path_from_arg(arg: &str) -> Option<PathBuf> {
    let trimmed = arg.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return None;
    }

    if let Some(rest) = trimmed.strip_prefix("file://") {
        // file:///home/user/a%20b.mp3 -> /home/user/a b.mp3
        // file://localhost/home/user/a.mp3 -> /home/user/a.mp3
        let without_host = rest.strip_prefix("localhost").unwrap_or(rest);
        return Some(PathBuf::from(percent_decode(without_host)));
    }

    Some(PathBuf::from(trimmed))
}

/// Minimal percent-decoding for `file://` URLs (avoids an extra dependency).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Pick the playable audio files out of a process argument list.
pub fn audio_paths_from_args<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .filter_map(|arg| path_from_arg(arg.as_ref()))
        .filter(|path| crate::library::is_audio_file(path) && path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Hand a freshly opened file to the running app.
pub fn deliver(app: &AppHandle, paths: Vec<String>) {
    let Some(path) = paths.into_iter().next() else {
        return;
    };

    log::info!("OS opened audio file: {path}");

    let state = app.state::<OpenFileState>();
    if state.frontend_ready.load(Ordering::SeqCst) {
        let _ = app.emit(OPEN_FILE_EVENT, path);
    } else {
        state.park(path);
    }

    reveal_main_window(app);
}

/// Make sure the user can see what is playing.
///
/// If the mini-player is on screen we leave the windows alone — it already
/// reflects playback. Otherwise the main window is restored and focused.
fn reveal_main_window(app: &AppHandle) {
    if let Some(mini) = app.get_webview_window(crate::mini_player::MINI_WINDOW_LABEL) {
        if mini.is_visible().unwrap_or(false) {
            return;
        }
    }

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// Build queue entries from file paths, reading tags when possible.
pub fn queue_tracks_from_paths(
    paths: &[String],
    art_cache_dir: Option<&Path>,
) -> Result<Vec<QueueTrack>, String> {
    let mut tracks = Vec::with_capacity(paths.len());

    for path in paths {
        let file = crate::audio::validate_audio_path(path)?;
        if !crate::library::is_audio_file(&file) {
            return Err(format!("Not an audio file: {path}"));
        }

        tracks.push(match crate::library::read_track_tags(&file, art_cache_dir) {
            Ok(track) => QueueTrack {
                id: track.id,
                path: path.clone(),
                title: track.title,
                artist: track.artist,
                album: track.album,
                duration_secs: track.duration_secs,
                art_path: track.art_path,
            },
            Err(_) => QueueTrack {
                id: uuid::Uuid::new_v4().to_string(),
                path: path.clone(),
                title: file
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                artist: String::new(),
                album: String::new(),
                duration_secs: None,
                art_path: None,
            },
        });
    }

    if tracks.is_empty() {
        return Err("No audio files to play".to_string());
    }

    Ok(tracks)
}

/// Frontend readiness handshake: returns a file opened before the UI was up.
#[tauri::command]
pub fn take_pending_open_file(state: State<'_, OpenFileState>) -> Option<String> {
    state.take()
}

/// Replace the queue with the given files and start playing the first one.
#[tauri::command]
pub fn play_paths(
    app: AppHandle,
    engine: State<'_, PlaybackEngine>,
    paths: Vec<String>,
) -> Result<(), String> {
    let art_cache_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("art-cache"));
    let tracks = queue_tracks_from_paths(&paths, art_cache_dir.as_deref())?;
    log::info!(
        "Playing {} opened file(s), starting with: {}",
        tracks.len(),
        tracks[0].title
    );

    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.set_queue(tracks, Some(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_paths_pass_through() {
        assert_eq!(
            path_from_arg("/home/user/Music/song.mp3"),
            Some(PathBuf::from("/home/user/Music/song.mp3"))
        );
    }

    #[test]
    fn flags_and_empty_args_are_ignored() {
        assert_eq!(path_from_arg("--verbose"), None);
        assert_eq!(path_from_arg("-c"), None);
        assert_eq!(path_from_arg("   "), None);
    }

    #[test]
    fn file_urls_are_decoded() {
        assert_eq!(
            path_from_arg("file:///home/user/My%20Music/a%20b.mp3"),
            Some(PathBuf::from("/home/user/My Music/a b.mp3"))
        );
        assert_eq!(
            path_from_arg("file://localhost/home/user/song.flac"),
            Some(PathBuf::from("/home/user/song.flac"))
        );
    }

    #[test]
    fn percent_decode_leaves_plain_text_alone() {
        assert_eq!(percent_decode("plain/path.mp3"), "plain/path.mp3");
        assert_eq!(percent_decode("100%25.mp3"), "100%.mp3");
        // A dangling percent sign must not panic or eat characters.
        assert_eq!(percent_decode("odd%"), "odd%");
    }

    #[test]
    fn args_are_filtered_to_existing_audio_files() {
        let dir = std::env::temp_dir().join(format!("wepl4y-open-file-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let song = dir.join("song.mp3");
        let notes = dir.join("notes.txt");
        std::fs::write(&song, b"not really audio").unwrap();
        std::fs::write(&notes, b"hello").unwrap();

        let args = vec![
            "wepl4y".to_string(),
            "--flag".to_string(),
            notes.to_string_lossy().into_owned(),
            song.to_string_lossy().into_owned(),
            dir.join("missing.mp3").to_string_lossy().into_owned(),
        ];

        let paths = audio_paths_from_args(args);
        assert_eq!(paths, vec![song.to_string_lossy().into_owned()]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn queue_tracks_fall_back_to_file_stem_for_untagged_files() {
        let dir = std::env::temp_dir().join(format!("wepl4y-queue-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let song = dir.join("My Song.mp3");
        std::fs::write(&song, b"not really audio").unwrap();

        let tracks = queue_tracks_from_paths(&[song.to_string_lossy().into_owned()], None).unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].title, "My Song");
        assert_eq!(tracks[0].path, song.to_string_lossy());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn queue_tracks_reject_missing_and_non_audio_files() {
        let dir = std::env::temp_dir().join(format!("wepl4y-reject-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let notes = dir.join("notes.txt");
        std::fs::write(&notes, b"hello").unwrap();

        assert!(queue_tracks_from_paths(&[notes.to_string_lossy().into_owned()], None).is_err());
        assert!(queue_tracks_from_paths(&["/definitely/missing.mp3".to_string()], None).is_err());
        assert!(queue_tracks_from_paths(&[], None).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }
}
