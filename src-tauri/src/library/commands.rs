use std::sync::Arc;

use tauri::State;
use tauri::AppHandle;

use crate::db::{Database, LibraryFolder, Track};
use crate::library;

/// Add a library folder to scan.
#[tauri::command]
pub fn add_library_folder(
    app: AppHandle,
    db: State<'_, Arc<Database>>,
    path: String,
    label: Option<String>,
) -> Result<LibraryFolder, String> {
    let lbl = label.unwrap_or_else(|| {
        std::path::Path::new(&path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&path)
            .to_string()
    });
    let folder = db.add_folder(&path, &lbl)?;

    // Kick off a scan in the background
    let db_clone = Arc::clone(&db);
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let _ = library::scan_folder(&app_clone, &db_clone, &path);
        })
        .await;
    });

    Ok(folder)
}

/// Get all configured library folders.
#[tauri::command]
pub fn get_library_folders(db: State<'_, Arc<Database>>) -> Result<Vec<LibraryFolder>, String> {
    db.get_folders()
}

/// Remove a library folder.
#[tauri::command]
pub fn remove_library_folder(db: State<'_, Arc<Database>>, id: String) -> Result<(), String> {
    db.remove_folder(&id)
}

/// Trigger a rescan of all library folders.
#[tauri::command]
pub async fn rescan_library(
    app: AppHandle,
    db: State<'_, Arc<Database>>,
) -> Result<library::ScanResult, String> {
    let db_clone = Arc::clone(&db);
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || library::scan_all_folders(&app_clone, &db_clone))
        .await
        .map_err(|e| format!("Scan task failed: {e}"))?
}

/// Get all tracks in the library.
#[tauri::command]
pub fn get_tracks(db: State<'_, Arc<Database>>) -> Result<Vec<Track>, String> {
    db.get_all_tracks()
}

#[tauri::command]
pub fn set_track_favorite(
    db: State<'_, Arc<Database>>,
    track_id: String,
    favorite: bool,
) -> Result<(), String> {
    db.set_favorite(&track_id, favorite)
}

#[tauri::command]
pub fn get_favorite_tracks(db: State<'_, Arc<Database>>) -> Result<Vec<Track>, String> {
    Ok(db
        .get_all_tracks()?
        .into_iter()
        .filter(|track| track.favorite)
        .collect())
}

/// Get the total track count.
#[tauri::command]
pub fn get_track_count(db: State<'_, Arc<Database>>) -> Result<i64, String> {
    db.track_count()
}

/// Pick a folder using the native dialog and add it to the library.
#[tauri::command]
pub async fn pick_library_folder(
    app: AppHandle,
    db: State<'_, Arc<Database>>,
) -> Result<Option<LibraryFolder>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder_path = app
        .dialog()
        .file()
        .set_title("Select music folder")
        .blocking_pick_folder();

    match folder_path {
        Some(path) => {
            let path_str = path.to_string();
            let lbl = std::path::Path::new(&path_str)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&path_str)
                .to_string();
            let folder = db.add_folder(&path_str, &lbl)?;

            // Kick off a scan in the background
            let db_clone = Arc::clone(&db);
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    let _ = library::scan_folder(&app_clone, &db_clone, &path_str);
                })
                .await;
            });

            Ok(Some(folder))
        }
        None => Ok(None),
    }
}
