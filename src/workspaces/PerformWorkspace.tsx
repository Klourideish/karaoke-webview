import type { AudioPlayer } from "../audioPlayer";
import { playbackStatusLabel } from "../player/playbackFormatting";

export function PerformWorkspace({
  audioPlayer,
  heading,
  description,
}: {
  audioPlayer: AudioPlayer;
  heading: string;
  description: string;
}) {
  const currentSong = audioPlayer.currentSong;

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
          <p>
            {currentSong.artist || "Artist not specified"} - {currentSong.title} ·{" "}
            {playbackStatusLabel(audioPlayer.status)}
          </p>
        ) : (
          <p>Future live lyrics and performance presentation area.</p>
        )}
      </section>
    </section>
  );
}
