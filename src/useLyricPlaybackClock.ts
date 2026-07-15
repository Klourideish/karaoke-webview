import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { AudioPlayer } from "./audioPlayer";
import { effectiveLyricTimeMs } from "./lyricOffset";
import { LyricTimingEngine, type ActiveLyricState } from "./lyricTiming";
import type { LyricDocument } from "./lyrics";
import {
  lyricPresentationSignature,
  LyricPresentationModel,
  type LyricPresentationRow,
} from "./lyricPresentation";

export type LyricPlaybackSnapshot = {
  playbackTimeMs: number;
  effectiveTimeMs: number;
  offsetMs: number;
  state: ActiveLyricState;
  presentationRows: LyricPresentationRow[];
};

export function useLyricPlaybackClock({
  audioPlayer,
  document: lyricDocument,
  offsetMs,
}: {
  audioPlayer: AudioPlayer;
  document: LyricDocument | null;
  offsetMs: number;
}) {
  const timingEngine = useMemo(() => {
    return lyricDocument ? new LyricTimingEngine(lyricDocument) : null;
  }, [lyricDocument]);
  const presentationModel = useMemo(() => {
    return lyricDocument ? new LyricPresentationModel(lyricDocument.lines) : null;
  }, [lyricDocument]);
  const [snapshot, setSnapshot] = useState<LyricPlaybackSnapshot | null>(null);
  const signatureRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    signatureRef.current = null;
    if (!timingEngine || !presentationModel) {
      setSnapshot(null);
      return;
    }

    publishSnapshot(
      timingEngine,
      presentationModel,
      audioPlayer.getCurrentTime,
      offsetMs,
      setSnapshot,
      signatureRef,
    );
  }, [
    audioPlayer.currentSong?.id,
    audioPlayer.currentTime,
    audioPlayer.getCurrentTime,
    offsetMs,
    presentationModel,
    timingEngine,
  ]);

  useEffect(() => {
    if (!timingEngine || !presentationModel || audioPlayer.status !== "playing") {
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

      publishSnapshot(
        timingEngine,
        presentationModel,
        audioPlayer.getCurrentTime,
        offsetMs,
        setSnapshot,
        signatureRef,
      );
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

      publishSnapshot(
        timingEngine,
        presentationModel,
        audioPlayer.getCurrentTime,
        offsetMs,
        setSnapshot,
        signatureRef,
      );
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
  }, [audioPlayer.getCurrentTime, audioPlayer.status, offsetMs, presentationModel, timingEngine]);

  return snapshot;
}

function publishSnapshot(
  timingEngine: LyricTimingEngine,
  presentationModel: LyricPresentationModel,
  getCurrentTime: () => number,
  offsetMs: number,
  setSnapshot: (
    updater: (current: LyricPlaybackSnapshot | null) => LyricPlaybackSnapshot | null,
  ) => void,
  signatureRef: MutableRefObject<string | null>,
) {
  const playbackTimeMs = getCurrentTime() * 1_000;
  const effectiveTimeMs = effectiveLyricTimeMs(playbackTimeMs, offsetMs);
  const state = timingEngine.lookup(effectiveTimeMs);
  const presentationRows = presentationModel.lookup(effectiveTimeMs, state.timelineState);
  const signature = lyricStateSignature(state, presentationRows);
  if (signatureRef.current === signature && state.activeFragmentIds.length === 0) {
    return;
  }

  signatureRef.current = signature;
  setSnapshot(() => ({
    playbackTimeMs,
    effectiveTimeMs,
    offsetMs,
    state,
    presentationRows,
  }));
}

function lyricStateSignature(state: ActiveLyricState, presentationRows: LyricPresentationRow[]) {
  return [
    state.timelineState,
    state.currentLine?.id ?? "",
    state.nextLine?.id ?? "",
    state.activeFragmentIds.join(","),
    state.activeFragmentIndex ?? "",
    lyricPresentationSignature(presentationRows),
  ].join("|");
}

function documentIsHidden() {
  return typeof document !== "undefined" && document.hidden;
}
