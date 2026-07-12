import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMicrophoneChannel,
  listMicrophoneChannels,
  removeMicrophoneChannel,
  replaceMicrophoneChannelSource,
} from "./api";
import type { LocalMicrophoneChannel, LocalMicrophoneSource } from "./types";

let pendingChannelList: Promise<LocalMicrophoneChannel[]> | null = null;

function loadChannels() {
  if (!pendingChannelList) {
    pendingChannelList = listMicrophoneChannels().finally(() => {
      pendingChannelList = null;
    });
  }
  return pendingChannelList;
}

export function useMicrophoneChannels(discoveredSources: readonly LocalMicrophoneSource[]) {
  const [channels, setChannels] = useState<LocalMicrophoneChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestVersion = requestVersionRef.current;
    try {
      const next = await loadChannels();
      if (requestVersionRef.current === requestVersion) {
        setChannels(next);
        setError(null);
      }
    } catch (cause) {
      console.error("Microphone channels could not be loaded.", cause);
      if (requestVersionRef.current === requestVersion) {
        setError("Could not load microphone channels.");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [discoveredSources, refresh]);

  const create = useCallback(async (sourceId: string) => {
    const requestVersion = ++requestVersionRef.current;
    setPendingAction(`create:${sourceId}`);
    setError(null);
    try {
      const created = await createMicrophoneChannel(sourceId);
      if (requestVersionRef.current === requestVersion) {
        setChannels((current) => [...current, created]);
      }
    } catch (cause) {
      console.error("Microphone channel could not be created.", cause);
      if (requestVersionRef.current === requestVersion) {
        setError("Could not create the microphone channel.");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingAction(null);
        setIsLoading(false);
      }
    }
  }, []);

  const remove = useCallback(async (channelId: string) => {
    const requestVersion = ++requestVersionRef.current;
    setPendingAction(`remove:${channelId}`);
    setError(null);
    try {
      await removeMicrophoneChannel(channelId);
      if (requestVersionRef.current === requestVersion) {
        setChannels((current) => current.filter((channel) => channel.id !== channelId));
      }
    } catch (cause) {
      console.error("Microphone channel could not be removed.", cause);
      if (requestVersionRef.current === requestVersion) {
        setError("Could not remove the microphone channel.");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingAction(null);
      }
    }
  }, []);

  const replaceSource = useCallback(async (channelId: string, sourceId: string) => {
    const requestVersion = ++requestVersionRef.current;
    setPendingAction(`replace:${channelId}`);
    setError(null);
    try {
      const replaced = await replaceMicrophoneChannelSource(channelId, sourceId);
      if (requestVersionRef.current === requestVersion) {
        setChannels((current) =>
          current.map((channel) => (channel.id === channelId ? replaced : channel)),
        );
      }
    } catch (cause) {
      console.error("Microphone channel source could not be replaced.", cause);
      if (requestVersionRef.current === requestVersion) {
        setError("Could not replace the microphone channel source.");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingAction(null);
      }
    }
  }, []);

  return { channels, create, error, isLoading, pendingAction, refresh, remove, replaceSource };
}
