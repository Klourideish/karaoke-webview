import { useEffect, useMemo, useState } from "react";
import type { Singer } from "../app/SingerBar";
import type { KaraokeMode } from "../host-domain/types";
import { useDiagnosticCapture } from "../microphones/useDiagnosticCapture";
import { useDiagnosticMonitor } from "../microphones/useDiagnosticMonitor";
import { useDevelopmentProtocol } from "../microphones/useDevelopmentProtocol";
import type { useLocalMicrophones } from "../microphones/useLocalMicrophones";
import type { useMicrophoneAssignments } from "../microphones/useMicrophoneAssignments";
import { useMicrophoneChannels } from "../microphones/useMicrophoneChannels";
import { useMicrophoneRecovery } from "../microphones/useMicrophoneRecovery";
import { usePerformanceMicrophoneReadiness } from "../microphones/usePerformanceMicrophoneReadiness";
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
  discovery,
  singers,
}: {
  assignments: ReturnType<typeof useMicrophoneAssignments>;
  discovery: ReturnType<typeof useLocalMicrophones>;
  singers: Singer[];
}) {
  const availableSources = useMemo(
    () => discovery.sources.filter((source) => source.availability === "available"),
    [discovery.sources],
  );
  const channelRegistry = useMicrophoneChannels(discovery.sources);
  const recovery = useMicrophoneRecovery(discovery.sources, channelRegistry.channels);
  const readiness = usePerformanceMicrophoneReadiness();
  const development = useDevelopmentProtocol();
  const {
    snapshot: captureSnapshot,
    start: startCapture,
    stop: stopCapture,
  } = useDiagnosticCapture();
  const diagnosticMonitor = useDiagnosticMonitor();
  const [developmentBindAddress, setDevelopmentBindAddress] = useState("127.0.0.1");
  const [developmentTcpPort, setDevelopmentTcpPort] = useState("45820");
  const [developmentUdpPort, setDevelopmentUdpPort] = useState("45821");
  const [developmentFormError, setDevelopmentFormError] = useState<string | null>(null);
  const [monitorSourceId, setMonitorSourceId] = useState("");
  const [monitorOutputId, setMonitorOutputId] = useState("default");
  const [monitorGain, setMonitorGain] = useState("25");
  const [monitorFormError, setMonitorFormError] = useState<string | null>(null);
  const [readinessMode, setReadinessMode] = useState<KaraokeMode>("standard");
  const [allowAutomaticRecovery, setAllowAutomaticRecovery] = useState(true);

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

  const refreshDiscovery = discovery.refresh;
  useEffect(() => {
    if (development.status.sourceId) {
      void refreshDiscovery();
    }
  }, [development.status.sourceId, refreshDiscovery]);

  async function refreshMicrophoneState() {
    await Promise.all([channelRegistry.refresh(), recovery.refresh(), discovery.refresh()]);
  }

  async function selectSingerMicrophone(view: SingerMicrophoneView, nextSourceId: string) {
    if (!nextSourceId) {
      if (view.assignment) {
        await assignments.unassign(view.assignment.channelId);
      }
      await refreshMicrophoneState();
      return;
    }

    if (view.channel) {
      if (view.channel.sourceId !== nextSourceId) {
        if (view.channel.state === "disconnected") {
          await channelRegistry.replaceDisconnectedSource(view.channel.id, nextSourceId);
        } else {
          await channelRegistry.replaceSource(view.channel.id, nextSourceId);
        }
      }
      if (!view.assignment) {
        await assignments.assign(view.channel.id, view.singerId);
      }
      await refreshMicrophoneState();
      return;
    }

    const reusableChannel = channelRegistry.channels.find(
      (channel) =>
        channel.sourceId === nextSourceId &&
        !assignments.assignments.some((assignment) => assignment.channelId === channel.id),
    );
    if (reusableChannel) {
      await assignments.assign(reusableChannel.id, view.singerId);
      await refreshMicrophoneState();
      return;
    }

    const createdChannel = await channelRegistry.create(nextSourceId);
    if (createdChannel) {
      await assignments.assign(createdChannel.id, view.singerId);
    }
    await refreshMicrophoneState();
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
    if (view.assignment) {
      await assignments.unassign(view.assignment.channelId);
    }
    if (view.waiting) {
      await assignments.clearWaiting(view.singerId);
    }
    await refreshMicrophoneState();
  }

  async function testSingerMicrophone(view: SingerMicrophoneView) {
    if (!view.channel || view.status !== "ready") return;
    if (captureSnapshot.status !== "idle") {
      await stopCapture();
    }
    await startCapture(view.channel.sourceId);
  }

  const proposedParticipantIds = useMemo(() => {
    const assignedSingerIdsInOrder = singers
      .filter((singer) =>
        assignments.assignments.some((assignment) => assignment.singerId === singer.id),
      )
      .map((singer) => singer.id);
    if (readinessMode === "party") {
      return singers.map((singer) => singer.id);
    }
    if (assignedSingerIdsInOrder.length > 0) {
      return assignedSingerIdsInOrder;
    }
    return singers.slice(0, readinessMode === "battle" ? 2 : 1).map((singer) => singer.id);
  }, [assignments.assignments, readinessMode, singers]);

  async function checkPerformanceReadiness() {
    await readiness.check({
      allowAutomaticRecovery,
      mode: readinessMode,
      participantSingerIds: proposedParticipantIds,
    });
    await channelRegistry.refresh();
    await recovery.refresh();
  }

  async function startDevelopmentListener() {
    const bindAddress = developmentBindAddress.trim();
    const tcpPort = parseDevelopmentPort(developmentTcpPort);
    const udpPort = parseDevelopmentPort(developmentUdpPort);
    if (!bindAddress) {
      setDevelopmentFormError("Enter a bind address before starting the listener.");
      return;
    }
    if (tcpPort === null || udpPort === null) {
      setDevelopmentFormError("Ports must be whole numbers from 1 to 65535.");
      return;
    }

    setDevelopmentFormError(null);
    await development.start({ bindAddress, tcpPort, udpPort });
    await discovery.refresh();
  }

  async function startDiagnosticMonitoring() {
    const gainPercent = Number(monitorGain);
    if (!monitorSourceId) {
      setMonitorFormError("Choose a microphone source before monitoring.");
      return;
    }
    if (!monitorOutputId) {
      setMonitorFormError("Choose an output device before monitoring.");
      return;
    }
    if (!Number.isFinite(gainPercent) || gainPercent < 0 || gainPercent > 100) {
      setMonitorFormError("Gain must be a number from 0 to 100.");
      return;
    }
    setMonitorFormError(null);
    await diagnosticMonitor.start({
      sourceId: monitorSourceId,
      outputDeviceId: monitorOutputId,
      gain: gainPercent / 100,
    });
  }
  const isDevelopmentListenerActive = development.status.listenerState === "listening";
  const developmentControlsDisabled =
    development.pendingAction !== null || isDevelopmentListenerActive;
  const captureSourceId = captureSnapshot.sourceId;
  const canStopCapture = captureSnapshot.status === "active";

  return (
    <section className="view-panel microphone-workspace" aria-labelledby="view-heading">
      <div className="microphone-header">
        <div className="view-heading-group">
          <p className="region-label">Operator</p>
          <h2 id="view-heading">Microphones</h2>
          <p className="view-description">
            Assign microphones to singers and check that input is working.
          </p>
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
        {assignments.error || channelRegistry.error || recovery.error ? (
          <p className="microphone-error" role="alert">
            {assignments.error ?? channelRegistry.error ?? recovery.error}
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
                    recovery.pendingChannelId !== null
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
                      disabled={assignments.pendingChannelId !== null}
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

      <details className="microphone-secondary-section">
        <summary>Developer diagnostics</summary>
        <DeveloperDiagnostics
          allowAutomaticRecovery={allowAutomaticRecovery}
          captureSnapshot={captureSnapshot}
          channelRegistry={channelRegistry}
          checkPerformanceReadiness={checkPerformanceReadiness}
          development={development}
          developmentBindAddress={developmentBindAddress}
          developmentControlsDisabled={developmentControlsDisabled}
          developmentFormError={developmentFormError}
          developmentTcpPort={developmentTcpPort}
          developmentUdpPort={developmentUdpPort}
          diagnosticMonitor={diagnosticMonitor}
          isDevelopmentListenerActive={isDevelopmentListenerActive}
          readiness={readiness}
          readinessMode={readinessMode}
          setAllowAutomaticRecovery={setAllowAutomaticRecovery}
          setDevelopmentBindAddress={setDevelopmentBindAddress}
          setDevelopmentTcpPort={setDevelopmentTcpPort}
          setDevelopmentUdpPort={setDevelopmentUdpPort}
          setMonitorGain={setMonitorGain}
          setMonitorOutputId={setMonitorOutputId}
          setMonitorSourceId={setMonitorSourceId}
          setReadinessMode={setReadinessMode}
          startDevelopmentListener={startDevelopmentListener}
          startDiagnosticMonitoring={startDiagnosticMonitoring}
          stopCapture={stopCapture}
          monitorFormError={monitorFormError}
          monitorGain={monitorGain}
          monitorOutputId={monitorOutputId}
          monitorSourceId={monitorSourceId}
          sources={discovery.sources}
        />
      </details>
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
      .filter((source) => source.id === channel?.sourceId || !assignedSourceIds.has(source.id))
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
  return (
    <span className="microphone-status-badge" data-status={status}>
      <span aria-hidden="true">
        {status === "ready" ? "✓" : status === "unassigned" ? "○" : "!"}
      </span>
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

function DeveloperDiagnostics({
  allowAutomaticRecovery,
  captureSnapshot,
  channelRegistry,
  checkPerformanceReadiness,
  development,
  developmentBindAddress,
  developmentControlsDisabled,
  developmentFormError,
  developmentTcpPort,
  developmentUdpPort,
  diagnosticMonitor,
  isDevelopmentListenerActive,
  monitorFormError,
  monitorGain,
  monitorOutputId,
  monitorSourceId,
  readiness,
  readinessMode,
  setAllowAutomaticRecovery,
  setDevelopmentBindAddress,
  setDevelopmentTcpPort,
  setDevelopmentUdpPort,
  setMonitorGain,
  setMonitorOutputId,
  setMonitorSourceId,
  setReadinessMode,
  startDevelopmentListener,
  startDiagnosticMonitoring,
  stopCapture,
  sources,
}: {
  allowAutomaticRecovery: boolean;
  captureSnapshot: ReturnType<typeof useDiagnosticCapture>["snapshot"];
  channelRegistry: ReturnType<typeof useMicrophoneChannels>;
  checkPerformanceReadiness: () => Promise<void>;
  development: ReturnType<typeof useDevelopmentProtocol>;
  developmentBindAddress: string;
  developmentControlsDisabled: boolean;
  developmentFormError: string | null;
  developmentTcpPort: string;
  developmentUdpPort: string;
  diagnosticMonitor: ReturnType<typeof useDiagnosticMonitor>;
  isDevelopmentListenerActive: boolean;
  monitorFormError: string | null;
  monitorGain: string;
  monitorOutputId: string;
  monitorSourceId: string;
  readiness: ReturnType<typeof usePerformanceMicrophoneReadiness>;
  readinessMode: KaraokeMode;
  setAllowAutomaticRecovery: (value: boolean) => void;
  setDevelopmentBindAddress: (value: string) => void;
  setDevelopmentTcpPort: (value: string) => void;
  setDevelopmentUdpPort: (value: string) => void;
  setMonitorGain: (value: string) => void;
  setMonitorOutputId: (value: string) => void;
  setMonitorSourceId: (value: string) => void;
  setReadinessMode: (value: KaraokeMode) => void;
  startDevelopmentListener: () => Promise<void>;
  startDiagnosticMonitoring: () => Promise<void>;
  stopCapture: () => Promise<void>;
  sources: LocalMicrophoneSource[];
}) {
  return (
    <div className="developer-diagnostics-panel">
      <section className="microphone-test-panel" aria-labelledby="development-protocol-heading">
        <div>
          <p className="region-label">Developer</p>
          <h3 id="development-protocol-heading">Network microphone receiver</h3>
        </div>
        <p className="microphone-error" role="note">
          INSECURE DEVELOPMENT CONNECTION - local synthetic and Android-style testing only.
        </p>
        <p className="view-description">
          127.0.0.1 allows only same-PC connections. A LAN IP such as 192.168.1.78 allows phone
          access on the same network. 0.0.0.0 listens on all interfaces and is development-only.
        </p>
        <div className="microphone-readiness-controls">
          <label>
            Bind address
            <input
              className="microphone-select"
              type="text"
              value={developmentBindAddress}
              disabled={developmentControlsDisabled}
              onChange={(event) => setDevelopmentBindAddress(event.target.value)}
            />
          </label>
          <label>
            TCP port
            <input
              className="microphone-select"
              type="number"
              min={1}
              max={65535}
              value={developmentTcpPort}
              disabled={developmentControlsDisabled}
              onChange={(event) => setDevelopmentTcpPort(event.target.value)}
            />
          </label>
          <label>
            UDP port
            <input
              className="microphone-select"
              type="number"
              min={1}
              max={65535}
              value={developmentUdpPort}
              disabled={developmentControlsDisabled}
              onChange={(event) => setDevelopmentUdpPort(event.target.value)}
            />
          </label>
        </div>
        <div className="microphone-test-actions">
          <button
            className="microphone-test-button"
            type="button"
            disabled={development.pendingAction !== null || isDevelopmentListenerActive}
            onClick={() => void startDevelopmentListener()}
          >
            Start Listener
          </button>
          <button
            className="microphone-test-button"
            type="button"
            disabled={
              development.pendingAction !== null || development.status.listenerState === "stopped"
            }
            onClick={async () => {
              await development.stop();
              await stopCapture();
            }}
          >
            Stop Listener
          </button>
        </div>
        {developmentFormError ? (
          <p className="microphone-error" role="alert">
            {developmentFormError}
          </p>
        ) : null}
        <div className="microphone-capture-status" aria-live="polite">
          <p>
            Listener: {readableState(development.status.listenerState)} · TCP{" "}
            {development.status.tcpPort} · UDP {development.status.udpPort} ·{" "}
            {development.status.bindAddress}
          </p>
          <p>
            Client: {development.status.connectedClientName ?? "None"} · Source:{" "}
            {development.status.sourceId ?? "None"} · Stream:{" "}
            {development.status.activeStreamId ?? "None"}
          </p>
          <p>
            Health: {readableState(development.status.sourceHealth)} · Valid packets:{" "}
            {development.diagnostics.validPackets} · Gaps: {development.diagnostics.sequenceGaps} ·
            Queue: {development.diagnostics.receiverQueueDepth}/
            {development.diagnostics.maximumQueueDepth}
          </p>
        </div>
        {development.error || development.status.error ? (
          <p className="microphone-error" role="alert">
            {development.error ?? development.status.error}
          </p>
        ) : null}
      </section>

      <section className="microphone-test-panel" aria-labelledby="microphone-readiness-heading">
        <div>
          <p className="region-label">Developer</p>
          <h3 id="microphone-readiness-heading">Readiness probe</h3>
        </div>
        <p className="view-description">
          Checks proposed participants before countdown without starting capture.
        </p>
        <div className="microphone-readiness-controls">
          <label>
            Mode
            <select
              className="microphone-select"
              value={readinessMode}
              onChange={(event) => setReadinessMode(event.target.value as KaraokeMode)}
            >
              <option value="standard">Standard</option>
              <option value="party">Party</option>
              <option value="battle">Battle</option>
            </select>
          </label>
          <label className="microphone-checkbox-label">
            <input
              type="checkbox"
              checked={allowAutomaticRecovery}
              onChange={(event) => setAllowAutomaticRecovery(event.target.checked)}
            />
            Allow one-source recovery before countdown
          </label>
          <button
            className="microphone-test-button"
            type="button"
            disabled={readiness.isChecking}
            onClick={() => void checkPerformanceReadiness()}
          >
            Check readiness
          </button>
        </div>
        {readiness.error ? (
          <p className="microphone-error" role="alert">
            {readiness.error}
          </p>
        ) : null}
        {readiness.result ? (
          <div className="microphone-readiness-result" aria-live="polite">
            <p>
              Status: {readableState(readiness.result.status)} · {readiness.result.message}
            </p>
            <p>Locked participant count: {readiness.result.lockedParticipants.length}</p>
          </div>
        ) : null}
      </section>

      <section className="microphone-test-panel" aria-labelledby="capture-diagnostics-heading">
        <div>
          <p className="region-label">Developer</p>
          <h3 id="capture-diagnostics-heading">Capture diagnostics</h3>
        </div>
        <p className="microphone-capture-status" aria-live="polite">
          State: {readableState(captureSnapshot.status)} · Source:{" "}
          {captureSnapshot.sourceId ?? "None"}
        </p>
        {captureSnapshot.error ? (
          <p className="microphone-error" role="alert">
            {captureSnapshot.error}
          </p>
        ) : null}
        <LevelMeter label="Diagnostic RMS level" value={captureSnapshot.level.rms} />
        <LevelMeter label="Diagnostic peak level" value={captureSnapshot.level.peak} />
        <p
          className="microphone-clipping-status"
          data-clipping={captureSnapshot.level.clipping ? "true" : "false"}
        >
          {captureSnapshot.level.clipping ? "Clipping detected" : "No clipping"}
        </p>
      </section>

      <section className="microphone-test-panel" aria-labelledby="diagnostic-monitor-heading">
        <div>
          <p className="region-label">Developer</p>
          <h3 id="diagnostic-monitor-heading">Diagnostic audio monitoring</h3>
        </div>
        <p className="microphone-error" role="note">
          Use headphones to prevent acoustic feedback.
        </p>
        <label>
          Source
          <select
            className="microphone-select"
            value={monitorSourceId}
            disabled={
              diagnosticMonitor.pendingAction !== null ||
              diagnosticMonitor.status.state === "active"
            }
            onChange={(event) => setMonitorSourceId(event.target.value)}
          >
            <option value="">Choose microphone</option>
            {sources
              .filter((source) => source.availability === "available")
              .map((source) => (
                <option key={source.id} value={source.id}>
                  {source.displayName}
                </option>
              ))}
          </select>
        </label>
        <label>
          Output
          <select
            className="microphone-select"
            value={monitorOutputId}
            disabled={
              diagnosticMonitor.pendingAction !== null ||
              diagnosticMonitor.status.state === "active"
            }
            onChange={(event) => setMonitorOutputId(event.target.value)}
          >
            {diagnosticMonitor.outputs.length === 0 ? (
              <option value="default">Default Windows output</option>
            ) : null}
            {diagnosticMonitor.outputs.map((output) => (
              <option key={output.id} value={output.id}>
                {output.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Gain
          <input
            className="microphone-select"
            type="number"
            min={0}
            max={100}
            value={monitorGain}
            disabled={
              diagnosticMonitor.pendingAction !== null ||
              diagnosticMonitor.status.state === "active"
            }
            onChange={(event) => setMonitorGain(event.target.value)}
          />
        </label>
        <div className="microphone-test-actions">
          <button
            className="microphone-test-button"
            type="button"
            disabled={
              diagnosticMonitor.pendingAction !== null ||
              diagnosticMonitor.status.state === "active"
            }
            onClick={() => void startDiagnosticMonitoring()}
          >
            Start Monitoring
          </button>
          <button
            className="microphone-test-button"
            type="button"
            disabled={
              diagnosticMonitor.pendingAction !== null ||
              diagnosticMonitor.status.state !== "active"
            }
            onClick={() => void diagnosticMonitor.stop()}
          >
            Stop Monitoring
          </button>
        </div>
        {monitorFormError || diagnosticMonitor.error ? (
          <p className="microphone-error" role="alert">
            {monitorFormError ?? diagnosticMonitor.error}
          </p>
        ) : null}
        <div className="microphone-capture-status" aria-live="polite">
          <p>
            Status: {readableState(diagnosticMonitor.status.state)} · Source:{" "}
            {diagnosticMonitor.status.sourceId ?? "None"} · Output:{" "}
            {diagnosticMonitor.status.outputDeviceId ?? "None"}
          </p>
          <p>
            Queue: {diagnosticMonitor.diagnostics.queueDepth}/
            {diagnosticMonitor.diagnostics.queueCapacity} · Dropped:{" "}
            {diagnosticMonitor.diagnostics.droppedMonitorFrames} · Underruns:{" "}
            {diagnosticMonitor.diagnostics.underruns} · Buffered:{" "}
            {diagnosticMonitor.diagnostics.bufferedLatencyMs} ms
          </p>
          <p>
            Samples written: {diagnosticMonitor.diagnostics.samplesWritten} · Gain:{" "}
            {Math.round(diagnosticMonitor.diagnostics.gain * 100)}%
          </p>
        </div>
      </section>
      <section className="microphone-test-panel" aria-labelledby="runtime-inventory-heading">
        <div>
          <p className="region-label">Developer</p>
          <h3 id="runtime-inventory-heading">Runtime inventory</h3>
        </div>
        <p>{sources.length} discovered source projection(s).</p>
        <p>{channelRegistry.channels.length} microphone channel projection(s).</p>
      </section>
    </div>
  );
}

function readableState(value: string) {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function parseDevelopmentPort(value: string) {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}
