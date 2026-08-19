//! Audio playback engine.
//!
//! `OutputStream` is not `Send + Sync` (it wraps a raw `cpal::Stream`
//! pointer), so it cannot live in Tauri's managed state. Instead we spawn
//! a dedicated audio thread that owns the stream and keeps it alive for
//! the lifetime of the app. The `Sink` — which IS `Send + Sync` — is
//! sent back to the main thread and stored in managed state.
//!
//! A second polling thread checks the sink position every 500ms, updates
//! `position_secs`, auto-advances when a track ends, and emits
//! `playback-state` events to the frontend.

pub mod commands;

use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// A single track in the playback queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueTrack {
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_secs: Option<f64>,
    pub art_path: Option<String>,
}

/// Repeat mode for the queue.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepeatMode {
    Off,
    All,
    One,
}

/// Playback state held behind the app-wide mutex.
/// Only `Send + Sync` types live here — the `OutputStream` is kept
/// alive on a separate thread.
pub struct PlaybackState {
    pub queue: Vec<QueueTrack>,
    pub current_index: Option<usize>,
    pub repeat: RepeatMode,
    pub shuffle: bool,
    pub volume: f32,
    #[allow(dead_code)]
    pub crossfade: bool,
    #[allow(dead_code)]
    pub crossfade_secs: f64,
    pub is_playing: bool,
    pub position_secs: f64,
    /// Monotonic counter bumped whenever the queue or index changes,
    /// so the frontend can detect changes via events.
    pub revision: u64,
    /// Set to true when the frontend should be notified of a state change.
    pub dirty: bool,
    sink: Option<Sink>,
    handle: Option<OutputStreamHandle>,
}

impl PlaybackState {
    pub fn new() -> Self {
        // Spawn a dedicated audio thread that owns the OutputStream.
        // The stream must not be dropped or audio stops.
        let (tx, rx) = mpsc::channel::<Option<(OutputStreamHandle, Sink)>>();

        std::thread::Builder::new()
            .name("wepl4y-audio".into())
            .spawn(move || {
                let (_stream, handle) = match OutputStream::try_default() {
                    Ok((s, h)) => (s, h),
                    Err(e) => {
                        log::error!("Failed to open audio output stream: {e}");
                        let _ = tx.send(None);
                        return;
                    }
                };

                let sink = match Sink::try_new(&handle) {
                    Ok(s) => s,
                    Err(e) => {
                        log::error!("Failed to create sink: {e}");
                        let _ = tx.send(None);
                        return;
                    }
                };

                let _ = tx.send(Some((handle, sink)));

                // Keep the stream alive — block forever.
                // The OutputStream must not be dropped.
                loop {
                    std::thread::sleep(Duration::from_secs(3600));
                }
            })
            .expect("failed to spawn audio thread");

        let (handle, sink) = match rx.recv() {
            Ok(Some(pair)) => pair,
            Ok(None) | Err(_) => {
                log::error!("Audio output unavailable; playback commands will no-op.");
                return Self::no_audio();
            }
        };

        Self {
            queue: Vec::new(),
            current_index: None,
            repeat: RepeatMode::Off,
            shuffle: false,
            volume: 0.8,
            crossfade: false,
            crossfade_secs: 3.0,
            is_playing: false,
            position_secs: 0.0,
            revision: 0,
            dirty: false,
            sink: Some(sink),
            handle: Some(handle),
        }
    }

    fn no_audio() -> Self {
        Self {
            queue: Vec::new(),
            current_index: None,
            repeat: RepeatMode::Off,
            shuffle: false,
            volume: 0.8,
            crossfade: false,
            crossfade_secs: 3.0,
            is_playing: false,
            position_secs: 0.0,
            revision: 0,
            dirty: false,
            sink: None,
            handle: None,
        }
    }
}

// ============================================================
// Playback operations
// ============================================================

impl PlaybackState {
    fn sink(&self) -> Option<&Sink> {
        self.sink.as_ref()
    }

    /// Load and start playing the track at `index` in the queue.
    pub fn play_index(&mut self, index: usize) -> Result<(), String> {
        if index >= self.queue.len() {
            return Err(format!(
                "Index {index} out of bounds (queue len {})",
                self.queue.len()
            ));
        }
        let track = self.queue[index].clone();
        let sink = self.sink().ok_or("No audio sink available")?;

        let file = File::open(&track.path)
            .map_err(|e| format!("Failed to open '{}': {e}", track.path))?;
        let source = Decoder::new(BufReader::new(file))
            .map_err(|e| format!("Failed to decode '{}': {e}", track.path))?;

        sink.clear();
        sink.append(source);
        sink.set_volume(self.volume);
        sink.play();

        self.current_index = Some(index);
        self.is_playing = true;
        self.position_secs = 0.0;
        self.revision += 1;
        self.dirty = true;
        Ok(())
    }

    pub fn pause(&mut self) {
        if let Some(sink) = self.sink() {
            sink.pause();
            self.is_playing = false;
            self.revision += 1;
            self.dirty = true;
        }
    }

    pub fn resume(&mut self) {
        if let Some(sink) = self.sink() {
            sink.play();
            self.is_playing = true;
            self.revision += 1;
            self.dirty = true;
        }
    }

    pub fn toggle_play(&mut self) {
        if self.is_playing {
            self.pause();
        } else if self.current_index.is_some() {
            self.resume();
        }
    }

    pub fn stop(&mut self) {
        if let Some(sink) = self.sink() {
            sink.stop();
            if let Some(handle) = &self.handle {
                self.sink = Sink::try_new(handle).ok();
            }
        }
        self.is_playing = false;
        self.position_secs = 0.0;
        self.revision += 1;
        self.dirty = true;
    }

    pub fn next(&mut self) -> Result<(), String> {
        let idx = match self.current_index {
            Some(i) => i,
            None => return self.play_index(0),
        };

        if self.queue.is_empty() {
            return Ok(());
        }

        match self.repeat {
            RepeatMode::One => self.play_index(idx),
            RepeatMode::All => {
                let next = (idx + 1) % self.queue.len();
                self.play_index(next)
            }
            RepeatMode::Off => {
                if idx + 1 < self.queue.len() {
                    self.play_index(idx + 1)
                } else {
                    self.stop();
                    Ok(())
                }
            }
        }
    }

    pub fn prev(&mut self) -> Result<(), String> {
        let idx = match self.current_index {
            Some(i) => i,
            None => return self.play_index(0),
        };

        // If we're more than 3 seconds in, restart current track
        if self.position_secs > 3.0 {
            return self.play_index(idx);
        }

        if self.queue.is_empty() {
            return Ok(());
        }

        match self.repeat {
            RepeatMode::All => {
                let prev = if idx == 0 {
                    self.queue.len() - 1
                } else {
                    idx - 1
                };
                self.play_index(prev)
            }
            _ => {
                if idx > 0 {
                    self.play_index(idx - 1)
                } else {
                    self.play_index(0)
                }
            }
        }
    }

    pub fn set_volume(&mut self, vol: f32) {
        self.volume = vol.clamp(0.0, 1.0);
        if let Some(sink) = self.sink() {
            sink.set_volume(self.volume);
        }
        self.revision += 1;
        self.dirty = true;
    }

    pub fn set_queue(
        &mut self,
        tracks: Vec<QueueTrack>,
        start_index: Option<usize>,
    ) -> Result<(), String> {
        self.queue = tracks;
        self.current_index = None;
        self.revision += 1;
        self.dirty = true;
        if let Some(idx) = start_index {
            self.play_index(idx)?;
        }
        Ok(())
    }

    pub fn clear_queue(&mut self) {
        if let Some(sink) = self.sink() {
            sink.stop();
            if let Some(handle) = &self.handle {
                self.sink = Sink::try_new(handle).ok();
            }
        }
        self.queue.clear();
        self.current_index = None;
        self.is_playing = false;
        self.position_secs = 0.0;
        self.revision += 1;
        self.dirty = true;
    }

    pub fn seek(&mut self, secs: f64) {
        if let Some(sink) = self.sink() {
            let _ = sink.try_seek(Duration::from_secs_f64(secs));
        }
        self.position_secs = secs;
        self.revision += 1;
        self.dirty = true;
    }

    /// Called by the polling thread to update position from the sink.
    /// Returns true if the track has ended and auto-advance is needed.
    pub fn poll_position(&mut self) -> bool {
        if !self.is_playing {
            return false;
        }

        // Extract position and empty status from the sink without holding the borrow.
        let (new_pos, is_empty) = if let Some(sink) = self.sink() {
            (sink.get_pos().as_secs_f64(), sink.empty())
        } else {
            return false;
        };

        // Only update if position changed meaningfully (> 0.3s)
        if (new_pos - self.position_secs).abs() > 0.3 {
            self.position_secs = new_pos;
            self.dirty = true;
        }

        // Check if the sink is empty (track ended)
        is_empty && self.current_index.is_some()
    }

    /// Get the current track, if any.
    #[allow(dead_code)]
    pub fn current_track(&self) -> Option<&QueueTrack> {
        self.current_index.and_then(|i| self.queue.get(i))
    }
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================
// Snapshot for frontend
// ============================================================

/// Serializable snapshot of playback state for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct PlaybackSnapshot {
    pub queue: Vec<QueueTrack>,
    pub current_index: Option<usize>,
    pub is_playing: bool,
    pub volume: f32,
    pub repeat: RepeatMode,
    pub shuffle: bool,
    pub position_secs: f64,
    pub revision: u64,
}

impl PlaybackState {
    pub fn snapshot(&self) -> PlaybackSnapshot {
        PlaybackSnapshot {
            queue: self.queue.clone(),
            current_index: self.current_index,
            is_playing: self.is_playing,
            volume: self.volume,
            repeat: self.repeat,
            shuffle: self.shuffle,
            position_secs: self.position_secs,
            revision: self.revision,
        }
    }
}

// ============================================================
// Engine wrapper for Tauri managed state
// ============================================================

/// App-wide playback engine, managed via Tauri's state system.
/// Holds the shared state and spawns a polling thread that:
/// - Updates playback position from the sink
/// - Auto-advances when a track ends
/// - Emits `playback-state` events to the frontend
pub struct PlaybackEngine {
    pub state: Arc<Mutex<PlaybackState>>,
}

impl PlaybackEngine {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(PlaybackState::new())),
        }
    }

    /// Start the polling thread that tracks position and auto-advances.
    /// Must be called after Tauri setup so we have an AppHandle.
    pub fn start_poll_thread(&self, app: AppHandle) {
        let state = Arc::clone(&self.state);

        std::thread::Builder::new()
            .name("wepl4y-playback-poll".into())
            .spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_millis(500));

                    let (needs_advance, mut needs_emit) = {
                        let mut st = match state.lock() {
                            Ok(s) => s,
                            Err(_) => continue,
                        };

                        let advance = st.poll_position();
                        let emit = st.dirty;
                        st.dirty = false;
                        (advance, emit)
                    };

                    // Auto-advance if the track ended
                    if needs_advance {
                        let mut st = match state.lock() {
                            Ok(s) => s,
                            Err(_) => continue,
                        };
                        let _ = st.next();
                        needs_emit = true;
                    }

                    // Emit state to frontend
                    if needs_emit {
                        let st = match state.lock() {
                            Ok(s) => s,
                            Err(_) => continue,
                        };
                        let _ = app.emit("playback-state", st.snapshot());
                    }
                }
            })
            .expect("failed to spawn playback poll thread");
    }
}

impl Default for PlaybackEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Helper to validate an audio file path exists.
pub fn validate_audio_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.exists() {
        return Err(format!("File not found: {path}"));
    }
    Ok(p)
}
