import { useState } from "react";
import type { ParticipantCommitProjection } from "../session-singers/types";
import { displayNameHint, normalizeDisplayName, type SyncStep } from "./types";

export function usePhysicalParticipantSetup({
  onCommit,
  onSuccess,
}: {
  onCommit: (
    requestId: string,
    displayName: string,
    sourceId: string,
  ) => Promise<ParticipantCommitProjection>;
  onSuccess: (result: ParticipantCommitProjection) => void;
}) {
  const [step, setStep] = useState<SyncStep>("choose-method");
  const [sourceId, setSourceIdState] = useState("");
  const [displayName, setDisplayNameState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  function setSourceId(value: string) {
    setSourceIdState(value);
    setRequestId(null);
    setError(null);
  }

  function setDisplayName(value: string) {
    setDisplayNameState(value);
    setRequestId(null);
    setError(null);
  }

  function nextFromName() {
    const hint = displayNameHint(displayName);
    if (hint) {
      setError(hint);
      return;
    }
    setDisplayNameState(normalizeDisplayName(displayName));
    setError(null);
    setStep("confirm");
  }

  function back() {
    setError(null);
    if (step === "choose-microphone") {
      setStep("choose-method");
    } else if (step === "enter-name") {
      setStep("choose-microphone");
    } else if (step === "confirm" || step === "failed") {
      setStep("enter-name");
    }
  }

  async function submit() {
    if (!sourceId || displayNameHint(displayName)) {
      setError("Check the singer name and microphone before continuing.");
      return;
    }
    const operationId = requestId ?? createRequestId();
    setRequestId(operationId);
    setStep("submitting");
    setError(null);
    try {
      const result = await onCommit(operationId, normalizeDisplayName(displayName), sourceId);
      onSuccess(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete participant setup.");
      setStep("failed");
    }
  }

  return {
    back,
    displayName,
    error,
    nextFromName,
    selectPhysical: () => setStep("choose-microphone"),
    setDisplayName,
    setSourceId,
    sourceId,
    step,
    submit,
    toName: () => {
      if (sourceId) {
        setStep("enter-name");
      }
    },
  };
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `participant-${Date.now()}-${Math.random()}`;
}
