import { StrictMode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PerformanceController } from "../performance/usePerformance";
import { QueueWorkspace } from "../workspaces/QueueWorkspace";
import type { QueueProjection } from "./types";

const mockSingers = [
  { id: "singer-1", displayName: "Kyle" },
  { id: "singer-2", displayName: "Alice" },
];

const queueEntry = {
  id: "queue-entry-1",
  songId: "song-1",
  requesterSingerId: "singer-1",
  requesterDisplayName: "Kyle",
  songTitle: "Taste",
  songArtist: "Sabrina Carpenter",
  voteCount: 0,
};

const mockProjection: QueueProjection = {
  revision: 1,
  current: { entry: queueEntry, performanceId: "performance-1" },
  queued: [
    {
      ...queueEntry,
      id: "queue-entry-2",
      songId: "song-2",
      requesterSingerId: "singer-2",
      requesterDisplayName: "Alice",
      songTitle: "Hey Jude",
      songArtist: "The Beatles",
      voteCount: 2,
    },
  ],
  failed: [],
  progressionPaused: false,
  diagnostics: {
    activeQueueCount: 2,
    currentEntryId: "queue-entry-1",
    linkedPerformanceId: "performance-1",
    progressionPaused: false,
    lastTransition: null,
    lastFailure: null,
    workerFailure: null,
    idempotencyHitCount: 0,
    idempotencyConflictCount: 0,
  },
};

const mockPerformance = {
  projection: {
    revision: 1,
    active: {
      id: "performance-1",
      state: "countdown" as const,
      performer: { id: "singer-1", displayName: "Kyle" },
      song: { id: "song-1", title: "Taste", artist: "Sabrina Carpenter" },
      countdownDeadlineUnixMs: 3_000,
      countdownRemainingMs: 3_000,
      resultsDeadlineUnixMs: null,
      resultsRemainingMs: null,
      readiness: {} as never,
      playback: { attemptId: null, state: "idle", startupPending: false },
      terminalReason: null,
      failure: null,
    },
    diagnostics: {
      lastTransition: null,
      stalePlaybackEventCount: 0,
      idempotencyHitCount: 0,
      idempotencyConflictCount: 0,
    },
  },
  error: null,
  create: vi.fn(),
  cancel: vi.fn(),
  skip: vi.fn(),
} as unknown as PerformanceController;

function createMockQueue(projection = mockProjection) {
  return {
    projection,
    error: null as string | null,
    pendingAction: null as string | null,
    addSong: vi.fn(),
    removeEntry: vi.fn(),
    moveEntry: vi.fn(),
    voteForEntry: vi.fn(),
    removeVote: vi.fn(),
    pauseProgression: vi.fn(),
    resumeProgression: vi.fn(),
    skipCurrent: vi.fn(),
    retryFailed: vi.fn(),
    refresh: vi.fn(),
  };
}

describe("QueueWorkspace", () => {
  it("derives countdown from the linked Performance projection", () => {
    render(
      <StrictMode>
        <QueueWorkspace
          performance={mockPerformance}
          queue={createMockQueue()}
          singers={mockSingers}
        />
      </StrictMode>,
    );
    expect(screen.getByText("Taste")).toBeInTheDocument();
    expect(screen.getByText("Starting in 3")).toBeInTheDocument();
    expect(mockProjection).not.toHaveProperty("countdownRemainingMs");
  });

  it("renders future and failed entries without Queue history", () => {
    const failedProjection = {
      ...mockProjection,
      failed: [{ entry: { ...queueEntry, id: "queue-entry-3" }, message: "Could not start." }],
    };
    render(
      <QueueWorkspace
        performance={mockPerformance}
        queue={createMockQueue(failedProjection)}
        singers={mockSingers}
      />,
    );
    expect(screen.getByText("Hey Jude")).toBeInTheDocument();
    expect(screen.getByText("Could not start.")).toBeInTheDocument();
    expect(screen.queryByText(/history/i)).not.toBeInTheDocument();
  });

  it("uses vote totals without rendering raw voter IDs", () => {
    const queue = createMockQueue();
    render(<QueueWorkspace performance={mockPerformance} queue={queue} singers={mockSingers} />);
    expect(screen.getByText("Upvotes: 2")).toBeInTheDocument();
    expect(screen.queryByText("singer-1")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Singer voting on Hey Jude"), {
      target: { value: "singer-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upvote" }));
    expect(queue.voteForEntry).toHaveBeenCalledWith("queue-entry-2", "singer-1");
  });

  it("routes pause, skip, move, remove, and retry actions", () => {
    const projection = {
      ...mockProjection,
      failed: [{ entry: { ...queueEntry, id: "queue-entry-3" }, message: "Failed" }],
      queued: [...mockProjection.queued, { ...queueEntry, id: "queue-entry-4", songTitle: "Jóga" }],
    };
    const queue = createMockQueue(projection);
    render(<QueueWorkspace performance={mockPerformance} queue={queue} singers={mockSingers} />);
    fireEvent.click(screen.getByRole("button", { name: "Pause queue" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip current" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Earlier" })[1]);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(queue.pauseProgression).toHaveBeenCalledOnce();
    expect(queue.skipCurrent).toHaveBeenCalledOnce();
    expect(queue.moveEntry).toHaveBeenCalledWith("queue-entry-4", 0);
    expect(queue.removeEntry).toHaveBeenCalledWith("queue-entry-2");
    expect(queue.retryFailed).toHaveBeenCalledWith("queue-entry-3");
  });
});
