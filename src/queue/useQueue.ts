import { useCallback, useEffect, useRef, useState } from "react";
import {
  addSongToQueue,
  getQueueProjection,
  listenForQueueProjection,
  moveQueueEntry,
  pauseQueueProgression,
  removeQueueEntry,
  removeQueueVote,
  resumeQueueProgression,
  retryFailedQueueEntry,
  skipCurrentQueueEntry,
  voteForQueueEntry,
} from "./api";
import type { QueueProjection } from "./types";

const POLL_INTERVAL_MS = 500;

export const idleQueueProjection: QueueProjection = {
  revision: 0,
  current: null,
  queued: [],
  failed: [],
  progressionPaused: false,
  diagnostics: {
    activeQueueCount: 0,
    currentEntryId: null,
    linkedPerformanceId: null,
    progressionPaused: false,
    lastTransition: null,
    lastFailure: null,
    workerFailure: null,
    idempotencyHitCount: 0,
    idempotencyConflictCount: 0,
  },
};

export function useQueue({ active = true }: { active?: boolean } = {}) {
  const projectionRef = useRef(idleQueueProjection);
  const [projection, setProjection] = useState(idleQueueProjection);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const actionIds = useRef(new Map<string, string>());
  const mounted = useRef(true);

  const accept = useCallback((next: QueueProjection) => {
    if (!isQueueProjection(next) || next.revision < projectionRef.current.revision) return;
    projectionRef.current = next;
    setProjection(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await getQueueProjection();
      if (!mounted.current) return;
      accept(next);
      setRefreshError(null);
    } catch (cause) {
      if (mounted.current) setRefreshError(errorMessage(cause));
    }
  }, [accept]);

  useEffect(() => {
    mounted.current = true;
    if (!active) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenForQueueProjection((next) => {
      if (!disposed) accept(next);
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    });
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      mounted.current = false;
      unlisten?.();
      window.clearInterval(interval);
    };
  }, [active, accept, refresh]);

  const mutate = useCallback(
    async (
      key: string,
      action: string,
      operation: (requestId: string) => Promise<QueueProjection>,
    ) => {
      const requestId = requestIdFor(actionIds.current, key);
      setPendingAction(action);
      setActionError(null);
      try {
        const next = await operation(requestId);
        if (mounted.current) {
          actionIds.current.delete(key);
          accept(next);
        }
        return true;
      } catch (cause) {
        if (mounted.current) setActionError(errorMessage(cause));
        return false;
      } finally {
        if (mounted.current) setPendingAction(null);
      }
    },
    [accept],
  );

  const addSong = useCallback(
    (songId: string, singerId: string) =>
      mutate(`add:${songId}:${singerId}`, "add", (requestId) =>
        addSongToQueue(requestId, songId, singerId),
      ),
    [mutate],
  );
  const removeEntry = useCallback(
    (entryId: string) =>
      mutate(`remove:${entryId}`, "remove", (requestId) => removeQueueEntry(requestId, entryId)),
    [mutate],
  );
  const moveEntry = useCallback(
    (entryId: string, targetIndex: number) =>
      mutate(`move:${entryId}:${targetIndex}`, "move", (requestId) =>
        moveQueueEntry(requestId, entryId, targetIndex),
      ),
    [mutate],
  );
  const voteForEntry = useCallback(
    (entryId: string, singerId: string) =>
      mutate(`vote:${entryId}:${singerId}`, "vote", (requestId) =>
        voteForQueueEntry(requestId, entryId, singerId),
      ),
    [mutate],
  );
  const removeVote = useCallback(
    (entryId: string, singerId: string) =>
      mutate(`unvote:${entryId}:${singerId}`, "unvote", (requestId) =>
        removeQueueVote(requestId, entryId, singerId),
      ),
    [mutate],
  );
  const pauseProgression = useCallback(
    () => mutate("pause", "pause", pauseQueueProgression),
    [mutate],
  );
  const resumeProgression = useCallback(
    () => mutate("resume", "resume", resumeQueueProgression),
    [mutate],
  );
  const skipCurrent = useCallback(() => mutate("skip", "skip", skipCurrentQueueEntry), [mutate]);
  const retryFailed = useCallback(
    (entryId: string) =>
      mutate(`retry:${entryId}`, "retry", (requestId) => retryFailedQueueEntry(requestId, entryId)),
    [mutate],
  );

  return {
    projection,
    error: actionError ?? refreshError,
    pendingAction,
    addSong,
    removeEntry,
    moveEntry,
    voteForEntry,
    removeVote,
    pauseProgression,
    resumeProgression,
    skipCurrent,
    retryFailed,
    refresh,
  };
}

function requestIdFor(cache: Map<string, string>, key: string) {
  const existing = cache.get(key);
  if (existing) return existing;
  const created =
    globalThis.crypto?.randomUUID?.() ?? `queue-action-${Date.now()}-${Math.random()}`;
  cache.set(key, created);
  return created;
}

function isQueueProjection(value: unknown): value is QueueProjection {
  if (!value || typeof value !== "object") return false;
  const projection = value as Partial<QueueProjection>;
  return (
    typeof projection.revision === "number" &&
    Array.isArray(projection.queued) &&
    Array.isArray(projection.failed) &&
    typeof projection.progressionPaused === "boolean" &&
    projection.diagnostics !== null &&
    typeof projection.diagnostics === "object"
  );
}

function errorMessage(cause: unknown) {
  if (cause && typeof cause === "object" && "message" in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "The Host could not update the Queue.";
}
