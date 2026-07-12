import { invoke } from "@tauri-apps/api/core";
import type {
  AutomaticAssignmentResult,
  LocalMicrophoneChannel,
  LocalMicrophoneSource,
  MicrophoneAssignment,
  MicrophoneWaitingState,
} from "./types";

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

export function syncSessionSingers(singerIds: string[]): Promise<MicrophoneAssignment[]> {
  return invoke<MicrophoneAssignment[]>("sync_session_singers", { singerIds });
}

export function listMicrophoneAssignments(): Promise<MicrophoneAssignment[]> {
  return invoke<MicrophoneAssignment[]>("list_microphone_assignments");
}

export function assignMicrophoneChannel(
  channelId: string,
  singerId: string,
): Promise<MicrophoneAssignment> {
  return invoke<MicrophoneAssignment>("assign_microphone_channel", { channelId, singerId });
}

export function unassignMicrophoneChannel(channelId: string): Promise<void> {
  return invoke<void>("unassign_microphone_channel", { channelId });
}

export function autoAssignMicrophoneChannel(singerId: string): Promise<AutomaticAssignmentResult> {
  return invoke<AutomaticAssignmentResult>("auto_assign_microphone_channel", { singerId });
}

export function listMicrophoneWaitingStates(): Promise<MicrophoneWaitingState[]> {
  return invoke<MicrophoneWaitingState[]>("list_microphone_waiting_states");
}

export function clearMicrophoneWaitingState(singerId: string): Promise<void> {
  return invoke<void>("clear_microphone_waiting_state", { singerId });
}
