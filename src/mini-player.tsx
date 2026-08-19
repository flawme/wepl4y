import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PlaybackSnapshot } from "./types";
import "./styles.css";

type DockEdge = "floating" | "top" | "left" | "right" | "bottom";
type LayoutMode = "small" | "medium" | "large";

/** Determine layout mode from window dimensions (logical pixels). */
function getLayoutMode(w: number, h: number): LayoutMode {
  // Small/pill: very short height (horizontal strip) or very narrow
  if (h < 120 || (w < 180 && h < 250)) return "small";
  // Large: wide or tall enough for art to dominate
  if (w >= 400 || h >= 500) return "large";
  // Medium: everything in between
  return "medium";
}

function MiniPlayer() {
  const [state, setState] = useState<PlaybackSnapshot | null>(null);
  const [snapPreview, setSnapPreview] = useState<DockEdge | null>(null);
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [winSize, setWinSize] = useState({ w: 320, h: 420 });
  const dragCheckRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  // --- Playback state sync ---
  useEffect(() => {
    invoke<PlaybackSnapshot>("get_playback_state")
      .then(setState)
      .catch(console.error);

    let unlisten: UnlistenFn | undefined;
    listen<PlaybackSnapshot>("playback-state", (event) => {
      setState(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // --- Track window size for responsive breakpoints ---
  useEffect(() => {
    const win = getCurrentWindow();

    // Fetch initial size
    win.outerSize().then((size) => {
      setWinSize({ w: size.width, h: size.height });
    }).catch(() => {});

    // Listen for resize events
    let unlisten: UnlistenFn | undefined;
    win.onResized(async () => {
      const size = await win.outerSize().catch(() => null);
      if (size) {
        setWinSize({ w: size.width, h: size.height });
        // Debounced save on resize
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
          invoke("save_mini_player_position_cmd").catch(console.error);
        }, 500);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // --- Snap-dock polling during drag ---
  const startSnapPolling = useCallback(() => {
    if (dragCheckRef.current) return;
    dragCheckRef.current = window.setInterval(async () => {
      try {
        const edge = await invoke<DockEdge | null>("check_snap_edge");
        setSnapPreview(edge);
      } catch {
        // ignore
      }
    }, 100);
  }, []);

  const stopSnapPolling = useCallback(async () => {
    if (dragCheckRef.current) {
      clearInterval(dragCheckRef.current);
      dragCheckRef.current = null;
    }
    if (snapPreview) {
      await invoke("dock_mini_player", { edge: snapPreview });
      // Refresh size after docking
      const win = getCurrentWindow();
      const size = await win.outerSize().catch(() => null);
      if (size) setWinSize({ w: size.width, h: size.height });
      setSnapPreview(null);
    } else {
      await invoke("save_mini_player_position_cmd").catch(console.error);
    }
  }, [snapPreview]);

  const current = state?.current_index != null ? state.queue[state.current_index] : null;
  const isPlaying = state?.is_playing ?? false;
  const volume = state?.volume ?? 0.8;

  // --- Album art ---
  useEffect(() => {
    if (current?.art_path) {
      invoke<string | null>("get_album_art", { path: current.art_path })
        .then(setArtUrl)
        .catch(() => setArtUrl(null));
    } else {
      setArtUrl(null);
    }
  }, [current?.art_path]);

  // --- Transport ---
  const playPause = () => invoke("play_pause");
  const next = () => invoke("next");
  const prev = () => invoke("prev");
  const seekStart = () => invoke("seek", { positionSecs: 0 });
  const setVol = (v: number) => invoke("set_volume", { volume: v });

  const mode = getLayoutMode(winSize.w, winSize.h);

  const discClass = isPlaying ? "disc-spinning" : "disc-paused";
  const discBg = artUrl
    ? { backgroundImage: `url(${artUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { backgroundImage: "radial-gradient(circle at 50% 50%, #1d2030 0%, #161821 100%)" };

  // --- SMALL: horizontal pill ---
  if (mode === "small") {
    return (
      <div
        data-tauri-drag-region
        onMouseDown={startSnapPolling}
        onMouseUp={stopSnapPolling}
        className="flex h-full w-full items-center gap-2 overflow-hidden rounded-xl bg-bg px-2 shadow-2xl"
      >
        {/* Thumbnail */}
        <div
          className={`h-8 w-8 flex-shrink-0 rounded-full border border-border ${discClass}`}
          style={discBg}
        />

        {/* Track info (truncated) */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="truncate text-xs font-medium leading-tight text-text">
            {current?.title ?? "Nothing playing"}
          </p>
          <p className="truncate text-[10px] leading-tight text-text-faint">
            {current?.artist ?? ""}
          </p>
        </div>

        {/* Play/pause + next only */}
        <button
          onClick={(e) => { e.stopPropagation(); playPause(); }}
          className="flex-shrink-0 rounded-full bg-text px-1.5 py-1.5 text-bg hover:opacity-80"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); next(); }}
          className="flex-shrink-0 text-text-dim hover:text-text"
          title="Next"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>
    );
  }

  // --- LARGE: album art fills most of the window ---
  if (mode === "large") {
    return (
      <div
        data-tauri-drag-region
        onMouseDown={startSnapPolling}
        onMouseUp={stopSnapPolling}
        className="relative flex h-full w-full flex-col rounded-xl bg-bg shadow-2xl"
      >
        {/* Drag handle at top */}
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        {/* Album art fills most of the window */}
        <div className="flex flex-1 items-center justify-center overflow-hidden px-4 py-2">
          <div
            className={`max-h-full max-w-full rounded-lg border-2 border-border shadow-lg ${discClass}`}
            style={{
              ...discBg,
              aspectRatio: "1 / 1",
              height: "min(100%, calc(100% - 80px))",
              width: "auto",
            }}
          >
            <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg/80" />
          </div>
        </div>

        {/* Caption strip below */}
        <div className="flex flex-col gap-2 px-4 pb-3">
          <div className="text-center">
            <p className="truncate text-sm font-medium text-text">
              {current?.title ?? "Nothing playing"}
            </p>
            <p className="truncate text-xs text-text-faint">
              {current?.artist ?? ""}
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button onClick={prev} className="text-text-dim hover:text-text" title="Previous">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </button>
            <button
              onClick={playPause}
              className="rounded-full bg-text px-2.5 py-2.5 text-bg hover:opacity-80"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button onClick={next} className="text-text-dim hover:text-text" title="Next">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </button>
          </div>
        </div>

        {snapPreview && (
          <div className="pointer-events-none absolute inset-0 rounded-xl border-2 border-accent/50 bg-accent/10" />
        )}
      </div>
    );
  }

  // --- MEDIUM: square-ish card with full transport ---
  return (
    <div
      data-tauri-drag-region
      onMouseDown={startSnapPolling}
      onMouseUp={stopSnapPolling}
      className="flex h-full w-full flex-col items-center gap-2 rounded-xl bg-bg p-3 shadow-2xl"
    >
      {/* Spinning disc / album art */}
      <div className="relative mt-1 flex-shrink-0">
        <div
          className={`rounded-full border-4 border-border shadow-lg ${discClass}`}
          style={{
            ...discBg,
            width: "min(140px, calc(100% - 16px))",
            height: "auto",
            aspectRatio: "1 / 1",
          }}
        >
          <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg" />
          <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border" />
        </div>
      </div>

      {/* Track info */}
      <div className="w-full text-center">
        <p className="truncate text-sm font-medium text-text">
          {current?.title ?? "Nothing playing"}
        </p>
        <p className="truncate text-xs text-text-faint">
          {current?.artist ?? ""}
        </p>
      </div>

      {/* Full transport: prev, rewind, play/pause, next, volume */}
      <div className="flex items-center gap-2">
        <button onClick={prev} className="text-text-dim hover:text-text" title="Previous">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>
        <button
          onClick={seekStart}
          className="text-text-dim hover:text-text"
          title="Restart"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
          </svg>
        </button>
        <button
          onClick={playPause}
          className="rounded-full bg-text px-2.5 py-2.5 text-bg hover:opacity-80"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button onClick={next} className="text-text-dim hover:text-text" title="Next">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>

      {/* Volume slider */}
      <div className="flex w-full items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0 text-text-faint">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
        </svg>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVol(parseFloat(e.target.value))}
          className="flex-1 accent-accent"
        />
      </div>

      {snapPreview && (
        <div className="pointer-events-none absolute inset-0 rounded-xl border-2 border-accent/50 bg-accent/10" />
      )}
    </div>
  );
}

export default MiniPlayer;
