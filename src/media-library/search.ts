import type { MediaSong } from "./types";

export function filterSongs(songs: MediaSong[], searchTerm: string) {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  if (!normalizedSearchTerm) {
    return songs;
  }

  return songs.filter((song) =>
    [song.artist, song.title, song.displayName, song.fileStem].some((value) =>
      value.toLowerCase().includes(normalizedSearchTerm),
    ),
  );
}
