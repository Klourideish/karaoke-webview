import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelPreparation,
  createPerformance,
  getPerformanceProjection,
  listenForPerformanceProjection,
  skipPerformance,
} from "./api";
import { emptyPerformanceProjection, type PerformanceProjection } from "./types";

export function usePerformance() {
  const projectionRef = useRef(emptyPerformanceProjection);
  const [projection, setProjection] = useState(emptyPerformanceProjection);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback((next: PerformanceProjection) => {
    if (!next || next.revision < projectionRef.current.revision) return;
    projectionRef.current = next;
    setProjection(next);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenForPerformanceProjection((next) => {
      if (!disposed) accept(next);
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    });
    void getPerformanceProjection().then((next) => {
      if (!disposed) accept(next);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [accept]);

  const run = useCallback(
    async (operation: Promise<PerformanceProjection>) => {
      try {
        setError(null);
        const next = await operation;
        accept(next);
        return next;
      } catch (cause) {
        setError(errorMessage(cause));
        return null;
      }
    },
    [accept],
  );

  return {
    projection,
    error,
    create: (singerId: string, songId: string) =>
      run(createPerformance(operationId("create"), singerId, songId)),
    cancel: (performanceId: string) => run(cancelPreparation(operationId("cancel"), performanceId)),
    skip: (performanceId: string) => run(skipPerformance(operationId("skip"), performanceId)),
  };
}

export type PerformanceController = ReturnType<typeof usePerformance>;

let nextOperation = 0;

function operationId(kind: string) {
  nextOperation += 1;
  return `performance-${kind}-${nextOperation}`;
}

function errorMessage(cause: unknown) {
  if (cause && typeof cause === "object" && "message" in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "The Host could not update this Performance.";
}
