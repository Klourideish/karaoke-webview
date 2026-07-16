import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  adjustLyricOffsetMs,
  LYRIC_OFFSET_MAX_MS,
  LYRIC_OFFSET_MIN_MS,
  totalLyricOffsetMs,
} from "./lyricOffset";
import {
  getSongLyricTiming,
  removeSongLyricOffset,
  saveSongLyricOffset,
  type LyricTimingPersistenceStatus,
  type SongLyricTimingProjection,
} from "./lyricTimingPreferences";

export type SongLyricTimingController = {
  songId: string | null;
  savedOffsetMs: number | null;
  temporaryOffsetMs: number;
  effectiveOffsetMs: number;
  persistenceStatus: LyricTimingPersistenceStatus | "idle" | "loading" | "saving" | "removing";
  error: string | null;
  isPending: boolean;
  adjustTemporary: (deltaMs: number) => void;
  resetTemporary: () => void;
  saveForSong: () => Promise<boolean>;
  removeSavedOffset: () => Promise<boolean>;
};

type TemporaryOffsetState = { songId: string | null; offsetMs: number };

export function useSongLyricTiming(songId: string | null): SongLyricTimingController {
  const [projection, setProjection] = useState<SongLyricTimingProjection | null>(null);
  const [temporary, setTemporary] = useState<TemporaryOffsetState>({ songId, offsetMs: 0 });
  const [status, setStatus] = useState<SongLyricTimingController["persistenceStatus"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const mutationPending = useRef(false);
  const songIdRef = useRef(songId);
  songIdRef.current = songId;

  const savedOffsetMs = projection?.songId === songId ? projection.savedOffsetMs : null;
  const temporaryOffsetMs = temporary.songId === songId ? temporary.offsetMs : 0;
  const effectiveOffsetMs = totalLyricOffsetMs(savedOffsetMs ?? 0, temporaryOffsetMs);

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setTemporary({ songId, offsetMs: 0 });
    setError(null);

    if (!songId) {
      setProjection(null);
      setStatus("idle");
      return;
    }

    setStatus("loading");
    void getSongLyricTiming(songId)
      .then((next) => {
        if (requestSequence.current !== sequence || songIdRef.current !== songId) return;
        setProjection(next);
        setStatus(next.persistenceStatus);
        setError(next.lastError);
      })
      .catch((reason: unknown) => {
        if (requestSequence.current !== sequence || songIdRef.current !== songId) return;
        setProjection(null);
        setStatus("failed");
        setError(errorMessage(reason, "Could not load saved lyric timing."));
      });
  }, [songId]);

  const adjustTemporary = useCallback(
    (deltaMs: number) => {
      if (!songId) return;
      setTemporary((current) => ({
        songId,
        offsetMs: adjustLyricOffsetMs(current.songId === songId ? current.offsetMs : 0, deltaMs),
      }));
    },
    [songId],
  );

  const resetTemporary = useCallback(() => {
    setTemporary({ songId, offsetMs: 0 });
  }, [songId]);

  const saveForSong = useCallback(async () => {
    if (
      !songId ||
      mutationPending.current ||
      effectiveOffsetMs < LYRIC_OFFSET_MIN_MS ||
      effectiveOffsetMs > LYRIC_OFFSET_MAX_MS
    ) {
      return false;
    }
    mutationPending.current = true;
    setStatus("saving");
    setError(null);
    try {
      const next = await saveSongLyricOffset(songId, effectiveOffsetMs);
      if (songIdRef.current === songId) {
        setProjection(next);
        setTemporary({ songId, offsetMs: 0 });
        setStatus(next.persistenceStatus);
        setError(next.lastError);
      }
      return true;
    } catch (reason) {
      if (songIdRef.current === songId) {
        setStatus("failed");
        setError(errorMessage(reason, "Could not save lyric timing for this song."));
      }
      return false;
    } finally {
      mutationPending.current = false;
    }
  }, [effectiveOffsetMs, songId]);

  const removeSavedOffset = useCallback(async () => {
    if (!songId || mutationPending.current) return false;
    mutationPending.current = true;
    setStatus("removing");
    setError(null);
    try {
      const next = await removeSongLyricOffset(songId);
      if (songIdRef.current === songId) {
        setProjection(next);
        setStatus(next.persistenceStatus);
        setError(next.lastError);
      }
      return true;
    } catch (reason) {
      if (songIdRef.current === songId) {
        setStatus("failed");
        setError(errorMessage(reason, "Could not reset lyric timing for this song."));
      }
      return false;
    } finally {
      mutationPending.current = false;
    }
  }, [songId]);

  return useMemo(
    () => ({
      songId,
      savedOffsetMs,
      temporaryOffsetMs,
      effectiveOffsetMs,
      persistenceStatus: status,
      error,
      isPending: status === "loading" || status === "saving" || status === "removing",
      adjustTemporary,
      resetTemporary,
      saveForSong,
      removeSavedOffset,
    }),
    [
      adjustTemporary,
      effectiveOffsetMs,
      error,
      removeSavedOffset,
      resetTemporary,
      saveForSong,
      savedOffsetMs,
      songId,
      status,
      temporaryOffsetMs,
    ],
  );
}

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return fallback;
}
