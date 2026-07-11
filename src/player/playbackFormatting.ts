import type { AudioPlayer } from "../audioPlayer";

export function playbackStatusLabel(status: AudioPlayer["status"]) {
  switch (status) {
    case "idle":
      return "Idle";
    case "loading":
      return "Loading";
    case "ready":
      return "Ready";
    case "playing":
      return "Playing";
    case "paused":
      return "Paused";
    case "ended":
      return "Ended";
    case "error":
      return "Error";
  }
}
