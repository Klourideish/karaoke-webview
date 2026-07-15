import type { MediaSong } from "./types";

export const UNKNOWN_ARTIST = "Unknown Artist";

export type LibraryArtistGroup = {
  key: string;
  artist: string;
  songs: MediaSong[];
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function groupSongsByArtist(songs: MediaSong[]): LibraryArtistGroup[] {
  const grouped = new Map<string, { labels: Set<string>; songs: MediaSong[] }>();
  for (const song of songs) {
    const label = song.artist.trim() || UNKNOWN_ARTIST;
    const key = label.toLowerCase();
    const group = grouped.get(key) ?? { labels: new Set<string>(), songs: [] };
    group.labels.add(label);
    group.songs.push(song);
    grouped.set(key, group);
  }

  return [...grouped.entries()]
    .map(([key, group]) => ({
      key,
      artist: [...group.labels].sort(compareText)[0] ?? UNKNOWN_ARTIST,
      songs: [...group.songs].sort(compareSongs),
    }))
    .sort((left, right) => compareText(left.artist, right.artist));
}

function compareSongs(left: MediaSong, right: MediaSong) {
  return (
    compareText(left.title, right.title) ||
    compareText(left.displayName, right.displayName) ||
    left.id.localeCompare(right.id)
  );
}

function compareText(left: string, right: string) {
  return collator.compare(left, right) || left.localeCompare(right);
}
