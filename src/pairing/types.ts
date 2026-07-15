export type PairingOfferState =
  | "created"
  | "displayed"
  | "claimed"
  | "awaiting-participant-setup"
  | "awaiting-operator-approval"
  | "accepted"
  | "rejected"
  | "expired"
  | "cancelled";

export type PairingErrorCode =
  | "unsupported-profile-version"
  | "offer-not-found"
  | "offer-expired"
  | "offer-cancelled"
  | "offer-already-claimed"
  | "offer-already-used"
  | "offer-already-active"
  | "invalid-token"
  | "invalid-participant-setup-token"
  | "invalid-display-name"
  | "display-name-too-long"
  | "display-name-empty"
  | "display-name-control-characters"
  | "duplicate-display-name-not-allowed"
  | "session-capacity-reached"
  | "self-registration-disabled"
  | "operator-approval-required"
  | "client-device-rejected"
  | "network-source-ineligible"
  | "target-singer-not-found"
  | "target-singer-already-linked"
  | "policy-rejected"
  | "malformed-json"
  | "unknown-message-type"
  | "missing-required-field"
  | "invalid-field"
  | "invalid-request"
  | "request-id-conflict"
  | "invalid-state"
  | "listener-not-active"
  | "unreachable-host-address"
  | "internal-error";

export type PairingError = {
  reasonCode: PairingErrorCode;
  message: string;
};

export type PairingOfferProjection = {
  profileVersion: 0;
  offerId: string;
  hostDisplayName: string;
  hostAddress: string;
  controlPort: number;
  pairingToken: string;
  expiresAt: string;
  lifetimeSeconds: number;
  pairingScope: { kind: "generic" };
  qrPayload: string;
};

export type PendingParticipantProjection = {
  requestId: string;
  clientDeviceId: string;
  clientName: string;
  localParticipantProfileId: string;
  preferredDisplayName: string;
  previousHostParticipantReference: string | null;
};

export type AcceptedParticipantProjection = {
  status: "accepted";
  hostDisplayName: string;
  sessionSingerId: string;
  acceptedDisplayName: string;
  microphone: {
    state: "ready" | "unassigned" | "waiting" | "needs-attention" | "disconnected";
    message: string;
  };
  queuedSongCount: number;
  nextUp: { state: "unknown" | "not-next" | "next" | "current" };
};

export type RevokedParticipantProjection = {
  sessionSingerId: string;
  acceptedDisplayName: string;
  reasonCode: string;
  message: string;
};

export type DevelopmentPairingStatus = {
  activeOfferId: string | null;
  lifecycleState: PairingOfferState | null;
  hostAddress: string | null;
  controlPort: number | null;
  expiresInSeconds: number | null;
  expiresAt: string | null;
  lifetimeSeconds: number | null;
  claimedClientName: string | null;
  claimedClientDeviceId: string | null;
  participantSetupTokenIssued: boolean;
  pendingParticipant: PendingParticipantProjection | null;
  acceptedParticipant: AcceptedParticipantProjection | null;
  lastRevokedParticipant: RevokedParticipantProjection | null;
  lastRejectionReason: PairingErrorCode | null;
  lastRejectionMessage: string | null;
};

export type DevelopmentPairingDiagnostics = {
  retainedOfferCount: number;
  offersCreated: number;
  offersExpired: number;
  offersCancelled: number;
  offersConsumed: number;
  duplicateClaims: number;
  invalidTokens: number;
  proposalsReceived: number;
  acceptedParticipants: number;
  revokedParticipants: number;
  rejectedProposals: number;
};

export type DevelopmentPairingProjection = {
  status: DevelopmentPairingStatus;
  diagnostics: DevelopmentPairingDiagnostics;
};
