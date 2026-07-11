import { useMemo } from "react";
import type { AudioPlayer } from "../audioPlayer";
import { LyricTimingEngine } from "../lyricTiming";
import { playbackStatusLabel } from "../player/playbackFormatting";
import type { SongLyricsState } from "../useSongLyrics";

export function PerformWorkspace({
  audioPlayer,
  heading,
  lyrics,
  description,
}: {
  audioPlayer: AudioPlayer;
  heading: string;
  lyrics: SongLyricsState;
  description: string;
}) {
  const currentSong = audioPlayer.currentSong;
  const timingEngine = useMemo(() => {
    return lyrics.document ? new LyricTimingEngine(lyrics.document) : null;
  }, [lyrics.document]);
  const lyricState = timingEngine?.lookup(audioPlayer.currentTime * 1_000) ?? null;

  return (
    <section className="perform-view">
      <div className="view-heading-group">
        <p className="region-label">Workspace</p>
        <h2 id="view-heading">{heading}</h2>
        <p className="view-description">{description}</p>
      </div>

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
                    (lyricState.currentLine?.text ?? "")
                  )}
                </p>
                <p className="lyric-line lyric-line-secondary">{lyricState.nextLine?.text ?? ""}</p>
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
