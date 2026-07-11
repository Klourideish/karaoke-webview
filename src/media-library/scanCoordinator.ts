import { loadLibraryIndex, loadLibrarySettings, scanMediaLibrary } from "./api";
import type { LibraryIndexLoadResult, LibraryScanResult, LibrarySettings } from "./types";

let pendingSettingsLoad: Promise<LibrarySettings> | null = null;
const pendingScans = new Map<string, Promise<LibraryScanResult>>();
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

export function scanLibrary(rootPath: string, force = false): Promise<LibraryScanResult> {
  if (!force) {
    const pendingScan = pendingScans.get(rootPath);
    if (pendingScan) {
      return pendingScan;
    }
  }

  const scanPromise = scanMediaLibrary(rootPath).finally(() => {
    pendingScans.delete(rootPath);
  });
  pendingScans.set(rootPath, scanPromise);
  return scanPromise;
}
