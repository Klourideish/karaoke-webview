import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { emptyPerformanceProjection } from "../performance/types";
import type { QueueEntry, QueueProjection } from "../queue/types";
import { idleQueueProjection } from "../queue/useQueue";
import { QueuePanel } from "./QueuePanel";

function queueEntry(position: number): QueueEntry {
  return {
    id: `entry-${position}`,
    songId: `song-${position}`,
    requesterSingerId: `singer-${position}`,
    requesterDisplayName: `Singer ${position}`,
    songTitle: `Song ${position}`,
    songArtist: `Artist ${position}`,
    voteCount: 0,
  };
}

function queueProjection(overrides: Partial<QueueProjection> = {}): QueueProjection {
  return { ...idleQueueProjection, ...overrides };
}

describe("QueuePanel", () => {
  it("renders the linked active Performance as a structured current tile", () => {
    const current = queueEntry(1);
    const { container } = render(
      <QueuePanel
        performance={{
          ...emptyPerformanceProjection,
          active: {
            id: "performance-1",
            state: "playing",
            performer: { id: current.requesterSingerId, displayName: current.requesterDisplayName },
            song: { id: current.songId, title: current.songTitle, artist: current.songArtist },
            countdownDeadlineUnixMs: null,
            countdownRemainingMs: null,
            resultsDeadlineUnixMs: null,
            resultsRemainingMs: null,
            readiness: {} as never,
            playback: { attemptId: "attempt-1", state: "playing", startupPending: false },
            terminalReason: null,
            failure: null,
          },
        }}
        queue={queueProjection({ current: { entry: current, performanceId: "performance-1" } })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Current" })).toBeInTheDocument();
    expect(container.querySelector(".queue-panel-song-title")).toHaveTextContent("Song 1");
    expect(container.querySelector(".queue-panel-singer-name")).toHaveTextContent("Singer 1");
    expect(container.querySelector(".queue-panel-item-state")).toHaveTextContent("Playing");
    expect(container.querySelector(".queue-panel-current-tile")).not.toHaveTextContent(
      "Song 1Singer 1playing",
    );
  });

  it("shows the authoritative failed entry separately from the next queued song", () => {
    const failedEntry = {
      ...queueEntry(1),
      songTitle: "Someone You Loved",
      requesterDisplayName: "Kyle",
    };
    render(
      <QueuePanel
        performance={emptyPerformanceProjection}
        queue={queueProjection({
          progressionPaused: true,
          failed: [
            {
              entry: failedEntry,
              message: "Performance failed.",
            },
          ],
          queued: [
            {
              ...queueEntry(2),
              requesterDisplayName: "Ellie",
              songTitle: "You've Got a Friend in Me",
              songArtist: "Randy Newman",
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("Failed · Retry available")).toBeInTheDocument();
    expect(screen.getByText("Someone You Loved")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Up next (1)" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Next songs" })).toHaveTextContent(
      "You've Got a Friend in Me",
    );
  });

  it("renders upcoming entries in authoritative order with explicit positions", () => {
    render(
      <QueuePanel
        performance={emptyPerformanceProjection}
        queue={queueProjection({ queued: [queueEntry(3), queueEntry(1), queueEntry(2)] })}
      />,
    );

    const entries = screen.getByRole("list", { name: "Next songs" }).querySelectorAll("li");
    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveTextContent("1Song 3Singer 3");
    expect(entries[1]).toHaveTextContent("2Song 1Singer 1");
    expect(entries[2]).toHaveTextContent("3Song 2Singer 2");
    expect(screen.getByLabelText("Queue position 1")).toBeInTheDocument();
  });

  it("keeps Current fixed and renders the complete upcoming queue in its scroll container", () => {
    const current = queueEntry(1);
    const queued = Array.from({ length: 12 }, (_, index) => queueEntry(index + 2));
    const { container } = render(
      <QueuePanel
        performance={emptyPerformanceProjection}
        queue={queueProjection({ current: { entry: current, performanceId: null }, queued })}
      />,
    );

    const currentSection = container.querySelector(".queue-panel-current-section");
    const scrollContainer = screen.getByTestId("queue-panel-next-scroll");
    expect(currentSection).toContainElement(screen.getByText("Song 1"));
    expect(scrollContainer).not.toContainElement(screen.getByText("Song 1"));
    expect(scrollContainer.querySelectorAll(".queue-panel-upcoming-tile")).toHaveLength(12);
    expect(screen.getByRole("heading", { name: "Up next (12)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Queue position 12")).toBeInTheDocument();
  });

  it("renders a clear current-only state", () => {
    const current = queueEntry(1);
    render(
      <QueuePanel
        performance={emptyPerformanceProjection}
        queue={queueProjection({ current: { entry: current, performanceId: null } })}
      />,
    );

    expect(screen.getByText("Song 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Up next (0)" })).toBeInTheDocument();
    expect(screen.getByText("No songs waiting.")).toBeInTheDocument();
  });

  it("renders a clear upcoming-only state", () => {
    render(
      <QueuePanel
        performance={emptyPerformanceProjection}
        queue={queueProjection({ queued: [queueEntry(1), queueEntry(2)] })}
      />,
    );

    expect(screen.getByText("Nothing playing.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Up next (2)" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Next songs" }).querySelectorAll("li")).toHaveLength(2);
  });

  it("renders a concise empty state", () => {
    render(<QueuePanel performance={emptyPerformanceProjection} queue={idleQueueProjection} />);

    expect(screen.getByText("No songs queued.")).toBeInTheDocument();
    expect(screen.getByText("Nothing playing.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Current" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Up next (0)" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Next songs" })).not.toBeInTheDocument();
  });
});
