import { issueKindLabel } from "./issueFormatting";
import type { LibraryIssue } from "./types";

export function LibraryDiagnostics({ issues }: { issues: LibraryIssue[] }) {
  return (
    <details className="library-diagnostics">
      <summary>Diagnostics ({issues.length})</summary>
      {issues.length === 0 ? (
        <p>No library issues found.</p>
      ) : (
        <ul>
          {issues.map((issue) => (
            <li key={issue.id}>
              <strong>{issueKindLabel(issue.kind)}</strong>
              <code>{issue.path}</code>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
