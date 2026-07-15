import {
  loadLibraryIndex,
  loadLibrarySettings,
  refreshMediaLibrary,
  selectLibraryLocation,
} from "./api";
import type { LibraryIndexLoadResult, LibraryScanResult, LibrarySettings } from "./types";

let pendingSettingsLoad: Promise<LibrarySettings> | null = null;
const pendingRefreshes = new Map<string, Promise<LibraryScanResult>>();
const pendingIndexLoads = new Map<string, Promise<LibraryIndexLoadResult>>();

export function loadLibrarySettingsOnce(): Promise<LibrarySettings> {
  if (!pendingSettingsLoad) {
    pendingSettingsLoad = loadLibrarySettings().finally(() => {
      pendingSettingsLoad = null;
    });
  }

  return pendingSettingsLoad;
}

export function loadLibraryIndexOnce(rootPath: string): Promise<LibraryIndexLoadResult> {
  const pendingIndexLoad = pendingIndexLoads.get(rootPath);
  if (pendingIndexLoad) {
    return pendingIndexLoad;
  }

  const indexLoadPromise = loadLibraryIndex(rootPath).finally(() => {
    pendingIndexLoads.delete(rootPath);
  });
  pendingIndexLoads.set(rootPath, indexLoadPromise);
  return indexLoadPromise;
}

export function refreshLibrary(
  rootPath: string,
  selectLocation = false,
): Promise<LibraryScanResult> {
  const key = `${selectLocation ? "select" : "rescan"}\0${rootPath.toLocaleLowerCase()}`;
  const pendingRefresh = pendingRefreshes.get(key);
  if (pendingRefresh) {
    return pendingRefresh;
  }

  const refreshPromise = (
    selectLocation ? selectLibraryLocation(rootPath) : refreshMediaLibrary(rootPath)
  ).finally(() => {
    pendingRefreshes.delete(key);
  });
  pendingRefreshes.set(key, refreshPromise);
  return refreshPromise;
}
