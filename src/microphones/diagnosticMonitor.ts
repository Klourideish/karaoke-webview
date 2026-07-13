import { invoke } from "@tauri-apps/api/core";

export type DiagnosticMonitorState =
  "idle" | "starting" | "active" | "stopping" | "stopped" | "failed";

export type DiagnosticOutputDevice = {
  id: string;
  displayName: string;
  isDefault: boolean;
};

export type DiagnosticMonitorStatus = {
  attemptId: string | null;
  state: DiagnosticMonitorState;
  sourceId: string | null;
  outputDeviceId: string | null;
  gain: number;
  message: string | null;
  failureReason: string | null;
};

export type DiagnosticMonitorDiagnostics = {
  queueCapacity: number;
  queueDepth: number;
  maximumQueueDepth: number;
  droppedMonitorFrames: number;
  underruns: number;
  resets: number;
  bufferedLatencyMs: number;
  inputSampleRateHz: number | null;
  outputSampleRateHz: number | null;
  inputChannels: number | null;
  outputChannels: number | null;
  gain: number;
  samplesConsumed: number;
  samplesWritten: number;
  syntheticSilenceSamples: number;
};

export type DiagnosticMonitorCommandError = {
  reason: string;
  message: string;
};

export const idleDiagnosticMonitorStatus: DiagnosticMonitorStatus = {
  attemptId: null,
  state: "idle",
  sourceId: null,
  outputDeviceId: null,
  gain: 0.25,
  message: null,
  failureReason: null,
};

export const idleDiagnosticMonitorDiagnostics: DiagnosticMonitorDiagnostics = {
  queueCapacity: 8,
  queueDepth: 0,
  maximumQueueDepth: 0,
  droppedMonitorFrames: 0,
  underruns: 0,
  resets: 0,
  bufferedLatencyMs: 0,
  inputSampleRateHz: null,
  outputSampleRateHz: null,
  inputChannels: null,
  outputChannels: null,
  gain: 0.25,
  samplesConsumed: 0,
  samplesWritten: 0,
  syntheticSilenceSamples: 0,
};

export function listDiagnosticOutputDevices(): Promise<DiagnosticOutputDevice[]> {
  return invoke<DiagnosticOutputDevice[]>("list_diagnostic_output_devices");
}

export function getDiagnosticMonitorStatus(): Promise<DiagnosticMonitorStatus> {
  return invoke<DiagnosticMonitorStatus>("get_diagnostic_monitor_status");
}

export function getDiagnosticMonitorDiagnostics(): Promise<DiagnosticMonitorDiagnostics> {
  return invoke<DiagnosticMonitorDiagnostics>("get_diagnostic_monitor_diagnostics");
}

export function startDiagnosticMonitor(request: {
  sourceId: string;
  outputDeviceId: string;
  gain: number;
}): Promise<DiagnosticMonitorStatus> {
  return invoke<DiagnosticMonitorStatus>("start_diagnostic_monitor", { request });
}

export function stopDiagnosticMonitor(): Promise<DiagnosticMonitorStatus> {
  return invoke<DiagnosticMonitorStatus>("stop_diagnostic_monitor");
}
