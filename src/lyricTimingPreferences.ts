import { invoke } from "@tauri-apps/api/core";

export type LyricTimingPersistenceStatus = "loaded" | "saved" | "removed" | "failed";

export type SongLyricTimingProjection = {
  songId: string;
  savedOffsetMs: number | null;
  persistenceStatus: LyricTimingPersistenceStatus;
  lastError: string | null;
};

export type LyricTimingPreferenceError = {
  reasonCode: string;
  message: string;
};

export function getSongLyricTiming(songId: string) {
  return invoke<SongLyricTimingProjection>("get_song_lyric_timing", { songId });
}

export function saveSongLyricOffset(songId: string, offsetMs: number) {
  return invoke<SongLyricTimingProjection>("save_song_lyric_offset", { songId, offsetMs });
}

export function removeSongLyricOffset(songId: string) {
  return invoke<SongLyricTimingProjection>("remove_song_lyric_offset", { songId });
}
