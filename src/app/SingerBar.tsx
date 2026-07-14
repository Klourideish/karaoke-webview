import { useId } from "react";
import type { SessionSingerId } from "../host-domain/types";
import type { SingerReadinessProjection } from "./singerReadiness";

export type Singer = {
  id: SessionSingerId;
  displayName: string;
};

export function SingerBar({
  readiness,
  singers,
  onAddSinger,
  onRemoveSinger,
  onRenameSinger,
}: {
  readiness: SingerReadinessProjection[];
  singers: Singer[];
  onAddSinger: () => void;
  onRemoveSinger: (id: string) => void;
  onRenameSinger: (id: string, displayName: string) => void;
}) {
  const readinessBySinger = new Map(readiness.map((item) => [item.singerId, item]));

  return (
    <section className="singer-bar" aria-label="Singer bar">
      <div className="singer-bar-heading">
        <p className="region-label">Singers</p>
      </div>

      <div className="singer-list" aria-label="Singer list">
        {singers.map((singer) => (
          <SingerItem
            key={singer.id}
            readiness={readinessBySinger.get(singer.id)}
            singer={singer}
            onRemoveSinger={onRemoveSinger}
            onRenameSinger={onRenameSinger}
          />
        ))}
      </div>

      <button className="add-singer-button" type="button" onClick={onAddSinger}>
        Add singer
      </button>
    </section>
  );
}

function SingerItem({
  readiness,
  singer,
  onRemoveSinger,
  onRenameSinger,
}: {
  readiness?: SingerReadinessProjection;
  singer: Singer;
  onRemoveSinger: (id: string) => void;
  onRenameSinger: (id: string, displayName: string) => void;
}) {
  const inputId = useId();
  const status = readiness?.status ?? "unassigned";
  const statusLabel = readiness?.label ?? `${singer.displayName}, microphone unassigned`;

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
        value={singer.displayName}
        onChange={(event) => onRenameSinger(singer.id, event.target.value)}
      />
      <button
        className="remove-singer-button"
        type="button"
        onClick={() => onRemoveSinger(singer.id)}
        aria-label={`Remove ${singer.displayName}`}
      >
        Remove
      </button>
    </div>
  );
}
