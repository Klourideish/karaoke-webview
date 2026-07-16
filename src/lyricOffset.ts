export const LYRIC_OFFSET_MIN_MS = -3_000;
export const LYRIC_OFFSET_MAX_MS = 3_000;
export const LYRIC_OFFSET_STEP_MS = 100;

export function clampLyricOffsetMs(offsetMs: number) {
  if (!Number.isFinite(offsetMs)) return 0;
  return Math.min(LYRIC_OFFSET_MAX_MS, Math.max(LYRIC_OFFSET_MIN_MS, Math.round(offsetMs)));
}

export function adjustLyricOffsetMs(offsetMs: number, deltaMs: number) {
  return clampLyricOffsetMs(offsetMs + deltaMs);
}

export function effectiveLyricTimeMs(playbackTimeMs: number, offsetMs: number) {
  const safePlaybackTime = Number.isFinite(playbackTimeMs) ? playbackTimeMs : 0;
  const safeOffset = Number.isFinite(offsetMs) ? Math.round(offsetMs) : 0;
  return Math.max(0, safePlaybackTime - safeOffset);
}

export function totalLyricOffsetMs(savedSongOffsetMs: number, temporarySessionOffsetMs: number) {
  const saved = Number.isFinite(savedSongOffsetMs) ? Math.round(savedSongOffsetMs) : 0;
  const temporary = Number.isFinite(temporarySessionOffsetMs)
    ? Math.round(temporarySessionOffsetMs)
    : 0;
  return saved + temporary;
}

export function formatLyricOffset(offsetMs: number) {
  const value = Number.isFinite(offsetMs) ? Math.round(offsetMs) : 0;
  if (value === 0) return "0 ms";
  return `${value > 0 ? "+" : ""}${value} ms`;
}
