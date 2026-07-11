import { useEffect, useId, useMemo, useState } from "react";
import { useDiagnosticCapture } from "../microphones/useDiagnosticCapture";
import type { useLocalMicrophones } from "../microphones/useLocalMicrophones";

export function MicrophoneWorkspace({
  discovery,
}: {
  discovery: ReturnType<typeof useLocalMicrophones>;
}) {
  const isLoading = discovery.status === "loading";
  const availableSources = useMemo(
    () => discovery.sources.filter((source) => source.availability === "available"),
    [discovery.sources],
  );
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const {
    snapshot: captureSnapshot,
    start: startCapture,
    stop: stopCapture,
  } = useDiagnosticCapture();
  const selectId = useId();
  const selectedSource = useMemo(
    () => availableSources.find((source) => source.id === selectedSourceId) ?? null,
    [availableSources, selectedSourceId],
  );

  useEffect(() => {
    if (selectedSourceId && !selectedSource) {
      void stopCapture();
      setSelectedSourceId("");
      return;
    }
    if (!selectedSourceId && availableSources.length > 0) {
      const preferred = availableSources.find((source) => source.isDefault) ?? availableSources[0];
      setSelectedSourceId(preferred.id);
    }
  }, [availableSources, selectedSource, selectedSourceId, stopCapture]);

  async function changeSelection(sourceId: string) {
    if (captureSnapshot.status !== "idle") {
      await stopCapture();
    }
    setSelectedSourceId(sourceId);
  }

  const isTransitioning =
    captureSnapshot.status === "starting" || captureSnapshot.status === "stopping";
  const canStart =
    selectedSource !== null && !isTransitioning && captureSnapshot.status !== "active";
  const canStop = captureSnapshot.status === "active";

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
        {discovery.status === "success" && availableSources.length === 0 ? (
          <p>No available local microphone inputs were found.</p>
        ) : null}
        {discovery.status === "success" && availableSources.length > 0 ? (
          <p>
            {availableSources.length} available local microphone input
            {availableSources.length === 1 ? "" : "s"} discovered.
          </p>
        ) : null}
      </div>

      {availableSources.length > 0 ? (
        <ul className="microphone-source-list" aria-label="Discovered microphone inputs">
          {availableSources.map((source) => (
            <li className="microphone-source-row" key={source.id}>
              <div>
                <h3>{source.displayName}</h3>
                <p>Available</p>
              </div>
              {source.isDefault ? (
                <span className="microphone-default-label">Default input</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <section className="microphone-test-panel" aria-labelledby="microphone-test-heading">
        <div>
          <p className="region-label">Diagnostic capture</p>
          <h3 id="microphone-test-heading">Live input test</h3>
        </div>

        <label htmlFor={selectId}>Microphone</label>
        <select
          id={selectId}
          className="microphone-select"
          value={selectedSourceId}
          onChange={(event) => void changeSelection(event.target.value)}
          disabled={isTransitioning || availableSources.length === 0}
        >
          <option value="">Select a microphone</option>
          {availableSources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.displayName}
              {source.isDefault ? " (Default)" : ""}
            </option>
          ))}
        </select>

        <div className="microphone-test-actions">
          <button
            className="microphone-test-button"
            type="button"
            disabled={!canStart}
            onClick={() => selectedSource && void startCapture(selectedSource.id)}
          >
            Start Test
          </button>
          <button
            className="microphone-test-button"
            type="button"
            disabled={!canStop}
            onClick={() => void stopCapture()}
          >
            Stop Test
          </button>
        </div>

        <p className="microphone-capture-status" aria-live="polite">
          State: {captureStatusLabel(captureSnapshot.status)}
        </p>
        {captureSnapshot.error ? (
          <p className="microphone-error" role="alert">
            {captureSnapshot.error}
          </p>
        ) : null}

        <LevelMeter label="RMS level" value={captureSnapshot.level.rms} />
        <LevelMeter label="Peak level" value={captureSnapshot.level.peak} />
        <p
          className="microphone-clipping-status"
          data-clipping={captureSnapshot.level.clipping ? "true" : "false"}
        >
          {captureSnapshot.level.clipping ? "Clipping detected" : "No clipping"}
        </p>
      </section>
    </section>
  );
}

function LevelMeter({ label, value }: { label: string; value: number }) {
  const normalized = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div className="microphone-meter-group">
      <span>{label}</span>
      <div
        className="microphone-meter"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={normalized}
      >
        <span className="microphone-meter-fill" style={{ width: `${normalized * 100}%` }} />
      </div>
    </div>
  );
}

function captureStatusLabel(status: string) {
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}
