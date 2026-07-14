import type { AudioPlayer } from "../audioPlayer";
import { LibraryDiagnostics } from "../media-library/LibraryDiagnostics";
import { LibrarySongList } from "../media-library/LibrarySongList";
import { scanSummary } from "../media-library/libraryFormatting";
import { useMediaLibrary } from "../media-library/useMediaLibrary";

export function LibraryWorkspace({
  audioPlayer,
  mediaLibrary,
}: {
  audioPlayer: AudioPlayer;
  mediaLibrary: ReturnType<typeof useMediaLibrary>;
}) {
  const {
    chooseFolder,
    error,
    filteredSongs,
    isLoadingSettings,
    isRebuildingIndex,
    isScanning,
    rebuildIndex,
    rescan,
    restoredRootPath,
    scanResult,
    searchTerm,
    setSearchTerm,
    statusMessage,
  } = mediaLibrary;

  const hasFolder = Boolean(restoredRootPath);
  const completedScan = scanResult;
  const songCount = completedScan?.songs.length ?? 0;
  const isSearchActive = searchTerm.trim().length > 0;

  return (
    <section className="library-workspace" aria-labelledby="view-heading">
      <h2 id="view-heading" className="visually-hidden">
        Library
      </h2>
      <div className="library-header">
        <div className="library-actions" aria-label="Library actions">
          <button className="library-action-button" type="button" onClick={chooseFolder}>
            {hasFolder ? "Change folder" : "Choose music folder"}
          </button>
          <button
            className="library-action-button"
            type="button"
            onClick={rescan}
            disabled={!hasFolder || isScanning}
          >
            Rescan
          </button>
          <button
            className="library-action-button"
            type="button"
            onClick={rebuildIndex}
            disabled={!hasFolder || isScanning || isRebuildingIndex}
          >
            Rebuild library index
          </button>
        </div>
      </div>

      <div className="library-status-panel" aria-live="polite">
        {isLoadingSettings ? (
          <p>Restoring saved library folder...</p>
        ) : hasFolder ? (
          <p>
            Selected folder: <span>{restoredRootPath}</span>
          </p>
        ) : (
          <p>No music folder selected.</p>
        )}
        {statusMessage ? <p>{statusMessage}</p> : null}
        {isScanning ? <p>Scanning for .opus and .ttml pairs...</p> : null}
        {error ? <p className="library-error">{error}</p> : null}
        {completedScan ? <p>{scanSummary(completedScan)}</p> : null}
      </div>

      {!hasFolder && !isLoadingSettings ? (
        <div className="library-empty-state">
          <h3>No folder selected</h3>
          <p>
            Choose a folder containing paired files like Artist - Song.opus and Artist - Song.ttml
            in the same directory.
          </p>
          <button className="library-action-button" type="button" onClick={chooseFolder}>
            Choose music folder
          </button>
        </div>
      ) : null}

      {completedScan ? (
        <>
          <div className="library-search-row">
            <label htmlFor="library-search">Search library</label>
            <input
              id="library-search"
              className="library-search-input"
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search artist, title, or filename"
            />
          </div>

          <LibrarySongList
            audioPlayer={audioPlayer}
            isSearchActive={isSearchActive}
            rootPath={completedScan.rootPath}
            scanResult={completedScan}
            songs={filteredSongs}
            totalSongCount={songCount}
          />

          <LibraryDiagnostics issues={completedScan.issues} />
        </>
      ) : null}
    </section>
  );
}
