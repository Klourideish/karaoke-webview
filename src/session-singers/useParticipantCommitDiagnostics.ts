import { useCallback, useEffect, useRef, useState } from "react";
import { getParticipantCommitDiagnostics } from "./api";
import type { ParticipantCommitDiagnosticProjection } from "./types";

const emptyDiagnostics: ParticipantCommitDiagnosticProjection = {
  requestId: null,
  outcome: "none",
  singerName: null,
  sourceDisplayName: null,
  microphoneState: null,
  rollbackOccurred: false,
  failureReason: null,
  failureMessage: null,
};

let pendingDiagnostics: Promise<ParticipantCommitDiagnosticProjection> | null = null;

function loadDiagnostics() {
  if (!pendingDiagnostics) {
    pendingDiagnostics = getParticipantCommitDiagnostics().finally(() => {
      pendingDiagnostics = null;
    });
  }
  return pendingDiagnostics;
}

export function useParticipantCommitDiagnostics() {
  const [diagnostics, setDiagnostics] = useState(emptyDiagnostics);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await loadDiagnostics();
      if (mountedRef.current) {
        setDiagnostics(next);
        setError(null);
      }
      return next;
    } catch (cause) {
      console.error("Participant commit diagnostics could not be loaded.", cause);
      if (mountedRef.current) {
        setError("Could not load participant onboarding diagnostics.");
      }
      return null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  return { diagnostics, error, refresh };
}
