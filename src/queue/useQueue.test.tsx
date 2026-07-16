import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueProjection } from "./types";

const api = vi.hoisted(() => ({
  getQueueProjection: vi.fn(),
  listenForQueueProjection: vi.fn(),
  addSongToQueue: vi.fn(),
  moveQueueEntry: vi.fn(),
  pauseQueueProgression: vi.fn(),
  removeQueueEntry: vi.fn(),
  removeQueueVote: vi.fn(),
  resumeQueueProgression: vi.fn(),
  retryFailedQueueEntry: vi.fn(),
  skipCurrentQueueEntry: vi.fn(),
  voteForQueueEntry: vi.fn(),
}));

vi.mock("./api", () => api);

import { idleQueueProjection, useQueue } from "./useQueue";

function projection(revision: number): QueueProjection {
  return {
    ...structuredClone(idleQueueProjection),
    revision,
    diagnostics: { ...idleQueueProjection.diagnostics, lastTransition: `revision-${revision}` },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("useQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listenForQueueProjection.mockResolvedValue(() => undefined);
    api.getQueueProjection.mockResolvedValue(projection(0));
  });

  it("does not allow a delayed poll to overwrite a newer revision", async () => {
    const old = deferred<QueueProjection>();
    api.getQueueProjection.mockReturnValueOnce(old.promise).mockResolvedValueOnce(projection(2));
    const { result } = renderHook(() => useQueue());
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.projection.revision).toBe(2);
    await act(async () => old.resolve(projection(1)));
    expect(result.current.projection.revision).toBe(2);
  });

  it("surfaces typed Queue errors and reports failed insertion", async () => {
    api.addSongToQueue.mockRejectedValue({
      reasonCode: "singer-not-found",
      message: "Add a singer before queuing a song.",
    });
    const { result } = renderHook(() => useQueue({ active: false }));
    let added = true;
    await act(async () => {
      added = await result.current.addSong("song-1", "singer-1");
    });
    expect(added).toBe(false);
    await waitFor(() => expect(result.current.error).toBe("Add a singer before queuing a song."));
  });

  it("ignores malformed Host projections without replacing the last valid revision", async () => {
    api.getQueueProjection.mockResolvedValueOnce({ libraryRoot: "C:\\Music" });
    const { result } = renderHook(() => useQueue());

    await waitFor(() => expect(api.getQueueProjection).toHaveBeenCalled());
    expect(result.current.projection).toEqual(idleQueueProjection);
  });
});
