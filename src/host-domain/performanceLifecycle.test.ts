import { describe, expect, it } from "vitest";
import { canTransitionPerformance, canTransitionSessionFlow } from "./performanceLifecycle";
import type { PerformanceState } from "./types";

describe("performance lifecycle", () => {
  it("accepts the normal host-authoritative progression", () => {
    const path: PerformanceState[] = [
      "created",
      "preparing",
      "ready",
      "countdown",
      "playing",
      "finalizing",
      "results",
      "completed",
    ];

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransitionPerformance(path[index], path[index + 1])).toBe(true);
    }
  });

  it("allows stop and failure only from documented active phases", () => {
    expect(canTransitionPerformance("created", "stopped")).toBe(true);
    expect(canTransitionPerformance("playing", "stopped")).toBe(true);
    expect(canTransitionPerformance("preparing", "failed")).toBe(true);
    expect(canTransitionPerformance("finalizing", "failed")).toBe(true);
    expect(canTransitionPerformance("results", "stopped")).toBe(false);
  });

  it("rejects skipped, backward, and terminal transitions", () => {
    expect(canTransitionPerformance("created", "playing")).toBe(false);
    expect(canTransitionPerformance("results", "playing")).toBe(false);
    expect(canTransitionPerformance("completed", "created")).toBe(false);
    expect(canTransitionPerformance("stopped", "preparing")).toBe(false);
    expect(canTransitionPerformance("failed", "preparing")).toBe(false);
  });
});

describe("session flow lifecycle", () => {
  it("supports deferred pause, cancellation, immediate idle pause, and resume", () => {
    expect(canTransitionSessionFlow("running", "pause-requested")).toBe(true);
    expect(canTransitionSessionFlow("pause-requested", "paused")).toBe(true);
    expect(canTransitionSessionFlow("pause-requested", "running")).toBe(true);
    expect(canTransitionSessionFlow("running", "paused")).toBe(true);
    expect(canTransitionSessionFlow("paused", "running")).toBe(true);
  });

  it("rejects flow transitions that skip host coordination", () => {
    expect(canTransitionSessionFlow("paused", "pause-requested")).toBe(false);
    expect(canTransitionSessionFlow("running", "running")).toBe(false);
  });
});
