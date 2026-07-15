import { useMemo } from "react";
import { LibrarySongList } from "../media-library/LibrarySongList";
import { groupSongsByArtist } from "../media-library/libraryPresentation";
import { useMediaLibrary } from "../media-library/useMediaLibrary";

export function LibraryWorkspace({
  mediaLibrary,
}: {
  mediaLibrary: ReturnType<typeof useMediaLibrary>;
}) {
  const {
    chooseFolder,
    error,
    filteredSongs,
    isLoadingSettings,
    isScanning,
    rescan,
    restoredRootPath,
    scanResult,
    searchTerm,
    setSearchTerm,
  } = mediaLibrary;
  const hasFolder = Boolean(restoredRootPath);
  const songCount = scanResult?.songs.length ?? 0;
  const artistCount = useMemo(
    () => groupSongsByArtist(scanResult?.songs ?? []).length,
    [scanResult?.songs],
  );
  const controlsDisabled = isLoadingSettings || isScanning;

  return (
    <section className="library-workspace" aria-labelledby="view-heading">
      <h2 id="view-heading" className="visually-hidden">
        Library
      </h2>
      <div className="library-toolbar" aria-label="Library controls">
        <button
          className="library-action-button"
          type="button"
          onClick={chooseFolder}
          disabled={controlsDisabled}
        >
          Library location
        </button>
        <button
          className="library-action-button"
          type="button"
          onClick={rescan}
          disabled={!hasFolder || controlsDisabled}
        >
          Rescan
        </button>
        <p className="library-location" title={restoredRootPath ?? undefined}>
          {restoredRootPath ?? "No library location selected"}
        </p>
      </div>

      <div className="library-summary" aria-live="polite">
        <strong>
          {songCount} {songCount === 1 ? "song" : "songs"} · {artistCount}{" "}
          {artistCount === 1 ? "artist" : "artists"}
        </strong>
        {isScanning ? <span>Refreshing library...</span> : null}
        {error ? (
          <span className="library-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>

      {!hasFolder && !isLoadingSettings ? (
        <div className="library-empty-state">
          <p>Choose a library location to browse karaoke songs.</p>
        </div>
      ) : null}

      {scanResult ? (
        <>
          {songCount > 0 ? (
            <div className="library-search-row">
              <label htmlFor="library-search">Search library</label>
              <input
                id="library-search"
                className="library-search-input"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search artist or title"
              />
            </div>
          ) : null}
          <section className="library-artists" aria-labelledby="library-artists-heading">
            <h3 id="library-artists-heading">Artists</h3>
            <LibrarySongList
              isSearchActive={searchTerm.trim().length > 0}
              songs={filteredSongs}
              totalSongCount={songCount}
            />
          </section>
        </>
      ) : null}
    </section>
  );
}
