import { invoke } from "@tauri-apps/api/core";
import type {
  DevelopmentProtocolProjection,
  DevelopmentProtocolStatus,
  DevelopmentStreamDiagnostics,
  LocalMicrophoneSource,
} from "./types";

export type StartDevelopmentProtocolRequest = {
  tcpPort?: number;
  udpPort?: number;
  bindAddress?: string;
};

export function startDevelopmentProtocolListener(
  request: StartDevelopmentProtocolRequest = {},
): Promise<DevelopmentProtocolProjection> {
  return invoke<DevelopmentProtocolProjection>("start_development_protocol_listener", { request });
}

export function stopDevelopmentProtocolListener(): Promise<DevelopmentProtocolProjection> {
  return invoke<DevelopmentProtocolProjection>("stop_development_protocol_listener");
}

export function getDevelopmentProtocolStatus(): Promise<DevelopmentProtocolStatus> {
  return invoke<DevelopmentProtocolStatus>("get_development_protocol_status");
}

export function listDevelopmentNetworkSources(): Promise<LocalMicrophoneSource[]> {
  return invoke<LocalMicrophoneSource[]>("list_development_network_sources");
}

export function getDevelopmentStreamDiagnostics(): Promise<DevelopmentStreamDiagnostics> {
  return invoke<DevelopmentStreamDiagnostics>("get_development_stream_diagnostics");
}
