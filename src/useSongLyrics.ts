import { useEffect, useMemo, useRef, useState } from "react";
import { parseSongLyrics, type LyricDocument } from "./lyrics";
import type { MediaSong } from "./media-library/types";

export type SongLyricsState = {
  document: LyricDocument | null;
  error: string | null;
  isLoading: boolean;
  songId: string | null;
};

export function useSongLyrics(song: MediaSong | null): SongLyricsState {
  const [state, setState] = useState<SongLyricsState>({
    document: null,
    error: null,
    isLoading: false,
    songId: null,
  });
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!song) {
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
      songId: song.id,
    });

    parseSongLyrics(song)
      .then((document) => {
        if (requestIdRef.current !== requestId || document.sourceSongId !== song.id) {
          return;
        }
        setState({
          document,
          error: null,
          isLoading: false,
          songId: song.id,
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
          songId: song.id,
        });
      });
  }, [song]);

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
