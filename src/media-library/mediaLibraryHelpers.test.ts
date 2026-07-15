import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanResultsMatch } from "./comparison";
import { groupSongsByArtist, UNKNOWN_ARTIST } from "./libraryPresentation";
import { filterSongs } from "./search";
import { refreshLibrary } from "./scanCoordinator";
import type { LibraryScanResult, MediaSong } from "./types";

const apiMocks = vi.hoisted(() => ({
  refreshMediaLibrary: vi.fn(),
  selectLibraryLocation: vi.fn(),
}));

vi.mock("./api", () => ({
  loadLibraryIndex: vi.fn(),
  loadLibrarySettings: vi.fn(),
  refreshMediaLibrary: apiMocks.refreshMediaLibrary,
  selectLibraryLocation: apiMocks.selectLibraryLocation,
}));

const songs: MediaSong[] = [
  {
    id: "song-a",
    title: "Hey Jude",
    artist: "The Beatles",
    displayName: "The Beatles - Hey Jude",
    directoryPath: "C:\\Music\\Pop",
    audioPath: "C:\\Music\\Pop\\The Beatles - Hey Jude.opus",
    lyricPath: "C:\\Music\\Pop\\The Beatles - Hey Jude.ttml",
    fileStem: "The Beatles - Hey Jude",
  },
  {
    id: "song-b",
    title: "Jóga",
    artist: "Björk",
    displayName: "Björk - Jóga",
    directoryPath: "C:\\Music\\Alt",
    audioPath: "C:\\Music\\Alt\\Björk - Jóga.opus",
    lyricPath: "C:\\Music\\Alt\\Björk - Jóga.ttml",
    fileStem: "Björk - Jóga",
  },
];

const scanResult: LibraryScanResult = {
  rootPath: "C:\\Music",
  songs,
  issues: [],
  scannedDirectoryCount: 3,
  scannedFileCount: 4,
  supportedFileCount: 4,
  audioFileCount: 2,
  lyricFileCount: 2,
  completedAt: "1000Z",
};

beforeEach(() => {
  apiMocks.refreshMediaLibrary.mockReset();
  apiMocks.selectLibraryLocation.mockReset();
});

describe("media-library search helpers", () => {
  it("filters by artist, title, display name, and filename stem case-insensitively", () => {
    expect(filterSongs(songs, "beatles")).toEqual([songs[0]]);
    expect(filterSongs(songs, "jÓga")).toEqual([songs[1]]);
    expect(filterSongs(songs, "THE BEATLES - HEY")).toEqual([songs[0]]);
    expect(filterSongs(songs, "björk - jóga")).toEqual([songs[1]]);
  });

  it("returns the original list for blank search", () => {
    expect(filterSongs(songs, "   ")).toBe(songs);
  });
});

describe("media-library comparison helpers", () => {
  it("normalizes equivalent root paths while comparing authoritative content", () => {
    expect(
      scanResultsMatch(
        {
          ...scanResult,
          rootPath: "C:/Music/",
          completedAt: "older",
        },
        {
          ...scanResult,
          rootPath: "c:\\music",
          completedAt: "newer",
        },
      ),
    ).toBe(true);
  });

  it("detects changed song content", () => {
    expect(
      scanResultsMatch(scanResult, {
        ...scanResult,
        songs: [songs[0]],
      }),
    ).toBe(false);
  });
});

describe("library refresh coordinator", () => {
  it("shares a pending same-root refresh", async () => {
    let resolveScan: (value: LibraryScanResult) => void = () => undefined;
    const pendingScan = new Promise<LibraryScanResult>((resolve) => {
      resolveScan = resolve;
    });
    apiMocks.refreshMediaLibrary.mockReturnValue(pendingScan);

    const firstScan = refreshLibrary("C:\\Music");
    const secondScan = refreshLibrary("C:\\Music");

    expect(secondScan).toBe(firstScan);
    expect(apiMocks.refreshMediaLibrary).toHaveBeenCalledTimes(1);

    resolveScan(scanResult);
    await expect(firstScan).resolves.toEqual(scanResult);
  });

  it("keeps location selection distinct from a rescan", async () => {
    apiMocks.refreshMediaLibrary.mockResolvedValue(scanResult);
    apiMocks.selectLibraryLocation.mockResolvedValue(scanResult);

    const rescan = refreshLibrary("C:\\Music");
    const selection = refreshLibrary("C:\\Music", true);

    expect(selection).not.toBe(rescan);
    expect(apiMocks.refreshMediaLibrary).toHaveBeenCalledTimes(1);
    expect(apiMocks.selectLibraryLocation).toHaveBeenCalledTimes(1);

    await expect(rescan).resolves.toEqual(scanResult);
    await expect(selection).resolves.toEqual(scanResult);
  });
});

describe("library artist presentation", () => {
  it("groups artists and songs using stable case-insensitive alphabetical ordering", () => {
    const groups = groupSongsByArtist([
      { ...songs[0], id: "queen-b", artist: "queen", title: "Zoo" },
      { ...songs[1], id: "adele-b", artist: "Adele", title: "taste" },
      { ...songs[0], id: "queen-a", artist: "Queen", title: "A Kind of Magic" },
      { ...songs[1], id: "adele-a", artist: "adele", title: "Hello" },
    ]);

    expect(groups.map((group) => group.artist.toLowerCase())).toEqual(["adele", "queen"]);
    expect(groups[0].songs.map((song) => song.title)).toEqual(["Hello", "taste"]);
    expect(groups[1].songs.map((song) => song.title)).toEqual(["A Kind of Magic", "Zoo"]);
  });

  it("uses the unknown artist fallback only when artist metadata is blank", () => {
    const groups = groupSongsByArtist([{ ...songs[0], artist: "   " }]);

    expect(groups).toHaveLength(1);
    expect(groups[0].artist).toBe(UNKNOWN_ARTIST);
    expect(groups[0].songs[0].id).toBe(songs[0].id);
  });
});
