import type { LibraryScanResult } from "./types";

export function scanResultsMatch(left: LibraryScanResult | null, right: LibraryScanResult) {
  if (!left) {
    return false;
  }

  return JSON.stringify(scanResultComparable(left)) === JSON.stringify(scanResultComparable(right));
}

function scanResultComparable(scanResult: LibraryScanResult) {
  return {
    rootPath: normalizeRoot(scanResult.rootPath),
    songs: scanResult.songs,
    issues: scanResult.issues,
    scannedDirectoryCount: scanResult.scannedDirectoryCount,
    scannedFileCount: scanResult.scannedFileCount,
    supportedFileCount: scanResult.supportedFileCount,
    audioFileCount: scanResult.audioFileCount,
    lyricFileCount: scanResult.lyricFileCount,
  };
}

export function normalizeRoot(rootPath: string) {
  return rootPath.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}
