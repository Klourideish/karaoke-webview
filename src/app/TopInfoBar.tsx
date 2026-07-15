import type { AudioPlayer } from "../audioPlayer";
import {
  formatLyricOffset,
  LYRIC_OFFSET_MAX_MS,
  LYRIC_OFFSET_MIN_MS,
  LYRIC_OFFSET_STEP_MS,
} from "../lyricOffset";

export function TopInfoBar({
  audioPlayer,
  lyricOffsetMs,
  onAdjustLyricOffset,
  onResetLyricOffset,
}: {
  audioPlayer: AudioPlayer;
  lyricOffsetMs: number;
  onAdjustLyricOffset: (deltaMs: number) => void;
  onResetLyricOffset: () => void;
}) {
  const currentSong = audioPlayer.currentSong;

  return (
    <header className="top-info-bar" aria-label="Application overview">
      <section className="brand-region" aria-labelledby="app-title">
        <p className="region-label">Application</p>
        <h1 id="app-title">Karaoke Webview</h1>
      </section>

      <section className="song-region" aria-label="Current song information">
        <p className="region-label">Song information</p>
        {currentSong ? (
          <p className="placeholder-copy">
            {currentSong.artist || "Artist not specified"} - {currentSong.title}
          </p>
        ) : (
          <p className="placeholder-copy">No song loaded</p>
        )}
      </section>

      <section className="offset-region" aria-label="Lyric offset information">
        <p className="region-label">Lyric offset</p>
        <div className="offset-controls" aria-describedby="lyric-offset-description">
          <button
            aria-label="Show lyrics 100 milliseconds earlier"
            disabled={lyricOffsetMs <= LYRIC_OFFSET_MIN_MS}
            onClick={() => onAdjustLyricOffset(-LYRIC_OFFSET_STEP_MS)}
            title="Show lyrics earlier"
            type="button"
          >
            −
          </button>
          <output aria-label="Current lyric offset">{formatLyricOffset(lyricOffsetMs)}</output>
          <button
            aria-label="Show lyrics 100 milliseconds later"
            disabled={lyricOffsetMs >= LYRIC_OFFSET_MAX_MS}
            onClick={() => onAdjustLyricOffset(LYRIC_OFFSET_STEP_MS)}
            title="Show lyrics later"
            type="button"
          >
            +
          </button>
          <button
            aria-label="Reset lyric offset"
            className="offset-reset-button"
            disabled={lyricOffsetMs === 0}
            onClick={onResetLyricOffset}
            type="button"
          >
            Reset
          </button>
        </div>
        <p className="visually-hidden" id="lyric-offset-description">
          Negative values show lyrics earlier. Positive values show lyrics later.
        </p>
      </section>
    </header>
  );
}
