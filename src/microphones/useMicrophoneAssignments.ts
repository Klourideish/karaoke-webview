import { useCallback, useEffect, useRef, useState } from "react";
import type { Singer } from "../app/SingerBar";
import {
  assignMicrophoneChannel,
  autoAssignMicrophoneChannel,
  clearMicrophoneWaitingState,
  listMicrophoneAssignments,
  listMicrophoneWaitingStates,
  unassignMicrophoneChannel,
} from "./api";
import type { MicrophoneAssignment, MicrophoneWaitingState } from "./types";

export function useMicrophoneAssignments(singers: readonly Singer[]) {
  const [assignments, setAssignments] = useState<MicrophoneAssignment[]>([]);
  const [waitingStates, setWaitingStates] = useState<MicrophoneWaitingState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [pendingSingerId, setPendingSingerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const singerKey = singers.map((singer) => singer.id).join("\u0000");

  const refresh = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;
    setIsLoading(true);
    try {
      const nextAssignments = await listMicrophoneAssignments();
      const nextWaitingStates = await listMicrophoneWaitingStates();
      if (requestVersionRef.current === requestVersion) {
        setAssignments(nextAssignments);
        setWaitingStates(nextWaitingStates);
        setError(null);
      }
    } catch (cause) {
      console.error("Microphone assignments could not be loaded.", cause);
      if (requestVersionRef.current === requestVersion) {
        setError("Could not load microphone assignments.");
      }
    } finally {
      if (requestVersionRef.current === requestVersion) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [refresh, singerKey]);

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
    refresh,
    unassign,
    waitingStates,
  };
}
