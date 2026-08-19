import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePlayback } from "./hooks/usePlayback";
import { useLibrary } from "./hooks/useLibrary";
import { Sidebar } from "./components/Sidebar";
import { TrackList } from "./components/TrackList";
import { NowPlayingBar } from "./components/NowPlayingBar";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { HudNotification } from "./components/HudNotification";
import { isEditableElement } from "./utils/keyboard";
import type { Track, QueueTrack, Playlist, Settings, LibraryFolder, RepeatMode } from "./types";

function formatTime(secs: number): string {
  if (!secs || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function App() {
  const [version, setVersion] = useState("");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [favoriteTracks, setFavoriteTracks] = useState<Track[]>([]);
  const [favoritesSelected, setFavoritesSelected] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<LibraryFolder | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [hudMessage, setHudMessage] = useState<string | null>(null);
  const [entryAnimationStarted, setEntryAnimationStarted] = useState(false);
  const [entryOverlayVisible, setEntryOverlayVisible] = useState(true);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const hudTimerRef = useRef<number | undefined>(undefined);
  const previousVolumeRef = useRef<number>(0.8);

  const {
    state,
    playQueue,
    playPause,
    next,
    prev,
    setVolume,
    seek,
    setRepeat,
    setShuffle,
  } = usePlayback();

  const {
    tracks,
    folders,
    scanProgress,
    pickFolder,
    removeFolder,
    rescan,
    refreshTracks,
  } = useLibrary();

  const showHud = useCallback((msg: string) => {
    if (hudTimerRef.current !== undefined) {
      window.clearTimeout(hudTimerRef.current);
    }
    setHudMessage(msg);
    hudTimerRef.current = window.setTimeout(() => {
      setHudMessage(null);
    }, 1300);
  }, []);

  useEffect(() => {
    invoke<string>("app_version")
      .then(setVersion)
      .catch(() => setVersion("unknown"));
    refreshPlaylists();
  }, []);

  useEffect(() => {
    let frameOne = 0;
    let frameTwo = 0;
    let overlayTimer: number | undefined;

    const startAnimationAfterPaint = (enabled: boolean) => {
      if (!enabled) {
        setEntryOverlayVisible(false);
        setEntryAnimationStarted(false);
        return;
      }
      frameOne = window.requestAnimationFrame(() => {
        frameTwo = window.requestAnimationFrame(() => {
          setEntryAnimationStarted(true);
          overlayTimer = window.setTimeout(() => setEntryOverlayVisible(false), 1300);
        });
      });
    };

    invoke<Settings>("get_settings")
      .then((loadedSettings) => {
        setSettings(loadedSettings);
        startAnimationAfterPaint(loadedSettings.entry_animation);
      })
      .catch(() => {
        startAnimationAfterPaint(true);
      });

    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
      if (overlayTimer !== undefined) window.clearTimeout(overlayTimer);
      if (hudTimerRef.current !== undefined) window.clearTimeout(hudTimerRef.current);
    };
  }, []);

  async function updateEntryAnimation(enabled: boolean) {
    if (!settings) return;
    const nextSettings = { ...settings, entry_animation: enabled };
    setSettings(nextSettings);
    try {
      await invoke("update_settings", { settings: nextSettings });
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  }

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
    setFavoritesSelected(false);
    setSelectedFolder(null);
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

  const handleSelectAllSongs = useCallback(() => {
    setFavoritesSelected(false);
    setSelectedFolder(null);
    setSelectedPlaylist(null);
    setPlaylistTracks([]);
  }, []);

  const handleSelectFolder = useCallback((folder: LibraryFolder) => {
    setFavoritesSelected(false);
    setSelectedFolder(folder);
    setSelectedPlaylist(null);
    setPlaylistTracks([]);
  }, []);

  const handleSelectFavorites = useCallback(async () => {
    setSelectedFolder(null);
    setSelectedPlaylist(null);
    setPlaylistTracks([]);
    setFavoritesSelected(true);
    try {
      const favorites = await invoke<Track[]>("get_favorite_tracks");
      setFavoriteTracks(favorites);
    } catch (error) {
      console.error("Failed to load favorites:", error);
      setFavoriteTracks([]);
    }
  }, []);

  // Determine which tracks to display
  const folderTracks = selectedFolder
    ? tracks.filter((track) => {
        const folderPath = selectedFolder.path.replace(/[\\/]+$/, "");
        return (
          track.file_path === folderPath ||
          track.file_path.startsWith(`${folderPath}/`) ||
          track.file_path.startsWith(`${folderPath}\\`)
        );
      })
    : tracks;
  const displayedTracks = favoritesSelected
    ? favoriteTracks
    : selectedPlaylist
      ? playlistTracks
      : folderTracks;
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

  const handleToggleFavorite = useCallback(
    async (track: Track) => {
      await invoke("set_track_favorite", {
        trackId: track.id,
        favorite: !track.favorite,
      });
      await refreshTracks();
      if (favoritesSelected) {
        const favorites = await invoke<Track[]>("get_favorite_tracks");
        setFavoriteTracks(favorites);
      }
    },
    [refreshTracks, favoritesSelected]
  );

  const currentTrack =
    state?.current_index != null ? state.queue[state.current_index] : null;
  const currentTrackId = currentTrack?.id;
  const currentTrackFromLibrary = tracks.find((t) => t.id === currentTrackId);
  const isCurrentFavorite = currentTrackFromLibrary?.favorite ?? false;

  const handleToggleCurrentFavorite = useCallback(async () => {
    if (!currentTrackFromLibrary) return;
    await handleToggleFavorite(currentTrackFromLibrary);
    showHud(
      currentTrackFromLibrary.favorite
        ? "Removed from Favorites ♡"
        : "Added to Favorites ♥"
    );
  }, [currentTrackFromLibrary, handleToggleFavorite, showHud]);

  const toggleMute = useCallback(() => {
    const currentVol = state?.volume ?? 0.8;
    if (currentVol > 0) {
      previousVolumeRef.current = currentVol;
      void setVolume(0);
      showHud("Muted 🔇");
    } else {
      const restored =
        previousVolumeRef.current > 0 ? previousVolumeRef.current : 0.8;
      void setVolume(restored);
      showHud(`Unmuted (${Math.round(restored * 100)}%) 🔊`);
    }
  }, [state?.volume, setVolume, showHud]);

  const toggleShuffle = useCallback(async () => {
    const nextShuffle = !(state?.shuffle ?? false);
    await setShuffle(nextShuffle);
    showHud(nextShuffle ? "Shuffle ON 🔀" : "Shuffle OFF ➡️");
  }, [state?.shuffle, setShuffle, showHud]);

  const cycleRepeat = useCallback(async () => {
    const currentRepeat = state?.repeat ?? "off";
    const nextRepeat: RepeatMode =
      currentRepeat === "off" ? "all" : currentRepeat === "all" ? "one" : "off";
    await setRepeat(nextRepeat);
    const label =
      nextRepeat === "all"
        ? "Repeat ALL 🔁"
        : nextRepeat === "one"
        ? "Repeat ONE 🔂"
        : "Repeat OFF ➡️";
    showHud(label);
  }, [state?.repeat, setRepeat, showHud]);

  // Comprehensive keyboard shortcuts listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as Element | null;
      const active = document.activeElement;
      const isTyping = isEditableElement(target) || isEditableElement(active);

      // Escape key handler
      if (e.key === "Escape") {
        if (shortcutsModalOpen) {
          e.preventDefault();
          setShortcutsModalOpen(false);
          return;
        }
        if (settingsOpen) {
          e.preventDefault();
          setSettingsOpen(false);
          return;
        }
        if (isTyping) {
          e.preventDefault();
          setSearchQuery("");
          (active as HTMLElement)?.blur();
          return;
        }
      }

      // If user is typing in a text field, pass all other keys through
      if (isTyping) return;

      // Focus Search: / or Ctrl+F / Cmd+F
      if (
        (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) ||
        ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F"))
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // Shortcuts Modal: ? or H
      if (
        (e.key === "?" || e.key === "h" || e.key === "H") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setShortcutsModalOpen((prev) => !prev);
        return;
      }

      // Play / Pause: Space or K
      if (
        (e.code === "Space" ||
          e.key === " " ||
          e.key === "Spacebar" ||
          e.key === "k" ||
          e.key === "K") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat
      ) {
        e.preventDefault();
        void playPause();
        showHud(state?.is_playing ? "Paused ⏸" : "Playing ▶");
        return;
      }

      // Next Track: Shift+Right, Ctrl+Right, or N
      if (
        (e.key === "ArrowRight" && (e.shiftKey || e.ctrlKey || e.metaKey)) ||
        ((e.key === "n" || e.key === "N") &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.repeat)
      ) {
        e.preventDefault();
        void next();
        showHud("Next Track ⏭");
        return;
      }

      // Previous Track: Shift+Left, Ctrl+Left, or P
      if (
        (e.key === "ArrowLeft" && (e.shiftKey || e.ctrlKey || e.metaKey)) ||
        ((e.key === "p" || e.key === "P") &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.repeat)
      ) {
        e.preventDefault();
        void prev();
        showHud("Previous Track ⏮");
        return;
      }

      // Seek Forward 5s: Right Arrow without modifiers
      if (
        e.key === "ArrowRight" &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        const pos = state?.position_secs ?? 0;
        const dur = currentTrack?.duration_secs ?? 0;
        const nextPos = dur > 0 ? Math.min(dur, pos + 5) : pos + 5;
        void seek(nextPos);
        showHud(`+5s (${formatTime(nextPos)}) ⏩`);
        return;
      }

      // Seek Backward 5s: Left Arrow without modifiers
      if (
        e.key === "ArrowLeft" &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        const pos = state?.position_secs ?? 0;
        const nextPos = Math.max(0, pos - 5);
        void seek(nextPos);
        showHud(`-5s (${formatTime(nextPos)}) ⏪`);
        return;
      }

      // Seek Forward 10s: L
      if (
        (e.key === "l" || e.key === "L") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat
      ) {
        e.preventDefault();
        const pos = state?.position_secs ?? 0;
        const dur = currentTrack?.duration_secs ?? 0;
        const nextPos = dur > 0 ? Math.min(dur, pos + 10) : pos + 10;
        void seek(nextPos);
        showHud(`+10s (${formatTime(nextPos)}) ⏩`);
        return;
      }

      // Seek Backward 10s: J
      if (
        (e.key === "j" || e.key === "J") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat
      ) {
        e.preventDefault();
        const pos = state?.position_secs ?? 0;
        const nextPos = Math.max(0, pos - 10);
        void seek(nextPos);
        showHud(`-10s (${formatTime(nextPos)}) ⏪`);
        return;
      }

      // Volume Up: Up Arrow (+5%)
      if (
        e.key === "ArrowUp" &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        const currentVol = state?.volume ?? 0.8;
        const nextVol = Math.min(1, Math.round((currentVol + 0.05) * 100) / 100);
        void setVolume(nextVol);
        showHud(`Volume: ${Math.round(nextVol * 100)}% 🔊`);
        return;
      }

      // Volume Down: Down Arrow (-5%)
      if (
        e.key === "ArrowDown" &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        const currentVol = state?.volume ?? 0.8;
        const nextVol = Math.max(0, Math.round((currentVol - 0.05) * 100) / 100);
        void setVolume(nextVol);
        showHud(
          `Volume: ${Math.round(nextVol * 100)}% ${
            nextVol === 0 ? "🔇" : "🔉"
          }`
        );
        return;
      }

      // Mute / Unmute: M
      if (
        (e.key === "m" || e.key === "M") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat
      ) {
        e.preventDefault();
        toggleMute();
        return;
      }

      // Toggle Shuffle: S
      if (
        (e.key === "s" || e.key === "S") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat
      ) {
        e.preventDefault();
        void toggleShuffle();
        return;
      }

      // Cycle Repeat: R
      if (
        (e.key === "r" || e.key === "R") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat
      ) {
        e.preventDefault();
        void cycleRepeat();
        return;
      }

      // Favorite Current Track: F
      if (
        (e.key === "f" || e.key === "F") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat
      ) {
        e.preventDefault();
        void handleToggleCurrentFavorite();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    playPause,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    handleToggleCurrentFavorite,
    shortcutsModalOpen,
    settingsOpen,
    state?.position_secs,
    state?.volume,
    state?.is_playing,
    currentTrack?.duration_secs,
    showHud,
  ]);

  return (
    <div
      className={`app-shell app-enter flex h-full flex-col bg-bg text-text ${
        entryAnimationStarted ? "app-enter-active" : ""
      }`}
    >
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          folders={folders}
          playlists={playlists}
          scanProgress={scanProgress}
          onPickFolder={pickFolder}
          onRemoveFolder={removeFolder}
          onSelectFolder={handleSelectFolder}
          onSelectAllSongs={handleSelectAllSongs}
          onRescan={rescan}
          trackCount={tracks.length}
          onCreatePlaylist={handleCreatePlaylist}
          onDeletePlaylist={handleDeletePlaylist}
          onSelectPlaylist={handleSelectPlaylist}
          onSelectFavorites={handleSelectFavorites}
          selectedPlaylistId={selectedPlaylist?.id ?? null}
          favoritesSelected={favoritesSelected}
          selectedFolderId={selectedFolder?.id ?? null}
        />

        <main className="app-main flex flex-1 flex-col overflow-hidden">
          <header className="app-header flex items-center justify-between border-b border-border px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="app-brand text-lg font-semibold tracking-tight">
                wepl4y
              </span>
              <span className="text-xs text-text-faint">v{version}</span>
              {selectedPlaylist && (
                <span className="text-sm text-text-dim">
                  / {selectedPlaylist.name}
                </span>
              )}
              {favoritesSelected && (
                <span className="text-sm text-text-dim">/ Favorites</span>
              )}
              {selectedFolder && (
                <span className="text-sm text-text-dim">
                  / {selectedFolder.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              {/* Search bar with instant keyboard focus shortcut */}
              <div className="relative flex items-center">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-none absolute left-3 text-text-faint"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search library..."
                  className="app-search w-60 rounded-xl border border-border bg-surface py-1.5 pl-8 pr-11 text-sm outline-none focus:border-accent"
                />
                {searchQuery ? (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-2.5 rounded-full p-0.5 text-xs text-text-faint hover:bg-surface-2 hover:text-text transition-colors"
                    title="Clear search (Esc)"
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                ) : (
                  <kbd className="pointer-events-none absolute right-2.5 rounded border border-border/50 bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono text-text-faint">
                    /
                  </kbd>
                )}
              </div>

              {/* Shortcuts Help Button */}
              <button
                onClick={() => setShortcutsModalOpen(true)}
                className="app-shortcuts-button flex items-center gap-1.5 rounded-xl border border-border px-2.5 py-1.5 text-sm text-text-dim hover:bg-surface-2"
                title="Keyboard Shortcuts (?)"
                aria-label="Keyboard Shortcuts"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" />
                </svg>
                <span className="hidden sm:inline">Keys</span>
              </button>

              {/* Mini player switch */}
              <button
                onClick={async () => {
                  try {
                    await invoke("switch_to_mini_player");
                  } catch (e) {
                    console.error("Failed to toggle mini-player:", e);
                  }
                }}
                className="app-mini-button rounded-xl border border-border px-3 py-1.5 text-sm text-text-dim hover:bg-surface-2"
                title="Switch to mini player"
              >
                Mini Player
              </button>

              {/* Settings button */}
              <button
                className="app-settings-button rounded-xl border border-border px-3 py-1.5 text-sm text-text-dim hover:bg-surface-2"
                onClick={() => setSettingsOpen((open) => !open)}
                title="Settings"
                aria-label="Settings"
              >
                Settings
              </button>
            </div>
            {settingsOpen && settings && (
              <div className="settings-popover">
                <p className="settings-popover-title">Settings</p>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={settings.entry_animation}
                    onChange={(event) =>
                      updateEntryAnimation(event.target.checked)
                    }
                  />
                  <span>
                    <strong>Entry animation</strong>
                    <small>Animate the app when it opens</small>
                  </span>
                </label>
              </div>
            )}
          </header>

          <TrackList
            tracks={filteredTracks}
            onPlayTrack={handlePlayTrack}
            onToggleFavorite={handleToggleFavorite}
            currentTrackId={currentTrackId}
            isPlaying={state?.is_playing ?? false}
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
        onToggleShuffle={toggleShuffle}
        onToggleRepeat={cycleRepeat}
        onToggleFavorite={handleToggleCurrentFavorite}
        isFavorite={isCurrentFavorite}
      />

      <ShortcutsModal
        isOpen={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
      />

      <HudNotification message={hudMessage} />

      {entryOverlayVisible && (
        <div
          className="entry-overlay"
          role="status"
          aria-label="wepl4y starting"
        >
          <div className="entry-sakura-sweep" aria-hidden="true" />
          <div className="entry-wordmark">
            <strong>wepl4y</strong>
            <span>no skips. no mercy.</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
