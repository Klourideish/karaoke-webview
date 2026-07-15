import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PerformanceProjection } from "./types";

export const PERFORMANCE_PROJECTION_EVENT = "performance-projection-changed";

export function getPerformanceProjection() {
  return invoke<PerformanceProjection>("get_performance_projection");
}

export function createPerformance(requestId: string, singerId: string, songId: string) {
  return invoke<PerformanceProjection>("create_performance", {
    request: { requestId, singerId, songId },
  });
}

export function cancelPreparation(requestId: string, performanceId: string) {
  return invoke<PerformanceProjection>("cancel_preparation", {
    request: { requestId, performanceId },
  });
}

export function skipPerformance(requestId: string, performanceId: string) {
  return invoke<PerformanceProjection>("skip_performance", {
    request: { requestId, performanceId },
  });
}

export function listenForPerformanceProjection(
  onProjection: (projection: PerformanceProjection) => void,
): Promise<UnlistenFn> {
  return listen<PerformanceProjection>(PERFORMANCE_PROJECTION_EVENT, (event) => {
    onProjection(event.payload);
  });
}
