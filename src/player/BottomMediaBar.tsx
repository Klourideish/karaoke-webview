import { formatMediaTime, type AudioPlayer } from "../audioPlayer";
import { playbackStatusLabel } from "./playbackFormatting";

export function BottomMediaBar({ audioPlayer }: { audioPlayer: AudioPlayer }) {
  const hasSong = Boolean(audioPlayer.currentSong);
  const isPlaying = audioPlayer.status === "playing";
  const duration = audioPlayer.duration;

  return (
    <footer className="bottom-media-bar" aria-label="Media transport">
      <button
        className="media-play-button"
        type="button"
        disabled={!hasSong}
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={() => {
          if (isPlaying) {
            void audioPlayer.pause();
          } else if (audioPlayer.status === "paused") {
            void audioPlayer.play();
          } else if (audioPlayer.currentSong) {
            void audioPlayer.loadSong(audioPlayer.currentSong.id);
          } else {
            void audioPlayer.play();
          }
        }}
      >
        {isPlaying ? "Pause" : "Play"}
      </button>

      <div className="media-track-placeholder" aria-label="Track placeholder">
        <span className="track-artist">{audioPlayer.currentSong?.artist || "No song loaded"}</span>
        <span className="track-title">
          {audioPlayer.currentSong?.title ?? "Select from Library"}
        </span>
      </div>

      <label className="seek-placeholder">
        <span className="visually-hidden">Seek</span>
        <span>{formatMediaTime(audioPlayer.currentTime)}</span>
        <input
          aria-label="Seek"
          disabled={!hasSong || duration <= 0}
          max={duration || 0}
          min="0"
          step="0.1"
          type="range"
          value={Math.min(audioPlayer.currentTime, duration || 0)}
          onChange={(event) => audioPlayer.seek(Number(event.currentTarget.value))}
        />
        <span>{formatMediaTime(duration)}</span>
      </label>

      <label className="volume-placeholder">
        <span>Volume</span>
        <input
          aria-label="Volume"
          max="100"
          min="0"
          type="range"
          value={Math.round(audioPlayer.volume * 100)}
          onChange={(event) => audioPlayer.setVolume(Number(event.currentTarget.value) / 100)}
        />
      </label>

      <p className="transport-status" aria-live="polite">
        {audioPlayer.error ?? playbackStatusLabel(audioPlayer.status)}
      </p>
    </footer>
  );
}
