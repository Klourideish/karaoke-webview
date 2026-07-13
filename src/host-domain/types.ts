export type SingerId = string;
export type SingerProfileId = string;
export type SessionSingerId = string;
export type SingerSlotId = string;
export type ClientId = string;
export type ClientDeviceId = string;
export type MicrophoneSourceId = string;
export type MicrophoneChannelId = string;
export type QueueItemId = string;
export type PerformanceId = string;
export type PerformanceRecordId = string;
export type HostSessionId = string;
export type MediaSongId = string;

export type KaraokeMode = "standard" | "party" | "battle";

export type Singer = {
  id: SingerId;
  sessionSingerId: SessionSingerId;
};

export type SingerProfile = {
  id: SingerProfileId;
  displayName: string;
  pinSaltedHash: string;
  createdAt: string;
};

export type SessionSinger = {
  id: SessionSingerId;
  singerId: SingerId;
  displayName: string;
  profileId: SingerProfileId | null;
  participation: "ready" | "sitting-out" | "waiting" | "disconnected";
};

export type SingerSlot = {
  id: SingerSlotId;
  singerId: SingerId;
  position: number;
  reservedUntil: string | null;
};

export type ClientKind = "android-phone" | "remote-operator" | "test-client";
export type ClientRole = "singer" | "operator";

export type Client = {
  id: ClientId;
  deviceId: ClientDeviceId;
  kind: ClientKind;
  role: ClientRole;
  linkedSingerId: SingerId | null;
  connectionState: "connecting" | "connected" | "disconnected";
};

export type ClientDevice = {
  id: ClientDeviceId;
  suggestedProfileId: SingerProfileId | null;
  lastSeenAt: string | null;
};

export type MicrophoneSourceAvailability = "available" | "unavailable";

export type MicrophoneSource =
  | {
      id: MicrophoneSourceId;
      kind: "windows-device";
      displayName: string;
      availability: MicrophoneSourceAvailability;
      isDefault: boolean;
    }
  | {
      id: MicrophoneSourceId;
      kind: "network-client";
      displayName: string;
      availability: MicrophoneSourceAvailability;
      isDefault: false;
      clientId: ClientId | null;
    }
  | {
      id: MicrophoneSourceId;
      kind: "adapter";
      adapterKey: string;
    };

export type MicrophoneChannel = {
  id: MicrophoneChannelId;
  sourceId: MicrophoneSourceId;
  singerId: SingerId | null;
  muted: boolean;
  gain: number;
  level: number | null;
  health: "unknown" | "ready" | "degraded" | "disconnected";
  latencyMs: number | null;
};

export type QueueItem = {
  id: QueueItemId;
  songId: MediaSongId;
  requestedBySingerId: SingerId | null;
  intendedParticipantIds: SingerId[];
  requestedAt: string;
};

export type PerformanceState =
  | "created"
  | "preparing"
  | "ready"
  | "countdown"
  | "playing"
  | "finalizing"
  | "results"
  | "completed"
  | "stopped"
  | "failed";

export type SessionFlowState = "running" | "pause-requested" | "paused";

export type PerformanceParticipant = {
  singerId: SingerId;
  microphoneChannelId: MicrophoneChannelId | null;
  role: string | null;
  scoringEligibility: "official" | "partial" | "practice" | "unscored";
};

export type Performance = {
  id: PerformanceId;
  sourceQueueItemId: QueueItemId | null;
  songId: MediaSongId;
  mode: KaraokeMode;
  state: PerformanceState;
  participants: PerformanceParticipant[];
  audioReady: boolean;
  lyricsReady: boolean;
  microphoneResourcesReady: boolean;
  scoringMode: "enabled" | "degraded" | "disabled";
  audioOnlyOverride: boolean;
  battleMapVersion: string | null;
  createdAt: string;
  startedAt: string | null;
};

export type PerformanceOutcomeKind =
  "official" | "partial" | "practice" | "audio-only" | "stopped" | "failed";

export type PerformanceRecord = {
  id: PerformanceRecordId;
  performanceId: PerformanceId;
  songId: MediaSongId;
  mode: KaraokeMode;
  finalState: Extract<PerformanceState, "completed" | "stopped" | "failed">;
  outcomeKind: PerformanceOutcomeKind;
  participants: PerformanceParticipant[];
  startedAt: string | null;
  finalizedAt: string;
  scoringVersion: string | null;
  battleMapVersion: string | null;
  lyricOffsetMs: number;
  recordingReferences: string[];
};

export type HostSession = {
  id: HostSessionId;
  flowState: SessionFlowState;
  defaultMode: KaraokeMode;
  singerIds: SingerId[];
  slotIds: SingerSlotId[];
  clientIds: ClientId[];
  queueItemIds: QueueItemId[];
  microphoneChannelIds: MicrophoneChannelId[];
  currentPerformanceId: PerformanceId | null;
  completedPerformanceRecordIds: PerformanceRecordId[];
  startedAt: string;
};
