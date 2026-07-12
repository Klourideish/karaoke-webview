import type {
  KaraokeMode,
  MicrophoneChannelId,
  MicrophoneSource,
  MicrophoneSourceId,
  SessionSingerId,
} from "../host-domain/types";

export type LocalMicrophoneSource = Extract<MicrophoneSource, { kind: "windows-device" }>;

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
