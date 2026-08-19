import {
  useEffect,
  useState,
  useRef,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import type { PlaybackSnapshot, QueueTrack, Track, RepeatMode } from "./types";
import { isEditableElement } from "./utils/keyboard";
import { HudNotification } from "./components/HudNotification";
import "./styles.css";

type MiniPlayerMode = "compact" | "full";

function formatTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const minutes = Math.floor(secs / 60);
  const seconds = Math.floor(secs % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  if (name === "play") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z" />
      </svg>
    );
  }
  if (name === "pause") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
      </svg>
    );
  }
  if (name === "previous") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
      </svg>
    );
  }
  if (name === "next") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
      </svg>
    );
  }
  if (name === "shuffle") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
      </svg>
    );
  }
  if (name === "repeat") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
      </svg>
    );
  }
  if (name === "mute") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
      </svg>
    );
  }
  if (name === "volume") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  );
}

interface TransportProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  size?: number;
}

function Transport({
  isPlaying,
  onPlayPause,
  onPrevious,
  onNext,
  size = 16,
}: TransportProps) {
  return (
    <div className="mini-transport" onMouseDown={(event) => event.stopPropagation()}>
      <button onClick={onPrevious} title="Previous (Shift+← / P)" aria-label="Previous">
        <Icon name="previous" size={size} />
      </button>
      <button
        className="mini-play-button"
        onClick={onPlayPause}
        title={isPlaying ? "Pause (Space / K)" : "Play (Space / K)"}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        <Icon name={isPlaying ? "pause" : "play"} size={size} />
      </button>
      <button onClick={onNext} title="Next (Shift+→ / N)" aria-label="Next">
        <Icon name="next" size={size} />
      </button>
    </div>
  );
}

interface WindowChromeProps {
  mode: MiniPlayerMode;
  libraryOpen: boolean;
  onToggleMode: () => void;
  onToggleLibrary: () => void;
  onOpenFullPlayer: () => void;
  onHide: () => void;
}

function WindowChrome({
  mode,
  libraryOpen,
  onToggleMode,
  onToggleLibrary,
  onOpenFullPlayer,
  onHide,
}: WindowChromeProps) {
  return (
    <header className="mini-window-chrome">
      <div className="mini-window-title">
        <span className="mini-window-dot" />
        <span className="mini-brand-name">wepl4y</span>
      </div>
      <div className="mini-window-actions" onMouseDown={(event) => event.stopPropagation()}>
        {mode === "full" && (
          <button
            onClick={onToggleLibrary}
            title={libraryOpen ? "Hide library (Tab)" : "Show library (Tab)"}
            aria-label={libraryOpen ? "Hide library" : "Show library"}
          >
            {libraryOpen ? "Close Lib" : "Library"}
          </button>
        )}
        <button
          onClick={onToggleMode}
          title={mode === "compact" ? "Expand mini-player" : "Use compact mini-player"}
          aria-label={mode === "compact" ? "Expand mini-player" : "Use compact mini-player"}
        >
          {mode === "compact" ? "Expand" : "Compact"}
        </button>
        <button onClick={onOpenFullPlayer} title="Open full player" aria-label="Open full player">
          Full Player
        </button>
        <button onClick={onHide} title="Hide mini-player" aria-label="Hide mini-player">
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
    </header>
  );
}

interface LibraryPanelProps {
  title: string;
  tracks: Track[];
  onPickTrack: (index: number) => void;
  side: "left" | "right";
}

function LibraryPanel({ title, tracks, onPickTrack, side }: LibraryPanelProps) {
  return (
    <aside className={`mini-library-panel mini-library-${side}`} onMouseDown={(event) => event.stopPropagation()}>
      <div className="mini-library-heading">
        <span>{title}</span>
      </div>
      <div className="mini-library-list">
        {tracks.length === 0 ? (
          <p className="mini-library-empty">No tracks in library</p>
        ) : (
          tracks.map((track, index) => (
            <button
              className="mini-library-track"
              key={track.id}
              onClick={() => onPickTrack(index)}
              title={`${track.title} - ${track.artist}`}
            >
              <span>{track.title}</span>
              <small>{track.artist}</small>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function MiniPlayer() {
  const appWindow = getCurrentWindow();
  const [state, setState] = useState<PlaybackSnapshot | null>(null);
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<MiniPlayerMode>("compact");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySide, setLibrarySide] = useState<"left" | "right">("left");
  const [libraryTracks, setLibraryTracks] = useState<Track[]>([]);
  const [hudMessage, setHudMessage] = useState<string | null>(null);

  const hudTimerRef = useRef<number | undefined>(undefined);
  const previousVolumeRef = useRef<number>(0.8);

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
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    invoke<PlaybackSnapshot>("get_playback_state")
      .then((snapshot) => {
        if (!disposed) setState(snapshot);
      })
      .catch(console.error);

    listen<PlaybackSnapshot>("playback-state", (event) => {
      if (!disposed) setState(event.payload);
    })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch(console.error);

    invoke<MiniPlayerMode>("get_mini_player_mode_cmd")
      .then((savedMode) => {
        if (!disposed && (savedMode === "compact" || savedMode === "full")) {
          setMode(savedMode);
        }
      })
      .catch(console.error);

    return () => {
      disposed = true;
      unlisten?.();
      if (hudTimerRef.current !== undefined) window.clearTimeout(hudTimerRef.current);
    };
  }, []);

  // Save after movement or resizing without slowing down the drag gesture.
  useEffect(() => {
    let disposed = false;
    let saveTimer: number | undefined;
    let stopMoved: UnlistenFn | undefined;
    let stopResized: UnlistenFn | undefined;

    const scheduleSave = () => {
      if (saveTimer !== undefined) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        if (!disposed) void invoke("save_mini_player_position_cmd").catch(console.error);
      }, 350);
    };

    appWindow
      .onMoved(scheduleSave)
      .then((stop) => {
        if (disposed) stop();
        else stopMoved = stop;
      })
      .catch(console.error);
    appWindow
      .onResized(scheduleSave)
      .then((stop) => {
        if (disposed) stop();
        else stopResized = stop;
      })
      .catch(console.error);

    return () => {
      disposed = true;
      stopMoved?.();
      stopResized?.();
      if (saveTimer !== undefined) window.clearTimeout(saveTimer);
      void invoke("save_mini_player_position_cmd").catch(console.error);
    };
  }, []);

  const current = state?.current_index != null ? state.queue[state.current_index] : null;
  const isPlaying = state?.is_playing ?? false;
  const volume = state?.volume ?? 0.8;
  const position = state?.position_secs ?? 0;
  const duration = current?.duration_secs ?? 0;
  const artPath = current?.art_path;
  const repeatMode: RepeatMode = state?.repeat ?? "off";
  const isShuffle: boolean = state?.shuffle ?? false;

  useEffect(() => {
    if (volume > 0) {
      previousVolumeRef.current = volume;
    }
  }, [volume]);

  useEffect(() => {
    let active = true;
    setArtUrl(null);

    if (artPath) {
      invoke<string | null>("get_album_art", { path: artPath })
        .then((url) => {
          if (active) setArtUrl(url);
        })
        .catch(() => {
          if (active) setArtUrl(null);
        });
    }

    return () => {
      active = false;
    };
  }, [artPath]);

  useEffect(() => {
    if (!libraryOpen || libraryTracks.length > 0) return;

    invoke<Track[]>("get_tracks")
      .then(setLibraryTracks)
      .catch(console.error);
  }, [libraryOpen, libraryTracks.length]);

  const run = (command: string, args?: Record<string, unknown>) => {
    void invoke(command, args).catch(console.error);
  };

  const toQueueTrack = (track: Track): QueueTrack => ({
    id: track.id,
    path: track.file_path,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration_secs: track.duration_secs,
    art_path: track.art_path,
  });

  const playLibraryTrack = async (index: number) => {
    if (libraryTracks.length === 0) return;
    await invoke("play_queue", {
      tracks: libraryTracks.map(toQueueTrack),
      startIndex: index,
    });
  };

  const playPause = () => {
    if (current) {
      run("play_pause");
    } else {
      run("play_random_track");
    }
    showHud(isPlaying ? "Paused ⏸" : "Playing ▶");
  };

  const previous = () => {
    run("prev");
    showHud("Previous Track ⏮");
  };

  const next = () => {
    run("next");
    showHud("Next Track ⏭");
  };

  const setVol = (nextVolume: number) => {
    run("set_volume", { volume: nextVolume });
  };

  const toggleMute = () => {
    if (volume > 0) {
      previousVolumeRef.current = volume;
      setVol(0);
      showHud("Muted 🔇");
    } else {
      const restored = previousVolumeRef.current > 0 ? previousVolumeRef.current : 0.8;
      setVol(restored);
      showHud(`Unmuted (${Math.round(restored * 100)}%) 🔊`);
    }
  };

  const toggleShuffle = () => {
    const nextVal = !isShuffle;
    run("set_shuffle", { enabled: nextVal });
    showHud(nextVal ? "Shuffle ON 🔀" : "Shuffle OFF ➡️");
  };

  const cycleRepeat = () => {
    const nextVal: RepeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
    run("set_repeat", { mode: nextVal });
    const label = nextVal === "all" ? "Repeat ALL 🔁" : nextVal === "one" ? "Repeat ONE 🔂" : "Repeat OFF ➡️";
    showHud(label);
  };

  // Mini-player keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as Element | null;
      const active = document.activeElement;
      if (isEditableElement(target) || isEditableElement(active)) {
        return;
      }

      // Play / Pause: Space or K
      if (
        (e.code === "Space" || e.key === " " || e.key === "Spacebar" || e.key === "k" || e.key === "K") &&
        !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat
      ) {
        e.preventDefault();
        playPause();
        return;
      }

      // Next Track: Shift+Right, Ctrl+Right, or N
      if (
        (e.key === "ArrowRight" && (e.shiftKey || e.ctrlKey || e.metaKey)) ||
        ((e.key === "n" || e.key === "N") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat)
      ) {
        e.preventDefault();
        next();
        return;
      }

      // Previous Track: Shift+Left, Ctrl+Left, or P
      if (
        (e.key === "ArrowLeft" && (e.shiftKey || e.ctrlKey || e.metaKey)) ||
        ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat)
      ) {
        e.preventDefault();
        previous();
        return;
      }

      // Seek Forward 5s: Right Arrow
      if (e.key === "ArrowRight" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const nextPos = duration > 0 ? Math.min(duration, position + 5) : position + 5;
        run("seek", { positionSecs: nextPos });
        showHud(`+5s (${formatTime(nextPos)}) ⏩`);
        return;
      }

      // Seek Backward 5s: Left Arrow
      if (e.key === "ArrowLeft" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const nextPos = Math.max(0, position - 5);
        run("seek", { positionSecs: nextPos });
        showHud(`-5s (${formatTime(nextPos)}) ⏪`);
        return;
      }

      // Volume Up: Up Arrow (+5%)
      if (e.key === "ArrowUp" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const nextVol = Math.min(1, Math.round((volume + 0.05) * 100) / 100);
        setVol(nextVol);
        showHud(`Volume: ${Math.round(nextVol * 100)}% 🔊`);
        return;
      }

      // Volume Down: Down Arrow (-5%)
      if (e.key === "ArrowDown" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const nextVol = Math.max(0, Math.round((volume - 0.05) * 100) / 100);
        setVol(nextVol);
        showHud(`Volume: ${Math.round(nextVol * 100)}% ${nextVol === 0 ? "🔇" : "🔉"}`);
        return;
      }

      // Mute / Unmute: M
      if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        e.preventDefault();
        toggleMute();
        return;
      }

      // Toggle Shuffle: S
      if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        e.preventDefault();
        toggleShuffle();
        return;
      }

      // Cycle Repeat: R
      if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        e.preventDefault();
        cycleRepeat();
        return;
      }

      // Toggle Library Drawer: Tab
      if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleLibrary();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [current, isPlaying, position, duration, volume, isShuffle, repeatMode]);

  const title = current?.title ?? "Nothing playing";
  const artist = current?.artist ?? "Start a track from your library";
  const artStyle = artUrl
    ? {
        backgroundImage: `url(${artUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : undefined;

  const startDragging = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return;
    const target = event.target as Element;
    if (target.closest("button, input, textarea, select, a")) return;
    void appWindow.startDragging().catch(console.error);
  };

  const toggleMode = () => {
    const nextMode: MiniPlayerMode = mode === "compact" ? "full" : "compact";
    if (nextMode === "compact") setLibraryOpen(false);
    setMode(nextMode);
    void invoke("set_mini_player_mode_cmd", { mode: nextMode }).catch((error) => {
      console.error(error);
      setMode(mode);
    });
  };

  const openFullPlayer = () => {
    void invoke("switch_to_full_player").catch(console.error);
  };
  const hideWindow = () => {
    void invoke("switch_to_full_player").catch(console.error);
  };

  const chooseLibrarySide = async () => {
    const [pos, sz, monitor] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
      currentMonitor(),
    ]);
    if (!monitor) return;

    const windowCenter = pos.x + sz.width / 2;
    const monitorCenter = monitor.position.x + monitor.size.width / 2;
    setLibrarySide(windowCenter < monitorCenter ? "right" : "left");
  };

  const toggleLibrary = () => {
    if (!libraryOpen) {
      void chooseLibrarySide().catch(console.error);
    }
    setLibraryOpen((open) => !open);
  };

  const chrome = (
    <WindowChrome
      mode={mode}
      libraryOpen={libraryOpen}
      onToggleMode={toggleMode}
      onToggleLibrary={toggleLibrary}
      onOpenFullPlayer={openFullPlayer}
      onHide={hideWindow}
    />
  );

  const pickerPanel = mode === "full" && libraryOpen ? (
    <LibraryPanel
      title="Library"
      tracks={libraryTracks}
      onPickTrack={(index) => {
        void playLibraryTrack(index).catch(console.error);
      }}
      side={librarySide}
    />
  ) : null;

  if (mode === "compact") {
    return (
      <div className="mini-window mini-window-compact" onMouseDown={startDragging}>
        <div className="mini-sakura-effect" aria-hidden="true" />
        {chrome}
        {librarySide === "left" && pickerPanel}
        <div className="mini-compact-content">
          <div className={`mini-compact-thumb ${isPlaying ? "disc-spinning" : ""}`} style={artStyle}>
            {!artUrl && <Icon name="note" size={19} />}
          </div>
          <div className="mini-compact-copy">
            <p className="mini-track-title">{title}</p>
            <p className="mini-track-subtitle">{artist}</p>
          </div>
          <Transport
            isPlaying={isPlaying}
            onPlayPause={playPause}
            onPrevious={previous}
            onNext={next}
            size={14}
          />
        </div>
        {librarySide === "right" && pickerPanel}
        <HudNotification message={hudMessage} />
      </div>
    );
  }

  const rangeMax = duration > 0 ? duration : 100;

  return (
    <div className="mini-window mini-window-full" onMouseDown={startDragging}>
      <div className="mini-sakura-effect" aria-hidden="true" />
      {chrome}
      {librarySide === "left" && pickerPanel}
      <div className="mini-full-content">
        <div className={`mini-full-cover ${isPlaying ? "mini-full-cover-playing" : ""}`} style={artStyle}>
          {!artUrl && <Icon name="note" size={34} />}
          <span className="mini-full-cover-hole" />
        </div>
        <div className="mini-full-copy">
          <p className="mini-track-title">{title}</p>
          <p className="mini-track-subtitle">{artist}</p>
          <p className="mini-track-album">{current?.album ?? "wepl4y library"}</p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={toggleShuffle}
            className={`p-1.5 rounded-lg transition-colors ${
              isShuffle ? "text-accent bg-accent/15" : "text-text-faint hover:text-text"
            }`}
            title={`Shuffle: ${isShuffle ? "ON" : "OFF"} (S)`}
            aria-label="Toggle shuffle"
          >
            <Icon name="shuffle" size={14} />
          </button>
          <Transport
            isPlaying={isPlaying}
            onPlayPause={playPause}
            onPrevious={previous}
            onNext={next}
            size={18}
          />
          <button
            onClick={cycleRepeat}
            className={`relative p-1.5 rounded-lg transition-colors ${
              repeatMode !== "off" ? "text-accent bg-accent/15" : "text-text-faint hover:text-text"
            }`}
            title={`Repeat: ${repeatMode.toUpperCase()} (R)`}
            aria-label="Cycle repeat mode"
          >
            <Icon name="repeat" size={14} />
            {repeatMode === "one" && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-accent text-[8px] font-extrabold text-white">
                1
              </span>
            )}
          </button>
        </div>
        <div className="mini-progress-row">
          <span>{formatTime(position)}</span>
          <input
            type="range"
            min={0}
            max={rangeMax}
            value={Math.min(position, rangeMax)}
            onChange={(event) => run("seek", { positionSecs: Number(event.target.value) })}
            aria-label="Track progress"
          />
          <span>{formatTime(duration)}</span>
        </div>
        <div className="mini-volume-row">
          <button
            onClick={toggleMute}
            className="text-text-faint hover:text-text p-0.5 transition-colors"
            title={volume === 0 ? "Unmute (M)" : "Mute (M)"}
            aria-label="Mute / Unmute"
          >
            <Icon name={volume === 0 ? "mute" : "volume"} size={13} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => setVol(Number(event.target.value))}
            aria-label="Volume"
          />
          <span className="text-[10px] font-mono text-text-faint w-6 text-right">
            {Math.round(volume * 100)}%
          </span>
        </div>
      </div>
      {librarySide === "right" && pickerPanel}
      <HudNotification message={hudMessage} />
    </div>
  );
}

export default MiniPlayer;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <MiniPlayer />,
);
