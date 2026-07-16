import { describe, expect, it } from "vitest";
import {
  adjustLyricOffsetMs,
  effectiveLyricTimeMs,
  formatLyricOffset,
  LYRIC_OFFSET_MAX_MS,
  LYRIC_OFFSET_MIN_MS,
  totalLyricOffsetMs,
} from "./lyricOffset";

describe("lyric offset", () => {
  it("uses authored time at zero and applies the documented signed semantics", () => {
    expect(effectiveLyricTimeMs(1_000, 0)).toBe(1_000);
    expect(effectiveLyricTimeMs(1_000, 500)).toBe(500);
    expect(effectiveLyricTimeMs(1_000, -500)).toBe(1_500);
  });

  it("clamps negative effective time and bounded offset adjustments safely", () => {
    expect(effectiveLyricTimeMs(100, 500)).toBe(0);
    expect(adjustLyricOffsetMs(LYRIC_OFFSET_MAX_MS, 100)).toBe(LYRIC_OFFSET_MAX_MS);
    expect(adjustLyricOffsetMs(LYRIC_OFFSET_MIN_MS, -100)).toBe(LYRIC_OFFSET_MIN_MS);
  });

  it("formats the operator-visible sign explicitly", () => {
    expect(formatLyricOffset(-500)).toBe("-500 ms");
    expect(formatLyricOffset(0)).toBe("0 ms");
    expect(formatLyricOffset(500)).toBe("+500 ms");
  });

  it("composes saved and temporary offsets once without mutating either value", () => {
    expect(totalLyricOffsetMs(-700, 100)).toBe(-600);
    expect(effectiveLyricTimeMs(1_000, totalLyricOffsetMs(-700, 100))).toBe(1_600);
  });
});
