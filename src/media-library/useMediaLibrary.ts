import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chooseLibraryFolder } from "./api";
import { scanResultsMatch } from "./comparison";
import { errorToMessage } from "./errorFormatting";
import { filterSongs } from "./search";
import { loadLibraryIndexOnce, loadLibrarySettingsOnce, refreshLibrary } from "./scanCoordinator";
import type { LibraryScanResult, QueuedLibraryRefresh } from "./types";

type LibraryState = {
  restoredRootPath: string | null;
  isLoadingSettings: boolean;
  isScanning: boolean;
  scanResult: LibraryScanResult | null;
  error: string | null;
  statusMessage: string | null;
  searchTerm: string;
  isShowingCachedResult: boolean;
};

export function useMediaLibrary() {
  const [state, setState] = useState<LibraryState>({
    restoredRootPath: null,
    isLoadingSettings: true,
    isScanning: false,
    scanResult: null,
    error: null,
    statusMessage: null,
    searchTerm: "",
    isShowingCachedResult: false,
  });
  const isMountedRef = useRef(false);
  const activeRefreshRef = useRef<QueuedLibraryRefresh | null>(null);
  const queuedRefreshRef = useRef<QueuedLibraryRefresh | null>(null);
  const requestedRootRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const runRefresh = useCallback(async (rootPath: string, selectLocation = false) => {
    requestedRootRef.current = rootPath;
    if (activeRefreshRef.current) {
      const active = activeRefreshRef.current;
      if (active.rootPath !== rootPath || active.selectLocation !== selectLocation) {
        queuedRefreshRef.current = { rootPath, selectLocation };
        setState((current) => ({
          ...current,
          isScanning: true,
          statusMessage: "Refreshing library...",
          error: null,
        }));
      }
      return;
    }

    activeRefreshRef.current = { rootPath, selectLocation };
    setState((current) => ({
      ...current,
      isScanning: true,
      statusMessage: "Refreshing library...",
      error: null,
    }));

    try {
      const result = await refreshLibrary(rootPath, selectLocation);
      const queued = queuedRefreshRef.current;
      if (
        !isMountedRef.current ||
        requestedRootRef.current !== rootPath ||
        (queued && queued.rootPath !== rootPath)
      ) {
        return;
      }
      setState((current) => ({
        ...current,
        restoredRootPath: result.rootPath,
        isLoadingSettings: false,
        isScanning: false,
        scanResult: scanResultsMatch(current.scanResult, result) ? current.scanResult : result,
        isShowingCachedResult: false,
        statusMessage: null,
        searchTerm: selectLocation ? "" : current.searchTerm,
        error: null,
      }));
    } catch (error) {
      if (!isMountedRef.current || requestedRootRef.current !== rootPath) {
        return;
      }
      setState((current) => ({
        ...current,
        isLoadingSettings: false,
        isScanning: false,
        statusMessage: null,
        error: errorToMessage(error, "The library could not be refreshed."),
      }));
    } finally {
      if (
        activeRefreshRef.current?.rootPath === rootPath &&
        activeRefreshRef.current.selectLocation === selectLocation
      ) {
        activeRefreshRef.current = null;
      }
      const queued = queuedRefreshRef.current;
      if (queued && isMountedRef.current) {
        queuedRefreshRef.current = null;
        void runRefresh(queued.rootPath, queued.selectLocation);
      }
    }
  }, []);

  const loadCacheThenRefresh = useCallback(
    async (rootPath: string) => {
      requestedRootRef.current = rootPath;
      setState((current) => ({
        ...current,
        restoredRootPath: rootPath,
        isLoadingSettings: false,
        statusMessage: "Refreshing library...",
        error: null,
      }));

      try {
        const cached = await loadLibraryIndexOnce(rootPath);
        if (!isMountedRef.current || requestedRootRef.current !== rootPath) return;
        if (cached.scanResult) {
          setState((current) => ({
            ...current,
            scanResult: cached.scanResult,
            isShowingCachedResult: true,
          }));
        }
      } catch (error) {
        if (isMountedRef.current && requestedRootRef.current === rootPath) {
          setState((current) => ({
            ...current,
            error: errorToMessage(error, "Could not load the saved library."),
          }));
        }
      }

      await runRefresh(rootPath);
    },
    [runRefresh],
  );

  useEffect(() => {
    let cancelled = false;
    async function restoreSettings() {
      try {
        const settings = await loadLibrarySettingsOnce();
        if (cancelled || !isMountedRef.current) return;
        setState((current) => ({
          ...current,
          restoredRootPath: settings.libraryRoot,
          isLoadingSettings: false,
          error: null,
        }));
        if (settings.libraryRoot) {
          await loadCacheThenRefresh(settings.libraryRoot);
        }
      } catch (error) {
        if (!cancelled && isMountedRef.current) {
          setState((current) => ({
            ...current,
            isLoadingSettings: false,
            error: errorToMessage(error, "Could not restore the saved library location."),
          }));
        }
      }
    }
    void restoreSettings();
    return () => {
      cancelled = true;
    };
  }, [loadCacheThenRefresh]);

  const chooseFolder = useCallback(async () => {
    try {
      const selectedFolder = await chooseLibraryFolder();
      if (selectedFolder) await runRefresh(selectedFolder, true);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: errorToMessage(error, "Could not choose the library location."),
      }));
    }
  }, [runRefresh]);

  const rescan = useCallback(async () => {
    if (state.restoredRootPath && !state.isScanning) {
      await runRefresh(state.restoredRootPath);
    }
  }, [runRefresh, state.isScanning, state.restoredRootPath]);

  const setSearchTerm = useCallback((searchTerm: string) => {
    setState((current) => ({ ...current, searchTerm }));
  }, []);

  const filteredSongs = useMemo(
    () => filterSongs(state.scanResult?.songs ?? [], state.searchTerm),
    [state.scanResult?.songs, state.searchTerm],
  );

  return { ...state, filteredSongs, chooseFolder, rescan, setSearchTerm };
}
