import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDiagnosticCaptureSnapshot,
  idleDiagnosticCapture,
  startDiagnosticCapture,
  stopDiagnosticCapture,
  type DiagnosticCaptureSnapshot,
} from "./diagnosticCapture";

export const DIAGNOSTIC_LEVEL_POLL_INTERVAL_MS = 50;

export function useDiagnosticCapture() {
  const [snapshot, setSnapshot] = useState(idleDiagnosticCapture);
  const snapshotRef = useRef(snapshot);
  const pollPendingRef = useRef(false);
  const operationRef = useRef(0);

  const publish = useCallback((next: DiagnosticCaptureSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const start = useCallback(
    async (sourceId: string) => {
      const operation = ++operationRef.current;
      publish({
        ...idleDiagnosticCapture,
        status: "starting",
        sourceId,
      });
      try {
        const next = await startDiagnosticCapture(sourceId);
        if (operationRef.current === operation) {
          publish(next);
        }
      } catch (error) {
        if (operationRef.current !== operation) {
          return;
        }
        console.error("Diagnostic microphone capture could not start.", error);
        publish({
          ...idleDiagnosticCapture,
          status: "failed",
          sourceId,
          error: "Could not start the microphone test.",
        });
      }
    },
    [publish],
  );

  const stop = useCallback(async () => {
    if (snapshotRef.current.status === "idle") {
      return;
    }
    const operation = ++operationRef.current;
    publish({ ...snapshotRef.current, status: "stopping", level: idleDiagnosticCapture.level });
    try {
      const next = await stopDiagnosticCapture();
      if (operationRef.current === operation) {
        publish(next);
      }
    } catch (error) {
      if (operationRef.current !== operation) {
        return;
      }
      console.error("Diagnostic microphone capture could not stop cleanly.", error);
      publish({
        ...snapshotRef.current,
        status: "failed",
        level: idleDiagnosticCapture.level,
        error: "Could not stop the microphone test cleanly.",
      });
    }
  }, [publish]);

  useEffect(() => {
    if (snapshot.status !== "active") {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (pollPendingRef.current) {
        return;
      }
      const operation = operationRef.current;
      const sessionId = snapshotRef.current.sessionId;
      pollPendingRef.current = true;
      void getDiagnosticCaptureSnapshot()
        .then((next) => {
          if (operationRef.current === operation && snapshotRef.current.sessionId === sessionId) {
            publish(next);
          }
        })
        .catch((error: unknown) => {
          console.error("Could not read diagnostic microphone levels.", error);
        })
        .finally(() => {
          pollPendingRef.current = false;
        });
    }, DIAGNOSTIC_LEVEL_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [publish, snapshot.status]);

  useEffect(() => {
    return () => {
      operationRef.current += 1;
      if (snapshotRef.current.status !== "idle") {
        void stopDiagnosticCapture();
      }
    };
  }, []);

  return { snapshot, start, stop };
}
