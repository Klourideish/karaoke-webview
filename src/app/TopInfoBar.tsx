import type { AudioPlayer } from "../audioPlayer";

export function TopInfoBar({ audioPlayer }: { audioPlayer: AudioPlayer }) {
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
        <div className="offset-placeholder" aria-hidden="true">
          <span>-</span>
          <span>0 ms</span>
          <span>+</span>
        </div>
      </section>
    </header>
  );
}
