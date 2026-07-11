import { useCallback, useEffect, useRef, useState } from "react";
import { discoverLocalMicrophoneSources } from "./api";
import type { MicrophoneDiscoveryState } from "./types";

const initialState: MicrophoneDiscoveryState = {
  status: "loading",
  sources: [],
  error: null,
};

export function useLocalMicrophones() {
  const [state, setState] = useState(initialState);
  const requestIdRef = useRef(0);
  const startedRef = useRef(false);

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({ ...current, status: "loading", error: null }));

    try {
      const sources = await discoverLocalMicrophoneSources();
      if (requestIdRef.current === requestId) {
        setState({ status: "success", sources, error: null });
      }
    } catch (error) {
      console.error("Local microphone discovery failed.", error);
      if (requestIdRef.current === requestId) {
        setState({
          status: "failure",
          sources: [],
          error: "Could not discover local microphone inputs.",
        });
      }
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
