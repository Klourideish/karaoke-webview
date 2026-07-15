export type HostPlaybackState =
  "idle" | "starting" | "playing" | "paused" | "stopped" | "completed" | "failed";

export type PlaybackAdapterAction = "none" | "start" | "pause" | "resume" | "stop";

export type PlaybackSongProjection = {
  id: string;
  title: string;
  artist: string;
  audioPath: string;
};

export type PlaybackProjection = {
  revision: number;
  state: HostPlaybackState;
  desiredAction: PlaybackAdapterAction;
  attemptId: string | null;
  song: PlaybackSongProjection | null;
  failureReason: string | null;
  failureMessage: string | null;
  diagnostics: {
    lastAdapterEvent: string | null;
    staleEventCount: number;
    idempotencyHitCount: number;
    idempotencyConflictCount: number;
  };
};

export type PlaybackCommandError = {
  reasonCode: string;
  message: string;
};

export const idlePlaybackProjection: PlaybackProjection = {
  revision: 0,
  state: "idle",
  desiredAction: "none",
  attemptId: null,
  song: null,
  failureReason: null,
  failureMessage: null,
  diagnostics: {
    lastAdapterEvent: null,
    staleEventCount: 0,
    idempotencyHitCount: 0,
    idempotencyConflictCount: 0,
  },
};
