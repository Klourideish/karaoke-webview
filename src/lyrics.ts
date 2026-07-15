import { invoke } from "@tauri-apps/api/core";

export type LyricTimingGranularity = "text" | "word" | "syllable";

export type LyricSegment = {
  id: string;
  text: string;
  beginMs: number;
  endMs: number;
  timingGranularity: LyricTimingGranularity;
  styleRefs: string[];
};

export type LyricLine = {
  id: string;
  beginMs: number;
  endMs: number;
  text: string;
  segments: LyricSegment[];
  role: string | null;
  region: string | null;
  styleRefs: string[];
};

export type LyricWarning = {
  code: string;
  message: string;
  sourceContext: string | null;
};

export type LyricDocument = {
  schemaVersion: number;
  sourceSongId: string;
  language: string | null;
  lines: LyricLine[];
  warnings: LyricWarning[];
};

export function parseSongLyrics(songId: string): Promise<LyricDocument> {
  return invoke<LyricDocument>("parse_song_lyrics", { songId });
}
