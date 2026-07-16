import type { AudioPlayer } from "../audioPlayer";
import {
  formatLyricOffset,
  LYRIC_OFFSET_MAX_MS,
  LYRIC_OFFSET_MIN_MS,
  LYRIC_OFFSET_STEP_MS,
} from "../lyricOffset";
import type { SongLyricTimingController } from "../useSongLyricTiming";
import { FullscreenControl } from "./FullscreenControl";
import type { FullscreenWindowController } from "./useFullscreenWindow";

export function TopInfoBar({
  audioPlayer,
  fullscreen,
  lyricTiming,
}: {
  audioPlayer: AudioPlayer;
  fullscreen: FullscreenWindowController;
  lyricTiming: SongLyricTimingController;
}) {
  const currentSong = audioPlayer.currentSong;

  return (
    <header className="top-info-bar" aria-label="Application overview">
      <section className="brand-region" aria-labelledby="app-title">
        <p className="region-label">Application</p>
        <div className="brand-title-row">
          <h1 id="app-title">Karaoke Webview</h1>
          <FullscreenControl fullscreen={fullscreen} />
        </div>
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
        <div className="offset-summary">
          <span>
            Saved
            <output aria-label="Saved song lyric offset">
              {lyricTiming.savedOffsetMs === null
                ? "Not saved"
                : formatLyricOffset(lyricTiming.savedOffsetMs)}
            </output>
          </span>
          <span>
            Temporary
            <output aria-label="Temporary lyric adjustment">
              {formatLyricOffset(lyricTiming.temporaryOffsetMs)}
            </output>
          </span>
          <span>
            Effective
            <output aria-label="Effective lyric offset">
              {formatLyricOffset(lyricTiming.effectiveOffsetMs)}
            </output>
          </span>
        </div>
        <div className="offset-controls" aria-describedby="lyric-offset-description">
          <button
            aria-label="Show lyrics 100 milliseconds earlier"
            disabled={
              !lyricTiming.songId ||
              lyricTiming.isPending ||
              lyricTiming.temporaryOffsetMs <= LYRIC_OFFSET_MIN_MS
            }
            onClick={() => lyricTiming.adjustTemporary(-LYRIC_OFFSET_STEP_MS)}
            title="Show lyrics earlier"
            type="button"
          >
            −
          </button>
          <output aria-label="Current temporary lyric adjustment">
            {formatLyricOffset(lyricTiming.temporaryOffsetMs)}
          </output>
          <button
            aria-label="Show lyrics 100 milliseconds later"
            disabled={
              !lyricTiming.songId ||
              lyricTiming.isPending ||
              lyricTiming.temporaryOffsetMs >= LYRIC_OFFSET_MAX_MS
            }
            onClick={() => lyricTiming.adjustTemporary(LYRIC_OFFSET_STEP_MS)}
            title="Show lyrics later"
            type="button"
          >
            +
          </button>
          <button
            aria-label="Reset temporary lyric adjustment"
            className="offset-reset-button"
            disabled={lyricTiming.isPending || lyricTiming.temporaryOffsetMs === 0}
            onClick={lyricTiming.resetTemporary}
            type="button"
          >
            Reset temporary
          </button>
        </div>
        <div className="offset-persistence-actions">
          <button
            disabled={
              !lyricTiming.songId ||
              lyricTiming.isPending ||
              lyricTiming.effectiveOffsetMs < LYRIC_OFFSET_MIN_MS ||
              lyricTiming.effectiveOffsetMs > LYRIC_OFFSET_MAX_MS
            }
            onClick={() => void lyricTiming.saveForSong()}
            type="button"
          >
            Save for this song
          </button>
          <button
            disabled={
              !lyricTiming.songId || lyricTiming.isPending || lyricTiming.savedOffsetMs === null
            }
            onClick={() => void lyricTiming.removeSavedOffset()}
            type="button"
          >
            Reset song timing
          </button>
        </div>
        {lyricTiming.error ? (
          <p className="offset-error" role="alert">
            {lyricTiming.error}
          </p>
        ) : null}
        <p className="visually-hidden" id="lyric-offset-description">
          Negative values show lyrics earlier. Positive values show lyrics later.
        </p>
      </section>
    </header>
  );
}
