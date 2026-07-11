import type { LyricDocument, LyricLine, LyricSegment } from "./lyrics";

export type ActiveLyricState = {
  previousLine: LyricLine | null;
  currentLine: LyricLine | null;
  nextLine: LyricLine | null;
  activeFragments: LyricSegment[];
  currentLineProgress: number;
  timelineState:
    "before-first-line" | "active" | "short-gap" | "instrumental-gap" | "after-last-line";
};

export const INSTRUMENTAL_GAP_THRESHOLD_MS = 3_000;

export class LyricTimingEngine {
  private cursor = 0;
  private readonly lines: LyricLine[];

  constructor(document: LyricDocument) {
    this.lines = [...document.lines].sort((left, right) => {
      return (
        left.beginMs - right.beginMs ||
        left.endMs - right.endMs ||
        left.text.localeCompare(right.text)
      );
    });
  }

  lookup(playbackTimeMs: number): ActiveLyricState {
    const timeMs = finiteTime(playbackTimeMs);
    const currentIndex = this.findCurrentLineIndex(timeMs);
    const previousIndex = this.findPreviousLineIndex(timeMs, currentIndex);
    const nextIndex = this.findNextLineIndex(timeMs, currentIndex);
    const activeLine = currentIndex >= 0 ? this.lines[currentIndex] : null;
    const timelineState = this.timelineState(timeMs, currentIndex, previousIndex, nextIndex);
    const currentLine =
      timelineState === "short-gap" && previousIndex >= 0 ? this.lines[previousIndex] : activeLine;

    return {
      previousLine: previousIndex >= 0 ? this.lines[previousIndex] : null,
      currentLine,
      nextLine: nextIndex >= 0 ? this.lines[nextIndex] : null,
      activeFragments: activeLine ? activeSegments(activeLine, timeMs) : [],
      currentLineProgress: activeLine
        ? lineProgress(activeLine, timeMs)
        : timelineState === "short-gap"
          ? 1
          : 0,
      timelineState,
    };
  }

  private timelineState(
    timeMs: number,
    currentIndex: number,
    previousIndex: number,
    nextIndex: number,
  ): ActiveLyricState["timelineState"] {
    if (currentIndex >= 0) {
      return "active";
    }

    if (previousIndex < 0 && nextIndex >= 0) {
      return "before-first-line";
    }

    if (previousIndex >= 0 && nextIndex < 0) {
      return "after-last-line";
    }

    if (previousIndex >= 0 && nextIndex >= 0) {
      const gapDuration = this.lines[nextIndex].beginMs - this.lines[previousIndex].endMs;
      return gapDuration >= INSTRUMENTAL_GAP_THRESHOLD_MS ? "instrumental-gap" : "short-gap";
    }

    return "after-last-line";
  }

  private findCurrentLineIndex(timeMs: number) {
    if (this.lines.length === 0) {
      return -1;
    }

    const cursorLine = this.lines[this.cursor];
    if (cursorLine && containsTime(cursorLine, timeMs)) {
      return this.cursor;
    }

    if (cursorLine && timeMs >= cursorLine.endMs) {
      while (this.cursor + 1 < this.lines.length && timeMs >= this.lines[this.cursor].endMs) {
        this.cursor += 1;
        if (containsTime(this.lines[this.cursor], timeMs)) {
          return this.cursor;
        }
      }
    } else if (cursorLine && timeMs < cursorLine.beginMs) {
      while (this.cursor > 0 && timeMs < this.lines[this.cursor].beginMs) {
        this.cursor -= 1;
        if (containsTime(this.lines[this.cursor], timeMs)) {
          return this.cursor;
        }
      }
    }

    const foundIndex = this.binarySearchLine(timeMs);
    if (foundIndex >= 0) {
      this.cursor = foundIndex;
    }
    return foundIndex;
  }

  private binarySearchLine(timeMs: number) {
    let low = 0;
    let high = this.lines.length - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const line = this.lines[middle];
      if (timeMs < line.beginMs) {
        high = middle - 1;
      } else if (timeMs >= line.endMs) {
        low = middle + 1;
      } else {
        return middle;
      }
    }

    return -1;
  }

  private findPreviousLineIndex(timeMs: number, currentIndex: number) {
    let high = currentIndex >= 0 ? currentIndex - 1 : this.lines.length - 1;
    while (high >= 0) {
      if (this.lines[high].endMs <= timeMs || currentIndex >= 0) {
        return high;
      }
      high -= 1;
    }
    return -1;
  }

  private findNextLineIndex(timeMs: number, currentIndex: number) {
    let low = currentIndex >= 0 ? currentIndex + 1 : 0;
    while (low < this.lines.length) {
      if (this.lines[low].beginMs > timeMs || currentIndex >= 0) {
        return low;
      }
      low += 1;
    }
    return -1;
  }
}

function activeSegments(line: LyricLine, timeMs: number) {
  return line.segments.filter((segment) => containsTime(segment, timeMs));
}

function lineProgress(line: LyricLine, timeMs: number) {
  const duration = line.endMs - line.beginMs;
  if (duration <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, (timeMs - line.beginMs) / duration));
}

function containsTime(range: { beginMs: number; endMs: number }, timeMs: number) {
  return timeMs >= range.beginMs && timeMs < range.endMs;
}

function finiteTime(timeMs: number) {
  return Number.isFinite(timeMs) && timeMs > 0 ? timeMs : 0;
}
