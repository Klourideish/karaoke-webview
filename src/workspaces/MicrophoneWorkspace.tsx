import { useEffect, useId, useMemo, useState } from "react";
import type { Singer } from "../app/SingerBar";
import { useDiagnosticCapture } from "../microphones/useDiagnosticCapture";
import type { useLocalMicrophones } from "../microphones/useLocalMicrophones";
import { useMicrophoneChannels } from "../microphones/useMicrophoneChannels";
import type { useMicrophoneAssignments } from "../microphones/useMicrophoneAssignments";

export function MicrophoneWorkspace({
  assignments,
  discovery,
  singers,
}: {
  assignments: ReturnType<typeof useMicrophoneAssignments>;
  discovery: ReturnType<typeof useLocalMicrophones>;
  singers: Singer[];
}) {
  const isLoading = discovery.status === "loading";
  const availableSources = useMemo(
    () => discovery.sources.filter((source) => source.availability === "available"),
    [discovery.sources],
  );
  const channelRegistry = useMicrophoneChannels(discovery.sources);
  const usedSourceIds = useMemo(
    () => new Set(channelRegistry.channels.map((channel) => channel.sourceId)),
    [channelRegistry.channels],
  );
  const assignedSingerIds = useMemo(
    () => new Set(assignments.assignments.map((assignment) => assignment.singerId)),
    [assignments.assignments],
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
              <div className="microphone-source-actions">
                {source.isDefault ? (
                  <span className="microphone-default-label">Default input</span>
                ) : null}
                <button
                  className="microphone-test-button"
                  type="button"
                  disabled={usedSourceIds.has(source.id) || channelRegistry.pendingAction !== null}
                  onClick={() => void channelRegistry.create(source.id)}
                >
                  {usedSourceIds.has(source.id) ? "Channel created" : "Create channel"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="microphone-channel-section" aria-labelledby="microphone-channels-heading">
        <div>
          <p className="region-label">Host session infrastructure</p>
          <h3 id="microphone-channels-heading">Microphone channels</h3>
        </div>
        {channelRegistry.error ? (
          <p className="microphone-error" role="alert">
            {channelRegistry.error}
          </p>
        ) : null}
        {assignments.error ? (
          <p className="microphone-error" role="alert">
            {assignments.error}
          </p>
        ) : null}
        {channelRegistry.isLoading ? <p>Loading microphone channels...</p> : null}
        {!channelRegistry.isLoading && channelRegistry.channels.length === 0 ? (
          <p>No microphone channels created.</p>
        ) : null}
        {channelRegistry.channels.length > 0 ? (
          <ul className="microphone-source-list" aria-label="Host microphone channels">
            {channelRegistry.channels.map((channel) => {
              const assignment = assignments.assignments.find(
                (candidate) => candidate.channelId === channel.id,
              );
              const eligibleSingers = singers.filter(
                (singer) => singer.id === assignment?.singerId || !assignedSingerIds.has(singer.id),
              );
              const replacementSources = availableSources.filter(
                (source) => source.id === channel.sourceId || !usedSourceIds.has(source.id),
              );
              return (
                <li className="microphone-source-row" key={channel.id}>
                  <div>
                    <h4>{channel.id}</h4>
                    <p>
                      {channel.sourceDisplayName} · {channelStateLabel(channel.state)}
                    </p>
                  </div>
                  <div className="microphone-channel-actions">
                    <label>
                      Assigned singer
                      <select
                        className="microphone-select"
                        value={assignment?.singerId ?? ""}
                        disabled={assignments.isLoading || assignments.pendingChannelId !== null}
                        onChange={(event) => {
                          const singerId = event.target.value;
                          if (singerId) {
                            void assignments.assign(channel.id, singerId);
                          } else if (assignment) {
                            void assignments.unassign(channel.id);
                          }
                        }}
                      >
                        <option value="">Unassigned</option>
                        {eligibleSingers.map((singer) => (
                          <option key={singer.id} value={singer.id}>
                            {singer.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Source
                      <select
                        className="microphone-select"
                        value={channel.sourceId}
                        disabled={
                          channelRegistry.pendingAction !== null || replacementSources.length === 0
                        }
                        onChange={(event) =>
                          void channelRegistry.replaceSource(channel.id, event.target.value)
                        }
                      >
                        {!replacementSources.some((source) => source.id === channel.sourceId) ? (
                          <option value={channel.sourceId}>{channel.sourceDisplayName}</option>
                        ) : null}
                        {replacementSources.map((source) => (
                          <option key={source.id} value={source.id}>
                            {source.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="microphone-test-button"
                      type="button"
                      disabled={channelRegistry.pendingAction !== null || assignment !== undefined}
                      aria-describedby={assignment ? `${channel.id}-remove-note` : undefined}
                      onClick={() => void channelRegistry.remove(channel.id)}
                    >
                      Remove channel
                    </button>
                    {assignment ? (
                      <span id={`${channel.id}-remove-note`} className="microphone-assignment-note">
                        Unassign before removing
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

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

function channelStateLabel(state: "available" | "disconnected") {
  return state === "available" ? "Available" : "Disconnected";
}
