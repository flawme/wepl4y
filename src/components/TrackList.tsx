import type { Track } from "../types";

function formatDuration(secs: number | null): string {
  if (secs == null) return "--:--";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface TrackListProps {
  tracks: Track[];
  onPlayTrack: (track: Track, index: number) => void;
  onToggleFavorite: (track: Track) => void;
  currentTrackId?: string;
  isPlaying?: boolean;
}

export function TrackList({
  tracks,
  onPlayTrack,
  onToggleFavorite,
  currentTrackId,
  isPlaying = false,
}: TrackListProps) {
  if (tracks.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-text-faint">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-text">No tracks found</p>
        <p className="mt-1 text-xs text-text-faint">
          Add a music folder to your library or adjust your search.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur-md text-text-faint shadow-sm">
          <tr>
            <th className="w-10 px-3 py-2 text-left font-medium">#</th>
            <th className="w-10 px-3 py-2 text-center font-medium">Fav</th>
            <th className="px-3 py-2 text-left font-medium">Title</th>
            <th className="px-3 py-2 text-left font-medium">Artist</th>
            <th className="px-3 py-2 text-left font-medium">Album</th>
            <th className="w-16 px-3 py-2 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((track, index) => {
            const isActive = track.id === currentTrackId;
            return (
              <tr
                key={track.id}
                onClick={() => onPlayTrack(track, index)}
                className={`track-row group cursor-pointer border-b border-border/40 hover:bg-surface-2 ${
                  isActive ? "track-row-active bg-surface-2/90 text-accent font-medium" : "text-text"
                }`}
              >
                <td className="px-3 py-2 text-text-faint">
                  {isActive ? (
                    isPlaying ? (
                      <div className="equalizer-bars flex items-end gap-[2px] h-3.5 w-3.5">
                        <span className="eq-bar eq-bar-1" />
                        <span className="eq-bar eq-bar-2" />
                        <span className="eq-bar eq-bar-3" />
                      </div>
                    ) : (
                      <span className="text-accent text-xs">▶</span>
                    )
                  ) : (
                    <span className="group-hover:hidden">{index + 1}</span>
                  )}
                  {!isActive && (
                    <span className="hidden group-hover:inline text-accent text-xs">▶</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFavorite(track);
                    }}
                    className={`text-base transition-transform hover:scale-125 ${
                      track.favorite ? "text-accent-soft" : "text-text-faint hover:text-accent-soft"
                    }`}
                    title={track.favorite ? "Remove from favorites (F)" : "Add to favorites (F)"}
                    aria-label={track.favorite ? "Remove from favorites" : "Add to favorites"}
                  >
                    {track.favorite ? "♥" : "♡"}
                  </button>
                </td>
                <td className="px-3 py-2 font-medium">
                  <span className="truncate block max-w-xs">{track.title}</span>
                </td>
                <td className="px-3 py-2 text-text-dim">
                  <span className="truncate block max-w-xs">{track.artist}</span>
                </td>
                <td className="px-3 py-2 text-text-dim">
                  <span className="truncate block max-w-xs">{track.album}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-text-faint">
                  {formatDuration(track.duration_secs)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
