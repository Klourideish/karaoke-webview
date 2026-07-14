import type { SessionSingerId } from "../host-domain/types";

export type SessionSingerProjection = {
  id: SessionSingerId;
  displayName: string;
  createdOrder: number;
};

export type SessionSingerErrorCode =
  | "display-name-empty"
  | "display-name-too-long"
  | "display-name-control-characters"
  | "singer-not-found"
  | "singer-in-use"
  | "invalid-state"
  | "internal-error";

export type SessionSingerError = {
  reasonCode: SessionSingerErrorCode;
  message: string;
};

export type ParticipantCommitProjection = {
  sessionSinger: SessionSingerProjection;
  microphoneState: "ready";
  sourceDisplayName: string;
  assignmentSucceeded: boolean;
};

export type ParticipantCommitErrorCode =
  | "invalid-request"
  | "request-id-conflict"
  | "singer-not-found"
  | "invalid-display-name"
  | "source-unavailable"
  | "source-ineligible"
  | "assignment-conflict"
  | "internal-error";

export type ParticipantCommitError = {
  reasonCode: ParticipantCommitErrorCode;
  message: string;
};

export type ParticipantCommitDiagnosticProjection = {
  requestId: string | null;
  outcome: "none" | "success" | "failure";
  singerName: string | null;
  sourceDisplayName: string | null;
  microphoneState: "ready" | null;
  rollbackOccurred: boolean;
  failureReason: ParticipantCommitErrorCode | null;
  failureMessage: string | null;
};
