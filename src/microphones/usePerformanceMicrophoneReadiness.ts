import { useCallback, useState } from "react";
import type { KaraokeMode, SessionSingerId } from "../host-domain/types";
import { evaluatePerformanceMicrophoneReadiness } from "./api";
import type { PerformanceMicrophoneReadiness } from "./types";

export function usePerformanceMicrophoneReadiness() {
  const [result, setResult] = useState<PerformanceMicrophoneReadiness | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(
    async ({
      allowAutomaticRecovery,
      mode,
      participantSingerIds,
    }: {
      allowAutomaticRecovery: boolean;
      mode: KaraokeMode;
      participantSingerIds: SessionSingerId[];
    }) => {
      setIsChecking(true);
      setError(null);
      try {
        const next = await evaluatePerformanceMicrophoneReadiness({
          allowAutomaticRecovery,
          mode,
          participantSingerIds,
          phase: "preparing",
        });
        setResult(next);
        return next;
      } catch (cause) {
        console.error("Performance microphone readiness could not be evaluated.", cause);
        setError("Could not check microphone readiness.");
        return null;
      } finally {
        setIsChecking(false);
      }
    },
    [],
  );

  return {
    check,
    error,
    isChecking,
    result,
  };
}
