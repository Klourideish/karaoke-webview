import { type ReactElement, useCallback, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { MediaSong } from "./media-library/types";

export type PlaybackStatus =
  "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

type ResolvedAudioSource = {
  songId: string;
  audioPath: string;
};

export type AudioPlayer = {
  audioElement: ReactElement;
  currentSong: MediaSong | null;
  currentTime: number;
  duration: number;
  error: string | null;
  loadSong: (song: MediaSong) => Promise<void>;
  pause: () => void;
  play: () => Promise<void>;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  status: PlaybackStatus;
  volume: number;
};

export function useAudioPlayer(): AudioPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadTokenRef = useRef(0);
  const [currentSong, setCurrentSong] = useState<MediaSong | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [error, setError] = useState<string | null>(null);

  const applyVolume = useCallback((nextVolume: number) => {
    const clampedVolume = clamp(nextVolume, 0, 1);
    setVolumeState(clampedVolume);
    if (audioRef.current) {
      audioRef.current.volume = clampedVolume;
    }
  }, []);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !currentSong) {
      return;
    }

    try {
      setError(null);
      await audio.play();
    } catch (playError) {
      console.error("Audio playback could not start.", playError);
      setStatus(audio.readyState > 0 ? "paused" : "ready");
      setError("Playback could not start. Press Play to try again.");
    }
  }, [currentSong]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }

    const nextTime = clamp(time, 0, audio.duration);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, []);

  const loadSong = useCallback(
    async (song: MediaSong) => {
      const token = loadTokenRef.current + 1;
      loadTokenRef.current = token;
      const audio = audioRef.current;

      setCurrentSong(song);
      setStatus("loading");
      setCurrentTime(0);
      setDuration(0);
      setError(null);

      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        audio.dataset.songId = song.id;
        audio.volume = volume;
      }

      try {
        const resolved = await invoke<ResolvedAudioSource>("resolve_audio_source", { song });
        if (loadTokenRef.current !== token || resolved.songId !== song.id) {
          return;
        }

        const sourceUrl = convertFileSrc(resolved.audioPath);
        const activeAudio = audioRef.current;
        if (!activeAudio) {
          return;
        }

        activeAudio.dataset.songId = song.id;
        activeAudio.src = sourceUrl;
        activeAudio.load();

        try {
          await activeAudio.play();
        } catch (playError) {
          if (loadTokenRef.current !== token) {
            return;
          }
          console.error("Audio playback could not start.", playError);
          setStatus("ready");
          setError("Playback could not start. Press Play to try again.");
        }
      } catch (resolveError) {
        if (loadTokenRef.current !== token) {
          return;
        }
        console.error("Could not resolve audio source.", resolveError);
        setStatus("error");
        setError(errorToMessage(resolveError, "Could not access this audio file."));
      }
    },
    [volume],
  );

  const audioElement = useMemo(
    () => (
      <audio
        aria-hidden="true"
        data-testid="persistent-audio-element"
        onCanPlay={() => {
          if (status === "loading") {
            setStatus("ready");
          }
        }}
        onDurationChange={(event) => {
          setDuration(finiteMediaTime(event.currentTarget.duration));
        }}
        onEnded={() => {
          setCurrentTime(finiteMediaTime(audioRef.current?.duration ?? 0));
          setStatus("ended");
        }}
        onError={(event) => {
          console.error("Audio element error.", event.currentTarget.error);
          setStatus("error");
          setError(mediaErrorMessage(event.currentTarget.error));
        }}
        onLoadedMetadata={(event) => {
          setDuration(finiteMediaTime(event.currentTarget.duration));
          setCurrentTime(finiteMediaTime(event.currentTarget.currentTime));
        }}
        onLoadStart={() => {
          setStatus("loading");
          setError(null);
        }}
        onPause={(event) => {
          if (!event.currentTarget.ended && status !== "loading" && status !== "error") {
            setStatus("paused");
          }
        }}
        onPlay={() => {
          setStatus("playing");
          setError(null);
        }}
        onSeeked={(event) => {
          setCurrentTime(finiteMediaTime(event.currentTarget.currentTime));
        }}
        onSeeking={(event) => {
          setCurrentTime(finiteMediaTime(event.currentTarget.currentTime));
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(finiteMediaTime(event.currentTarget.currentTime));
        }}
        preload="metadata"
        ref={audioRef}
      />
    ),
    [status],
  );

  return {
    audioElement,
    currentSong,
    currentTime,
    duration,
    error,
    loadSong,
    pause,
    play,
    seek,
    setVolume: applyVolume,
    status,
    volume,
  };
}

export function formatMediaTime(seconds: number) {
  const safeSeconds = finiteMediaTime(seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

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
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}
