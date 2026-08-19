import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PlaybackSnapshot } from "../types";

interface NowPlayingBarProps {
  state: PlaybackSnapshot | null;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (secs: number) => void;
  onVolume: (vol: number) => void;
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
}: NowPlayingBarProps) {
  const [artUrl, setArtUrl] = useState<string | null>(null);

  const current = state?.current_index != null ? state.queue[state.current_index] : null;
  const isPlaying = state?.is_playing ?? false;
  const volume = state?.volume ?? 0.8;
  const position = state?.position_secs ?? 0;
  const duration = current?.duration_secs ?? 0;

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

  return (
    <div className="flex items-center gap-4 border-t border-border bg-surface px-4 py-3">
      {/* Track info with album art */}
      <div className="flex w-56 items-center gap-3 overflow-hidden">
        <div
          className="h-12 w-12 flex-shrink-0 rounded bg-surface-2"
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
        <div className="overflow-hidden">
          <p className="truncate text-sm font-medium">
            {current?.title ?? "Nothing playing"}
          </p>
          <p className="truncate text-xs text-text-faint">
            {current?.artist ?? ""}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-1 flex-col items-center gap-1">
        <div className="flex items-center gap-4">
          <button
            onClick={onPrev}
            className="text-text-dim hover:text-text"
            title="Previous"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>
          <button
            onClick={onPlayPause}
            className="rounded-full bg-text px-2 py-2 text-bg hover:opacity-80"
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
          <button
            onClick={onNext}
            className="text-text-dim hover:text-text"
            title="Next"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex w-full max-w-md items-center gap-2">
          <span className="w-10 text-right text-xs text-text-faint">
            {formatTime(position)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={position}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="w-10 text-xs text-text-faint">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Volume */}
      <div className="flex w-32 items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-text-faint">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
        </svg>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(parseFloat(e.target.value))}
          className="flex-1 accent-accent"
        />
      </div>
    </div>
  );
}
