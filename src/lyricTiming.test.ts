import { describe, expect, it } from "vitest";
import { LyricTimingEngine } from "./lyricTiming";
import type { LyricDocument } from "./lyrics";

const lyricDocument: LyricDocument = {
  schemaVersion: 1,
  sourceSongId: "song-a",
  language: "en",
  warnings: [],
  lines: [
    {
      id: "line-a",
      beginMs: 1_000,
      endMs: 2_000,
      text: "First line",
      role: null,
      region: null,
      styleRefs: [],
      segments: [
        {
          id: "segment-a",
          beginMs: 1_000,
          endMs: 1_500,
          text: "First",
          timingGranularity: "text",
          styleRefs: [],
        },
        {
          id: "segment-b",
          beginMs: 1_500,
          endMs: 2_000,
          text: "line",
          timingGranularity: "text",
          styleRefs: [],
        },
      ],
    },
    {
      id: "line-b",
      beginMs: 4_000,
      endMs: 5_000,
      text: "Second line",
      role: null,
      region: null,
      styleRefs: [],
      segments: [
        {
          id: "segment-c",
          beginMs: 4_000,
          endMs: 5_000,
          text: "Second line",
          timingGranularity: "text",
          styleRefs: [],
        },
      ],
    },
  ],
};

describe("LyricTimingEngine", () => {
  it("selects previous, current, next, active fragments, and line progress", () => {
    const engine = new LyricTimingEngine(lyricDocument);

    const state = engine.lookup(1_250);

    expect(state.previousLine).toBeNull();
    expect(state.currentLine?.text).toBe("First line");
    expect(state.nextLine?.text).toBe("Second line");
    expect(state.activeFragments.map((fragment) => fragment.id)).toEqual(["segment-a"]);
    expect(state.currentLineProgress).toBeCloseTo(0.25);
  });

  it("keeps brief gaps stable without classifying them as instrumental", () => {
    const engine = new LyricTimingEngine(lyricDocument);

    const state = engine.lookup(3_000);

    expect(state.previousLine?.text).toBe("First line");
    expect(state.currentLine?.text).toBe("Second line");
    expect(state.nextLine).toBeNull();
    expect(state.activeFragments).toEqual([]);
    expect(state.currentLineProgress).toBe(0);
    expect(state.timelineState).toBe("short-gap");
  });

  it("classifies meaningful internal gaps as instrumental", () => {
    const engine = new LyricTimingEngine({
      ...lyricDocument,
      lines: [
        lyricDocument.lines[0],
        {
          ...lyricDocument.lines[1],
          beginMs: 8_000,
          endMs: 9_000,
        },
      ],
    });

    const state = engine.lookup(5_000);

    expect(state.currentLine).toBeNull();
    expect(state.nextLine?.text).toBe("Second line");
    expect(state.timelineState).toBe("instrumental-gap");
  });

  it("does not classify the intro before the first line as instrumental", () => {
    const engine = new LyricTimingEngine(lyricDocument);

    const state = engine.lookup(500);

    expect(state.currentLine?.text).toBe("First line");
    expect(state.nextLine?.text).toBe("Second line");
    expect(state.timelineState).toBe("before-first-line");
  });

  it("promotes the upcoming line during a short gap without activating fragments", () => {
    const engine = new LyricTimingEngine(lyricDocument);

    const state = engine.lookup(2_200);

    expect(state.currentLine?.id).toBe("line-b");
    expect(state.nextLine).toBeNull();
    expect(state.activeFragments).toEqual([]);
    expect(state.activeFragmentIds).toEqual([]);
    expect(state.timelineState).toBe("short-gap");
  });

  it("handles seeking forward and backward with the moving cursor", () => {
    const engine = new LyricTimingEngine(lyricDocument);

    expect(engine.lookup(4_500).currentLine?.text).toBe("Second line");
    expect(engine.lookup(1_600).currentLine?.text).toBe("First line");
    expect(engine.lookup(4_100).currentLine?.text).toBe("Second line");
  });

  it("reports no current or next line after playback end", () => {
    const engine = new LyricTimingEngine(lyricDocument);

    const state = engine.lookup(6_000);

    expect(state.previousLine?.text).toBe("Second line");
    expect(state.currentLine).toBeNull();
    expect(state.nextLine).toBeNull();
    expect(state.timelineState).toBe("after-last-line");
  });

  it("selects later active fragments and clamps fragment progress", () => {
    const engine = new LyricTimingEngine(lyricDocument);

    const state = engine.lookup(1_750);

    expect(state.activeFragments.map((fragment) => fragment.id)).toEqual(["segment-b"]);
    expect(state.activeFragmentIds).toEqual(["segment-b"]);
    expect(state.activeFragmentIndex).toBe(1);
    expect(state.currentFragmentProgress).toBeCloseTo(0.5);
  });

  it("switches fragments exactly at the transition boundary", () => {
    const engine = new LyricTimingEngine(lyricDocument);

    expect(engine.lookup(1_499).activeFragmentIds).toEqual(["segment-a"]);
    expect(engine.lookup(1_500).activeFragmentIds).toEqual(["segment-b"]);
  });

  it("updates active fragments after seeking forward and backward", () => {
    const engine = new LyricTimingEngine(lyricDocument);

    expect(engine.lookup(1_750).activeFragmentIds).toEqual(["segment-b"]);
    expect(engine.lookup(1_100).activeFragmentIds).toEqual(["segment-a"]);
  });

  it("does not invent an active fragment in a short gap between fragments", () => {
    const engine = new LyricTimingEngine({
      ...lyricDocument,
      lines: [
        {
          ...lyricDocument.lines[0],
          segments: [
            {
              ...lyricDocument.lines[0].segments[0],
              beginMs: 1_000,
              endMs: 1_300,
            },
            {
              ...lyricDocument.lines[0].segments[1],
              beginMs: 1_700,
              endMs: 2_000,
            },
          ],
        },
      ],
    });

    const state = engine.lookup(1_500);

    expect(state.currentLine?.id).toBe("line-a");
    expect(state.activeFragments).toEqual([]);
    expect(state.timelineState).toBe("active");
  });

  it("does not mark line-level-only text as an active timed fragment", () => {
    const engine = new LyricTimingEngine({
      ...lyricDocument,
      lines: [
        {
          id: "line-only",
          beginMs: 1_000,
          endMs: 2_000,
          text: "Whole line",
          role: null,
          region: null,
          styleRefs: [],
          segments: [
            {
              id: "line-only-segment",
              beginMs: 1_000,
              endMs: 2_000,
              text: "Whole line",
              timingGranularity: "text",
              styleRefs: [],
            },
          ],
        },
      ],
    });

    const state = engine.lookup(1_250);

    expect(state.currentLine?.text).toBe("Whole line");
    expect(state.activeFragments).toEqual([]);
    expect(state.currentFragmentProgress).toBe(0);
  });

  it("returns overlapping active fragments in source order", () => {
    const engine = new LyricTimingEngine({
      ...lyricDocument,
      lines: [
        {
          ...lyricDocument.lines[0],
          segments: [
            {
              ...lyricDocument.lines[0].segments[0],
              beginMs: 1_000,
              endMs: 1_800,
            },
            {
              ...lyricDocument.lines[0].segments[1],
              beginMs: 1_300,
              endMs: 2_000,
            },
          ],
        },
      ],
    });

    const state = engine.lookup(1_500);

    expect(state.activeFragmentIds).toEqual(["segment-a", "segment-b"]);
    expect(state.activeFragmentIndex).toBe(0);
  });

  it("clears the active fragment after its end", () => {
    const engine = new LyricTimingEngine(lyricDocument);

    expect(engine.lookup(2_000).activeFragments).toEqual([]);
  });
});
