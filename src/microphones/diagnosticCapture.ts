import { invoke } from "@tauri-apps/api/core";

export type DiagnosticCaptureStatus = "idle" | "starting" | "active" | "stopping" | "failed";

export type MicrophoneLevelSnapshot = {
  rms: number;
  peak: number;
  clipping: boolean;
  sequence: number;
};

export type DiagnosticCaptureSnapshot = {
  status: DiagnosticCaptureStatus;
  sessionId: string | null;
  sourceId: string | null;
  channelId: string | null;
  level: MicrophoneLevelSnapshot;
  error: string | null;
};

export const idleDiagnosticCapture: DiagnosticCaptureSnapshot = {
  status: "idle",
  sessionId: null,
  sourceId: null,
  channelId: null,
  level: { rms: 0, peak: 0, clipping: false, sequence: 0 },
  error: null,
};

export function startDiagnosticCapture(sourceId: string): Promise<DiagnosticCaptureSnapshot> {
  return invoke<DiagnosticCaptureSnapshot>("start_diagnostic_capture", { sourceId });
}

export function stopDiagnosticCapture(): Promise<DiagnosticCaptureSnapshot> {
  return invoke<DiagnosticCaptureSnapshot>("stop_diagnostic_capture");
}

export function getDiagnosticCaptureSnapshot(): Promise<DiagnosticCaptureSnapshot> {
  return invoke<DiagnosticCaptureSnapshot>("diagnostic_capture_snapshot");
}
