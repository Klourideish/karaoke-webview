import type { CSSProperties } from "react";
import type { AudioPlayer } from "../audioPlayer";
import { presentationLineProgress, type LyricPresentationRow } from "../lyricPresentation";
import { lyricFragmentProgress } from "../lyricTiming";
import type { LyricLine, LyricSegment } from "../lyrics";
import { playbackStatusLabel } from "../player/playbackFormatting";
import { useLyricPlaybackClock } from "../useLyricPlaybackClock";
import type { SongLyricsState } from "../useSongLyrics";

export function PerformWorkspace({
  audioPlayer,
  lyrics,
}: {
  audioPlayer: AudioPlayer;
  lyrics: SongLyricsState;
}) {
  const currentSong = audioPlayer.currentSong;
  const lyricSnapshot = useLyricPlaybackClock({
    audioPlayer,
    document: lyrics.document,
  });
  const currentTimeMs = lyricSnapshot?.sampledTimeMs ?? audioPlayer.currentTime * 1_000;
  const lyricState = lyricSnapshot?.state ?? null;
  const presentationRows = lyricSnapshot?.presentationRows ?? [];
  const currentRow = presentationRows.find((row) => row.role === "current") ?? null;

  return (
    <section className="perform-view">
      <h2 id="view-heading" className="visually-hidden">
        Performance
      </h2>

      <section className="performance-stage" aria-labelledby="performance-stage-title">
        <h3 id="performance-stage-title">Lyrics presentation</h3>
        {currentSong ? (
          <div className="lyric-display" aria-live="polite">
            <p className="lyric-song-status">
              {currentSong.artist || "Artist not specified"} - {currentSong.title} ·{" "}
              {playbackStatusLabel(audioPlayer.status)}
            </p>
            {lyrics.isLoading ? <p>Loading lyrics...</p> : null}
            {lyrics.error ? <p className="lyric-error">{lyrics.error}</p> : null}
            {lyrics.document && lyricState ? (
              <div
                className="lyric-line-stack"
                aria-label="Synchronized lyrics"
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
                  <PresentationLyricRow currentTimeMs={currentTimeMs} key={row.line.id} row={row} />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p>Future live lyrics and performance presentation area.</p>
        )}
      </section>
    </section>
  );
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
