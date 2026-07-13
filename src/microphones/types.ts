import type {
  KaraokeMode,
  MicrophoneChannelId,
  MicrophoneSource,
  MicrophoneSourceId,
  SessionSingerId,
} from "../host-domain/types";

export type LocalMicrophoneSource =
  | Extract<MicrophoneSource, { kind: "windows-device" }>
  | Extract<MicrophoneSource, { kind: "network-client" }>;

export type MicrophoneDiscoveryState = {
  status: "loading" | "success" | "failure";
  sources: LocalMicrophoneSource[];
  error: string | null;
  isRefreshing: boolean;
};

export type LocalMicrophoneChannel = {
  id: MicrophoneChannelId;
  sourceId: MicrophoneSourceId;
  sourceDisplayName: string;
  state: "available" | "disconnected";
};

export type MicrophoneAssignment = {
  channelId: MicrophoneChannelId;
  singerId: SessionSingerId;
  method: "manual" | "automatic";
  sequence: number;
};

export type MicrophoneWaitingState = {
  singerId: SessionSingerId;
  reason: "no-eligible-microphone";
  message: string;
  sequence: number;
};

export type AutomaticAssignmentResult = {
  status: "assigned" | "waiting";
  assignment: MicrophoneAssignment | null;
  waitingState: MicrophoneWaitingState | null;
};

export type MicrophoneRecoveryState = {
  channelId: MicrophoneChannelId;
  status: "healthy" | "disconnected" | "recovering" | "replacement-available" | "recovery-failed";
  sourcePresence: "available" | "unavailable" | "missing";
  reason: string;
  eligibleReplacementSourceIds: MicrophoneSourceId[];
  automaticReplacementEligible: boolean;
};

export type PerformanceReadinessPhase = "preparing" | "countdown" | "playing";

export type PerformanceMicrophoneReadinessRequest = {
  mode: KaraokeMode;
  participantSingerIds: SessionSingerId[];
  allowAutomaticRecovery: boolean;
  phase: PerformanceReadinessPhase;
};

export type PerformanceMicrophoneReadinessStatus = "ready" | "degraded" | "blocked";

export type PerformanceMicrophoneReadinessReason =
  | "ready"
  | "no-assignment"
  | "waiting-for-microphone"
  | "channel-disconnected"
  | "source-unavailable"
  | "diagnostic-session-active"
  | "conflicting-assignment"
  | "recovery-available"
  | "recovery-failed"
  | "excluded-by-party-mode";

export type ParticipantMicrophoneReadiness = {
  singerId: SessionSingerId;
  status: PerformanceMicrophoneReadinessStatus;
  reason: PerformanceMicrophoneReadinessReason;
  message: string;
  assignment: MicrophoneAssignment | null;
  channel: LocalMicrophoneChannel | null;
  recovery: MicrophoneRecoveryState | null;
  captureAvailable: boolean;
};

export type LockedPerformanceMicrophone = {
  singerId: SessionSingerId;
  channelId: MicrophoneChannelId;
  sourceId: MicrophoneSourceId;
};

export type PerformanceMicrophoneReadiness = {
  status: PerformanceMicrophoneReadinessStatus;
  mode: KaraokeMode;
  participants: ParticipantMicrophoneReadiness[];
  lockedParticipants: LockedPerformanceMicrophone[];
  message: string;
};

export type DevelopmentListenerState = "stopped" | "starting" | "listening" | "failed";
export type DevelopmentSourceHealth =
  | "connected-not-authorized"
  | "authorized-awaiting-audio"
  | "healthy"
  | "degraded"
  | "disconnected"
  | "failed";

export type DevelopmentProtocolStatus = {
  listenerState: DevelopmentListenerState;
  bindAddress: string;
  tcpPort: number;
  udpPort: number;
  connectedClientCount: number;
  currentConnectionId: string | null;
  currentSessionId: string | null;
  connectedClientName: string | null;
  sourceId: string | null;
  streamAuthorized: boolean;
  activeStreamId: number | null;
  sourceHealth: DevelopmentSourceHealth;
  lastHeartbeatAgeMs: number | null;
  malformedControlMessages: number;
  rejectedControlMessages: number;
  closureReason: string | null;
  error: string | null;
};

export type DevelopmentStreamDiagnostics = {
  activeStreamId: number | null;
  packetsReceived: number;
  validPackets: number;
  malformedPackets: number;
  unauthorizedPackets: number;
  duplicatePackets: number;
  stalePackets: number;
  latePackets: number;
  sequenceGaps: number;
  estimatedPacketLoss: number;
  receiverQueueDepth: number;
  maximumQueueDepth: number;
  jitterWindowDepth: number;
  jitterTargetMs: number;
  jitterMaxMs: number;
  currentSourceHealth: DevelopmentSourceHealth;
  lastValidPacketAgeMs: number | null;
  level: { rms: number; peak: number; clipping: boolean; sequence: number };
};

export type DevelopmentProtocolProjection = {
  status: DevelopmentProtocolStatus;
  diagnostics: DevelopmentStreamDiagnostics;
  sources: LocalMicrophoneSource[];
};
