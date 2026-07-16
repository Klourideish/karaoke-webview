import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSongLyricTiming,
  removeSongLyricOffset,
  saveSongLyricOffset,
} from "./lyricTimingPreferences";
import { useSongLyricTiming } from "./useSongLyricTiming";

vi.mock("./lyricTimingPreferences", () => ({
  getSongLyricTiming: vi.fn(),
  saveSongLyricOffset: vi.fn(),
  removeSongLyricOffset: vi.fn(),
}));

const getTiming = vi.mocked(getSongLyricTiming);
const saveTiming = vi.mocked(saveSongLyricOffset);
const removeTiming = vi.mocked(removeSongLyricOffset);
const savedOffsets = new Map<string, number>();

function projection(songId: string, status: "loaded" | "saved" | "removed") {
  return {
    songId,
    savedOffsetMs: savedOffsets.get(songId) ?? null,
    persistenceStatus: status,
    lastError: null,
  } as const;
}

function TimingHarness({ songId }: { songId: string | null }) {
  const timing = useSongLyricTiming(songId);
  return (
    <div>
      <output aria-label="Saved">{timing.savedOffsetMs ?? "none"}</output>
      <output aria-label="Temporary">{timing.temporaryOffsetMs}</output>
      <output aria-label="Effective">{timing.effectiveOffsetMs}</output>
      <button onClick={() => timing.adjustTemporary(100)}>Later</button>
      <button onClick={timing.resetTemporary}>Reset temporary</button>
      <button onClick={() => void timing.saveForSong()}>Save</button>
      <button onClick={() => void timing.removeSavedOffset()}>Remove saved</button>
      {timing.error ? <p role="alert">{timing.error}</p> : null}
    </div>
  );
}

beforeEach(() => {
  savedOffsets.clear();
  getTiming.mockReset();
  saveTiming.mockReset();
  removeTiming.mockReset();
  getTiming.mockImplementation((songId) => Promise.resolve(projection(songId, "loaded")));
  saveTiming.mockImplementation((songId, offsetMs) => {
    savedOffsets.set(songId, offsetMs);
    return Promise.resolve(projection(songId, "saved"));
  });
  removeTiming.mockImplementation((songId) => {
    savedOffsets.delete(songId);
    return Promise.resolve(projection(songId, "removed"));
  });
});

describe("useSongLyricTiming", () => {
  it("composes saved and temporary values and saves the effective value", async () => {
    savedOffsets.set("song-a", -700);
    render(<TimingHarness songId="song-a" />);
    await waitFor(() => expect(screen.getByLabelText("Saved")).toHaveTextContent("-700"));

    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.getByLabelText("Temporary")).toHaveTextContent("100");
    expect(screen.getByLabelText("Effective")).toHaveTextContent("-600");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveTiming).toHaveBeenCalledWith("song-a", -600));
    expect(screen.getByLabelText("Saved")).toHaveTextContent("-600");
    expect(screen.getByLabelText("Temporary")).toHaveTextContent("0");
    expect(screen.getByLabelText("Effective")).toHaveTextContent("-600");
  });

  it("resets temporary timing without removing the saved value", async () => {
    savedOffsets.set("song-a", -700);
    render(<TimingHarness songId="song-a" />);
    await waitFor(() => expect(screen.getByLabelText("Saved")).toHaveTextContent("-700"));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    fireEvent.click(screen.getByRole("button", { name: "Reset temporary" }));

    expect(removeTiming).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Saved")).toHaveTextContent("-700");
    expect(screen.getByLabelText("Temporary")).toHaveTextContent("0");
    expect(screen.getByLabelText("Effective")).toHaveTextContent("-700");
  });

  it("removes only saved timing while preserving the temporary adjustment", async () => {
    savedOffsets.set("song-a", -700);
    render(<TimingHarness songId="song-a" />);
    await waitFor(() => expect(screen.getByLabelText("Saved")).toHaveTextContent("-700"));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove saved" }));

    await waitFor(() => expect(removeTiming).toHaveBeenCalledWith("song-a"));
    expect(screen.getByLabelText("Saved")).toHaveTextContent("none");
    expect(screen.getByLabelText("Temporary")).toHaveTextContent("100");
    expect(screen.getByLabelText("Effective")).toHaveTextContent("100");
  });

  it("loads by stable song ID and resets temporary timing on song changes", async () => {
    savedOffsets.set("song-a", -700);
    savedOffsets.set("song-b", 400);
    const { rerender } = render(<TimingHarness songId="song-a" />);
    await waitFor(() => expect(screen.getByLabelText("Saved")).toHaveTextContent("-700"));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    rerender(<TimingHarness songId="song-b" />);

    await waitFor(() => expect(screen.getByLabelText("Saved")).toHaveTextContent("400"));
    expect(screen.getByLabelText("Temporary")).toHaveTextContent("0");
    expect(screen.getByLabelText("Effective")).toHaveTextContent("400");
  });

  it("preserves verified values and reports a failed save", async () => {
    savedOffsets.set("song-a", -700);
    saveTiming.mockRejectedValueOnce({
      reasonCode: "persistence-failed",
      message: "Could not save lyric timing.",
    });
    render(<TimingHarness songId="song-a" />);
    await waitFor(() => expect(screen.getByLabelText("Saved")).toHaveTextContent("-700"));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save lyric timing.");
    expect(screen.getByLabelText("Saved")).toHaveTextContent("-700");
    expect(screen.getByLabelText("Temporary")).toHaveTextContent("100");
  });

  it("does not duplicate persistence mutations under StrictMode", async () => {
    render(
      <StrictMode>
        <TimingHarness songId="song-a" />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByLabelText("Saved")).toHaveTextContent("none"));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveTiming).toHaveBeenCalledTimes(1));
  });
});
