import type {
  MicrophoneChannelId,
  MicrophoneSource,
  MicrophoneSourceId,
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
