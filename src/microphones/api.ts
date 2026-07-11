import { invoke } from "@tauri-apps/api/core";
import type { LocalMicrophoneSource } from "./types";

export function discoverLocalMicrophoneSources(): Promise<LocalMicrophoneSource[]> {
  return invoke<LocalMicrophoneSource[]>("discover_local_microphone_sources");
}
