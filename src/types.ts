// Types mirroring the Rust backend structs.

export interface QueueTrack {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration_secs: number | null;
  art_path: string | null;
}

export interface Track {
  id: string;
  file_path: string;
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  genre: string;
  year: number | null;
  track_number: number | null;
  duration_secs: number | null;
  file_size: number | null;
  art_path: string | null;
  date_added: string;
}

export interface LibraryFolder {
  id: string;
  path: string;
  label: string;
}

export interface PlaybackSnapshot {
  queue: QueueTrack[];
  current_index: number | null;
  is_playing: boolean;
  volume: number;
  repeat: "off" | "all" | "one";
  shuffle: boolean;
  position_secs: number;
  revision: number;
}

export interface ScanProgress {
  phase: string;
  current: number;
  total: number;
  current_file: string;
}

export interface ScanResult {
  tracks_added: number;
  tracks_updated: number;
  tracks_removed: number;
  errors: string[];
}

export type RepeatMode = "off" | "all" | "one";

export interface Playlist {
  id: string;
  name: string;
  is_smart: boolean;
  rules_json: string | null;
  created_at: string;
}

export interface SmartPlaylistRule {
  field: string;
  op: string;
  value: string;
}

export interface SmartPlaylistRules {
  match: "all" | "any";
  rules: SmartPlaylistRule[];
}
