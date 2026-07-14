import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDevelopmentProtocolStatus,
  getDevelopmentStreamDiagnostics,
  startDevelopmentProtocolListener,
  stopDevelopmentProtocolListener,
  type StartDevelopmentProtocolRequest,
} from "./developmentProtocol";
import type { DevelopmentProtocolStatus, DevelopmentStreamDiagnostics } from "./types";

export const DEVELOPMENT_PROTOCOL_POLL_INTERVAL_MS = 1000;

const idleStatus: DevelopmentProtocolStatus = {
  listenerState: "stopped",
  bindAddress: "127.0.0.1",
  tcpPort: 45820,
  udpPort: 45821,
  connectedClientCount: 0,
  currentConnectionId: null,
  currentSessionId: null,
  connectedClientName: null,
  sourceId: null,
  streamAuthorized: false,
  activeStreamId: null,
  sourceHealth: "disconnected",
  lastHeartbeatAgeMs: null,
  malformedControlMessages: 0,
  rejectedControlMessages: 0,
  closureReason: null,
  error: null,
};

const idleDiagnostics: DevelopmentStreamDiagnostics = {
  activeStreamId: null,
  packetsReceived: 0,
  validPackets: 0,
  malformedPackets: 0,
  unauthorizedPackets: 0,
  duplicatePackets: 0,
  stalePackets: 0,
  latePackets: 0,
  sequenceGaps: 0,
  estimatedPacketLoss: 0,
  receiverQueueDepth: 0,
  maximumQueueDepth: 0,
  jitterWindowDepth: 0,
  jitterTargetMs: 30,
  jitterMaxMs: 60,
  audioHandoffCapacityFrames: 4,
  audioHandoffQueueDepth: 0,
  audioHandoffMaximumQueueDepth: 0,
  audioHandoffDroppedFrames: 0,
  currentSourceHealth: "disconnected",
  lastValidPacketAgeMs: null,
  level: { rms: 0, peak: 0, clipping: false, sequence: 0 },
};

export function useDevelopmentProtocol() {
  const [status, setStatus] = useState<DevelopmentProtocolStatus>(idleStatus);
  const [diagnostics, setDiagnostics] = useState<DevelopmentStreamDiagnostics>(idleDiagnostics);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"start" | "stop" | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextDiagnostics] = await Promise.all([
        getDevelopmentProtocolStatus(),
        getDevelopmentStreamDiagnostics(),
      ]);
      if (!mountedRef.current) return;
      setStatus(nextStatus);
      setDiagnostics(nextDiagnostics);
      setError(null);
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const interval = window.setInterval(
      () => void refresh(),
      DEVELOPMENT_PROTOCOL_POLL_INTERVAL_MS,
    );
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [refresh]);

  const start = useCallback(async (request: StartDevelopmentProtocolRequest = {}) => {
    setPendingAction("start");
    try {
      const projection = await startDevelopmentProtocolListener(request);
      if (!mountedRef.current) return;
      setStatus(projection.status);
      setDiagnostics(projection.diagnostics);
      setError(null);
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mountedRef.current) setPendingAction(null);
    }
  }, []);

  const stop = useCallback(async () => {
    setPendingAction("stop");
    try {
      const projection = await stopDevelopmentProtocolListener();
      if (!mountedRef.current) return;
      setStatus(projection.status);
      setDiagnostics(projection.diagnostics);
      setError(null);
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mountedRef.current) setPendingAction(null);
    }
  }, []);

  return { status, diagnostics, error, pendingAction, refresh, start, stop };
}
