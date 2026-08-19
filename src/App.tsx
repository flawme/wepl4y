import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayback } from "./hooks/usePlayback";
import { useLibrary } from "./hooks/useLibrary";
import { Sidebar } from "./components/Sidebar";
import { TrackList } from "./components/TrackList";
import { NowPlayingBar } from "./components/NowPlayingBar";
import type { Track, QueueTrack, Playlist } from "./types";

function App() {
  const [version, setVersion] = useState("");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const { state, playQueue, playPause, next, prev, setVolume, seek } =
    usePlayback();
  const {
    tracks,
    folders,
    scanProgress,
    pickFolder,
    removeFolder,
    rescan,
  } = useLibrary();

  useEffect(() => {
    invoke<string>("app_version")
      .then(setVersion)
      .catch(() => setVersion("unknown"));
    refreshPlaylists();
  }, []);

  const refreshPlaylists = useCallback(async () => {
    try {
      const pls = await invoke<Playlist[]>("get_playlists");
      setPlaylists(pls);
    } catch (e) {
      console.error("Failed to load playlists:", e);
    }
  }, []);

  const handleCreatePlaylist = useCallback(
    async (name: string, isSmart: boolean) => {
      const rulesJson = isSmart
        ? JSON.stringify({ match: "all", rules: [] })
        : null;
      await invoke("create_playlist", {
        name,
        isSmart,
        rulesJson,
      });
      await refreshPlaylists();
    },
    [refreshPlaylists]
  );

  const handleDeletePlaylist = useCallback(
    async (id: string) => {
      await invoke("delete_playlist", { id });
      if (selectedPlaylist?.id === id) {
        setSelectedPlaylist(null);
        setPlaylistTracks([]);
      }
      await refreshPlaylists();
    },
    [refreshPlaylists, selectedPlaylist]
  );

  const handleSelectPlaylist = useCallback(async (playlist: Playlist) => {
    setSelectedPlaylist(playlist);
    try {
      if (playlist.is_smart && playlist.rules_json) {
        const t = await invoke<Track[]>("evaluate_smart_playlist", {
          rulesJson: playlist.rules_json,
        });
        setPlaylistTracks(t);
      } else {
        const t = await invoke<Track[]>("get_playlist_tracks", {
          playlistId: playlist.id,
        });
        setPlaylistTracks(t);
      }
    } catch (e) {
      console.error("Failed to load playlist tracks:", e);
      setPlaylistTracks([]);
    }
  }, []);

  // Determine which tracks to display
  const displayedTracks = selectedPlaylist ? playlistTracks : tracks;
  const filteredTracks = searchQuery
    ? displayedTracks.filter(
        (t) =>
          t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.artist.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.album.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : displayedTracks;

  function handlePlayTrack(_track: Track, index: number) {
    const queue: QueueTrack[] = filteredTracks.map((t) => ({
      id: t.id,
      path: t.file_path,
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration_secs: t.duration_secs,
      art_path: t.art_path,
    }));
    playQueue(queue, index);
  }

  const currentTrackId =
    state?.current_index != null
      ? state.queue[state.current_index]?.id
      : undefined;

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          folders={folders}
          playlists={playlists}
          scanProgress={scanProgress}
          onPickFolder={pickFolder}
          onRemoveFolder={removeFolder}
          onRescan={rescan}
          trackCount={tracks.length}
          onCreatePlaylist={handleCreatePlaylist}
          onDeletePlaylist={handleDeletePlaylist}
          onSelectPlaylist={handleSelectPlaylist}
          selectedPlaylistId={selectedPlaylist?.id ?? null}
        />

        <main className="flex flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-border px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold tracking-tight">wepl4y</span>
              <span className="text-xs text-text-faint">v{version}</span>
              {selectedPlaylist && (
                <span className="text-sm text-text-dim">
                  / {selectedPlaylist.name}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search library..."
                className="w-64 rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
              <button
                onClick={async () => {
                  try {
                    await invoke("toggle_mini_player");
                  } catch (e) {
                    console.error("Failed to toggle mini-player:", e);
                  }
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-text-dim hover:bg-surface-2"
                title="Toggle mini-player"
              >
                Mini Player
              </button>
            </div>
          </header>

          <TrackList
            tracks={filteredTracks}
            onPlayTrack={handlePlayTrack}
            currentTrackId={currentTrackId}
          />
        </main>
      </div>

      <NowPlayingBar
        state={state}
        onPlayPause={playPause}
        onNext={next}
        onPrev={prev}
        onSeek={seek}
        onVolume={setVolume}
      />
    </div>
  );
}

export default App;
