import { useMemo } from "react";
import type { Singer } from "../app/SingerBar";
import type { useDiagnosticCapture } from "../microphones/useDiagnosticCapture";
import type { useLocalMicrophones } from "../microphones/useLocalMicrophones";
import type { useMicrophoneAssignments } from "../microphones/useMicrophoneAssignments";
import type { useMicrophoneChannels } from "../microphones/useMicrophoneChannels";
import type { useMicrophoneRecovery } from "../microphones/useMicrophoneRecovery";
import { useMicrophoneSelection } from "../microphones/useMicrophoneSelection";
import type {
  LocalMicrophoneChannel,
  LocalMicrophoneSource,
  MicrophoneAssignment,
  MicrophoneRecoveryState,
  MicrophoneWaitingState,
} from "../microphones/types";

type SingerMicrophoneStatus =
  "ready" | "needs-attention" | "disconnected" | "waiting" | "unassigned";

type SingerMicrophoneOption = {
  id: string;
  label: string;
  disabled?: boolean;
};

type SingerMicrophoneView = {
  singerId: string;
  singerName: string;
  selectedMicrophoneId: string;
  selectedMicrophoneName: string | null;
  status: SingerMicrophoneStatus;
  statusLabel: string;
  statusMessage: string;
  options: SingerMicrophoneOption[];
  assignment: MicrophoneAssignment | null;
  channel: LocalMicrophoneChannel | null;
  recovery: MicrophoneRecoveryState | null;
  waiting: MicrophoneWaitingState | null;
};

export function MicrophoneWorkspace({
  assignments,
  capture,
  channelRegistry,
  discovery,
  onOpenDeveloper,
  recovery,
  singers,
}: {
  assignments: ReturnType<typeof useMicrophoneAssignments>;
  capture: ReturnType<typeof useDiagnosticCapture>;
  channelRegistry: ReturnType<typeof useMicrophoneChannels>;
  discovery: ReturnType<typeof useLocalMicrophones>;
  onOpenDeveloper: () => void;
  recovery: ReturnType<typeof useMicrophoneRecovery>;
  singers: Singer[];
}) {
  const availableSources = useMemo(
    () => discovery.sources.filter((source) => source.availability === "available"),
    [discovery.sources],
  );
  const { snapshot: captureSnapshot, start: startCapture, stop: stopCapture } = capture;
  const microphoneSelection = useMicrophoneSelection();

  const usedSourceIds = useMemo(
    () => new Set(channelRegistry.channels.map((channel) => channel.sourceId)),
    [channelRegistry.channels],
  );

  const singerViews = useMemo(
    () =>
      buildSingerMicrophoneViews({
        assignments: assignments.assignments,
        channels: channelRegistry.channels,
        recoveryStates: recovery.states,
        singers,
        sources: discovery.sources,
        waitingStates: assignments.waitingStates,
      }),
    [
      assignments.assignments,
      assignments.waitingStates,
      channelRegistry.channels,
      discovery.sources,
      recovery.states,
      singers,
    ],
  );

  async function refreshMicrophoneState() {
    await Promise.all([
      assignments.refresh(),
      channelRegistry.refresh(),
      recovery.refresh(),
      discovery.refresh(),
    ]);
  }

  async function selectSingerMicrophone(view: SingerMicrophoneView, nextSourceId: string) {
    const result = await microphoneSelection.select(view.singerId, nextSourceId || null);
    if (result) {
      await refreshMicrophoneState();
    }
  }

  async function autoAssignSinger(view: SingerMicrophoneView) {
    await assignments.autoAssign(view.singerId);
    await refreshMicrophoneState();
  }

  async function retrySingerMicrophone(view: SingerMicrophoneView) {
    if (!view.channel) return;
    await recovery.retry(view.channel.id);
    await refreshMicrophoneState();
  }

  async function leaveSingerUnassigned(view: SingerMicrophoneView) {
    const result = await microphoneSelection.select(view.singerId, null);
    if (result) {
      await refreshMicrophoneState();
    }
  }

  async function testSingerMicrophone(view: SingerMicrophoneView) {
    if (!view.channel || view.status !== "ready") return;
    if (captureSnapshot.status !== "idle") {
      await stopCapture();
    }
    await startCapture(view.channel.sourceId);
  }

  const captureSourceId = captureSnapshot.sourceId;
  const canStopCapture = captureSnapshot.status === "active";

  return (
    <section className="view-panel microphone-workspace" aria-labelledby="view-heading">
      <h2 id="view-heading" className="visually-hidden">
        Microphones
      </h2>
      <div className="microphone-header">
        <button
          className="microphone-refresh-button"
          type="button"
          onClick={() => void discovery.refresh()}
          disabled={discovery.isRefreshing}
        >
          Refresh
        </button>
      </div>

      <div className="microphone-status" aria-live="polite">
        {discovery.status === "loading" ? <p>Finding microphones...</p> : null}
        {discovery.status === "failure" ? (
          <p className="microphone-error" role="alert">
            {discovery.error}
          </p>
        ) : null}
        {discovery.status === "success" && availableSources.length === 0 ? (
          <p>No available microphones were found.</p>
        ) : null}
        {assignments.error ||
        channelRegistry.error ||
        recovery.error ||
        microphoneSelection.error ? (
          <p className="microphone-error" role="alert">
            {assignments.error ??
              channelRegistry.error ??
              recovery.error ??
              microphoneSelection.error}
          </p>
        ) : null}
      </div>

      <div className="singer-microphone-list" aria-label="Singer microphones">
        {singerViews.map((view) => {
          const isMeterActive = captureSourceId === view.channel?.sourceId;
          const level = isMeterActive ? captureSnapshot.level.rms : 0;
          return (
            <article className="singer-microphone-card" key={view.singerId}>
              <div className="singer-microphone-main">
                <h3>{view.singerName}</h3>
                <StatusBadge status={view.status} label={view.statusLabel} />
                <p>{view.statusMessage}</p>
              </div>

              <label className="singer-microphone-selector">
                Microphone
                <select
                  className="microphone-select"
                  value={view.selectedMicrophoneId}
                  disabled={
                    assignments.isLoading ||
                    channelRegistry.isLoading ||
                    assignments.pendingChannelId !== null ||
                    assignments.pendingSingerId !== null ||
                    channelRegistry.pendingAction !== null ||
                    recovery.pendingChannelId !== null ||
                    microphoneSelection.pendingSingerId !== null
                  }
                  onChange={(event) => void selectSingerMicrophone(view, event.target.value)}
                >
                  <option value="">No microphone</option>
                  {view.options.map((option) => (
                    <option disabled={option.disabled} key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="singer-microphone-meter-group">
                <div className="singer-microphone-meter-heading">
                  <span>Input level</span>
                  {isMeterActive && captureSnapshot.status === "active" ? (
                    <span>Testing</span>
                  ) : null}
                </div>
                <LevelMeter label={`${view.singerName} input level`} value={level} />
              </div>

              <div className="singer-microphone-actions">
                {view.status === "unassigned" || view.status === "waiting" ? (
                  <button
                    className="microphone-test-button"
                    type="button"
                    disabled={assignments.pendingSingerId !== null}
                    onClick={() => void autoAssignSinger(view)}
                  >
                    Auto assign
                  </button>
                ) : null}
                {view.status === "ready" ? (
                  <button
                    className="microphone-test-button"
                    type="button"
                    disabled={
                      captureSnapshot.status === "starting" || captureSnapshot.status === "stopping"
                    }
                    onClick={() => void testSingerMicrophone(view)}
                  >
                    Test microphone
                  </button>
                ) : null}
                {isMeterActive && canStopCapture ? (
                  <button
                    className="microphone-test-button"
                    type="button"
                    onClick={() => void stopCapture()}
                  >
                    Stop test
                  </button>
                ) : null}
                {view.status === "disconnected" || view.status === "needs-attention" ? (
                  <>
                    <button
                      className="microphone-test-button"
                      type="button"
                      disabled={!view.channel || recovery.pendingChannelId !== null}
                      onClick={() => void retrySingerMicrophone(view)}
                    >
                      Retry
                    </button>
                    <button
                      className="microphone-test-button"
                      type="button"
                      disabled={microphoneSelection.pendingSingerId !== null}
                      onClick={() => void leaveSingerUnassigned(view)}
                    >
                      Leave unassigned
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <details className="microphone-secondary-section">
        <summary>Available microphones ({availableSources.length})</summary>
        {availableSources.length === 0 ? (
          <p>No available microphones were found.</p>
        ) : (
          <ul className="microphone-source-list" aria-label="Available microphones">
            {availableSources.map((source) => (
              <li className="microphone-source-row" key={source.id}>
                <div>
                  <h3>{source.displayName}</h3>
                  <p>
                    {source.kind === "network-client" ? "Network microphone" : "Local microphone"}
                  </p>
                </div>
                <div className="microphone-source-actions">
                  {source.isDefault ? (
                    <span className="microphone-default-label">Default input</span>
                  ) : null}
                  {usedSourceIds.has(source.id) ? <span>In use</span> : <span>Available</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>

      <section className="microphone-secondary-section microphone-developer-link">
        <div>
          <h3>Developer diagnostics</h3>
          <p>Protocol, capture, monitor and runtime details now live in Developer.</p>
        </div>
        <button className="microphone-test-button" type="button" onClick={onOpenDeveloper}>
          Open Developer diagnostics
        </button>
      </section>
    </section>
  );
}

function buildSingerMicrophoneViews({
  assignments,
  channels,
  recoveryStates,
  singers,
  sources,
  waitingStates,
}: {
  assignments: MicrophoneAssignment[];
  channels: LocalMicrophoneChannel[];
  recoveryStates: MicrophoneRecoveryState[];
  singers: Singer[];
  sources: LocalMicrophoneSource[];
  waitingStates: MicrophoneWaitingState[];
}): SingerMicrophoneView[] {
  const assignedSourceIds = new Set(
    assignments
      .map(
        (assignment) => channels.find((channel) => channel.id === assignment.channelId)?.sourceId,
      )
      .filter((sourceId): sourceId is string => Boolean(sourceId)),
  );
  const availableOptions = sources
    .filter((source) => source.availability === "available")
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return singers.map((singer) => {
    const assignment = assignments.find((candidate) => candidate.singerId === singer.id) ?? null;
    const waiting = waitingStates.find((candidate) => candidate.singerId === singer.id) ?? null;
    const channel = assignment
      ? (channels.find((candidate) => candidate.id === assignment.channelId) ?? null)
      : null;
    const recovery = channel
      ? (recoveryStates.find((candidate) => candidate.channelId === channel.id) ?? null)
      : null;
    const currentSource =
      channel && sources.find((candidate) => candidate.id === channel.sourceId)
        ? (sources.find((candidate) => candidate.id === channel.sourceId) ?? null)
        : null;

    const options = availableOptions
      .filter((source) => {
        if (source.id === channel?.sourceId) return true;
        const sourceChannel = channels.find((candidate) => candidate.sourceId === source.id);
        if (!sourceChannel) return true;
        return !channel && !assignedSourceIds.has(source.id);
      })
      .map((source) => ({
        id: source.id,
        label: `${source.displayName}${source.isDefault ? " (Default)" : ""}`,
      }));

    if (channel && !options.some((option) => option.id === channel.sourceId)) {
      options.unshift({
        id: channel.sourceId,
        label: `${channel.sourceDisplayName} (Disconnected)`,
        disabled: channel.state === "disconnected",
      });
    }

    const status = singerMicrophoneStatus({ assignment, channel, recovery, waiting });
    return {
      assignment,
      channel,
      options,
      recovery,
      selectedMicrophoneId: channel?.sourceId ?? "",
      selectedMicrophoneName: currentSource?.displayName ?? channel?.sourceDisplayName ?? null,
      singerId: singer.id,
      singerName: singer.displayName,
      status,
      statusLabel: statusLabel(status),
      statusMessage: statusMessage({
        channel,
        recovery,
        selectedSourceName: currentSource?.displayName,
        status,
        waiting,
      }),
      waiting,
    };
  });
}

function singerMicrophoneStatus({
  assignment,
  channel,
  recovery,
  waiting,
}: {
  assignment: MicrophoneAssignment | null;
  channel: LocalMicrophoneChannel | null;
  recovery: MicrophoneRecoveryState | null;
  waiting: MicrophoneWaitingState | null;
}): SingerMicrophoneStatus {
  if (channel?.state === "available" && recovery?.status !== "recovery-failed") {
    return "ready";
  }
  if (channel?.state === "disconnected") {
    return "disconnected";
  }
  if (recovery?.status === "recovery-failed") {
    return "needs-attention";
  }
  if (waiting) {
    return "waiting";
  }
  if (!assignment) {
    return "unassigned";
  }
  return "needs-attention";
}

function statusLabel(status: SingerMicrophoneStatus) {
  switch (status) {
    case "ready":
      return "Ready";
    case "needs-attention":
      return "Needs attention";
    case "disconnected":
      return "Disconnected";
    case "waiting":
      return "Waiting";
    case "unassigned":
      return "Unassigned";
  }
}

function statusMessage({
  channel,
  recovery,
  selectedSourceName,
  status,
  waiting,
}: {
  channel: LocalMicrophoneChannel | null;
  recovery: MicrophoneRecoveryState | null;
  selectedSourceName?: string;
  status: SingerMicrophoneStatus;
  waiting: MicrophoneWaitingState | null;
}) {
  if (status === "ready") {
    return `${selectedSourceName ?? channel?.sourceDisplayName ?? "Microphone"} is ready.`;
  }
  if (status === "disconnected") {
    return `${channel?.sourceDisplayName ?? "This microphone"} is disconnected.`;
  }
  if (status === "waiting") {
    return waiting?.message ?? "Waiting for an available microphone.";
  }
  if (status === "needs-attention") {
    return recovery?.reason ?? "This microphone needs attention.";
  }
  return "No microphone selected.";
}

function StatusBadge({ label, status }: { label: string; status: SingerMicrophoneStatus }) {
  const marker = status === "ready" ? "OK" : status === "unassigned" ? "O" : "!";

  return (
    <span className="microphone-status-badge" data-status={status}>
      <span aria-hidden="true">{marker}</span>
      {label}
    </span>
  );
}

function LevelMeter({ label, value }: { label: string; value: number }) {
  const normalized = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
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
  );
}
