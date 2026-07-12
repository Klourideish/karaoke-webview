import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMicrophoneRecoveryStates,
  leaveMicrophoneChannelAssigned,
  retryMicrophoneChannelSource,
} from "./api";
import type {
  LocalMicrophoneChannel,
  LocalMicrophoneSource,
  MicrophoneRecoveryState,
} from "./types";

let pendingRecoveryLoad: Promise<MicrophoneRecoveryState[]> | null = null;

function loadRecoveryStates() {
  if (!pendingRecoveryLoad) {
    pendingRecoveryLoad = getMicrophoneRecoveryStates().finally(() => {
      pendingRecoveryLoad = null;
    });
  }
  return pendingRecoveryLoad;
}

export function useMicrophoneRecovery(
  sources: readonly LocalMicrophoneSource[],
  channels: readonly LocalMicrophoneChannel[],
) {
  const [states, setStates] = useState<MicrophoneRecoveryState[]>([]);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestVersion = requestVersionRef.current;
    try {
      const next = await loadRecoveryStates();
      if (requestVersionRef.current === requestVersion) {
        setStates(next);
        setError(null);
      }
    } catch (cause) {
      console.error("Microphone recovery states could not be loaded.", cause);
      if (requestVersionRef.current === requestVersion) {
        setError("Could not load microphone recovery status.");
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [channels, refresh, sources]);

  const retry = useCallback(async (channelId: string) => {
    const requestVersion = ++requestVersionRef.current;
    setPendingChannelId(channelId);
    setError(null);
    try {
      const next = await retryMicrophoneChannelSource(channelId);
      if (requestVersionRef.current === requestVersion) {
        setStates((current) => [...current.filter((state) => state.channelId !== channelId), next]);
      }
      return next;
    } catch (cause) {
      console.error("The original microphone source could not be recovered.", cause);
      if (requestVersionRef.current === requestVersion) {
        setError("Could not recover the original microphone source.");
      }
      return null;
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingChannelId(null);
      }
    }
  }, []);

  const leaveAssigned = useCallback(async (channelId: string) => {
    const requestVersion = ++requestVersionRef.current;
    setPendingChannelId(channelId);
    setError(null);
    try {
      const next = await leaveMicrophoneChannelAssigned(channelId);
      if (requestVersionRef.current === requestVersion) {
        setStates((current) => [...current.filter((state) => state.channelId !== channelId), next]);
      }
    } catch (cause) {
      console.error("The microphone channel could not be left assigned.", cause);
      if (requestVersionRef.current === requestVersion) {
        setError("Could not leave the microphone channel assigned.");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingChannelId(null);
      }
    }
  }, []);

  return { error, leaveAssigned, pendingChannelId, refresh, retry, states };
}
