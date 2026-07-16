import { invoke } from "@tauri-apps/api/core";
import type {
  DevelopmentProtocolProjection,
  DevelopmentProtocolStatus,
  DevelopmentStreamDiagnostics,
  LocalMicrophoneSource,
  PhonePairingListenerProjection,
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

export function startListenerForPhonePairing(): Promise<PhonePairingListenerProjection> {
  return invoke<PhonePairingListenerProjection>("start_listener_for_phone_pairing");
}

export function selectPhonePairingListenerAddress(
  candidateId: string,
): Promise<PhonePairingListenerProjection> {
  return invoke<PhonePairingListenerProjection>("select_phone_pairing_listener_address", {
    request: { candidateId },
  });
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
