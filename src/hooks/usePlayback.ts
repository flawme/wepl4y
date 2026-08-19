import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PlaybackSnapshot, QueueTrack, RepeatMode } from "../types";

export function usePlayback() {
  const [state, setState] = useState<PlaybackSnapshot | null>(null);

  useEffect(() => {
    // Fetch initial state
    invoke<PlaybackSnapshot>("get_playback_state")
      .then(setState)
      .catch(console.error);

    // Listen for state updates from the backend
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

  const playQueue = useCallback(
    async (tracks: QueueTrack[], startIndex?: number) => {
      await invoke("play_queue", {
        tracks,
        startIndex: startIndex ?? 0,
      });
      const s = await invoke<PlaybackSnapshot>("get_playback_state");
      setState(s);
    },
    []
  );

  const playPause = useCallback(async () => {
    if (state?.current_index == null) {
      await invoke("play_random_track");
    } else {
      await invoke("play_pause");
    }
    const s = await invoke<PlaybackSnapshot>("get_playback_state");
    setState(s);
  }, [state?.current_index]);

  const next = useCallback(async () => {
    await invoke("next");
    const s = await invoke<PlaybackSnapshot>("get_playback_state");
    setState(s);
  }, []);

  const prev = useCallback(async () => {
    await invoke("prev");
    const s = await invoke<PlaybackSnapshot>("get_playback_state");
    setState(s);
  }, []);

  const setVolume = useCallback(async (volume: number) => {
    await invoke("set_volume", { volume });
    const s = await invoke<PlaybackSnapshot>("get_playback_state");
    setState(s);
  }, []);

  const seek = useCallback(async (positionSecs: number) => {
    await invoke("seek", { positionSecs });
    const s = await invoke<PlaybackSnapshot>("get_playback_state");
    setState(s);
  }, []);

  const setRepeat = useCallback(async (mode: RepeatMode) => {
    await invoke("set_repeat", { mode });
    const s = await invoke<PlaybackSnapshot>("get_playback_state");
    setState(s);
  }, []);

  const setShuffle = useCallback(async (enabled: boolean) => {
    await invoke("set_shuffle", { enabled });
    const s = await invoke<PlaybackSnapshot>("get_playback_state");
    setState(s);
  }, []);

  return {
    state,
    playQueue,
    playPause,
    next,
    prev,
    setVolume,
    seek,
    setRepeat,
    setShuffle,
  };
}
