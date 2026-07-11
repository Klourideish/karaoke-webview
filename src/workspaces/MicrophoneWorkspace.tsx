import type { useLocalMicrophones } from "../microphones/useLocalMicrophones";

export function MicrophoneWorkspace({
  discovery,
}: {
  discovery: ReturnType<typeof useLocalMicrophones>;
}) {
  const isLoading = discovery.status === "loading";

  return (
    <section className="view-panel microphone-workspace" aria-labelledby="view-heading">
      <div className="microphone-header">
        <div className="view-heading-group">
          <p className="region-label">Local inputs</p>
          <h2 id="view-heading">Microphones</h2>
        </div>
        <button
          className="microphone-refresh-button"
          type="button"
          onClick={() => void discovery.refresh()}
          disabled={discovery.isRefreshing}
        >
          Refresh
        </button>
      </div>

      <p className="view-description">
        Discovered sources are not opened, assigned, or verified as ready for capture.
      </p>

      <div className="microphone-status" aria-live="polite">
        {isLoading ? <p>Discovering local microphone inputs...</p> : null}
        {discovery.status === "failure" ? (
          <p className="microphone-error" role="alert">
            {discovery.error}
          </p>
        ) : null}
        {discovery.status === "success" && discovery.sources.length === 0 ? (
          <p>No local microphone inputs were found.</p>
        ) : null}
        {discovery.status === "success" && discovery.sources.length > 0 ? (
          <p>
            {discovery.sources.length} local microphone input
            {discovery.sources.length === 1 ? "" : "s"} discovered.
          </p>
        ) : null}
      </div>

      {discovery.sources.length > 0 ? (
        <ul className="microphone-source-list" aria-label="Discovered microphone inputs">
          {discovery.sources.map((source) => (
            <li className="microphone-source-row" key={source.id}>
              <div>
                <h3>{source.displayName}</h3>
                <p>{source.availability === "available" ? "Available" : "Unavailable"}</p>
              </div>
              {source.isDefault ? (
                <span className="microphone-default-label">Default input</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
