import { useEffect, useMemo, useRef, useState } from "react";
import { parseSongLyrics, type LyricDocument } from "./lyrics";
import type { PlaybackSongProjection } from "./playback/types";

export type SongLyricsState = {
  document: LyricDocument | null;
  error: string | null;
  isLoading: boolean;
  songId: string | null;
};

export function useSongLyrics(song: PlaybackSongProjection | null): SongLyricsState {
  const [state, setState] = useState<SongLyricsState>({
    document: null,
    error: null,
    isLoading: false,
    songId: null,
  });
  const requestIdRef = useRef(0);
  const songId = song?.id ?? null;

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!songId) {
      setState({
        document: null,
        error: null,
        isLoading: false,
        songId: null,
      });
      return;
    }

    setState({
      document: null,
      error: null,
      isLoading: true,
      songId,
    });

    parseSongLyrics(songId)
      .then((document) => {
        if (requestIdRef.current !== requestId || document.sourceSongId !== songId) {
          return;
        }
        setState({
          document,
          error: null,
          isLoading: false,
          songId,
        });
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId) {
          return;
        }
        setState({
          document: null,
          error: errorToMessage(error, "Could not load lyrics for this song."),
          isLoading: false,
          songId,
        });
      });
  }, [songId]);

  return useMemo(() => state, [state]);
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
