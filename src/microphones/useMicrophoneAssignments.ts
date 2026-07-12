import { useCallback, useEffect, useRef, useState } from "react";
import type { Singer } from "../app/SingerBar";
import {
  assignMicrophoneChannel,
  autoAssignMicrophoneChannel,
  clearMicrophoneWaitingState,
  listMicrophoneWaitingStates,
  syncSessionSingers,
  unassignMicrophoneChannel,
} from "./api";
import type { MicrophoneAssignment, MicrophoneWaitingState } from "./types";

let pendingSingerSync: { key: string; promise: Promise<MicrophoneAssignment[]> } | null = null;

function synchronizeSingers(singerIds: string[]) {
  const key = singerIds.join("\u0000");
  if (!pendingSingerSync || pendingSingerSync.key !== key) {
    const promise = syncSessionSingers(singerIds).finally(() => {
      if (pendingSingerSync?.promise === promise) {
        pendingSingerSync = null;
      }
    });
    pendingSingerSync = { key, promise };
  }
  return pendingSingerSync.promise;
}

export function useMicrophoneAssignments(singers: readonly Singer[]) {
  const [assignments, setAssignments] = useState<MicrophoneAssignment[]>([]);
  const [waitingStates, setWaitingStates] = useState<MicrophoneWaitingState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [pendingSingerId, setPendingSingerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const singerKey = singers.map((singer) => singer.id).join("\u0000");

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current;
    const singerIds = singerKey ? singerKey.split("\u0000") : [];
    setIsLoading(true);
    void synchronizeSingers(singerIds)
      .then(async (nextAssignments) => ({
        assignments: nextAssignments,
        waitingStates: await listMicrophoneWaitingStates(),
      }))
      .then((next) => {
        if (requestVersionRef.current === requestVersion) {
          setAssignments(next.assignments);
          setWaitingStates(next.waitingStates);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        console.error("Session singer identities could not be synchronized.", cause);
        if (requestVersionRef.current === requestVersion) {
          setError("Could not load microphone assignments.");
        }
      })
      .finally(() => {
        if (requestVersionRef.current === requestVersion) {
          setIsLoading(false);
        }
      });
    return () => {
      requestVersionRef.current += 1;
    };
  }, [singerKey]);

  const assign = useCallback(async (channelId: string, singerId: string) => {
    const requestVersion = ++requestVersionRef.current;
    setPendingChannelId(channelId);
    setError(null);
    try {
      const next = await assignMicrophoneChannel(channelId, singerId);
      if (requestVersionRef.current === requestVersion) {
        setAssignments((current) => [
          ...current.filter(
            (assignment) => assignment.channelId !== channelId && assignment.singerId !== singerId,
          ),
          next,
        ]);
        setWaitingStates((current) => current.filter((waiting) => waiting.singerId !== singerId));
      }
    } catch (cause) {
      console.error("Microphone channel could not be assigned.", cause);
      if (requestVersionRef.current === requestVersion) {
        setError("Could not assign the microphone channel.");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingChannelId(null);
      }
    }
  }, []);

  const autoAssign = useCallback(async (singerId: string) => {
    const requestVersion = ++requestVersionRef.current;
    setPendingSingerId(singerId);
    setError(null);
    try {
      const result = await autoAssignMicrophoneChannel(singerId);
      if (requestVersionRef.current === requestVersion) {
        if (result.assignment) {
          const assignment = result.assignment;
          setAssignments((current) => [
            ...current.filter(
              (candidate) =>
                candidate.channelId !== assignment.channelId && candidate.singerId !== singerId,
            ),
            assignment,
          ]);
        }
        setWaitingStates((current) => [
          ...current.filter((waiting) => waiting.singerId !== singerId),
          ...(result.waitingState ? [result.waitingState] : []),
        ]);
      }
      return result;
    } catch (cause) {
      console.error("Microphone could not be assigned automatically.", cause);
      if (requestVersionRef.current === requestVersion) {
        setError("Could not automatically assign a microphone.");
      }
      return null;
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingSingerId(null);
      }
    }
  }, []);

  const clearWaiting = useCallback(async (singerId: string) => {
    const requestVersion = ++requestVersionRef.current;
    setPendingSingerId(singerId);
    setError(null);
    try {
      await clearMicrophoneWaitingState(singerId);
      if (requestVersionRef.current === requestVersion) {
        setWaitingStates((current) => current.filter((waiting) => waiting.singerId !== singerId));
      }
    } catch (cause) {
      console.error("Microphone waiting state could not be cleared.", cause);
      if (requestVersionRef.current === requestVersion) {
        setError("Could not clear the microphone waiting state.");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingSingerId(null);
      }
    }
  }, []);

  const unassign = useCallback(async (channelId: string) => {
    const requestVersion = ++requestVersionRef.current;
    setPendingChannelId(channelId);
    setError(null);
    try {
      await unassignMicrophoneChannel(channelId);
      if (requestVersionRef.current === requestVersion) {
        setAssignments((current) =>
          current.filter((assignment) => assignment.channelId !== channelId),
        );
      }
    } catch (cause) {
      console.error("Microphone channel could not be unassigned.", cause);
      if (requestVersionRef.current === requestVersion) {
        setError("Could not unassign the microphone channel.");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setPendingChannelId(null);
      }
    }
  }, []);

  return {
    assign,
    assignments,
    autoAssign,
    clearWaiting,
    error,
    isLoading,
    pendingChannelId,
    pendingSingerId,
    unassign,
    waitingStates,
  };
}
