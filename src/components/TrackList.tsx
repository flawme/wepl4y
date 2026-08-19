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
  currentTrackId?: string;
}

export function TrackList({ tracks, onPlayTrack, currentTrackId }: TrackListProps) {
  if (tracks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-text-faint">
          No tracks yet. Add a music folder to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface text-text-faint">
          <tr>
            <th className="w-8 px-3 py-2 text-left font-medium">#</th>
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
                className={`cursor-pointer border-b border-border/50 hover:bg-surface-2 ${
                  isActive ? "bg-surface-2 text-accent" : ""
                }`}
              >
                <td className="px-3 py-2 text-text-faint">
                  {isActive ? "▶" : index + 1}
                </td>
                <td className="px-3 py-2 font-medium">{track.title}</td>
                <td className="px-3 py-2 text-text-dim">{track.artist}</td>
                <td className="px-3 py-2 text-text-dim">{track.album}</td>
                <td className="px-3 py-2 text-right text-text-faint">
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
