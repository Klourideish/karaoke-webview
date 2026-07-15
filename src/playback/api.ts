import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PlaybackProjection } from "./types";

export const PLAYBACK_PROJECTION_EVENT = "playback-projection-changed";

export function getPlaybackProjection() {
  return invoke<PlaybackProjection>("get_playback_projection");
}

export function requestSongPlayback(requestId: string, songId: string) {
  return invoke<PlaybackProjection>("request_song_playback", {
    request: { requestId, songId },
  });
}

export function requestPlaybackPause(requestId: string) {
  return invoke<PlaybackProjection>("request_playback_pause", { request: { requestId } });
}

export function requestPlaybackResume(requestId: string) {
  return invoke<PlaybackProjection>("request_playback_resume", { request: { requestId } });
}

export function requestPlaybackStop(requestId: string) {
  return invoke<PlaybackProjection>("request_playback_stop", { request: { requestId } });
}

export function reportPlaybackStarted(attemptId: string) {
  return invoke<PlaybackProjection>("report_playback_started", { request: { attemptId } });
}

export function reportPlaybackCompleted(attemptId: string) {
  return invoke<PlaybackProjection>("report_playback_completed", { request: { attemptId } });
}

export function reportPlaybackFailed(
  attemptId: string,
  kind: "start-rejected" | "media-error",
  message: string,
) {
  return invoke<PlaybackProjection>("report_playback_failed", {
    request: { attemptId, kind, message },
  });
}

export function listenForPlaybackProjection(
  onProjection: (projection: PlaybackProjection) => void,
): Promise<UnlistenFn> {
  return listen<PlaybackProjection>(PLAYBACK_PROJECTION_EVENT, (event) => {
    onProjection(event.payload);
  });
}
