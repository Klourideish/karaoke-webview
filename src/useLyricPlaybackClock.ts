import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { AudioPlayer } from "./audioPlayer";
import { LyricTimingEngine, type ActiveLyricState } from "./lyricTiming";
import type { LyricDocument } from "./lyrics";

export type LyricPlaybackSnapshot = {
  sampledTimeMs: number;
  state: ActiveLyricState;
};

export function useLyricPlaybackClock({
  audioPlayer,
  document: lyricDocument,
}: {
  audioPlayer: AudioPlayer;
  document: LyricDocument | null;
}) {
  const timingEngine = useMemo(() => {
    return lyricDocument ? new LyricTimingEngine(lyricDocument) : null;
  }, [lyricDocument]);
  const [snapshot, setSnapshot] = useState<LyricPlaybackSnapshot | null>(null);
  const signatureRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    signatureRef.current = null;
    if (!timingEngine) {
      setSnapshot(null);
      return;
    }

    publishSnapshot(timingEngine, audioPlayer.getCurrentTime, setSnapshot, signatureRef);
  }, [
    audioPlayer.currentSong?.id,
    audioPlayer.currentTime,
    audioPlayer.getCurrentTime,
    timingEngine,
  ]);

  useEffect(() => {
    if (!timingEngine || audioPlayer.status !== "playing") {
      return undefined;
    }

    let disposed = false;

    function stopFrame() {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    }

    function tick() {
      if (disposed || !timingEngine) {
        return;
      }

      if (documentIsHidden()) {
        stopFrame();
        return;
      }

      publishSnapshot(timingEngine, audioPlayer.getCurrentTime, setSnapshot, signatureRef);
      frameRef.current = requestAnimationFrame(tick);
    }

    function handleVisibilityChange() {
      if (disposed || !timingEngine) {
        return;
      }

      if (documentIsHidden()) {
        stopFrame();
        return;
      }

      publishSnapshot(timingEngine, audioPlayer.getCurrentTime, setSnapshot, signatureRef);
      stopFrame();
      frameRef.current = requestAnimationFrame(tick);
    }

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      stopFrame();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [audioPlayer.getCurrentTime, audioPlayer.status, timingEngine]);

  return snapshot;
}

function publishSnapshot(
  timingEngine: LyricTimingEngine,
  getCurrentTime: () => number,
  setSnapshot: (
    updater: (current: LyricPlaybackSnapshot | null) => LyricPlaybackSnapshot | null,
  ) => void,
  signatureRef: MutableRefObject<string | null>,
) {
  const sampledTimeMs = getCurrentTime() * 1_000;
  const state = timingEngine.lookup(sampledTimeMs);
  const signature = lyricStateSignature(state);
  if (signatureRef.current === signature) {
    return;
  }

  signatureRef.current = signature;
  setSnapshot(() => ({
    sampledTimeMs,
    state,
  }));
}

function lyricStateSignature(state: ActiveLyricState) {
  return [
    state.timelineState,
    state.currentLine?.id ?? "",
    state.nextLine?.id ?? "",
    state.activeFragmentIds.join(","),
    state.activeFragmentIndex ?? "",
  ].join("|");
}

function documentIsHidden() {
  return typeof document !== "undefined" && document.hidden;
}
