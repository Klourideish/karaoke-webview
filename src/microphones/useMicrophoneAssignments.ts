import { useCallback, useEffect, useRef, useState } from "react";
import type { Singer } from "../app/SingerBar";
import { assignMicrophoneChannel, syncSessionSingers, unassignMicrophoneChannel } from "./api";
import type { MicrophoneAssignment } from "./types";

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
  const [isLoading, setIsLoading] = useState(true);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const singerKey = singers.map((singer) => singer.id).join("\u0000");

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current;
    const singerIds = singerKey ? singerKey.split("\u0000") : [];
    setIsLoading(true);
    void synchronizeSingers(singerIds)
      .then((next) => {
        if (requestVersionRef.current === requestVersion) {
          setAssignments(next);
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

  return { assign, assignments, error, isLoading, pendingChannelId, unassign };
}
