import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { QueueProjection } from "./types";

export function getQueueProjection() {
  return invoke<QueueProjection>("get_queue_projection");
}

export async function listenForQueueProjection(
  onProjection: (projection: QueueProjection) => void,
) {
  return listen<QueueProjection>("queue-projection-changed", (event) => {
    onProjection(event.payload);
  });
}

export function addSongToQueue(requestId: string, songId: string, singerId: string) {
  return invoke<QueueProjection>("add_song_to_queue", {
    request: { requestId, songId, singerId },
  });
}

export function removeQueueEntry(requestId: string, entryId: string) {
  return invoke<QueueProjection>("remove_queue_entry", {
    request: { requestId, entryId },
  });
}

export function moveQueueEntry(requestId: string, entryId: string, targetIndex: number) {
  return invoke<QueueProjection>("move_queue_entry", {
    request: { requestId, entryId, targetIndex },
  });
}

export function voteForQueueEntry(requestId: string, entryId: string, singerId: string) {
  return invoke<QueueProjection>("vote_for_queue_entry", {
    request: { requestId, entryId, singerId },
  });
}

export function removeQueueVote(requestId: string, entryId: string, singerId: string) {
  return invoke<QueueProjection>("remove_queue_vote", {
    request: { requestId, entryId, singerId },
  });
}

export function pauseQueueProgression(requestId: string) {
  return invoke<QueueProjection>("pause_queue_progression", {
    request: { requestId },
  });
}

export function resumeQueueProgression(requestId: string) {
  return invoke<QueueProjection>("resume_queue_progression", {
    request: { requestId },
  });
}

export function skipCurrentQueueEntry(requestId: string) {
  return invoke<QueueProjection>("skip_current_queue_entry", {
    request: { requestId },
  });
}

export function retryFailedQueueEntry(requestId: string, entryId: string) {
  return invoke<QueueProjection>("retry_failed_queue_entry", {
    request: { requestId, entryId },
  });
}
