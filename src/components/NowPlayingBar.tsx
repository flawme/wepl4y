import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PlaybackSnapshot, RepeatMode } from "../types";

interface NowPlayingBarProps {
  state: PlaybackSnapshot | null;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (secs: number) => void;
  onVolume: (vol: number) => void;
  onToggleShuffle?: () => void;
  onToggleRepeat?: () => void;
  onToggleFavorite?: () => void;
  isFavorite?: boolean;
}

function formatTime(secs: number): string {
  if (!secs || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function NowPlayingBar({
  state,
  onPlayPause,
  onNext,
  onPrev,
  onSeek,
  onVolume,
  onToggleShuffle,
  onToggleRepeat,
  onToggleFavorite,
  isFavorite = false,
}: NowPlayingBarProps) {
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const lastNonZeroVolumeRef = useRef<number>(0.8);

  const current = state?.current_index != null ? state.queue[state.current_index] : null;
  const isPlaying = state?.is_playing ?? false;
  const volume = state?.volume ?? 0.8;
  const position = state?.position_secs ?? 0;
  const duration = current?.duration_secs ?? 0;
  const repeatMode: RepeatMode = state?.repeat ?? "off";
  const isShuffle: boolean = state?.shuffle ?? false;

  // Track last non-zero volume for mute/unmute
  useEffect(() => {
    if (volume > 0) {
      lastNonZeroVolumeRef.current = volume;
    }
  }, [volume]);

  // Fetch album art when the current track changes
  useEffect(() => {
    if (current?.art_path) {
      invoke<string | null>("get_album_art", { path: current.art_path })
        .then(setArtUrl)
        .catch(() => setArtUrl(null));
    } else {
      setArtUrl(null);
    }
  }, [current?.art_path]);

  const handleToggleMute = () => {
    if (volume > 0) {
      lastNonZeroVolumeRef.current = volume;
      onVolume(0);
    } else {
      const restored = lastNonZeroVolumeRef.current > 0 ? lastNonZeroVolumeRef.current : 0.8;
      onVolume(restored);
    }
  };

  return (
    <div className="app-now-playing flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3 overflow-hidden">
      {/* Track info with album art */}
      <div className="flex w-56 shrink-0 items-center gap-3 overflow-hidden">
        <div
          className={`h-12 w-12 flex-shrink-0 rounded-xl bg-surface-2 ${
            isPlaying ? "shadow-md shadow-accent/15" : ""
          }`}
          style={
            artUrl
              ? {
                  backgroundImage: `url(${artUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          {!artUrl && (
            <div className="flex h-full w-full items-center justify-center text-text-faint">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          <p className="truncate text-sm font-medium text-text">
            {current?.title ?? "Nothing playing"}
          </p>
          <p className="truncate text-xs text-text-faint">
            {current?.artist ?? "Select a track to play"}
          </p>
        </div>
        {current && onToggleFavorite && (
          <button
            onClick={onToggleFavorite}
            className={`flex-shrink-0 p-1 text-base transition-transform hover:scale-110 ${
              isFavorite ? "text-accent-soft" : "text-text-faint hover:text-accent-soft"
            }`}
            title={isFavorite ? "Remove from Favorites (F)" : "Add to Favorites (F)"}
            aria-label="Toggle favorite"
          >
            {isFavorite ? "♥" : "♡"}
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-1 min-w-0 flex-col items-center gap-1 px-2">
        <div className="flex items-center gap-3">
          {/* Shuffle button */}
          <button
            onClick={onToggleShuffle}
            className={`rounded-lg p-1.5 transition-colors ${
              isShuffle
                ? "text-accent bg-accent/15 shadow-sm shadow-accent/20"
                : "text-text-faint hover:text-text"
            }`}
            title={`Shuffle: ${isShuffle ? "ON" : "OFF"} (S)`}
            aria-label="Toggle shuffle"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
            </svg>
          </button>

          {/* Previous button */}
          <button
            onClick={onPrev}
            className="text-text-dim hover:text-text"
            title="Previous (Shift+← / P)"
            aria-label="Previous track"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>

          {/* Play/Pause button */}
          <button
            onClick={onPlayPause}
            className="rounded-full bg-accent p-2.5 text-white shadow-lg shadow-accent/25 hover:bg-accent-hover active:scale-95 transition-transform"
            title={isPlaying ? "Pause (Space / K)" : "Play (Space / K)"}
            aria-label={isPlaying ? "Pause" : "Play"}
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

          {/* Next button */}
          <button
            onClick={onNext}
            className="text-text-dim hover:text-text"
            title="Next (Shift+→ / N)"
            aria-label="Next track"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>

          {/* Repeat button */}
          <button
            onClick={onToggleRepeat}
            className={`relative rounded-lg p-1.5 transition-colors ${
              repeatMode !== "off"
                ? "text-accent bg-accent/15 shadow-sm shadow-accent/20"
                : "text-text-faint hover:text-text"
            }`}
            title={`Repeat: ${repeatMode.toUpperCase()} (R)`}
            aria-label="Cycle repeat mode"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
            </svg>
            {repeatMode === "one" && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent text-[9px] font-extrabold text-white">
                1
              </span>
            )}
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex w-full max-w-md items-center gap-2">
          <span className="w-10 text-right text-xs font-mono text-text-faint">
            {formatTime(position)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={Math.min(position, duration || 100)}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="flex-1 min-w-0 accent-accent cursor-pointer"
            aria-label="Track progress"
          />
          <span className="w-10 text-xs font-mono text-text-faint">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Volume */}
      <div className="flex w-36 shrink-0 items-center justify-end gap-2">
        <button
          onClick={handleToggleMute}
          className="shrink-0 text-text-faint hover:text-text transition-colors p-1"
          title={volume === 0 ? "Unmute (M)" : "Mute (M)"}
          aria-label={volume === 0 ? "Unmute" : "Mute"}
        >
          {volume === 0 ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-accent">
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
            </svg>
          ) : volume < 0.5 ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 9v6h4l5 5V4L11 9H7z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
            </svg>
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(parseFloat(e.target.value))}
          className="w-16 min-w-0 flex-1 accent-accent cursor-pointer"
          aria-label="Volume slider"
        />
        <span className="w-8 text-right text-[11px] font-mono text-text-faint shrink-0 tabular-nums">
          {Math.round(volume * 100)}%
        </span>
      </div>
    </div>
  );
}
