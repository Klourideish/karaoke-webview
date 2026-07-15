import { useEffect, useId, useState } from "react";
import type { SessionSingerId } from "../host-domain/types";
import type { SingerReadinessProjection } from "./singerReadiness";

export type Singer = {
  id: SessionSingerId;
  displayName: string;
};

export function SingerBar({
  readiness,
  singers,
  onOpenSync,
  onRemoveSinger,
  onRenameSinger,
  error,
  pendingMutation,
}: {
  readiness: SingerReadinessProjection[];
  singers: Singer[];
  onOpenSync: () => void;
  onRemoveSinger: (id: string) => Promise<boolean>;
  onRenameSinger: (id: string, displayName: string) => Promise<unknown>;
  error: string | null;
  pendingMutation: string | null;
}) {
  const readinessBySinger = new Map(readiness.map((item) => [item.singerId, item]));

  return (
    <section className="singer-bar" aria-label="Singer bar" data-empty={singers.length === 0}>
      <div className="singer-bar-heading">
        <p className="region-label">Singers</p>
      </div>

      {singers.length > 0 ? (
        <div className="singer-list" aria-label="Singer list">
          {singers.map((singer) => (
            <SingerItem
              key={singer.id}
              readiness={readinessBySinger.get(singer.id)}
              singer={singer}
              onRemoveSinger={onRemoveSinger}
              onRenameSinger={onRenameSinger}
              pending={pendingMutation === singer.id}
            />
          ))}
        </div>
      ) : null}

      <div className="singer-bar-actions">
        {error ? (
          <p className="singer-bar-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="add-singer-button sync-singer-button"
          type="button"
          disabled={pendingMutation !== null}
          onClick={onOpenSync}
        >
          + Sync
        </button>
      </div>
    </section>
  );
}

function SingerItem({
  readiness,
  singer,
  onRemoveSinger,
  onRenameSinger,
  pending,
}: {
  readiness?: SingerReadinessProjection;
  singer: Singer;
  onRemoveSinger: (id: string) => Promise<boolean>;
  onRenameSinger: (id: string, displayName: string) => Promise<unknown>;
  pending: boolean;
}) {
  const inputId = useId();
  const [draftName, setDraftName] = useState(singer.displayName);
  const status = readiness?.status ?? "unassigned";
  const statusLabel = readiness?.label ?? `${singer.displayName}, microphone unassigned`;

  useEffect(() => {
    setDraftName(singer.displayName);
  }, [singer.displayName]);

  function commitRename() {
    if (draftName !== singer.displayName) {
      void onRenameSinger(singer.id, draftName);
    }
  }

  return (
    <div className="singer-item" data-singer-id={singer.id}>
      <span
        aria-hidden="true"
        className="singer-readiness-dot"
        data-status={status}
        title={statusLabel}
      />
      <span className="visually-hidden">{statusLabel}</span>
      <label className="visually-hidden" htmlFor={inputId}>
        Display name for {singer.displayName}
      </label>
      <input
        id={inputId}
        className="singer-name-input"
        type="text"
        value={draftName}
        disabled={pending}
        onBlur={commitRename}
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraftName(singer.displayName);
            event.currentTarget.blur();
          }
        }}
      />
      <button
        className="remove-singer-button"
        type="button"
        disabled={pending}
        onClick={() => void onRemoveSinger(singer.id)}
        aria-label={`Remove ${singer.displayName}`}
      >
        Remove
      </button>
    </div>
  );
}
