import type { ActiveLyricState } from "./lyricTiming";
import type { LyricLine } from "./lyrics";

export type LyricPresentationRole = "previous" | "current" | "upcoming";

export type LyricPresentationLifecycle = "pending" | "entering" | "active" | "leaving" | "expired";

export type LyricPresentationRow = {
  line: LyricLine;
  role: LyricPresentationRole;
  lifecycle: LyricPresentationLifecycle;
};

export class LyricPresentationModel {
  private readonly lines: LyricLine[];

  constructor(lines: LyricLine[]) {
    this.lines = [...lines].sort(compareLines);
  }

  lookup(
    playbackTimeMs: number,
    timelineState: ActiveLyricState["timelineState"],
  ): LyricPresentationRow[] {
    return buildWindowFromOrderedLines(this.lines, playbackTimeMs, timelineState);
  }
}

export function buildLyricPresentationWindow(
  lines: LyricLine[],
  playbackTimeMs: number,
  timelineState: ActiveLyricState["timelineState"],
): LyricPresentationRow[] {
  const orderedLines = [...lines].sort(compareLines);
  return buildWindowFromOrderedLines(orderedLines, playbackTimeMs, timelineState);
}

function buildWindowFromOrderedLines(
  orderedLines: LyricLine[],
  playbackTimeMs: number,
  timelineState: ActiveLyricState["timelineState"],
) {
  const timeMs = finiteTime(playbackTimeMs);
  const currentIndex = findPresentationCurrentIndex(orderedLines, timeMs, timelineState);

  if (currentIndex < 0) {
    const upcomingIndex = orderedLines.findIndex((line) => line.beginMs > timeMs);
    return upcomingIndex >= 0 && timelineState === "instrumental-gap"
      ? [row(orderedLines[upcomingIndex], "upcoming", "pending")]
      : [];
  }

  const rows: LyricPresentationRow[] = [];
  const previousIndex = currentIndex - 1;
  if (previousIndex >= 0) {
    rows.push(row(orderedLines[previousIndex], "previous", "leaving"));
  }

  const currentLine = orderedLines[currentIndex];
  rows.push(row(currentLine, "current", linePresentationLifecycle(currentLine, "current", timeMs)));

  if (currentIndex + 1 < orderedLines.length) {
    rows.push(row(orderedLines[currentIndex + 1], "upcoming", "pending"));
  }

  return rows.slice(0, 3);
}

export function linePresentationLifecycle(
  line: LyricLine,
  role: LyricPresentationRole,
  playbackTimeMs: number,
): LyricPresentationLifecycle {
  const timeMs = finiteTime(playbackTimeMs);
  if (timeMs >= line.endMs) return "expired";
  if (role === "previous") return "leaving";
  if (role === "upcoming") return "pending";
  if (timeMs < line.beginMs) return "entering";
  return "active";
}

export function presentationLineProgress(line: LyricLine, playbackTimeMs: number) {
  const duration = line.endMs - line.beginMs;
  if (duration <= 0) return 0;
  return Math.min(1, Math.max(0, (finiteTime(playbackTimeMs) - line.beginMs) / duration));
}

export function lyricPresentationSignature(rows: LyricPresentationRow[]) {
  return rows.map((item) => `${item.line.id}:${item.role}:${item.lifecycle}`).join("|");
}

function findPresentationCurrentIndex(
  lines: LyricLine[],
  timeMs: number,
  timelineState: ActiveLyricState["timelineState"],
) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (containsTime(lines[index], timeMs)) return index;
  }

  if (timelineState === "before-first-line" || timelineState === "short-gap") {
    return lines.findIndex((line) => line.beginMs > timeMs);
  }

  return -1;
}

function row(
  line: LyricLine,
  role: LyricPresentationRole,
  lifecycle: LyricPresentationLifecycle,
): LyricPresentationRow {
  return { line, role, lifecycle };
}

function compareLines(left: LyricLine, right: LyricLine) {
  return (
    left.beginMs - right.beginMs || left.endMs - right.endMs || left.text.localeCompare(right.text)
  );
}

function containsTime(range: { beginMs: number; endMs: number }, timeMs: number) {
  return timeMs >= range.beginMs && timeMs < range.endMs;
}

function finiteTime(timeMs: number) {
  return Number.isFinite(timeMs) && timeMs > 0 ? timeMs : 0;
}
