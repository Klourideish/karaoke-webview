import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const FULLSCREEN_ERROR = "Fullscreen could not be changed. Try again.";
const FULLSCREEN_UNAVAILABLE_ERROR = "Fullscreen controls are unavailable.";

export type FullscreenWindowController = {
  error: string | null;
  isFullscreen: boolean | null;
  isPending: boolean;
  toggle: () => Promise<void>;
};

export function useFullscreenWindow(): FullscreenWindowController {
  const [isFullscreen, setIsFullscreen] = useState<boolean | null>(null);
  const [isPending, setIsPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fullscreenRef = useRef<boolean | null>(null);
  const pendingRef = useRef(true);
  const mountedRef = useRef(false);
  const appWindowRef = useRef(getCurrentWindow());

  const projectFullscreen = useCallback((value: boolean) => {
    fullscreenRef.current = value;
    if (mountedRef.current) setIsFullscreen(value);
  }, []);

  const requestFullscreen = useCallback(
    async (nextFullscreen: boolean) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      if (mountedRef.current) {
        setIsPending(true);
        setError(null);
      }

      try {
        await appWindowRef.current.setFullscreen(nextFullscreen);
        projectFullscreen(await appWindowRef.current.isFullscreen());
      } catch {
        try {
          projectFullscreen(await appWindowRef.current.isFullscreen());
        } catch {
          // Preserve the last verified projection when the native state cannot be read.
        }
        if (mountedRef.current) setError(FULLSCREEN_ERROR);
      } finally {
        pendingRef.current = false;
        if (mountedRef.current) setIsPending(false);
      }
    },
    [projectFullscreen],
  );

  const toggle = useCallback(async () => {
    if (fullscreenRef.current === null) return;
    await requestFullscreen(!fullscreenRef.current);
  }, [requestFullscreen]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    void appWindowRef.current
      .isFullscreen()
      .then((value) => {
        if (!cancelled) {
          projectFullscreen(value);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError(FULLSCREEN_UNAVAILABLE_ERROR);
      })
      .finally(() => {
        if (!cancelled) {
          pendingRef.current = false;
          setIsPending(false);
        }
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [projectFullscreen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || pendingRef.current) return;

      if (event.key === "F11") {
        event.preventDefault();
        void toggle();
        return;
      }

      if (event.key === "Escape" && fullscreenRef.current === true) {
        event.preventDefault();
        event.stopPropagation();
        void requestFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [requestFullscreen, toggle]);

  return { error, isFullscreen, isPending, toggle };
}
