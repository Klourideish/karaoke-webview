export function QueuePanel() {
  return (
    <aside className="queue-panel" aria-labelledby="queue-heading">
      <div className="queue-heading-group">
        <p className="region-label">Persistent queue</p>
        <h2 id="queue-heading">Queue</h2>
      </div>
      <p className="queue-empty-state">No songs queued yet.</p>
    </aside>
  );
}
