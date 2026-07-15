import type { PerformanceMicrophoneReadiness } from "../microphones/types";

export type PerformanceLifecycleState =
  | "created"
  | "preparing"
  | "ready"
  | "countdown"
  | "playing"
  | "finalizing"
  | "results"
  | "completed"
  | "stopped"
  | "failed";

export type PerformanceDetailsProjection = {
  id: string;
  state: PerformanceLifecycleState;
  performer: { id: string; displayName: string };
  song: { id: string; title: string; artist: string };
  countdownDeadlineUnixMs: number | null;
  countdownRemainingMs: number | null;
  resultsDeadlineUnixMs: number | null;
  resultsRemainingMs: number | null;
  readiness: PerformanceMicrophoneReadiness;
  playback: { attemptId: string | null; state: string; startupPending: boolean };
  terminalReason: "cancelled-before-playback" | "skipped-by-operator" | null;
  failure: { reasonCode: string; message: string } | null;
};

export type PerformanceProjection = {
  revision: number;
  active: PerformanceDetailsProjection | null;
  diagnostics: {
    lastTransition: string | null;
    stalePlaybackEventCount: number;
    idempotencyHitCount: number;
    idempotencyConflictCount: number;
  };
};

export const emptyPerformanceProjection: PerformanceProjection = {
  revision: 0,
  active: null,
  diagnostics: {
    lastTransition: null,
    stalePlaybackEventCount: 0,
    idempotencyHitCount: 0,
    idempotencyConflictCount: 0,
  },
};
