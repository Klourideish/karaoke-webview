import type { CSSProperties } from "react";
import type { AudioPlayer } from "../audioPlayer";
import { lyricFragmentProgress, type ActiveLyricState } from "../lyricTiming";
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
                data-progress={lyricState.currentLineProgress.toFixed(3)}
                data-timeline-state={lyricState.timelineState}
              >
                <p className="lyric-line lyric-line-current">
                  {lyricState.timelineState === "instrumental-gap" ? (
                    <span aria-label="Instrumental section">Instrumental</span>
                  ) : (
                    <CurrentLyricLine lyricState={lyricState} currentTimeMs={currentTimeMs} />
                  )}
                </p>
                <p className="lyric-line lyric-line-secondary">
                  {lyricState.nextLine ? lineText(lyricState.nextLine) : ""}
                </p>
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

function CurrentLyricLine({
  currentTimeMs,
  lyricState,
}: {
  currentTimeMs: number;
  lyricState: ActiveLyricState;
}) {
  const currentLine = lyricState.currentLine;
  if (!currentLine) {
    return null;
  }

  if (currentLine.segments.length === 0) {
    return <>{currentLine.text}</>;
  }

  return (
    <span className="lyric-fragment-line" aria-label={lineText(currentLine)}>
      {currentLine.segments.map((segment) => {
        const fragmentState = fragmentDisplayState(segment, lyricState, currentTimeMs);
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

function fragmentDisplayState(
  segment: LyricSegment,
  lyricState: ActiveLyricState,
  currentTimeMs: number,
) {
  if (lyricState.activeFragmentIds.includes(segment.id)) {
    return "active";
  }

  if (currentTimeMs >= segment.endMs || lyricState.currentLineProgress >= 1) {
    return "past";
  }

  return "upcoming";
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
