export type MediaSong = {
  id: string;
  title: string;
  artist: string;
  displayName: string;
  directoryPath: string;
  audioPath: string;
  lyricPath: string;
  fileStem: string;
};

export type LibraryIssueKind =
  | "missing-audio"
  | "missing-lyrics"
  | "duplicate-audio"
  | "duplicate-lyrics"
  | "invalid-name"
  | "unreadable-directory"
  | "unsupported-entry";

export type LibraryIssue = {
  id: string;
  kind: LibraryIssueKind;
  path: string;
  message: string;
};

export type LibraryScanResult = {
  rootPath: string;
  songs: MediaSong[];
  issues: LibraryIssue[];
  scannedDirectoryCount: number;
  scannedFileCount: number;
  supportedFileCount: number;
  audioFileCount: number;
  lyricFileCount: number;
  completedAt: string;
};

export type LibraryIndexLoadStatus =
  "hit" | "miss" | "corrupt" | "root-mismatch" | "unsupported-schema";

export type LibraryIndexLoadResult = {
  status: LibraryIndexLoadStatus;
  scanResult: LibraryScanResult | null;
  message: string | null;
};

export type LibrarySettings = {
  libraryRoot: string | null;
};

export type QueuedScan = {
  force: boolean;
  rebuild?: boolean;
  rootPath: string;
};

export type QueuedScanOptions = {
  force?: boolean;
  rebuild?: boolean;
};
