import { invoke } from "@tauri-apps/api/core";
import type { LocalMicrophoneChannel, LocalMicrophoneSource } from "./types";

export function discoverLocalMicrophoneSources(): Promise<LocalMicrophoneSource[]> {
  return invoke<LocalMicrophoneSource[]>("discover_local_microphone_sources");
}

export function listMicrophoneChannels(): Promise<LocalMicrophoneChannel[]> {
  return invoke<LocalMicrophoneChannel[]>("list_microphone_channels");
}

export function createMicrophoneChannel(sourceId: string): Promise<LocalMicrophoneChannel> {
  return invoke<LocalMicrophoneChannel>("create_microphone_channel", { sourceId });
}

export function removeMicrophoneChannel(channelId: string): Promise<void> {
  return invoke<void>("remove_microphone_channel", { channelId });
}

export function replaceMicrophoneChannelSource(
  channelId: string,
  sourceId: string,
): Promise<LocalMicrophoneChannel> {
  return invoke<LocalMicrophoneChannel>("replace_microphone_channel_source", {
    channelId,
    sourceId,
  });
}
