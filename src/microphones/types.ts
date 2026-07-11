import type { MicrophoneSource } from "../host-domain/types";

export type LocalMicrophoneSource = Extract<MicrophoneSource, { kind: "windows-device" }>;

export type MicrophoneDiscoveryState = {
  status: "loading" | "success" | "failure";
  sources: LocalMicrophoneSource[];
  error: string | null;
};
