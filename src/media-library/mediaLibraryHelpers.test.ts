import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanResultsMatch } from "./comparison";
import { filterSongs } from "./search";
import { scanLibrary } from "./scanCoordinator";
import type { LibraryScanResult, MediaSong } from "./types";

const apiMocks = vi.hoisted(() => ({
  scanMediaLibrary: vi.fn(),
}));

vi.mock("./api", () => ({
  loadLibraryIndex: vi.fn(),
  loadLibrarySettings: vi.fn(),
  scanMediaLibrary: apiMocks.scanMediaLibrary,
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
  apiMocks.scanMediaLibrary.mockReset();
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

describe("scan coordinator", () => {
  it("shares a pending same-root scan", async () => {
    let resolveScan: (value: LibraryScanResult) => void = () => undefined;
    const pendingScan = new Promise<LibraryScanResult>((resolve) => {
      resolveScan = resolve;
    });
    apiMocks.scanMediaLibrary.mockReturnValue(pendingScan);

    const firstScan = scanLibrary("C:\\Music");
    const secondScan = scanLibrary("C:\\Music");

    expect(secondScan).toBe(firstScan);
    expect(apiMocks.scanMediaLibrary).toHaveBeenCalledTimes(1);

    resolveScan(scanResult);
    await expect(firstScan).resolves.toEqual(scanResult);
  });

  it("starts a fresh same-root scan when forced", async () => {
    apiMocks.scanMediaLibrary.mockResolvedValue(scanResult);

    const firstScan = scanLibrary("C:\\Music");
    const forcedScan = scanLibrary("C:\\Music", true);

    expect(forcedScan).not.toBe(firstScan);
    expect(apiMocks.scanMediaLibrary).toHaveBeenCalledTimes(2);

    await expect(firstScan).resolves.toEqual(scanResult);
    await expect(forcedScan).resolves.toEqual(scanResult);
  });
});
