import { useMemo, useState } from "react";
import { groupSongsByArtist } from "./libraryPresentation";
import type { MediaSong } from "./types";
import type { Singer } from "../app/SingerBar";

export function LibrarySongList({
  isSearchActive,
  songs,
  totalSongCount,
  singers,
  onAddSong,
  queueError,
}: {
  isSearchActive: boolean;
  songs: MediaSong[];
  totalSongCount: number;
  singers: readonly Singer[];
  onAddSong: (songId: string, singerId: string) => Promise<boolean>;
  queueError: string | null;
}) {
  const [expandedArtists, setExpandedArtists] = useState<Set<string>>(() => new Set());
  const [requestingSongId, setRequestingSongId] = useState<string | null>(null);
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
                  <article className="library-song-tile" key={song.id}>
                    <span className="library-song-title" title={song.title}>
                      {song.title}
                    </span>
                    <div className="song-row-actions">
                      {requestingSongId === song.id ? (
                        <div className="requester-selection" aria-label="Choose singer">
                          {singers.length === 0 ? (
                            <span className="no-singers-warning">Create a singer first!</span>
                          ) : (
                            <>
                              <span className="selection-label">Who is singing?</span>
                              {singers.map((singer) => (
                                <button
                                  key={singer.id}
                                  className="select-singer-btn"
                                  type="button"
                                  onClick={() => {
                                    void onAddSong(song.id, singer.id).then((added) => {
                                      if (added) setRequestingSongId(null);
                                    });
                                  }}
                                >
                                  {singer.displayName}
                                </button>
                              ))}
                            </>
                          )}
                          <button
                            className="cancel-singer-btn"
                            type="button"
                            onClick={() => setRequestingSongId(null)}
                          >
                            Cancel
                          </button>
                          {queueError ? (
                            <span className="queue-add-error" role="alert">
                              {queueError}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <button
                          className="add-to-queue-btn"
                          type="button"
                          onClick={() => setRequestingSongId(song.id)}
                        >
                          Add to Queue
                        </button>
                      )}
                    </div>
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
