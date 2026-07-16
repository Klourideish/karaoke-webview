import type { CSSProperties } from "react";
import type { AudioPlayer } from "../audioPlayer";
import { effectiveLyricTimeMs } from "../lyricOffset";
import { presentationLineProgress, type LyricPresentationRow } from "../lyricPresentation";
import { lyricFragmentProgress } from "../lyricTiming";
import type { LyricLine, LyricSegment } from "../lyrics";
import type { PerformanceController } from "../performance/usePerformance";
import { useLyricPlaybackClock } from "../useLyricPlaybackClock";
import type { SongLyricsState } from "../useSongLyrics";

export function PerformWorkspace({
  audioPlayer,
  lyricOffsetMs,
  lyrics,
  performance,
}: {
  audioPlayer: AudioPlayer;
  lyricOffsetMs: number;
  lyrics: SongLyricsState;
  performance: PerformanceController;
}) {
  const activePerformance = performance.projection.active;
  const currentSong = audioPlayer.currentSong;
  const lyricSnapshot = useLyricPlaybackClock({
    audioPlayer,
    document: lyrics.document,
    offsetMs: lyricOffsetMs,
  });
  const playbackTimeMs = lyricSnapshot?.playbackTimeMs ?? audioPlayer.currentTime * 1_000;
  const currentTimeMs =
    lyricSnapshot?.effectiveTimeMs ?? effectiveLyricTimeMs(playbackTimeMs, lyricOffsetMs);
  const lyricState = lyricSnapshot?.state ?? null;
  const presentationRows = lyricSnapshot?.presentationRows ?? [];
  const currentRow = presentationRows.find((row) => row.role === "current") ?? null;
  const countdownNumber = performanceCountdownNumber(
    activePerformance?.state,
    activePerformance?.countdownRemainingMs,
  );
  const showLyrics = Boolean(
    currentSong && (!activePerformance || activePerformance.state === "playing"),
  );

  return (
    <section className="perform-view">
      <h2 id="view-heading" className="visually-hidden">
        Performance
      </h2>

      <section className="performance-stage" aria-label="Performance canvas">
        {activePerformance ? (
          <h3
            aria-label={`${activePerformance.performer.displayName}, singer`}
            className="performance-singer-heading"
          >
            <span aria-hidden="true">🎤</span>
            <span>{activePerformance.performer.displayName}</span>
          </h3>
        ) : null}
        <div className="performance-canvas-body">
          {performance.error ? (
            <p className="performance-state-message" role="alert">
              {performance.error}
            </p>
          ) : countdownNumber !== null ? (
            <p
              aria-atomic="true"
              aria-label={`Performance starts in ${countdownNumber} ${countdownNumber === 1 ? "second" : "seconds"}`}
              aria-live="polite"
              className="performance-countdown"
              key={countdownNumber}
              role="timer"
            >
              {countdownNumber}
            </p>
          ) : showLyrics ? (
            <div className="lyric-display" aria-live="polite">
              {lyrics.isLoading ? (
                <p className="performance-state-message">Loading lyrics...</p>
              ) : null}
              {lyrics.error || (!lyrics.isLoading && !lyrics.document) ? (
                <p className="performance-state-message">Lyrics are not available for this song.</p>
              ) : null}
              {lyrics.document && lyricState ? (
                <div
                  className="lyric-line-stack"
                  aria-label="Synchronized lyrics"
                  data-effective-time-ms={currentTimeMs.toFixed(0)}
                  data-lyric-offset-ms={lyricOffsetMs}
                  data-playback-time-ms={playbackTimeMs.toFixed(0)}
                  data-progress={
                    currentRow
                      ? presentationLineProgress(currentRow.line, currentTimeMs).toFixed(3)
                      : "0.000"
                  }
                  data-timeline-state={lyricState.timelineState}
                >
                  {lyricState.timelineState === "instrumental-gap" ? (
                    <p
                      className="lyric-line lyric-line-row lyric-line-current"
                      data-presentation-lifecycle="active"
                      data-presentation-role="current"
                    >
                      <span aria-label="Instrumental section">Instrumental</span>
                    </p>
                  ) : null}
                  {presentationRows.map((row) => (
                    <PresentationLyricRow
                      currentTimeMs={currentTimeMs}
                      key={row.line.id}
                      row={row}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="performance-state-message">
              {performanceStateMessage(activePerformance)}
            </p>
          )}
        </div>
        <div
          aria-hidden="true"
          className="performance-waveform-reserve"
          data-visualizer-active="false"
          data-waveform-reserved="true"
        />
      </section>
    </section>
  );
}

function performanceCountdownNumber(
  state: string | undefined,
  countdownRemainingMs: number | null | undefined,
) {
  if (
    state !== "countdown" ||
    countdownRemainingMs === null ||
    countdownRemainingMs === undefined
  ) {
    return null;
  }
  if (!Number.isFinite(countdownRemainingMs) || countdownRemainingMs <= 0) return null;
  return Math.min(3, Math.max(1, Math.ceil(countdownRemainingMs / 1_000)));
}

function performanceStateMessage(active: PerformanceController["projection"]["active"]) {
  if (!active) return "Waiting for the next singer.";
  if (active.failure) return active.failure.message;

  switch (active.state) {
    case "created":
    case "preparing":
    case "ready":
      return `Get ready, ${active.performer.displayName}.`;
    case "countdown":
      return "Starting shortly.";
    case "playing":
      return "The song is starting.";
    case "finalizing":
    case "results":
      return "Finishing the performance.";
    case "completed":
      return "Performance complete.";
    case "stopped":
      return "Performance ended.";
    case "failed":
      return "This performance could not continue.";
  }
}

function PresentationLyricRow({
  currentTimeMs,
  row,
}: {
  currentTimeMs: number;
  row: LyricPresentationRow;
}) {
  const current = row.role === "current";
  const className = [
    "lyric-line",
    "lyric-line-row",
    `lyric-line-${row.role}`,
    current ? "lyric-line-current" : "lyric-line-secondary",
  ].join(" ");

  return (
    <p
      aria-hidden={current ? undefined : true}
      className={className}
      data-presentation-lifecycle={row.lifecycle}
      data-presentation-role={row.role}
    >
      {current ? (
        <CurrentLyricLine currentLine={row.line} currentTimeMs={currentTimeMs} />
      ) : (
        lineText(row.line)
      )}
    </p>
  );
}

function CurrentLyricLine({
  currentLine,
  currentTimeMs,
}: {
  currentLine: LyricLine;
  currentTimeMs: number;
}) {
  if (currentLine.segments.length === 0) {
    return <>{currentLine.text}</>;
  }

  return (
    <span className="lyric-fragment-line" aria-label={lineText(currentLine)}>
      {currentLine.segments.map((segment) => {
        const fragmentState = fragmentDisplayState(currentLine, segment, currentTimeMs);
        const fillProgress = fragmentFillProgress(segment, fragmentState, currentTimeMs);
        return (
          <span
            className={`lyric-fragment lyric-fragment-${fragmentState}`}
            data-fragment-id={segment.id}
            data-fragment-state={fragmentState}
            data-fill-progress={fillProgress.toFixed(3)}
            data-text={segment.text}
            key={segment.id}
            style={
              {
                "--lyric-fill-progress": fillProgress,
              } as CSSProperties
            }
          >
            {segment.text}
          </span>
        );
      })}
    </span>
  );
}

function fragmentDisplayState(line: LyricLine, segment: LyricSegment, currentTimeMs: number) {
  if (containsTime(segment, currentTimeMs) && !usesOnlyLineTiming(line, segment)) {
    return "active";
  }

  if (currentTimeMs >= segment.endMs) {
    return "past";
  }

  return "upcoming";
}

function containsTime(range: { beginMs: number; endMs: number }, timeMs: number) {
  return timeMs >= range.beginMs && timeMs < range.endMs;
}

function usesOnlyLineTiming(line: LyricLine, segment: LyricSegment) {
  return (
    segment.beginMs === line.beginMs &&
    segment.endMs === line.endMs &&
    line.segments.every(
      (candidate) => candidate.beginMs === line.beginMs && candidate.endMs === line.endMs,
    )
  );
}

function fragmentFillProgress(
  segment: LyricSegment,
  fragmentState: "active" | "past" | "upcoming",
  currentTimeMs: number,
) {
  if (fragmentState === "past") {
    return 1;
  }

  if (fragmentState === "active") {
    return lyricFragmentProgress(segment, currentTimeMs);
  }

  return 0;
}

function lineText(line: LyricLine) {
  return line.segments.length > 0
    ? line.segments.map((segment) => segment.text).join("")
    : line.text;
}
