//! File system watcher for auto-rescanning library folders.
//!
//! Uses the `notify` crate to watch library folders for changes.
//! When files are added/removed/modified, triggers a debounced rescan
//! so new tracks appear without manual rescanning.

use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Manager};

use crate::db::Database;
use crate::library;

/// Start watching all library folders for changes.
/// Returns the watcher (must be kept alive).
pub fn start_library_watcher(app: &AppHandle) -> Option<RecommendedWatcher> {
    use notify::RecommendedWatcher;

    let db = app.try_state::<Arc<Database>>()?;
    let folders = db.get_folders().ok()?;

    if folders.is_empty() {
        return None;
    }

    let (tx, rx) = mpsc::channel::<()>();

    let mut watcher = match RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                // Only trigger on file create/remove/modify for audio files
                let is_audio_change = event.paths.iter().any(|p| {
                    library::is_audio_file(p) || is_art_file(p)
                });
                if is_audio_change {
                    let _ = tx.send(());
                }
            }
        },
        notify::Config::default(),
    ) {
        Ok(w) => w,
        Err(e) => {
            log::error!("Failed to create file watcher: {e}");
            return None;
        }
    };

    // Watch each library folder
    for folder in &folders {
        if let Err(e) = watcher.watch(
            std::path::Path::new(&folder.path),
            RecursiveMode::Recursive,
        ) {
            log::warn!("Failed to watch folder {}: {e}", folder.path);
        }
    }

    log::info!("File watcher started for {} folders", folders.len());

    // Spawn a debounced rescan handler on a dedicated thread
    let app_clone = app.clone();
    let db_arc = Arc::clone(&db);
    std::thread::Builder::new()
        .name("wepl4y-watcher".into())
        .spawn(move || {
            let mut last_scan = Instant::now() - Duration::from_secs(60);
            let debounce = Duration::from_secs(3);

            while let Ok(()) = rx.recv() {
                // Debounce: wait for a quiet period
                std::thread::sleep(debounce);

                // Drain any pending events
                while rx.try_recv().is_ok() {}

                // Only rescan if at least 5 seconds since last scan
                if last_scan.elapsed() < Duration::from_secs(5) {
                    continue;
                }

                log::info!("File change detected, auto-rescanning...");
                last_scan = Instant::now();

                if let Err(e) = library::scan_all_folders(&app_clone, &db_arc) {
                    log::error!("Auto-rescan failed: {e}");
                }
            }
        })
        .expect("failed to spawn watcher thread");

    Some(watcher)
}

fn is_art_file(path: &std::path::Path) -> bool {
    let name = match path.file_name().and_then(|s| s.to_str()) {
        Some(n) => n.to_lowercase(),
        None => return false,
    };
    matches!(
        name.as_str(),
        "cover.jpg"
            | "cover.jpeg"
            | "cover.png"
            | "folder.jpg"
            | "folder.jpeg"
            | "folder.png"
            | "album.jpg"
            | "album.jpeg"
            | "album.png"
            | "front.jpg"
            | "front.jpeg"
            | "front.png"
    )
}
