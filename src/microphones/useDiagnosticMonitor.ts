import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDiagnosticMonitorDiagnostics,
  getDiagnosticMonitorStatus,
  idleDiagnosticMonitorDiagnostics,
  idleDiagnosticMonitorStatus,
  listDiagnosticOutputDevices,
  startDiagnosticMonitor,
  stopDiagnosticMonitor,
  type DiagnosticMonitorCommandError,
  type DiagnosticMonitorDiagnostics,
  type DiagnosticMonitorStatus,
  type DiagnosticOutputDevice,
} from "./diagnosticMonitor";

export const DIAGNOSTIC_MONITOR_POLL_INTERVAL_MS = 100;

export function useDiagnosticMonitor() {
  const [status, setStatus] = useState<DiagnosticMonitorStatus>(idleDiagnosticMonitorStatus);
  const [diagnostics, setDiagnostics] = useState<DiagnosticMonitorDiagnostics>(
    idleDiagnosticMonitorDiagnostics,
  );
  const [outputs, setOutputs] = useState<DiagnosticOutputDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"start" | "stop" | null>(null);
  const operationRef = useRef(0);

  const refresh = useCallback(async () => {
    const [nextStatus, nextDiagnostics, nextOutputs] = await Promise.all([
      getDiagnosticMonitorStatus(),
      getDiagnosticMonitorDiagnostics(),
      listDiagnosticOutputDevices(),
    ]);
    setStatus(nextStatus);
    setDiagnostics(nextDiagnostics);
    setOutputs(nextOutputs);
  }, []);

  const start = useCallback(
    async (request: { sourceId: string; outputDeviceId: string; gain: number }) => {
      const operation = ++operationRef.current;
      setPendingAction("start");
      setError(null);
      try {
        const next = await startDiagnosticMonitor(request);
        if (operationRef.current === operation) {
          setStatus(next);
          setDiagnostics(await getDiagnosticMonitorDiagnostics());
        }
      } catch (caught) {
        if (operationRef.current === operation) {
          const error = caught as Partial<DiagnosticMonitorCommandError>;
          setError(error.message ?? "Could not start diagnostic audio monitoring.");
        }
      } finally {
        if (operationRef.current === operation) {
          setPendingAction(null);
        }
      }
    },
    [],
  );

  const stop = useCallback(async () => {
    const operation = ++operationRef.current;
    setPendingAction("stop");
    setError(null);
    try {
      const next = await stopDiagnosticMonitor();
      if (operationRef.current === operation) {
        setStatus(next);
        setDiagnostics(await getDiagnosticMonitorDiagnostics());
      }
    } catch (caught) {
      if (operationRef.current === operation) {
        console.error("Could not stop diagnostic audio monitoring.", caught);
        setError("Could not stop diagnostic audio monitoring cleanly.");
      }
    } finally {
      if (operationRef.current === operation) {
        setPendingAction(null);
      }
    }
  }, []);

  useEffect(() => {
    void refresh().catch((caught: unknown) => {
      console.error("Could not load diagnostic audio monitor state.", caught);
    });
  }, [refresh]);

  useEffect(() => {
    if (status.state !== "active") {
      return;
    }
    const interval = window.setInterval(() => {
      void getDiagnosticMonitorDiagnostics()
        .then(setDiagnostics)
        .catch((caught: unknown) => {
          console.error("Could not refresh diagnostic monitor diagnostics.", caught);
        });
    }, DIAGNOSTIC_MONITOR_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [status.state]);

  useEffect(() => {
    return () => {
      operationRef.current += 1;
      if (status.state === "active") {
        void stopDiagnosticMonitor();
      }
    };
  }, [status.state]);

  return { diagnostics, error, outputs, pendingAction, refresh, start, status, stop };
}
