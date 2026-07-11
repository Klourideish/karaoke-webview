import type { AudioPlayer } from "../audioPlayer";
import { relativeDirectory, zeroSongState } from "./libraryFormatting";
import type { LibraryScanResult, MediaSong } from "./types";

export function LibrarySongList({
  audioPlayer,
  isSearchActive,
  rootPath,
  scanResult,
  songs,
  totalSongCount,
}: {
  audioPlayer: AudioPlayer;
  isSearchActive: boolean;
  rootPath: string;
  scanResult: LibraryScanResult;
  songs: MediaSong[];
  totalSongCount: number;
}) {
  if (totalSongCount === 0) {
    const zeroState = zeroSongState(scanResult);
    return (
      <div className="library-empty-state">
        <h3>{zeroState.heading}</h3>
        <p>{zeroState.message}</p>
      </div>
    );
  }

  if (songs.length === 0 && isSearchActive) {
    return (
      <div className="library-empty-state">
        <h3>No search results</h3>
        <p>Clear the search field to show the complete library.</p>
      </div>
    );
  }

  return (
    <div className="song-list" aria-label="Discovered songs">
      {songs.map((song) => (
        <article className="song-row" key={song.id}>
          <div className="song-row-main">
            <h3>{song.title}</h3>
            <p>{song.artist || "Artist not specified"}</p>
          </div>
          <p className="song-row-detail">{relativeDirectory(rootPath, song.directoryPath)}</p>
          <p className="song-row-detail">{song.fileStem}</p>
          <button
            className="song-load-button"
            type="button"
            onClick={() => void audioPlayer.loadSong(song)}
          >
            {audioPlayer.currentSong?.id === song.id ? "Loaded" : "Play"}
          </button>
        </article>
      ))}
    </div>
  );
}
