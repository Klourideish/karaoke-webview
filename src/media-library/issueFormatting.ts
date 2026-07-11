import type { LibraryIssueKind } from "./types";

export function issueKindLabel(kind: LibraryIssueKind) {
  switch (kind) {
    case "missing-audio":
      return "Missing audio";
    case "missing-lyrics":
      return "Missing lyrics";
    case "duplicate-audio":
      return "Duplicate audio";
    case "duplicate-lyrics":
      return "Duplicate lyrics";
    case "invalid-name":
      return "Invalid name";
    case "unreadable-directory":
      return "Unreadable directory";
    case "unsupported-entry":
      return "Unsupported entry";
  }
}
