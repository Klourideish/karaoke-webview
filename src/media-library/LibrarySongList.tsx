import { useMemo, useState } from "react";
import { groupSongsByArtist } from "./libraryPresentation";
import type { MediaSong } from "./types";

export function LibrarySongList({
  isSearchActive,
  songs,
  totalSongCount,
}: {
  isSearchActive: boolean;
  songs: MediaSong[];
  totalSongCount: number;
}) {
  const [expandedArtists, setExpandedArtists] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => groupSongsByArtist(songs), [songs]);

  if (totalSongCount === 0) {
    return (
      <div className="library-empty-state">
        <p>No supported karaoke songs were found in this folder.</p>
      </div>
    );
  }

  if (songs.length === 0 && isSearchActive) {
    return (
      <div className="library-empty-state">
        <p>No songs match this search.</p>
      </div>
    );
  }

  return (
    <div className="artist-groups" aria-label="Artists">
      {groups.map((group, index) => {
        const expanded = expandedArtists.has(group.key);
        const contentId = `artist-group-${index}`;
        return (
          <section className="artist-group" key={group.key}>
            <button
              className="artist-group-toggle"
              type="button"
              aria-controls={contentId}
              aria-expanded={expanded}
              onClick={() =>
                setExpandedArtists((current) => {
                  const next = new Set(current);
                  if (expanded) next.delete(group.key);
                  else next.add(group.key);
                  return next;
                })
              }
            >
              <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
              <span>{group.artist}</span>
              <span className="artist-song-count">
                {group.songs.length} {group.songs.length === 1 ? "song" : "songs"}
              </span>
            </button>
            {expanded ? (
              <div className="artist-song-list" id={contentId}>
                {group.songs.map((song) => (
                  <article className="artist-song-row" key={song.id}>
                    <span>{song.title}</span>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
