import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioPlayer } from "../audioPlayer";
import type { LyricDocument } from "../lyrics";
import {
  emptyPerformanceProjection,
  type PerformanceDetailsProjection,
} from "../performance/types";
import type { PerformanceController } from "../performance/usePerformance";
import { idlePlaybackProjection, type HostPlaybackState } from "../playback/types";
import type { SongLyricsState } from "../useSongLyrics";
import { PerformWorkspace } from "./PerformWorkspace";

const song = {
  id: "song-1",
  title: "Authoritative Song",
  artist: "Authoritative Artist",
  audioPath: "C:\\Music\\song.mp3",
};

const lyricDocument: LyricDocument = {
  schemaVersion: 1,
  sourceSongId: song.id,
  language: "en",
  warnings: [],
  lines: [
    lyricLine("line-1", 0, 1_000, "Previous lyric"),
    lyricLine("line-2", 1_000, 4_000, "Current lyric"),
    lyricLine("line-3", 4_000, 5_000, "Upcoming lyric"),
  ],
};

describe("PerformWorkspace", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the authoritative singer without duplicated operator metadata", () => {
    const { container } = renderWorkspace({ active: activePerformance({ state: "preparing" }) });

    expect(screen.getByRole("heading", { name: "Kyle, singer" })).toBeInTheDocument();
    expect(screen.queryByText("Lyrics presentation")).not.toBeInTheDocument();
    expect(screen.queryByText(song.title)).not.toBeInTheDocument();
    expect(screen.queryByText(song.artist)).not.toBeInTheDocument();
    expect(screen.queryByText("Playing")).not.toBeInTheDocument();
    expect(screen.queryByText("performance-1")).not.toBeInTheDocument();
    expect(container.querySelector("[data-waveform-reserved='true']")).toHaveAttribute(
      "data-visualizer-active",
      "false",
    );
  });

  it("renders 3, 2, and 1 only from authoritative countdown projections", () => {
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const { rerender } = renderWorkspace({
      active: activePerformance({ state: "countdown", countdownRemainingMs: 3_000 }),
    });

    const three = screen.getByRole("timer", { name: "Performance starts in 3 seconds" });
    expect(three).toHaveTextContent("3");
    expect(three).toHaveClass("performance-countdown");
    rerender(
      workspace({ active: activePerformance({ state: "countdown", countdownRemainingMs: 2_000 }) }),
    );
    const two = screen.getByRole("timer", { name: "Performance starts in 2 seconds" });
    expect(two).toHaveTextContent("2");
    expect(two).not.toBe(three);
    rerender(
      workspace({ active: activePerformance({ state: "countdown", countdownRemainingMs: 1_000 }) }),
    );
    const one = screen.getByRole("timer", { name: "Performance starts in 1 second" });
    expect(one).toHaveTextContent("1");
    expect(one).not.toBe(two);
    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
  });

  it("keeps the singer visible and removes countdown presentation during playback", async () => {
    const { container, rerender } = renderWorkspace({
      active: activePerformance({ state: "countdown", countdownRemainingMs: 1_000 }),
    });

    rerender(
      workspace({
        active: activePerformance({ state: "playing", countdownRemainingMs: null }),
        currentSong: true,
        lyrics: { document: lyricDocument, error: null, isLoading: false, songId: song.id },
        lyricOffsetMs: -600,
      }),
    );

    expect(screen.getByRole("heading", { name: "Kyle, singer" })).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll(".lyric-line-row")).toHaveLength(3));
    expect(screen.getByText("Current lyric")).toHaveClass("lyric-line-current");
    expect(container.querySelector(".lyric-line-stack")).toHaveAttribute(
      "data-lyric-offset-ms",
      "-600",
    );
    expect(container.querySelector(".lyric-line-stack")).toHaveAttribute(
      "data-effective-time-ms",
      "2600",
    );
  });

  it("uses concise no-lyrics and failed presentation states", () => {
    const { rerender } = renderWorkspace({
      active: activePerformance({ state: "playing" }),
      currentSong: true,
    });

    expect(screen.getByText("Lyrics are not available for this song.")).toBeInTheDocument();
    rerender(
      workspace({
        active: activePerformance({
          state: "failed",
          failure: { reasonCode: "playback-failed", message: "This song could not be played." },
        }),
      }),
    );
    expect(screen.getByText("This song could not be played.")).toBeInTheDocument();
    expect(screen.queryByText("playback-failed")).not.toBeInTheDocument();
  });

  it("keeps the footer inert without Web Audio attachment or recurring frame work", () => {
    const audioContext = vi.fn();
    const animationFrame = vi.fn();
    vi.stubGlobal("AudioContext", audioContext);
    vi.stubGlobal("requestAnimationFrame", animationFrame);

    const { container } = render(
      <StrictMode>
        {workspace({
          active: activePerformance({ state: "playing" }),
          currentSong: true,
          playbackState: "playing",
        })}
      </StrictMode>,
    );

    expect(container.querySelector("[data-waveform-reserved='true']")).toHaveAttribute(
      "data-visualizer-active",
      "false",
    );
    expect(container.querySelector("canvas")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(audioContext).not.toHaveBeenCalled();
    expect(animationFrame).not.toHaveBeenCalled();
    expect(screen.getByText("Lyrics are not available for this song.")).toBeInTheDocument();
  });

  it("does not invoke Performance commands when mounted under StrictMode", () => {
    const controller = performanceController(activePerformance({ state: "preparing" }));
    render(
      <StrictMode>
        <PerformWorkspace
          audioPlayer={audioPlayer(false)}
          lyricOffsetMs={0}
          lyrics={emptyLyrics()}
          performance={controller}
        />
      </StrictMode>,
    );

    expect(controller.create).not.toHaveBeenCalled();
    expect(controller.cancel).not.toHaveBeenCalled();
    expect(controller.skip).not.toHaveBeenCalled();
  });
});

function renderWorkspace(options: WorkspaceOptions) {
  return render(workspace(options));
}

type WorkspaceOptions = {
  active: PerformanceDetailsProjection | null;
  currentSong?: boolean;
  currentTime?: number;
  duration?: number;
  lyricOffsetMs?: number;
  lyrics?: SongLyricsState;
  playbackState?: HostPlaybackState;
};

function workspace({
  active,
  currentSong = false,
  currentTime = 2,
  duration = 10,
  lyricOffsetMs = 0,
  lyrics = emptyLyrics(),
  playbackState = "idle",
}: WorkspaceOptions) {
  return (
    <PerformWorkspace
      audioPlayer={audioPlayer(currentSong, playbackState, currentTime, duration)}
      lyricOffsetMs={lyricOffsetMs}
      lyrics={lyrics}
      performance={performanceController(active)}
    />
  );
}

function performanceController(active: PerformanceDetailsProjection | null) {
  return {
    projection: { ...emptyPerformanceProjection, revision: 1, active },
    error: null,
    create: vi.fn(),
    cancel: vi.fn(),
    skip: vi.fn(),
  } as unknown as PerformanceController;
}

function activePerformance(
  overrides: Partial<PerformanceDetailsProjection>,
): PerformanceDetailsProjection {
  return {
    id: "performance-1",
    state: "preparing",
    performer: { id: "singer-1", displayName: "Kyle" },
    song: { id: song.id, title: song.title, artist: song.artist },
    countdownDeadlineUnixMs: null,
    countdownRemainingMs: null,
    resultsDeadlineUnixMs: null,
    resultsRemainingMs: null,
    readiness: {
      status: "ready",
      mode: "standard",
      message: "Ready.",
      lockedParticipants: [],
      participants: [],
    },
    playback: { attemptId: null, state: "idle", startupPending: false },
    terminalReason: null,
    failure: null,
    ...overrides,
  };
}

function audioPlayer(
  hasCurrentSong: boolean,
  playbackState: HostPlaybackState = "idle",
  currentTime = 2,
  duration = 10,
): AudioPlayer {
  return {
    audioElement: <audio />,
    currentSong: hasCurrentSong ? song : null,
    currentTime,
    duration,
    error: null,
    getCurrentTime: () => currentTime,
    loadSong: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    projection: {
      ...idlePlaybackProjection,
      state: playbackState,
      song: hasCurrentSong ? song : null,
      attemptId: hasCurrentSong ? "attempt-1" : null,
    },
    seek: vi.fn(),
    setVolume: vi.fn(),
    status: playbackState === "playing" ? "playing" : "paused",
    stop: vi.fn(),
    volume: 0.8,
  };
}

function emptyLyrics(): SongLyricsState {
  return { document: null, error: null, isLoading: false, songId: null };
}

function lyricLine(id: string, beginMs: number, endMs: number, text: string) {
  return {
    id,
    beginMs,
    endMs,
    text,
    segments: [],
    role: null,
    region: null,
    styleRefs: [],
  };
}
