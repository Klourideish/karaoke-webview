import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Singer } from "../app/SingerBar";
import type { KaraokeMode } from "../host-domain/types";
import type { useDiagnosticCapture } from "../microphones/useDiagnosticCapture";
import { useDiagnosticMonitor } from "../microphones/useDiagnosticMonitor";
import { useDevelopmentProtocol } from "../microphones/useDevelopmentProtocol";
import type { useLocalMicrophones } from "../microphones/useLocalMicrophones";
import type { useMicrophoneAssignments } from "../microphones/useMicrophoneAssignments";
import type { useMicrophoneChannels } from "../microphones/useMicrophoneChannels";
import type { useMicrophoneRecovery } from "../microphones/useMicrophoneRecovery";
import { usePerformanceMicrophoneReadiness } from "../microphones/usePerformanceMicrophoneReadiness";

export function DeveloperWorkspace({
  assignments,
  capture,
  channelRegistry,
  discovery,
  recovery,
  singers,
}: {
  assignments: ReturnType<typeof useMicrophoneAssignments>;
  capture: ReturnType<typeof useDiagnosticCapture>;
  channelRegistry: ReturnType<typeof useMicrophoneChannels>;
  discovery: ReturnType<typeof useLocalMicrophones>;
  recovery: ReturnType<typeof useMicrophoneRecovery>;
  singers: Singer[];
}) {
  const development = useDevelopmentProtocol();
  const diagnosticMonitor = useDiagnosticMonitor();
  const readiness = usePerformanceMicrophoneReadiness();
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

  const refreshDiscovery = discovery.refresh;
  useEffect(() => {
    if (development.status.sourceId) {
      void refreshDiscovery();
    }
  }, [development.status.sourceId, refreshDiscovery]);

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

  const isDevelopmentListenerActive = development.status.listenerState === "listening";
  const developmentControlsDisabled =
    development.pendingAction !== null || isDevelopmentListenerActive;

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

  async function checkPerformanceReadiness() {
    await readiness.check({
      allowAutomaticRecovery,
      mode: readinessMode,
      participantSingerIds: proposedParticipantIds,
    });
    await channelRegistry.refresh();
    await recovery.refresh();
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

  return (
    <section className="view-panel developer-workspace" aria-labelledby="view-heading">
      <div className="workspace-header">
        <div className="view-heading-group">
          <p className="region-label">Engineering</p>
          <h2 id="view-heading">Developer</h2>
          <p className="view-description">
            Protocol, capture, monitor and runtime diagnostics for development and hardware
            validation.
          </p>
        </div>
      </div>

      <div className="developer-diagnostics-panel">
        <section className="developer-panel" aria-labelledby="development-protocol-heading">
          <div>
            <p className="region-label">Developer</p>
            <h3 id="development-protocol-heading">Network microphone receiver</h3>
          </div>
          <p className="developer-warning" role="note">
            INSECURE DEVELOPMENT CONNECTION - local synthetic and Android-style testing only.
          </p>
          <p className="view-description">
            127.0.0.1 allows only same-PC connections. A LAN IP such as 192.168.1.78 allows phone
            access on the same network. 0.0.0.0 listens on all interfaces and is development-only.
          </p>
          <div className="developer-form-grid">
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
                await capture.stop();
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
          <DiagnosticText>
            <p>
              Listener: {readableState(development.status.listenerState)} / TCP{" "}
              {development.status.tcpPort} / UDP {development.status.udpPort} /{" "}
              {development.status.bindAddress}
            </p>
            <p>
              Client: {development.status.connectedClientName ?? "None"} / Source:{" "}
              {development.status.sourceId ?? "None"} / Stream:{" "}
              {development.status.activeStreamId ?? "None"}
            </p>
            <p>
              Health: {readableState(development.status.sourceHealth)} / Valid packets:{" "}
              {development.diagnostics.validPackets} / Gaps: {development.diagnostics.sequenceGaps}{" "}
              / Queue: {development.diagnostics.receiverQueueDepth}/
              {development.diagnostics.maximumQueueDepth}
            </p>
          </DiagnosticText>
          {development.error || development.status.error ? (
            <p className="microphone-error" role="alert">
              {development.error ?? development.status.error}
            </p>
          ) : null}
        </section>

        <section className="developer-panel" aria-labelledby="microphone-readiness-heading">
          <div>
            <p className="region-label">Developer</p>
            <h3 id="microphone-readiness-heading">Readiness probe</h3>
          </div>
          <p className="view-description">
            Checks proposed participants before countdown without starting capture.
          </p>
          <div className="developer-form-grid">
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
            <DiagnosticText>
              <p>
                Status: {readableState(readiness.result.status)} / {readiness.result.message}
              </p>
              <p>Locked participant count: {readiness.result.lockedParticipants.length}</p>
            </DiagnosticText>
          ) : null}
        </section>

        <section className="developer-panel" aria-labelledby="capture-diagnostics-heading">
          <div>
            <p className="region-label">Developer</p>
            <h3 id="capture-diagnostics-heading">Capture diagnostics</h3>
          </div>
          <DiagnosticText>
            <p>
              State: {readableState(capture.snapshot.status)} / Source:{" "}
              {capture.snapshot.sourceId ?? "None"}
            </p>
          </DiagnosticText>
          {capture.snapshot.error ? (
            <p className="microphone-error" role="alert">
              {capture.snapshot.error}
            </p>
          ) : null}
          <LevelMeter label="Diagnostic RMS level" value={capture.snapshot.level.rms} />
          <LevelMeter label="Diagnostic peak level" value={capture.snapshot.level.peak} />
          <p
            className="microphone-clipping-status"
            data-clipping={capture.snapshot.level.clipping ? "true" : "false"}
          >
            {capture.snapshot.level.clipping ? "Clipping detected" : "No clipping"}
          </p>
        </section>

        <section className="developer-panel" aria-labelledby="diagnostic-monitor-heading">
          <div>
            <p className="region-label">Developer</p>
            <h3 id="diagnostic-monitor-heading">Diagnostic audio monitoring</h3>
          </div>
          <p className="developer-warning" role="note">
            Use headphones to prevent acoustic feedback.
          </p>
          <div className="developer-form-grid">
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
                {discovery.sources
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
          </div>
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
          <DiagnosticText>
            <p>
              Status: {readableState(diagnosticMonitor.status.state)} / Source:{" "}
              {diagnosticMonitor.status.sourceId ?? "None"} / Output:{" "}
              {diagnosticMonitor.status.outputDeviceId ?? "None"}
            </p>
            <p>
              Queue: {diagnosticMonitor.diagnostics.queueDepth}/
              {diagnosticMonitor.diagnostics.queueCapacity} / Dropped:{" "}
              {diagnosticMonitor.diagnostics.droppedMonitorFrames} / Underruns:{" "}
              {diagnosticMonitor.diagnostics.underruns} / Buffered:{" "}
              {diagnosticMonitor.diagnostics.bufferedLatencyMs} ms
            </p>
            <p>
              Samples written: {diagnosticMonitor.diagnostics.samplesWritten} / Gain:{" "}
              {Math.round(diagnosticMonitor.diagnostics.gain * 100)}%
            </p>
          </DiagnosticText>
        </section>

        <section className="developer-panel" aria-labelledby="runtime-inventory-heading">
          <div>
            <p className="region-label">Developer</p>
            <h3 id="runtime-inventory-heading">Runtime inventory</h3>
          </div>
          <DiagnosticText>
            <p>{discovery.sources.length} discovered source projection(s).</p>
            <p>{channelRegistry.channels.length} microphone channel projection(s).</p>
            <p>{assignments.assignments.length} microphone assignment projection(s).</p>
            <p>{recovery.states.length} recovery state projection(s).</p>
          </DiagnosticText>
        </section>
      </div>
    </section>
  );
}

function DiagnosticText({ children }: { children: ReactNode }) {
  return (
    <div className="microphone-capture-status" aria-live="polite">
      {children}
    </div>
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
