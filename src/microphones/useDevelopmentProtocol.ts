import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDevelopmentProtocolStatus,
  getDevelopmentStreamDiagnostics,
  selectPhonePairingListenerAddress,
  startDevelopmentProtocolListener,
  startListenerForPhonePairing,
  stopDevelopmentProtocolListener,
  type StartDevelopmentProtocolRequest,
} from "./developmentProtocol";
import type {
  DevelopmentProtocolStatus,
  DevelopmentStreamDiagnostics,
  PhonePairingAddressCandidate,
  PhonePairingListenerError,
  PhonePairingListenerProjection,
} from "./types";

export const DEVELOPMENT_PROTOCOL_POLL_INTERVAL_MS = 1000;

const idleStatus: DevelopmentProtocolStatus = {
  listenerState: "stopped",
  bindAddress: "127.0.0.1",
  advertisedAddress: null,
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
  const [pollError, setPollError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "start" | "phone-start" | "phone-select" | "stop" | null
  >(null);
  const [phonePairingCandidates, setPhonePairingCandidates] = useState<
    PhonePairingAddressCandidate[]
  >([]);
  const [phonePairingEndpoint, setPhonePairingEndpoint] =
    useState<PhonePairingListenerProjection | null>(null);
  const mountedRef = useRef(true);
  const phoneActionInFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextDiagnostics] = await Promise.all([
        getDevelopmentProtocolStatus(),
        getDevelopmentStreamDiagnostics(),
      ]);
      if (!mountedRef.current) return;
      setStatus(nextStatus);
      setDiagnostics(nextDiagnostics);
      setPollError(null);
      return nextStatus;
    } catch (caught) {
      if (!mountedRef.current) return;
      setPollError(caught instanceof Error ? caught.message : String(caught));
      return null;
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
      setActionError(null);
    } catch (caught) {
      if (!mountedRef.current) return;
      setActionError(caught instanceof Error ? caught.message : String(caught));
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
      setPhonePairingCandidates([]);
      setPhonePairingEndpoint(null);
      setActionError(null);
    } catch (caught) {
      if (!mountedRef.current) return;
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mountedRef.current) setPendingAction(null);
    }
  }, []);

  const applyPhonePairingProjection = useCallback((projection: PhonePairingListenerProjection) => {
    if (!mountedRef.current) return null;
    setStatus(projection.listener.status);
    setDiagnostics(projection.listener.diagnostics);
    setPhonePairingCandidates([]);
    setPhonePairingEndpoint(projection);
    setActionError(null);
    return projection;
  }, []);

  const runPhoneAction = useCallback(
    async (
      action: "phone-start" | "phone-select",
      operation: () => Promise<PhonePairingListenerProjection>,
    ) => {
      if (phoneActionInFlight.current) {
        return { projection: null, error: null };
      }
      phoneActionInFlight.current = true;
      setPendingAction(action);
      setActionError(null);
      try {
        return {
          projection: applyPhonePairingProjection(await operation()),
          error: null,
        };
      } catch (caught) {
        if (!mountedRef.current) return { projection: null, error: null };
        const typed = phonePairingErrorFrom(caught);
        setPhonePairingCandidates(typed.candidates);
        setPhonePairingEndpoint(null);
        setActionError(typed.message);
        return { projection: null, error: typed };
      } finally {
        phoneActionInFlight.current = false;
        if (mountedRef.current) setPendingAction(null);
      }
    },
    [applyPhonePairingProjection],
  );

  const startForPhonePairingWithResult = useCallback(
    () => runPhoneAction("phone-start", startListenerForPhonePairing),
    [runPhoneAction],
  );

  const startForPhonePairing = useCallback(
    async () => (await startForPhonePairingWithResult()).projection,
    [startForPhonePairingWithResult],
  );

  const selectPhonePairingAddressWithResult = useCallback(
    (candidateId: string) =>
      runPhoneAction("phone-select", () => selectPhonePairingListenerAddress(candidateId)),
    [runPhoneAction],
  );

  const selectPhonePairingAddress = useCallback(
    async (candidateId: string) =>
      (await selectPhonePairingAddressWithResult(candidateId)).projection,
    [selectPhonePairingAddressWithResult],
  );

  return {
    status,
    diagnostics,
    error: actionError ?? pollError,
    pendingAction,
    phonePairingCandidates,
    phonePairingEndpoint,
    refresh,
    selectPhonePairingAddress,
    selectPhonePairingAddressWithResult,
    start,
    startForPhonePairing,
    startForPhonePairingWithResult,
    stop,
  };
}

function phonePairingErrorFrom(cause: unknown): PhonePairingListenerError {
  if (typeof cause === "string") {
    try {
      return phonePairingErrorFrom(JSON.parse(cause));
    } catch {
      return { reasonCode: "internal-error", message: cause, candidates: [] };
    }
  }
  if (cause && typeof cause === "object") {
    const error = cause as Partial<PhonePairingListenerError>;
    if (typeof error.reasonCode === "string" && typeof error.message === "string") {
      return {
        reasonCode: error.reasonCode as PhonePairingListenerError["reasonCode"],
        message: error.message,
        candidates: Array.isArray(error.candidates) ? error.candidates : [],
      };
    }
  }
  return {
    reasonCode: "internal-error",
    message: cause instanceof Error ? cause.message : "Could not start the development listener.",
    candidates: [],
  };
}
