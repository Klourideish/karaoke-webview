import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSessionSingerWithMicrophone,
  createSessionSinger,
  listSessionSingers,
  removeSessionSinger,
  renameSessionSinger,
} from "./api";
import type { ParticipantCommitError, SessionSingerError, SessionSingerProjection } from "./types";

let pendingSingerList: Promise<SessionSingerProjection[]> | null = null;

function loadSessionSingers() {
  if (!pendingSingerList) {
    pendingSingerList = listSessionSingers().finally(() => {
      pendingSingerList = null;
    });
  }
  return pendingSingerList;
}

function operatorMessage(cause: unknown, fallback: string) {
  if (
    cause &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof (cause as SessionSingerError).message === "string"
  ) {
    return (cause as SessionSingerError).message;
  }
  return fallback;
}

export function useSessionSingers() {
  const [singers, setSingers] = useState<SessionSingerProjection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingSingerId, setPendingSingerId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void loadSessionSingers()
      .then((projection) => {
        if (mountedRef.current) {
          setSingers(projection);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        console.error("Session singers could not be loaded.", cause);
        if (mountedRef.current) {
          setError("Could not load singers.");
        }
      })
      .finally(() => {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const create = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    try {
      const created = await createSessionSinger();
      if (mountedRef.current) {
        setSingers((current) => [...current, created]);
      }
      return created;
    } catch (cause) {
      console.error("Session singer could not be created.", cause);
      if (mountedRef.current) {
        setError(operatorMessage(cause, "Could not add the singer."));
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setIsCreating(false);
      }
    }
  }, []);

  const rename = useCallback(async (singerId: string, displayName: string) => {
    setPendingSingerId(singerId);
    setError(null);
    try {
      const renamed = await renameSessionSinger(singerId, displayName);
      if (mountedRef.current) {
        setSingers((current) =>
          current.map((singer) => (singer.id === singerId ? renamed : singer)),
        );
      }
      return renamed;
    } catch (cause) {
      console.error("Session singer could not be renamed.", cause);
      if (mountedRef.current) {
        setError(operatorMessage(cause, "Could not rename the singer."));
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setPendingSingerId(null);
      }
    }
  }, []);

  const remove = useCallback(async (singerId: string) => {
    setPendingSingerId(singerId);
    setError(null);
    try {
      await removeSessionSinger(singerId);
      if (mountedRef.current) {
        setSingers((current) => current.filter((singer) => singer.id !== singerId));
      }
      return true;
    } catch (cause) {
      console.error("Session singer could not be removed.", cause);
      if (mountedRef.current) {
        setError(operatorMessage(cause, "Could not remove the singer."));
      }
      return false;
    } finally {
      if (mountedRef.current) {
        setPendingSingerId(null);
      }
    }
  }, []);

  const createWithMicrophone = useCallback(
    async (requestId: string, displayName: string, sourceId: string) => {
      setIsCreating(true);
      setError(null);
      try {
        const commit = await createSessionSingerWithMicrophone(requestId, displayName, sourceId);
        if (mountedRef.current) {
          setSingers((current) =>
            current.some((singer) => singer.id === commit.sessionSinger.id)
              ? current
              : [...current, commit.sessionSinger],
          );
        }
        return commit;
      } catch (cause) {
        console.error("Participant setup could not be completed.", cause);
        const message = operatorMessage(cause, "Could not create and assign the singer.");
        if (mountedRef.current) {
          setError(message);
        }
        const error = new Error(message) as Error & { reasonCode?: string };
        if (cause && typeof cause === "object" && "reasonCode" in cause) {
          error.reasonCode = (cause as ParticipantCommitError).reasonCode;
        }
        throw error;
      } finally {
        if (mountedRef.current) {
          setIsCreating(false);
        }
      }
    },
    [],
  );

  return {
    create,
    createWithMicrophone,
    error,
    isCreating,
    isLoading,
    pendingSingerId,
    remove,
    rename,
    singers,
  };
}
