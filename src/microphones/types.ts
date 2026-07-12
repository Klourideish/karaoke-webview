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
  method: "manual";
  sequence: number;
};
