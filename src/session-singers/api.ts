import { invoke } from "@tauri-apps/api/core";
import type {
  ParticipantCommitDiagnosticProjection,
  ParticipantCommitProjection,
  SessionSingerProjection,
} from "./types";

export function listSessionSingers(): Promise<SessionSingerProjection[]> {
  return invoke<SessionSingerProjection[]>("list_session_singers");
}

export function createSessionSinger(displayName: string | null = null) {
  return invoke<SessionSingerProjection>("create_session_singer", {
    request: { displayName },
  });
}

export function renameSessionSinger(singerId: string, displayName: string) {
  return invoke<SessionSingerProjection>("rename_session_singer", {
    request: { singerId, displayName },
  });
}

export function removeSessionSinger(singerId: string) {
  return invoke<SessionSingerProjection>("remove_session_singer", { singerId });
}

export function createSessionSingerWithMicrophone(
  requestId: string,
  displayName: string,
  sourceId: string,
) {
  return invoke<ParticipantCommitProjection>("create_session_singer_with_microphone", {
    request: { requestId, displayName, sourceId },
  });
}

export function assignMicrophoneToExistingSinger(
  requestId: string,
  singerId: string,
  sourceId: string,
) {
  return invoke<ParticipantCommitProjection>("assign_microphone_to_existing_singer", {
    request: { requestId, singerId, sourceId },
  });
}

export function getParticipantCommitDiagnostics() {
  return invoke<ParticipantCommitDiagnosticProjection>("get_participant_commit_diagnostics");
}
