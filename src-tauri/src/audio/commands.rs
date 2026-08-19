use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, State};

use crate::audio::{PlaybackEngine, PlaybackSnapshot, QueueTrack, RepeatMode};
use crate::db::Database;

#[tauri::command]
pub fn play_track(path: String, title: String, artist: String, album: String) -> Result<(), String> {
    let _ = (title, artist, album);
    crate::audio::validate_audio_path(&path)?;
    Ok(())
}

/// Test command: plays a hardcoded test file to prove the audio pipeline works.
#[tauri::command]
pub fn play_file_test(engine: State<'_, PlaybackEngine>, path: String) -> Result<(), String> {
    crate::audio::validate_audio_path(&path)?;
    let track = QueueTrack {
        id: "test".to_string(),
        path: path.clone(),
        title: "Test Track".to_string(),
        artist: "Test Artist".to_string(),
        album: "Test Album".to_string(),
        duration_secs: None,
        art_path: None,
    };
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.set_queue(vec![track], Some(0))
}

#[tauri::command]
pub fn play_queue(
    engine: State<'_, PlaybackEngine>,
    tracks: Vec<QueueTrack>,
    start_index: Option<usize>,
) -> Result<(), String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.set_queue(tracks, start_index)
}

/// Start a random track from the library when no queue is active.
fn start_random_track(engine: &PlaybackEngine, db: &Database) -> Result<(), String> {
    let tracks = db.get_all_tracks()?;
    if tracks.is_empty() {
        return Err("No tracks in the library".to_string());
    }

    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos() as usize;
    let start_index = seed % tracks.len();
    let queue = tracks
        .into_iter()
        .map(|track| QueueTrack {
            id: track.id,
            path: track.file_path,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration_secs: track.duration_secs,
            art_path: track.art_path,
        })
        .collect();

    let mut state = engine.state.lock().map_err(|error| error.to_string())?;
    state.set_queue(queue, Some(start_index))
}

#[tauri::command]
pub fn play_random_track(
    engine: State<'_, PlaybackEngine>,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    start_random_track(&engine, &db)
}

/// Tray and media-key entrypoint for starting a random track without a webview.
pub fn play_random_track_from_app(app: &AppHandle) -> Result<(), String> {
    let engine = app.state::<PlaybackEngine>();
    let db = app.state::<Arc<Database>>();
    start_random_track(&engine, &db)
}

#[tauri::command]
pub fn play_pause(engine: State<'_, PlaybackEngine>) -> Result<(), String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.toggle_play();
    Ok(())
}

#[tauri::command]
pub fn pause(engine: State<'_, PlaybackEngine>) -> Result<(), String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.pause();
    Ok(())
}

#[tauri::command]
pub fn resume(engine: State<'_, PlaybackEngine>) -> Result<(), String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.resume();
    Ok(())
}

#[tauri::command]
pub fn stop(engine: State<'_, PlaybackEngine>) -> Result<(), String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.stop();
    Ok(())
}

#[tauri::command]
pub fn next(engine: State<'_, PlaybackEngine>) -> Result<(), String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.next()
}

#[tauri::command]
pub fn prev(engine: State<'_, PlaybackEngine>) -> Result<(), String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.prev()
}

#[tauri::command]
pub fn set_volume(engine: State<'_, PlaybackEngine>, volume: f32) -> Result<(), String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.set_volume(volume);
    Ok(())
}

#[tauri::command]
pub fn seek(engine: State<'_, PlaybackEngine>, position_secs: f64) -> Result<(), String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.seek(position_secs);
    Ok(())
}

#[tauri::command]
pub fn set_repeat(engine: State<'_, PlaybackEngine>, mode: RepeatMode) -> Result<(), String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.repeat = mode;
    state.revision += 1;
    state.dirty = true;
    Ok(())
}

#[tauri::command]
pub fn set_shuffle(engine: State<'_, PlaybackEngine>, enabled: bool) -> Result<(), String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.shuffle = enabled;
    state.revision += 1;
    state.dirty = true;
    Ok(())
}

#[tauri::command]
pub fn clear_queue(engine: State<'_, PlaybackEngine>) -> Result<(), String> {
    let mut state = engine.state.lock().map_err(|e| e.to_string())?;
    state.clear_queue();
    Ok(())
}

#[tauri::command]
pub fn get_playback_state(engine: State<'_, PlaybackEngine>) -> Result<PlaybackSnapshot, String> {
    let state = engine.state.lock().map_err(|e| e.to_string())?;
    Ok(state.snapshot())
}
