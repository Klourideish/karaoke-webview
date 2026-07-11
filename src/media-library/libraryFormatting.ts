import type { LibraryScanResult } from "./types";

export function scanSummary(scanResult: LibraryScanResult) {
  return `Scan complete · ${scanResult.scannedDirectoryCount} folders · ${scanResult.scannedFileCount} files · ${scanResult.songs.length} songs · ${scanResult.issues.length} issues`;
}

export function zeroSongState(scanResult: LibraryScanResult) {
  if (scanResult.scannedFileCount === 0) {
    return {
      heading: "No files inspected",
      message: "The selected folder could not be scanned or contains no files.",
    };
  }

  if (scanResult.supportedFileCount === 0) {
    return {
      heading: "No supported karaoke files found",
      message: "The scan did not find any .opus or .ttml files in the selected folder.",
    };
  }

  return {
    heading: "No valid songs found",
    message:
      ".opus and .ttml files must have matching filename stems and be in the same folder. Open diagnostics for details.",
  };
}

export function relativeDirectory(rootPath: string, directoryPath: string) {
  const normalizedRoot = rootPath.replaceAll("\\", "/").replace(/\/$/, "");
  const normalizedDirectory = directoryPath.replaceAll("\\", "/");
  if (normalizedDirectory.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    return normalizedDirectory.slice(normalizedRoot.length + 1);
  }

  if (normalizedDirectory.toLowerCase() === normalizedRoot.toLowerCase()) {
    return "Library root";
  }

  return normalizedDirectory;
}
