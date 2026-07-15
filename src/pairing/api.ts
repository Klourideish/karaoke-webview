import { invoke } from "@tauri-apps/api/core";
import type {
  DevelopmentPairingDiagnostics,
  DevelopmentPairingProjection,
  PairingOfferProjection,
} from "./types";

export function createDevelopmentPairingOffer(requestId: string) {
  return invoke<PairingOfferProjection>("create_development_pairing_offer", {
    request: { requestId },
  });
}

export function getDevelopmentPairingStatus() {
  return invoke<DevelopmentPairingProjection>("get_development_pairing_status");
}

export function getDevelopmentPairingDiagnostics() {
  return invoke<DevelopmentPairingDiagnostics>("get_development_pairing_diagnostics");
}

export function cancelDevelopmentPairingOffer(requestId: string, offerId: string) {
  return invoke<DevelopmentPairingProjection>("cancel_development_pairing_offer", {
    request: { requestId, offerId },
  });
}

export function acceptDevelopmentPairingProposal(requestId: string, offerId: string) {
  return invoke<DevelopmentPairingProjection>("accept_development_pairing_proposal", {
    request: { requestId, offerId },
  });
}

export function rejectDevelopmentPairingProposal(requestId: string, offerId: string) {
  return invoke<DevelopmentPairingProjection>("reject_development_pairing_proposal", {
    request: { requestId, offerId },
  });
}
