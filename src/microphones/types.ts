import type {
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
