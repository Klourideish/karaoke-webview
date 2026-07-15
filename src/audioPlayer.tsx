import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  getPlaybackProjection,
  listenForPlaybackProjection,
  reportPlaybackCompleted,
  reportPlaybackFailed,
  reportPlaybackStarted,
  requestPlaybackPause,
  requestPlaybackResume,
  requestPlaybackStop,
  requestSongPlayback,
} from "./playback/api";
import {
  idlePlaybackProjection,
  type PlaybackCommandError,
  type PlaybackProjection,
  type PlaybackSongProjection,
} from "./playback/types";

export type PlaybackStatus =
  "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

export type AudioPlayer = {
  audioElement: ReactElement;
  currentSong: PlaybackSongProjection | null;
  currentTime: number;
  duration: number;
  error: string | null;
  getCurrentTime: () => number;
  loadSong: (songId: string) => Promise<void>;
  pause: () => Promise<void>;
  play: () => Promise<void>;
  projection: PlaybackProjection;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  status: PlaybackStatus;
  stop: () => Promise<void>;
  volume: number;
};

export function useAudioPlayer(): AudioPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentTimeRef = useRef(0);
  const projectionRef = useRef(idlePlaybackProjection);
  const appliedActionRef = useRef<string | null>(null);
  const reportedAdapterEventsRef = useRef<{ attemptId: string | null; events: Set<string> }>({
    attemptId: null,
    events: new Set(),
  });
  const isReplacingSourceRef = useRef(false);
  const [projection, setProjection] = useState(idlePlaybackProjection);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [adapterError, setAdapterError] = useState<string | null>(null);

  const acceptProjection = useCallback((next: PlaybackProjection) => {
    if (!isPlaybackProjection(next)) return;
    if (next.revision < projectionRef.current.revision) return;
    projectionRef.current = next;
    setProjection(next);
  }, []);

  const acceptAdapterReport = useCallback(
    (report: Promise<PlaybackProjection>) => {
      void report.then(acceptProjection).catch(() => undefined);
    },
    [acceptProjection],
  );

  const reportAdapterEvent = useCallback(
    (attemptId: string, eventKey: string, report: () => Promise<PlaybackProjection>) => {
      if (reportedAdapterEventsRef.current.attemptId !== attemptId) {
        reportedAdapterEventsRef.current = { attemptId, events: new Set() };
      }
      if (reportedAdapterEventsRef.current.events.has(eventKey)) return;
      reportedAdapterEventsRef.current.events.add(eventKey);
      acceptAdapterReport(report());
    },
    [acceptAdapterReport],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenForPlaybackProjection((next) => {
      if (!disposed) acceptProjection(next);
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    });
    void getPlaybackProjection().then((next) => {
      if (!disposed) acceptProjection(next);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [acceptProjection]);

  const applyVolume = useCallback((nextVolume: number) => {
    const clampedVolume = clamp(nextVolume, 0, 1);
    setVolumeState(clampedVolume);
    if (audioRef.current) audioRef.current.volume = clampedVolume;
  }, []);

  const updateCurrentTime = useCallback((value: number) => {
    const nextTime = finiteMediaTime(value);
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
  }, []);

  const getCurrentTime = useCallback(() => {
    return finiteMediaTime(audioRef.current?.currentTime ?? currentTimeRef.current);
  }, []);

  useEffect(() => {
    const attemptId = projection.attemptId;
    if (!attemptId || projection.desiredAction === "none") return;
    const actionKey = `${projection.revision}:${attemptId}:${projection.desiredAction}`;
    if (appliedActionRef.current === actionKey) return;
    appliedActionRef.current = actionKey;
    const audio = audioRef.current;
    if (!audio) return;

    if (projection.desiredAction === "pause") {
      audio.pause();
      return;
    }
    if (projection.desiredAction === "stop") {
      isReplacingSourceRef.current = true;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      delete audio.dataset.attemptId;
      delete audio.dataset.songId;
      isReplacingSourceRef.current = false;
      updateCurrentTime(0);
      setDuration(0);
      return;
    }
    if (projection.desiredAction === "resume") {
      void audio.play().catch(() => {
        const message = "Playback could not resume. Press Play to try again.";
        setAdapterError(message);
        reportAdapterEvent(attemptId, "failed", () =>
          reportPlaybackFailed(attemptId, "start-rejected", message),
        );
      });
      return;
    }

    const song = projection.song;
    if (!song) return;
    isReplacingSourceRef.current = true;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    updateCurrentTime(0);
    setDuration(0);
    setAdapterError(null);
    audio.dataset.attemptId = attemptId;
    audio.dataset.songId = song.id;
    audio.volume = volume;
    audio.src = convertFileSrc(song.audioPath);
    audio.load();
    isReplacingSourceRef.current = false;
    void audio.play().catch(() => {
      const message = "Playback could not start. Press Play to try again.";
      setAdapterError(message);
      reportAdapterEvent(attemptId, "failed", () =>
        reportPlaybackFailed(attemptId, "start-rejected", message),
      );
    });
  }, [projection, reportAdapterEvent, updateCurrentTime, volume]);

  const loadSong = useCallback(
    async (songId: string) => {
      try {
        setAdapterError(null);
        acceptProjection(await requestSongPlayback(operationId("start"), songId));
      } catch (cause) {
        setAdapterError(errorToMessage(cause, "Could not start this song."));
      }
    },
    [acceptProjection],
  );

  const play = useCallback(async () => {
    try {
      setAdapterError(null);
      acceptProjection(await requestPlaybackResume(operationId("resume")));
    } catch (cause) {
      setAdapterError(errorToMessage(cause, "Playback could not resume."));
    }
  }, [acceptProjection]);

  const pause = useCallback(async () => {
    try {
      setAdapterError(null);
      acceptProjection(await requestPlaybackPause(operationId("pause")));
    } catch (cause) {
      setAdapterError(errorToMessage(cause, "Playback could not pause."));
    }
  }, [acceptProjection]);

  const stop = useCallback(async () => {
    try {
      setAdapterError(null);
      acceptProjection(await requestPlaybackStop(operationId("stop")));
    } catch (cause) {
      setAdapterError(errorToMessage(cause, "Playback could not stop."));
    }
  }, [acceptProjection]);

  const seek = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const nextTime = clamp(time, 0, audio.duration);
      audio.currentTime = nextTime;
      updateCurrentTime(nextTime);
    },
    [updateCurrentTime],
  );

  const audioElement = (
    <audio
      aria-hidden="true"
      data-testid="persistent-audio-element"
      onDurationChange={(event) => setDuration(finiteMediaTime(event.currentTarget.duration))}
      onEnded={(event) => {
        updateCurrentTime(audioRef.current?.duration ?? 0);
        const attemptId = event.currentTarget.dataset.attemptId;
        if (attemptId && attemptId === projectionRef.current.attemptId) {
          reportAdapterEvent(attemptId, "completed", () => reportPlaybackCompleted(attemptId));
        }
      }}
      onError={(event) => {
        if (isReplacingSourceRef.current) return;
        const message = mediaErrorMessage(event.currentTarget.error);
        setAdapterError(message);
        const attemptId = event.currentTarget.dataset.attemptId;
        if (attemptId && attemptId === projectionRef.current.attemptId) {
          reportAdapterEvent(attemptId, "failed", () =>
            reportPlaybackFailed(attemptId, "media-error", message),
          );
        }
      }}
      onLoadedMetadata={(event) => {
        setDuration(finiteMediaTime(event.currentTarget.duration));
        updateCurrentTime(event.currentTarget.currentTime);
      }}
      onPlaying={(event) => {
        setAdapterError(null);
        const current = projectionRef.current;
        if (
          current.attemptId &&
          event.currentTarget.dataset.attemptId === current.attemptId &&
          current.state === "starting"
        ) {
          reportAdapterEvent(current.attemptId, `started:${current.revision}`, () =>
            reportPlaybackStarted(current.attemptId as string),
          );
        }
      }}
      onSeeked={(event) => updateCurrentTime(event.currentTarget.currentTime)}
      onSeeking={(event) => updateCurrentTime(event.currentTarget.currentTime)}
      onTimeUpdate={(event) => updateCurrentTime(event.currentTarget.currentTime)}
      preload="metadata"
      ref={audioRef}
    />
  );

  return {
    audioElement,
    currentSong: projection.song,
    currentTime,
    duration,
    error: adapterError ?? projection.failureMessage,
    getCurrentTime,
    loadSong,
    pause,
    play,
    projection,
    seek,
    setVolume: applyVolume,
    status: playbackStatus(projection),
    stop,
    volume,
  };
}

export function formatMediaTime(seconds: number) {
  const safeSeconds = finiteMediaTime(seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function playbackStatus(projection: PlaybackProjection): PlaybackStatus {
  switch (projection.state) {
    case "idle":
      return "idle";
    case "starting":
      return "loading";
    case "playing":
      return "playing";
    case "paused":
      return "paused";
    case "completed":
      return "ended";
    case "failed":
      return "error";
    case "stopped":
      return projection.song ? "ready" : "idle";
  }
}

function operationId(kind: string) {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `playback-${kind}-${random}`;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function finiteMediaTime(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function mediaErrorMessage(error: MediaError | null) {
  switch (error?.code) {
    case 1:
      return "Playback was stopped before the audio could load.";
    case 2:
      return "Could not access this audio file.";
    case 3:
      return "This audio format could not be played.";
    case 4:
      return "The audio file is no longer available or could not be played.";
    default:
      return "Playback failed.";
  }
}

function errorToMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as PlaybackCommandError).message === "string"
  ) {
    return (error as PlaybackCommandError).message;
  }
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function isPlaybackProjection(value: unknown): value is PlaybackProjection {
  return Boolean(
    value &&
    typeof value === "object" &&
    "revision" in value &&
    typeof value.revision === "number" &&
    "state" in value &&
    typeof value.state === "string" &&
    "desiredAction" in value &&
    typeof value.desiredAction === "string",
  );
}
