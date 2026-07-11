import { useCallback, useEffect, useRef, useState } from "react";
import { discoverLocalMicrophoneSources } from "./api";
import type { LocalMicrophoneSource, MicrophoneDiscoveryState } from "./types";

const initialState: MicrophoneDiscoveryState = {
  status: "loading",
  sources: [],
  error: null,
  isRefreshing: true,
};

export const LOCAL_MICROPHONE_REFRESH_INTERVAL_MS = 3_000;

type RefreshOptions = {
  background?: boolean;
};

export function useLocalMicrophones() {
  const [state, setState] = useState(initialState);
  const pendingRefreshRef = useRef<Promise<void> | null>(null);
  const hasSnapshotRef = useRef(false);
  const latestSourcesRef = useRef<LocalMicrophoneSource[]>([]);

  const refresh = useCallback((options: RefreshOptions = {}) => {
    if (pendingRefreshRef.current) {
      return pendingRefreshRef.current;
    }

    const isBackground = options.background === true;
    if (!isBackground) {
      setState((current) => ({
        ...current,
        status: hasSnapshotRef.current ? "success" : "loading",
        error: null,
        isRefreshing: true,
      }));
    }

    const request = discoverLocalMicrophoneSources()
      .then((sources) => {
        hasSnapshotRef.current = true;
        latestSourcesRef.current = sources;
        setState((current) => {
          if (
            current.status === "success" &&
            current.error === null &&
            !current.isRefreshing &&
            sameSourceRegistry(current.sources, sources)
          ) {
            return current;
          }

          return { status: "success", sources, error: null, isRefreshing: false };
        });
      })
      .catch((error: unknown) => {
        console.error("Local microphone discovery failed.", error);
        setState({
          status: "failure",
          sources: hasSnapshotRef.current ? latestSourcesRef.current : [],
          error: "Could not discover local microphone inputs.",
          isRefreshing: false,
        });
      })
      .finally(() => {
        if (pendingRefreshRef.current === request) {
          pendingRefreshRef.current = null;
        }
      });

    pendingRefreshRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh({ background: true });
    }, LOCAL_MICROPHONE_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [refresh]);

  return { ...state, refresh };
}

export function sameSourceRegistry(
  left: readonly LocalMicrophoneSource[],
  right: readonly LocalMicrophoneSource[],
): boolean {
  return (
    left.length === right.length &&
    left.every((source, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        source.id === candidate.id &&
        source.displayName === candidate.displayName &&
        source.kind === candidate.kind &&
        source.availability === candidate.availability &&
        source.isDefault === candidate.isDefault
      );
    })
  );
}
