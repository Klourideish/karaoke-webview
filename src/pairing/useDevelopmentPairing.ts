import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptDevelopmentPairingProposal,
  cancelDevelopmentPairingOffer,
  createDevelopmentPairingOffer,
  getDevelopmentPairingStatus,
  rejectDevelopmentPairingProposal,
} from "./api";
import type { DevelopmentPairingProjection, PairingError, PairingOfferProjection } from "./types";

const POLL_INTERVAL_MS = 500;

const idleProjection: DevelopmentPairingProjection = {
  status: {
    activeOfferId: null,
    lifecycleState: null,
    hostAddress: null,
    controlPort: null,
    expiresInSeconds: null,
    expiresAt: null,
    lifetimeSeconds: null,
    claimedClientName: null,
    claimedClientDeviceId: null,
    participantSetupTokenIssued: false,
    pendingParticipant: null,
    acceptedParticipant: null,
    lastRevokedParticipant: null,
    lastRejectionReason: null,
    lastRejectionMessage: null,
  },
  diagnostics: {
    retainedOfferCount: 0,
    offersCreated: 0,
    offersExpired: 0,
    offersCancelled: 0,
    offersConsumed: 0,
    duplicateClaims: 0,
    invalidTokens: 0,
    proposalsReceived: 0,
    acceptedParticipants: 0,
    revokedParticipants: 0,
    rejectedProposals: 0,
  },
};

export function useDevelopmentPairing({ active = true }: { active?: boolean } = {}) {
  const [projection, setProjection] = useState(idleProjection);
  const [offer, setOffer] = useState<PairingOfferProjection | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "create" | "cancel" | "accept" | "reject" | null
  >(null);
  const actionIds = useRef(new Map<string, string>());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getDevelopmentPairingStatus();
      if (!mounted.current) return;
      setProjection(next);
      if (
        next.status.lifecycleState === "expired" ||
        next.status.lifecycleState === "cancelled" ||
        next.status.lifecycleState === "accepted" ||
        next.status.lifecycleState === "rejected"
      ) {
        setOffer(null);
      }
      setRefreshError(null);
    } catch (cause) {
      if (mounted.current) {
        setRefreshError(messageFrom(cause, "Could not load pairing status."));
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!active) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [active, refresh]);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const create = useCallback(async () => {
    const requestId = requestIdFor(actionIds.current, "create");
    setPendingAction("create");
    setActionError(null);
    try {
      const nextOffer = await createDevelopmentPairingOffer(requestId);
      if (!mounted.current) return null;
      actionIds.current.delete("create");
      setOffer(nextOffer);
      setProjection((current) => ({
        diagnostics: current.diagnostics,
        status: {
          ...idleProjection.status,
          activeOfferId: nextOffer.offerId,
          lifecycleState: "displayed",
          hostAddress: nextOffer.hostAddress,
          controlPort: nextOffer.controlPort,
          expiresInSeconds: nextOffer.lifetimeSeconds,
          expiresAt: nextOffer.expiresAt,
          lifetimeSeconds: nextOffer.lifetimeSeconds,
        },
      }));
      setActionError(null);
      await refresh();
      return nextOffer;
    } catch (cause) {
      if (mounted.current) {
        setActionError(messageFrom(cause, "Could not create the pairing code."));
      }
      return null;
    } finally {
      if (mounted.current) setPendingAction(null);
    }
  }, [refresh]);

  const act = useCallback(
    async (action: "cancel" | "accept" | "reject") => {
      const offerId = projection.status.activeOfferId ?? offer?.offerId;
      if (!offerId) return null;
      const key = `${action}:${offerId}`;
      const requestId = requestIdFor(actionIds.current, key);
      setPendingAction(action);
      setActionError(null);
      try {
        const operation =
          action === "cancel"
            ? cancelDevelopmentPairingOffer
            : action === "accept"
              ? acceptDevelopmentPairingProposal
              : rejectDevelopmentPairingProposal;
        const next = await operation(requestId, offerId);
        if (!mounted.current) return null;
        actionIds.current.delete(key);
        setProjection(next);
        setOffer(null);
        setActionError(null);
        return next;
      } catch (cause) {
        if (mounted.current) {
          setActionError(messageFrom(cause, `Could not ${action} this participant.`));
        }
        return null;
      } finally {
        if (mounted.current) setPendingAction(null);
      }
    },
    [offer?.offerId, projection.status.activeOfferId],
  );

  return {
    accept: () => act("accept"),
    cancel: () => act("cancel"),
    create,
    error: actionError ?? refreshError,
    offer,
    pendingAction,
    projection,
    refresh,
    reject: () => act("reject"),
  };
}

function requestIdFor(cache: Map<string, string>, key: string) {
  const existing = cache.get(key);
  if (existing) return existing;
  const created =
    globalThis.crypto?.randomUUID?.() ?? `development-pairing-${Date.now()}-${Math.random()}`;
  cache.set(key, created);
  return created;
}

function messageFrom(cause: unknown, fallback: string) {
  if (typeof cause === "string") {
    try {
      return messageFrom(JSON.parse(cause), fallback);
    } catch {
      return cause.trim() || fallback;
    }
  }
  if (cause && typeof cause === "object") {
    const error = cause as Partial<PairingError>;
    if (error.reasonCode === "listener-not-active") {
      return "Start the insecure development listener in Developer before pairing a phone.";
    }
    if (typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}
