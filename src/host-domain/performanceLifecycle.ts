import type { PerformanceState, SessionFlowState } from "./types";

const performanceTransitions: Readonly<Record<PerformanceState, readonly PerformanceState[]>> = {
  created: ["preparing", "stopped"],
  preparing: ["ready", "stopped", "failed"],
  ready: ["countdown", "stopped", "failed"],
  countdown: ["playing", "stopped", "failed"],
  playing: ["finalizing", "stopped", "failed"],
  finalizing: ["results", "failed"],
  results: ["completed"],
  completed: [],
  stopped: [],
  failed: [],
};

const sessionFlowTransitions: Readonly<Record<SessionFlowState, readonly SessionFlowState[]>> = {
  running: ["pause-requested", "paused"],
  "pause-requested": ["paused", "running"],
  paused: ["running"],
};

export function canTransitionPerformance(from: PerformanceState, to: PerformanceState): boolean {
  return performanceTransitions[from].includes(to);
}

export function canTransitionSessionFlow(from: SessionFlowState, to: SessionFlowState): boolean {
  return sessionFlowTransitions[from].includes(to);
}
