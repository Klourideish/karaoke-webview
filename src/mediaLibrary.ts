// Compatibility barrel for older imports. New code should import from focused modules in src/media-library/.
export type {
  LibraryIndexLoadResult,
  LibraryIndexLoadStatus,
  LibraryIssue,
  LibraryIssueKind,
  LibraryScanResult,
  LibrarySettings,
  MediaSong,
  QueuedScan,
  QueuedScanOptions,
} from "./media-library/types";
export { issueKindLabel } from "./media-library/issueFormatting";
export { useMediaLibrary } from "./media-library/useMediaLibrary";
