import { useCallback, useRef, useState } from "react";
import { selectSingerMicrophone } from "./api";

export function useMicrophoneSelection() {
  const [pendingSingerId, setPendingSingerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIds = useRef(new Map<string, string>());

  const select = useCallback(async (sessionSingerId: string, desiredSourceId: string | null) => {
    const fingerprint = `${sessionSingerId}\u0000${desiredSourceId ?? "<clear>"}`;
    const requestId = requestIds.current.get(fingerprint) ?? createRequestId();
    requestIds.current.set(fingerprint, requestId);
    setPendingSingerId(sessionSingerId);
    setError(null);
    try {
      const result = await selectSingerMicrophone({
        requestId,
        sessionSingerId,
        desiredSourceId,
      });
      requestIds.current.delete(fingerprint);
      return result;
    } catch (cause) {
      console.error("Singer microphone selection could not be completed.", cause);
      setError(errorMessage(cause));
      return null;
    } finally {
      setPendingSingerId((current) => (current === sessionSingerId ? null : current));
    }
  }, []);

  return { error, pendingSingerId, select };
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `microphone-selection-${Date.now()}-${Math.random()}`;
}

function errorMessage(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause) {
    return String(cause.message);
  }
  return "Could not update the singer's microphone.";
}
