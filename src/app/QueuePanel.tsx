import type { PerformanceLifecycleState, PerformanceProjection } from "../performance/types";
import type { QueueProjection } from "../queue/types";

export function QueuePanel({
  queue,
  performance,
}: {
  queue: QueueProjection;
  performance: PerformanceProjection;
}) {
  const linked =
    queue.current?.performanceId && performance.active?.id === queue.current.performanceId
      ? performance.active
      : null;
  const failed = queue.current ? null : (queue.failed[0] ?? null);
  return (
    <aside className="queue-panel" aria-labelledby="queue-heading">
      <div className="queue-heading-group">
        <p className="region-label">Session</p>
        <h2 id="queue-heading">Queue</h2>
      </div>
      <div className="queue-panel-content">
        <section
          className="queue-panel-section queue-panel-current-section"
          aria-labelledby="queue-current-heading"
        >
          <h3 className="queue-panel-section-label" id="queue-current-heading">
            Current
          </h3>
          {queue.current ? (
            <QueueTile
              singerName={queue.current.entry.requesterDisplayName}
              songTitle={queue.current.entry.songTitle}
              state={performanceState(linked?.state)}
              variant="current"
            />
          ) : failed ? (
            <QueueTile
              singerName={failed.entry.requesterDisplayName}
              songTitle={failed.entry.songTitle}
              state="Failed · Retry available"
              variant="failed"
            />
          ) : (
            <p className="queue-panel-section-empty">Nothing playing.</p>
          )}
        </section>

        {queue.progressionPaused ? <p className="queue-panel-paused">Queue paused.</p> : null}

        <section
          className="queue-panel-section queue-panel-upcoming-section"
          aria-labelledby="queue-upcoming-heading"
        >
          <h3 className="queue-panel-section-label" id="queue-upcoming-heading">
            Up next ({queue.queued.length})
          </h3>
          {queue.queued.length > 0 ? (
            <div className="queue-panel-next-scroll" data-testid="queue-panel-next-scroll">
              <ol className="queue-panel-next" aria-label="Next songs">
                {queue.queued.map((entry, index) => (
                  <li className="queue-panel-tile queue-panel-upcoming-tile" key={entry.id}>
                    <span
                      className="queue-panel-position"
                      aria-label={`Queue position ${index + 1}`}
                    >
                      {index + 1}
                    </span>
                    <span className="queue-panel-tile-copy">
                      <strong className="queue-panel-song-title">{entry.songTitle}</strong>
                      <span className="queue-panel-singer-name">{entry.requesterDisplayName}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="queue-panel-section-empty">
              {queue.current || failed ? "No songs waiting." : "No songs queued."}
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}

function QueueTile({
  singerName,
  songTitle,
  state,
  variant,
}: {
  singerName: string;
  songTitle: string;
  state: string;
  variant: "current" | "failed";
}) {
  return (
    <article className="queue-panel-tile queue-panel-current-tile" data-state={variant}>
      <strong className="queue-panel-song-title">{songTitle}</strong>
      <span className="queue-panel-singer-name">{singerName}</span>
      <span className="queue-panel-item-state">{state}</span>
    </article>
  );
}

function performanceState(state: PerformanceLifecycleState | undefined) {
  if (state === "playing") return "Playing";
  if (state === "failed") return "Failed";
  if (state === "finalizing" || state === "results") return "Finishing";
  return "Starting";
}
