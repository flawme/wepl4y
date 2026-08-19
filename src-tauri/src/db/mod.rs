//! SQLite database for the music library.
//!
//! Stores tracks, library folders, and playlists. Uses `rusqlite`
//! with the `bundled` feature so SQLite is compiled into the binary —
//! no external runtime dependency.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// A track row from the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub genre: String,
    pub year: Option<i32>,
    pub track_number: Option<i32>,
    pub duration_secs: Option<f64>,
    pub file_size: Option<i64>,
    pub art_path: Option<String>,
    pub date_added: String,
    pub favorite: bool,
}

/// A library folder the user has added.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryFolder {
    pub id: String,
    pub path: String,
    pub label: String,
}

/// A playlist (manual or smart).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub is_smart: bool,
    /// For smart playlists: the rule definition serialized as JSON.
    pub rules_json: Option<String>,
    pub created_at: String,
}

/// A track in a manual playlist (ordered).
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistEntry {
    pub playlist_id: String,
    pub track_id: String,
    pub position: i32,
}

/// Thread-safe wrapper around the SQLite connection.
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Open (or create) the database at `path`.
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("Failed to open database: {e}"))?;

        // Performance pragmas
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA temp_store = MEMORY;",
        )
        .map_err(|e| format!("Failed to set pragmas: {e}"))?;

        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Create an in-memory database (for tests).
    #[allow(dead_code)]
    pub fn open_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn init_schema(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS library_folders (
                id          TEXT PRIMARY KEY,
                path        TEXT NOT NULL UNIQUE,
                label       TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS tracks (
                id              TEXT PRIMARY KEY,
                file_path       TEXT NOT NULL UNIQUE,
                title           TEXT NOT NULL DEFAULT '',
                artist          TEXT NOT NULL DEFAULT '',
                album           TEXT NOT NULL DEFAULT '',
                album_artist    TEXT NOT NULL DEFAULT '',
                genre           TEXT NOT NULL DEFAULT '',
                year            INTEGER,
                track_number    INTEGER,
                duration_secs  REAL,
                file_size       INTEGER,
                art_path        TEXT,
                date_added      TEXT NOT NULL DEFAULT (datetime('now')),
                file_modified   REAL NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
            CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
            CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
            CREATE INDEX IF NOT EXISTS idx_tracks_year ON tracks(year);

            CREATE TABLE IF NOT EXISTS favorites (
                track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS playlists (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                is_smart    INTEGER NOT NULL DEFAULT 0,
                rules_json  TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS playlist_entries (
                playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                position    INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, track_id)
            );

            CREATE INDEX IF NOT EXISTS idx_playlist_entries
                ON playlist_entries(playlist_id, position);
            ",
        )
        .map_err(|e| format!("Failed to init schema: {e}"))?;
        Ok(())
    }

    // ================================================================
    // Library folders
    // ================================================================

    pub fn add_folder(&self, path: &str, label: &str) -> Result<LibraryFolder, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO library_folders (id, path, label) VALUES (?1, ?2, ?3)",
            params![id, path, label],
        )
        .map_err(|e| format!("Failed to add folder: {e}"))?;

        // Return the actual row (might be existing if IGNORE hit)
        let folder = conn
            .query_row(
                "SELECT id, path, label FROM library_folders WHERE path = ?1",
                params![path],
                |row| {
                    Ok(LibraryFolder {
                        id: row.get(0)?,
                        path: row.get(1)?,
                        label: row.get(2)?,
                    })
                },
            )
            .map_err(|e| format!("Failed to fetch folder: {e}"))?;
        Ok(folder)
    }

    pub fn get_folders(&self) -> Result<Vec<LibraryFolder>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, path, label FROM library_folders ORDER BY label")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(LibraryFolder {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    label: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn remove_folder(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM library_folders WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ================================================================
    // Tracks
    // ================================================================

    /// Insert or replace a track. Called during scanning.
    pub fn upsert_track(&self, track: &Track, file_modified: f64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO tracks (id, file_path, title, artist, album, album_artist, genre,
                 year, track_number, duration_secs, file_size, art_path, file_modified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(file_path) DO UPDATE SET
                 title = excluded.title,
                 artist = excluded.artist,
                 album = excluded.album,
                 album_artist = excluded.album_artist,
                 genre = excluded.genre,
                 year = excluded.year,
                 track_number = excluded.track_number,
                 duration_secs = excluded.duration_secs,
                 file_size = excluded.file_size,
                 art_path = excluded.art_path,
                 file_modified = excluded.file_modified",
            params![
                track.id,
                track.file_path,
                track.title,
                track.artist,
                track.album,
                track.album_artist,
                track.genre,
                track.year,
                track.track_number,
                track.duration_secs,
                track.file_size,
                track.art_path,
                file_modified,
            ],
        )
        .map_err(|e| format!("Failed to upsert track: {e}"))?;
        Ok(())
    }

    /// Remove tracks whose file_path is no longer on disk.
    pub fn remove_missing_tracks(&self, existing_paths: &[String]) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Simple approach: delete tracks not in the provided set.
        // For large libraries this could be optimized with a temp table.
        let mut count = 0;
        for batch in existing_paths.chunks(500) {
            let placeholders: Vec<String> = (0..batch.len()).map(|_| "?".to_string()).collect();
            let sql = format!(
                "DELETE FROM tracks WHERE file_path NOT IN ({})",
                placeholders.join(", ")
            );
            let params: Vec<&dyn rusqlite::ToSql> =
                batch.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
            count += conn.execute(&sql, params.as_slice()).unwrap_or(0);
        }
        Ok(count)
    }

    /// Get all tracks, ordered by artist then album then track number.
    pub fn get_all_tracks(&self) -> Result<Vec<Track>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path, title, artist, album, album_artist, genre,
                        year, track_number, duration_secs, file_size, art_path, date_added,
                        EXISTS(SELECT 1 FROM favorites f WHERE f.track_id = tracks.id)
                 FROM tracks
                 ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_number",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Track {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    title: row.get(2)?,
                    artist: row.get(3)?,
                    album: row.get(4)?,
                    album_artist: row.get(5)?,
                    genre: row.get(6)?,
                    year: row.get(7)?,
                    track_number: row.get(8)?,
                    duration_secs: row.get(9)?,
                    file_size: row.get(10)?,
                    art_path: row.get(11)?,
                    date_added: row.get(12)?,
                    favorite: row.get(13)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Check whether a track already has an album-art path stored.
    pub fn track_has_art(&self, file_path: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT art_path IS NOT NULL FROM tracks WHERE file_path = ?1",
            params![file_path],
            |row| row.get(0),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(|e| e.to_string())
    }

    pub fn set_favorite(&self, track_id: &str, favorite: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if favorite {
            conn.execute(
                "INSERT OR IGNORE INTO favorites (track_id) VALUES (?1)",
                params![track_id],
            )
            .map_err(|error| error.to_string())?;
        } else {
            conn.execute("DELETE FROM favorites WHERE track_id = ?1", params![track_id])
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    /// Get the total track count.
    pub fn track_count(&self) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
            .map_err(|e| e.to_string())
    }

    /// Get the file_modified timestamp for a track (to check if rescanning needed).
    pub fn get_track_mtime(&self, file_path: &str) -> Result<Option<f64>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT file_modified FROM tracks WHERE file_path = ?1",
            params![file_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    // ================================================================
    // Playlists
    // ================================================================

    pub fn create_playlist(
        &self,
        name: &str,
        is_smart: bool,
        rules_json: Option<&str>,
    ) -> Result<Playlist, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO playlists (id, name, is_smart, rules_json) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, is_smart as i32, rules_json],
        )
        .map_err(|e| format!("Failed to create playlist: {e}"))?;

        Ok(Playlist {
            id,
            name: name.to_string(),
            is_smart,
            rules_json: rules_json.map(|s| s.to_string()),
            created_at: String::new(),
        })
    }

    pub fn get_playlists(&self) -> Result<Vec<Playlist>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, is_smart, rules_json, created_at FROM playlists ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Playlist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    is_smart: row.get::<_, i32>(2)? != 0,
                    rules_json: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn delete_playlist(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_track_to_playlist(
        &self,
        playlist_id: &str,
        track_id: &str,
        position: i32,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO playlist_entries (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
            params![playlist_id, track_id, position],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_playlist_tracks(&self, playlist_id: &str) -> Result<Vec<Track>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT t.id, t.file_path, t.title, t.artist, t.album, t.album_artist,
                        t.genre, t.year, t.track_number, t.duration_secs, t.file_size,
                         t.art_path, t.date_added,
                         EXISTS(SELECT 1 FROM favorites f WHERE f.track_id = t.id)
                 FROM playlist_entries pe
                 JOIN tracks t ON pe.track_id = t.id
                 WHERE pe.playlist_id = ?1
                 ORDER BY pe.position",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![playlist_id], |row| {
                Ok(Track {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    title: row.get(2)?,
                    artist: row.get(3)?,
                    album: row.get(4)?,
                    album_artist: row.get(5)?,
                    genre: row.get(6)?,
                    year: row.get(7)?,
                    track_number: row.get(8)?,
                    duration_secs: row.get(9)?,
                    file_size: row.get(10)?,
                    art_path: row.get(11)?,
                    date_added: row.get(12)?,
                    favorite: row.get(13)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
}
