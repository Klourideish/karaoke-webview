import { useState } from "react";
import type { Singer } from "../app/SingerBar";
import type { PerformanceDetailsProjection } from "../performance/types";
import type { PerformanceController } from "../performance/usePerformance";
import type { QueueEntry } from "../queue/types";
import type { useQueue } from "../queue/useQueue";

export function QueueWorkspace({
  queue,
  singers,
  performance,
}: {
  queue: ReturnType<typeof useQueue>;
  singers: readonly Singer[];
  performance: PerformanceController;
}) {
  const {
    projection,
    error,
    removeEntry,
    moveEntry,
    voteForEntry,
    removeVote,
    pauseProgression,
    resumeProgression,
    skipCurrent,
    retryFailed,
  } = queue;
  const { current, queued, failed, progressionPaused } = projection;
  const linkedPerformance =
    current?.performanceId && performance.projection.active?.id === current.performanceId
      ? performance.projection.active
      : null;

  return (
    <section className="queue-workspace" aria-labelledby="view-heading">
      <h2 id="view-heading" className="visually-hidden">
        Queue
      </h2>

      {error ? (
        <p className="queue-error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <div className="queue-toolbar">
        <div className="progression-status">
          Queue: <strong>{progressionPaused ? "Paused" : "Active"}</strong>
        </div>
        <div className="progression-controls">
          {progressionPaused ? (
            <button type="button" onClick={() => void resumeProgression()}>
              Resume queue
            </button>
          ) : (
            <button type="button" onClick={() => void pauseProgression()}>
              Pause queue
            </button>
          )}
          {current ? (
            <button
              className="skip-button"
              type="button"
              disabled={
                linkedPerformance?.state === "finalizing" || linkedPerformance?.state === "results"
              }
              onClick={() => void skipCurrent()}
            >
              Skip current
            </button>
          ) : null}
        </div>
      </div>

      <div className="queue-main-grid">
        <section className="current-entry-section" aria-labelledby="current-entry-heading">
          <h3 id="current-entry-heading">Current / Starting</h3>
          {current ? (
            <div className="current-entry-card">
              <QueueEntryDetails entry={current.entry} />
              <strong className="current-entry-status" aria-live="polite">
                {performanceStatus(linkedPerformance)}
              </strong>
            </div>
          ) : (
            <p className="queue-empty-state">No songs queued. Add a song from Library.</p>
          )}
        </section>

        <section className="upcoming-entries-section" aria-labelledby="upcoming-heading">
          <h3 id="upcoming-heading">Up next ({queued.length})</h3>
          {queued.length === 0 ? (
            <p className="queue-empty-state">No upcoming songs.</p>
          ) : (
            <div className="upcoming-list">
              {queued.map((entry, index) => (
                <QueueEntryRow
                  entry={entry}
                  index={index}
                  key={entry.id}
                  onMove={moveEntry}
                  onRemove={removeEntry}
                  onRemoveVote={removeVote}
                  onVote={voteForEntry}
                  singers={singers}
                  total={queued.length}
                />
              ))}
            </div>
          )}
        </section>

        {failed.length > 0 ? (
          <section className="queue-attention-section" aria-labelledby="queue-attention-heading">
            <h3 id="queue-attention-heading">Needs attention</h3>
            {failed.map((failure) => (
              <article className="queue-item queue-item-failed" key={failure.entry.id}>
                <QueueEntryDetails entry={failure.entry} />
                <p>{failure.message}</p>
                <div className="queue-item-actions">
                  <button type="button" onClick={() => void retryFailed(failure.entry.id)}>
                    Retry
                  </button>
                  <button type="button" onClick={() => void removeEntry(failure.entry.id)}>
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </div>
    </section>
  );
}

function QueueEntryRow({
  entry,
  index,
  onMove,
  onRemove,
  onRemoveVote,
  onVote,
  singers,
  total,
}: {
  entry: QueueEntry;
  index: number;
  onMove: (entryId: string, targetIndex: number) => Promise<boolean>;
  onRemove: (entryId: string) => Promise<boolean>;
  onRemoveVote: (entryId: string, singerId: string) => Promise<boolean>;
  onVote: (entryId: string, singerId: string) => Promise<boolean>;
  singers: readonly Singer[];
  total: number;
}) {
  const [voterId, setVoterId] = useState("");
  return (
    <article className="queue-item">
      <QueueEntryDetails entry={entry} />
      <div className="queue-item-voting">
        <span>Upvotes: {entry.voteCount}</span>
        <select
          aria-label={`Singer voting on ${entry.songTitle}`}
          value={voterId}
          onChange={(event) => setVoterId(event.target.value)}
        >
          <option value="">Choose singer</option>
          {singers.map((singer) => (
            <option key={singer.id} value={singer.id}>
              {singer.displayName}
            </option>
          ))}
        </select>
        <button type="button" disabled={!voterId} onClick={() => void onVote(entry.id, voterId)}>
          Upvote
        </button>
        <button
          type="button"
          disabled={!voterId}
          onClick={() => void onRemoveVote(entry.id, voterId)}
        >
          Remove vote
        </button>
      </div>
      <div className="queue-item-actions">
        <button
          disabled={index === 0}
          type="button"
          onClick={() => void onMove(entry.id, index - 1)}
        >
          Earlier
        </button>
        <button
          disabled={index === total - 1}
          type="button"
          onClick={() => void onMove(entry.id, index + 1)}
        >
          Later
        </button>
        <button type="button" onClick={() => void onRemove(entry.id)}>
          Remove
        </button>
      </div>
    </article>
  );
}

function QueueEntryDetails({ entry }: { entry: QueueEntry }) {
  return (
    <div className="queue-item-info">
      <strong>{entry.songTitle}</strong>
      <span>{entry.songArtist}</span>
      <span>Requested by {entry.requesterDisplayName}</span>
    </div>
  );
}

function performanceStatus(active: PerformanceDetailsProjection | null) {
  if (!active) return "Preparing";
  if (active.state === "countdown") {
    return `Starting in ${Math.max(0, Math.ceil((active.countdownRemainingMs ?? 0) / 1_000))}`;
  }
  if (active.state === "playing") return "Playing";
  if (active.state === "finalizing") return "Finishing";
  if (active.state === "results") return "Results";
  return active.state.charAt(0).toUpperCase() + active.state.slice(1);
}
