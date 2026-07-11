import { useId } from "react";

export type Singer = {
  id: string;
  displayName: string;
};

export function SingerBar({
  singers,
  onAddSinger,
  onRemoveSinger,
  onRenameSinger,
}: {
  singers: Singer[];
  onAddSinger: () => void;
  onRemoveSinger: (id: string) => void;
  onRenameSinger: (id: string, displayName: string) => void;
}) {
  return (
    <section className="singer-bar" aria-label="Singer bar">
      <div className="singer-bar-heading">
        <p className="region-label">Singers</p>
      </div>

      <div className="singer-list" aria-label="Singer list">
        {singers.map((singer) => (
          <SingerItem
            key={singer.id}
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
  singer,
  onRemoveSinger,
  onRenameSinger,
}: {
  singer: Singer;
  onRemoveSinger: (id: string) => void;
  onRenameSinger: (id: string, displayName: string) => void;
}) {
  const inputId = useId();

  return (
    <div className="singer-item" data-singer-id={singer.id}>
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
