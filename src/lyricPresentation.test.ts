import { describe, expect, it } from "vitest";
import {
  buildLyricPresentationWindow,
  linePresentationLifecycle,
  presentationLineProgress,
} from "./lyricPresentation";
import type { LyricLine } from "./lyrics";

const lines: LyricLine[] = [
  makeLine("line-a", "First", 1_000, 3_000),
  makeLine("line-b", "Second", 2_500, 4_000),
  makeLine("line-c", "Third", 4_200, 5_000),
  makeLine("line-d", "Fourth", 8_500, 9_000),
];

describe("lyric presentation window", () => {
  it("promotes the newest overlapping line at its authored begin boundary", () => {
    expect(buildLyricPresentationWindow(lines, 2_499, "active").map(project)).toEqual([
      "line-a:current:active",
      "line-b:upcoming:pending",
    ]);

    expect(buildLyricPresentationWindow(lines, 2_500, "active").map(project)).toEqual([
      "line-a:previous:leaving",
      "line-b:current:active",
      "line-c:upcoming:pending",
    ]);
  });

  it("keeps at most previous, current, and upcoming during rapid overlaps", () => {
    const rapidLines = [
      makeLine("rapid-a", "A", 1_000, 2_000),
      makeLine("rapid-b", "B", 1_100, 2_000),
      makeLine("rapid-c", "C", 1_200, 2_000),
      makeLine("rapid-d", "D", 1_300, 2_000),
    ];

    const window = buildLyricPresentationWindow(rapidLines, 1_350, "active");
    expect(window).toHaveLength(2);
    expect(window.map(project)).toEqual(["rapid-c:previous:leaving", "rapid-d:current:active"]);
  });

  it("keeps the nearest expired line in the previous slot during normal playback", () => {
    expect(buildLyricPresentationWindow(lines, 3_100, "active").map(project)).toEqual([
      "line-a:previous:leaving",
      "line-b:current:active",
      "line-c:upcoming:pending",
    ]);
  });

  it("prepares short-gap lyrics without extending authored activity", () => {
    expect(buildLyricPresentationWindow(lines, 4_100, "short-gap").map(project)).toEqual([
      "line-b:previous:leaving",
      "line-c:current:entering",
      "line-d:upcoming:pending",
    ]);
    expect(presentationLineProgress(lines[2], 4_100)).toBe(0);
  });

  it("keeps long pauses instrumental with only the future lyric pending", () => {
    expect(buildLyricPresentationWindow(lines, 6_000, "instrumental-gap").map(project)).toEqual([
      "line-d:upcoming:pending",
    ]);
  });

  it("handles empty lyrics and the final lyric", () => {
    expect(buildLyricPresentationWindow([], 1_000, "after-last-line")).toEqual([]);
    expect(buildLyricPresentationWindow(lines, 8_750, "active").map(project)).toEqual([
      "line-c:previous:leaving",
      "line-d:current:active",
    ]);
    expect(buildLyricPresentationWindow(lines, 9_000, "after-last-line")).toEqual([]);
  });

  it("classifies expired lines while presenting the nearest one as leaving context", () => {
    expect(linePresentationLifecycle(lines[0], "previous", 3_000)).toBe("expired");
    expect(buildLyricPresentationWindow(lines, 3_100, "active").map(project)).toEqual([
      "line-a:previous:leaving",
      "line-b:current:active",
      "line-c:upcoming:pending",
    ]);
  });

  it("does not duplicate rows and keeps single-line states in the current slot", () => {
    const singleLine = [makeLine("only", "Only line", 1_000, 2_000)];
    const window = buildLyricPresentationWindow(singleLine, 1_500, "active");

    expect(window.map(project)).toEqual(["only:current:active"]);
    expect(new Set(window.map((item) => item.line.id)).size).toBe(window.length);
  });
});

function makeLine(id: string, text: string, beginMs: number, endMs: number): LyricLine {
  return {
    id,
    text,
    beginMs,
    endMs,
    segments: [],
    role: null,
    region: null,
    styleRefs: [],
  };
}

function project(row: ReturnType<typeof buildLyricPresentationWindow>[number]) {
  return `${row.line.id}:${row.role}:${row.lifecycle}`;
}
