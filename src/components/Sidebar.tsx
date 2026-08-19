import { useState } from "react";
import type { LibraryFolder, ScanProgress, Playlist } from "../types";

interface SidebarProps {
  folders: LibraryFolder[];
  playlists: Playlist[];
  scanProgress: ScanProgress | null;
  onPickFolder: () => void;
  onRemoveFolder: (id: string) => void;
  onRescan: () => void;
  trackCount: number;
  onCreatePlaylist: (name: string, isSmart: boolean) => void;
  onDeletePlaylist: (id: string) => void;
  onSelectPlaylist: (playlist: Playlist) => void;
  selectedPlaylistId: string | null;
}

export function Sidebar({
  folders,
  playlists,
  scanProgress,
  onPickFolder,
  onRemoveFolder,
  onRescan,
  trackCount,
  onCreatePlaylist,
  onDeletePlaylist,
  onSelectPlaylist,
  selectedPlaylistId,
}: SidebarProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [isSmart, setIsSmart] = useState(false);

  function handleCreate() {
    if (newName.trim()) {
      onCreatePlaylist(newName.trim(), isSmart);
      setNewName("");
      setIsSmart(false);
      setShowCreate(false);
    }
  }

  return (
    <aside className="flex w-56 flex-col border-r border-border bg-surface">
      <div className="p-3">
        <button
          onClick={onPickFolder}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          + Add Folder
        </button>
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={onRescan}
          disabled={!!scanProgress}
          className="w-full rounded-md border border-border px-3 py-1.5 text-sm text-text-dim hover:bg-surface-2 disabled:opacity-50"
        >
          {scanProgress ? "Scanning..." : "Rescan Library"}
        </button>
      </div>

      {scanProgress && (
        <div className="px-3 pb-2">
          <div className="h-1.5 w-full overflow-hidden rounded bg-surface-2">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${
                  scanProgress.total > 0
                    ? (scanProgress.current / scanProgress.total) * 100
                    : 0
                }%`,
              }}
            />
          </div>
          <p className="mt-1 truncate text-xs text-text-faint">
            {scanProgress.current_file}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-faint">
          Library
        </p>
        {folders.length === 0 ? (
          <p className="text-xs text-text-faint">No folders added</p>
        ) : (
          <ul className="mb-4 space-y-0.5">
            {folders.map((folder) => (
              <li
                key={folder.id}
                className="group flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-surface-2"
              >
                <span className="truncate">{folder.label}</span>
                <button
                  onClick={() => onRemoveFolder(folder.id)}
                  className="ml-2 hidden text-text-faint hover:text-red-400 group-hover:block"
                  title="Remove folder"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-text-faint">
            Playlists
          </p>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="text-text-faint hover:text-text"
            title="New playlist"
          >
            +
          </button>
        </div>

        {showCreate && (
          <div className="mb-2 space-y-2 rounded bg-surface-2 p-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Playlist name..."
              className="w-full rounded border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
              autoFocus
            />
            <label className="flex items-center gap-2 text-xs text-text-dim">
              <input
                type="checkbox"
                checked={isSmart}
                onChange={(e) => setIsSmart(e.target.checked)}
              />
              Smart playlist
            </label>
            <button
              onClick={handleCreate}
              className="w-full rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover"
            >
              Create
            </button>
          </div>
        )}

        {playlists.length === 0 ? (
          <p className="text-xs text-text-faint">No playlists yet</p>
        ) : (
          <ul className="space-y-0.5">
            {playlists.map((pl) => (
              <li
                key={pl.id}
                className={`group flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-surface-2 ${
                  selectedPlaylistId === pl.id ? "bg-surface-2 text-accent" : ""
                }`}
              >
                <button
                  onClick={() => onSelectPlaylist(pl)}
                  className="flex-1 truncate text-left"
                >
                  {pl.is_smart ? "✨ " : ""}
                  {pl.name}
                </button>
                <button
                  onClick={() => onDeletePlaylist(pl.id)}
                  className="ml-2 hidden text-text-faint hover:text-red-400 group-hover:block"
                  title="Delete playlist"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border px-3 py-2 text-xs text-text-faint">
        {trackCount} tracks
      </div>
    </aside>
  );
}
