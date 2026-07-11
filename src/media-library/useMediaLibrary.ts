import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chooseLibraryFolder, clearLibraryIndex, saveLibraryIndex, saveLibraryRoot } from "./api";
import { scanResultsMatch } from "./comparison";
import { errorToMessage } from "./errorFormatting";
import { filterSongs } from "./search";
import { loadLibraryIndexOnce, loadLibrarySettingsOnce, scanLibrary } from "./scanCoordinator";
import type { LibraryScanResult, QueuedScan, QueuedScanOptions } from "./types";

type LibraryState = {
  restoredRootPath: string | null;
  isLoadingSettings: boolean;
  isScanning: boolean;
  scanResult: LibraryScanResult | null;
  error: string | null;
  statusMessage: string | null;
  searchTerm: string;
  isShowingCachedResult: boolean;
  isRebuildingIndex: boolean;
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
    isRebuildingIndex: false,
  });
  const isMountedRef = useRef(false);
  const activeScanRootRef = useRef<string | null>(null);
  const queuedScanRef = useRef<QueuedScan | null>(null);
  const requestedRootRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const runScan = useCallback(async (rootPath: string, options?: QueuedScanOptions) => {
    requestedRootRef.current = rootPath;
    if (activeScanRootRef.current) {
      if (activeScanRootRef.current !== rootPath) {
        queuedScanRef.current = {
          rootPath,
          force: options?.force ?? false,
          rebuild: options?.rebuild ?? false,
        };
        setState((currentState) => ({
          ...currentState,
          restoredRootPath: rootPath,
          isScanning: true,
          isRebuildingIndex: options?.rebuild ?? false,
          statusMessage: options?.rebuild
            ? "Rebuilding library index..."
            : "Checking library for changes...",
          error: null,
        }));
      }
      return;
    }

    activeScanRootRef.current = rootPath;
    setState((currentState) => ({
      ...currentState,
      restoredRootPath: rootPath,
      isScanning: true,
      isRebuildingIndex: options?.rebuild ?? false,
      statusMessage: currentState.scanResult
        ? currentState.isShowingCachedResult
          ? "Showing saved library · checking for changes..."
          : "Checking library for changes..."
        : options?.rebuild
          ? "Rebuilding library index..."
          : "Checking library for changes...",
      error: null,
    }));

    try {
      const scanResult = await scanLibrary(rootPath, options?.force ?? false);
      const queuedScan = queuedScanRef.current;
      if (
        !isCurrentRoot(rootPath) ||
        requestedRootRef.current !== rootPath ||
        (queuedScan && queuedScan.rootPath !== rootPath)
      ) {
        return;
      }
      setState((currentState) => ({
        ...currentState,
        restoredRootPath: rootPath,
        isLoadingSettings: false,
        scanResult: scanResultsMatch(currentState.scanResult, scanResult)
          ? currentState.scanResult
          : scanResult,
        isScanning: false,
        isShowingCachedResult: false,
        isRebuildingIndex: false,
        statusMessage: scanResultsMatch(currentState.scanResult, scanResult)
          ? "Library up to date"
          : "Library updated",
        error: null,
      }));

      if (requestedRootRef.current === rootPath) {
        try {
          await saveLibraryIndex(scanResult);
        } catch (error) {
          if (requestedRootRef.current === rootPath && isMountedRef.current) {
            setState((currentState) => ({
              ...currentState,
              error: errorToMessage(error, "Could not save the library index."),
            }));
          }
        }
      }
    } catch (error) {
      const queuedScan = queuedScanRef.current;
      if (
        !isCurrentRoot(rootPath) ||
        requestedRootRef.current !== rootPath ||
        (queuedScan && queuedScan.rootPath !== rootPath)
      ) {
        return;
      }
      setState((currentState) => ({
        ...currentState,
        restoredRootPath: rootPath,
        isLoadingSettings: false,
        isScanning: false,
        isRebuildingIndex: false,
        statusMessage: currentState.scanResult
          ? "Library check failed · showing last known results"
          : null,
        error: errorToMessage(error, "The library scan failed."),
      }));
    } finally {
      if (activeScanRootRef.current === rootPath) {
        activeScanRootRef.current = null;
      }

      const queuedScan = queuedScanRef.current;
      if (queuedScan && isMountedRef.current) {
        queuedScanRef.current = null;
        void runScan(queuedScan.rootPath, {
          force: queuedScan.force,
          rebuild: queuedScan.rebuild,
        });
      }
    }
  }, []);

  const loadCacheThenScan = useCallback(
    async (rootPath: string, options?: { force?: boolean }) => {
      requestedRootRef.current = rootPath;
      setState((currentState) => ({
        ...currentState,
        restoredRootPath: rootPath,
        isLoadingSettings: false,
        statusMessage: "Checking library for changes...",
        error: null,
      }));

      try {
        const indexLoadResult = await loadLibraryIndexOnce(rootPath);
        if (!isCurrentRoot(rootPath) || requestedRootRef.current !== rootPath) {
          return;
        }

        if (indexLoadResult.scanResult) {
          setState((currentState) => ({
            ...currentState,
            restoredRootPath: rootPath,
            scanResult: indexLoadResult.scanResult,
            isShowingCachedResult: true,
            isLoadingSettings: false,
            statusMessage: "Showing saved library · checking for changes...",
            error: null,
          }));
        } else if (indexLoadResult.message) {
          setState((currentState) => ({
            ...currentState,
            statusMessage: indexLoadResult.message,
          }));
        }
      } catch (error) {
        if (!isCurrentRoot(rootPath) || requestedRootRef.current !== rootPath) {
          return;
        }
        setState((currentState) => ({
          ...currentState,
          error: errorToMessage(error, "Could not load the saved library index."),
        }));
      }

      await runScan(rootPath, { force: options?.force ?? false });
    },
    [runScan],
  );

  useEffect(() => {
    let cancelled = false;

    async function restoreSettings() {
      try {
        const settings = await loadLibrarySettingsOnce();
        if (cancelled || !isMountedRef.current) {
          return;
        }

        setState((currentState) => ({
          ...currentState,
          restoredRootPath: settings.libraryRoot,
          isLoadingSettings: false,
          error: null,
        }));

        if (settings.libraryRoot) {
          await loadCacheThenScan(settings.libraryRoot);
        }
      } catch (error) {
        if (cancelled || !isMountedRef.current) {
          return;
        }
        setState((currentState) => ({
          ...currentState,
          isLoadingSettings: false,
          error: errorToMessage(error, "Could not restore the saved library folder."),
        }));
      }
    }

    void restoreSettings();

    return () => {
      cancelled = true;
    };
  }, [loadCacheThenScan]);

  const chooseFolder = useCallback(async () => {
    try {
      const selectedFolder = await chooseLibraryFolder();
      if (!selectedFolder) {
        return;
      }

      const settings = await saveLibraryRoot(selectedFolder);
      const rootPath = settings.libraryRoot ?? selectedFolder;
      setState((currentState) => ({
        ...currentState,
        restoredRootPath: rootPath,
        scanResult: null,
        isShowingCachedResult: false,
        statusMessage: "Checking library for changes...",
        searchTerm: "",
        error: null,
      }));
      await loadCacheThenScan(rootPath, { force: true });
    } catch (error) {
      setState((currentState) => ({
        ...currentState,
        error: errorToMessage(error, "Could not choose the music folder."),
      }));
    }
  }, [loadCacheThenScan]);

  const rescan = useCallback(async () => {
    const rootPath = state.restoredRootPath;
    if (!rootPath || state.isScanning) {
      return;
    }

    await runScan(rootPath, { force: true });
  }, [runScan, state.isScanning, state.restoredRootPath]);

  const rebuildIndex = useCallback(async () => {
    const rootPath = state.restoredRootPath;
    if (!rootPath || state.isScanning || state.isRebuildingIndex) {
      return;
    }

    requestedRootRef.current = rootPath;
    setState((currentState) => ({
      ...currentState,
      isRebuildingIndex: true,
      statusMessage: "Rebuilding library index...",
      error: null,
    }));

    try {
      await clearLibraryIndex(rootPath);
      if (!isCurrentRoot(rootPath) || requestedRootRef.current !== rootPath) {
        return;
      }
      await runScan(rootPath, { force: true, rebuild: true });
    } catch (error) {
      if (!isCurrentRoot(rootPath) || requestedRootRef.current !== rootPath) {
        return;
      }
      setState((currentState) => ({
        ...currentState,
        isScanning: false,
        isRebuildingIndex: false,
        statusMessage: currentState.scanResult
          ? "Library check failed · showing last known results"
          : null,
        error: errorToMessage(error, "Could not rebuild the library index."),
      }));
    }
  }, [runScan, state.isRebuildingIndex, state.isScanning, state.restoredRootPath]);

  const setSearchTerm = useCallback((searchTerm: string) => {
    setState((currentState) => ({
      ...currentState,
      searchTerm,
    }));
  }, []);

  const filteredSongs = useMemo(() => {
    return filterSongs(state.scanResult?.songs ?? [], state.searchTerm);
  }, [state.scanResult?.songs, state.searchTerm]);

  return {
    ...state,
    filteredSongs,
    chooseFolder,
    rescan,
    rebuildIndex,
    setSearchTerm,
  };

  function isCurrentRoot(rootPath: string) {
    return isMountedRef.current && requestedRootRef.current === rootPath;
  }
}
