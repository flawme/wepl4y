import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Track, LibraryFolder, ScanProgress } from "../types";

export function useLibrary() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load folders and tracks on mount
    refreshFolders();
    refreshTracks();

    // Listen for scan progress
    let unlisten: UnlistenFn | undefined;
    listen<ScanProgress>("scan-progress", (event) => {
      setScanProgress(event.payload);
      if (event.payload.phase === "done") {
        setScanProgress(null);
        refreshTracks();
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const refreshTracks = useCallback(async () => {
    try {
      const t = await invoke<Track[]>("get_tracks");
      setTracks(t);
    } catch (e) {
      console.error("Failed to load tracks:", e);
    }
  }, []);

  const refreshFolders = useCallback(async () => {
    try {
      const f = await invoke<LibraryFolder[]>("get_library_folders");
      setFolders(f);
    } catch (e) {
      console.error("Failed to load folders:", e);
    }
  }, []);

  const pickFolder = useCallback(async () => {
    try {
      const result = await invoke<LibraryFolder | null>("pick_library_folder");
      if (result) {
        setFolders((prev) => {
          if (prev.some((f) => f.id === result.id)) return prev;
          return [...prev, result];
        });
      }
    } catch (e) {
      console.error("Failed to pick folder:", e);
    }
  }, []);

  const removeFolder = useCallback(async (id: string) => {
    await invoke("remove_library_folder", { id });
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const rescan = useCallback(async () => {
    setLoading(true);
    try {
      await invoke("rescan_library");
      await refreshTracks();
    } catch (e) {
      console.error("Rescan failed:", e);
    } finally {
      setLoading(false);
    }
  }, [refreshTracks]);

  return {
    tracks,
    folders,
    scanProgress,
    loading,
    refreshTracks,
    pickFolder,
    removeFolder,
    rescan,
  };
}
