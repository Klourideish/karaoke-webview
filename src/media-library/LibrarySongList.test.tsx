import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibrarySongList } from "./LibrarySongList";

const song = {
  id: "song-1",
  title: "Taste",
  artist: "Sabrina Carpenter",
  displayName: "Sabrina Carpenter - Taste",
  directoryPath: "C:/Music",
  audioPath: "C:/Music/Taste.opus",
  lyricPath: "C:/Music/Taste.ttml",
  fileStem: "Taste",
};

function renderSongList({
  onAddSong = vi.fn().mockResolvedValue(true),
  queueError = null,
  songs = [song],
  isSearchActive = false,
}: {
  onAddSong?: (songId: string, singerId: string) => Promise<boolean>;
  queueError?: string | null;
  songs?: (typeof song)[];
  isSearchActive?: boolean;
} = {}) {
  return render(
    <LibrarySongList
      isSearchActive={isSearchActive}
      onAddSong={onAddSong}
      queueError={queueError}
      singers={[{ id: "singer-1", displayName: "Kyle" }]}
      songs={songs}
      totalSongCount={songs.length || 1}
    />,
  );
}

describe("LibrarySongList queue interaction", () => {
  it("keeps artist groups collapsed with their disclosure count", () => {
    renderSongList();

    const artist = screen.getByRole("button", { name: /Sabrina Carpenter/ });
    expect(artist).toHaveAttribute("aria-expanded", "false");
    expect(artist).toHaveTextContent("1 song");
    expect(screen.queryByText("Taste")).not.toBeInTheDocument();
  });

  it("renders expanded songs as responsive tiles with distinct content and actions", () => {
    const { container } = renderSongList();

    fireEvent.click(screen.getByRole("button", { name: /Sabrina Carpenter/ }));
    expect(container.querySelector(".artist-song-list")).toBeInTheDocument();
    expect(container.querySelector(".library-song-tile")).toBeInTheDocument();
    expect(screen.getByText("Taste")).toHaveClass("library-song-title");
    expect(screen.getByRole("button", { name: "Add to Queue" })).toHaveClass("add-to-queue-btn");
    expect(screen.getByText("Taste")).not.toBe(
      screen.getByRole("button", { name: "Add to Queue" }),
    );
  });

  it("preserves the full accessible title when a long title is visually clamped", () => {
    const longTitle = "This Is a Deliberately Long Karaoke Song Title That Needs Two Lines";
    renderSongList({ songs: [{ ...song, title: longTitle }] });

    fireEvent.click(screen.getByRole("button", { name: /Sabrina Carpenter/ }));
    expect(screen.getByText(longTitle)).toHaveAttribute("title", longTitle);
  });

  it("preserves requester selection and shows the typed Host error on failure", async () => {
    const onAddSong = vi.fn().mockResolvedValue(false);
    const { container } = renderSongList({
      onAddSong,
      queueError: "The selected singer is no longer in this session.",
    });
    fireEvent.click(screen.getByRole("button", { name: /Sabrina Carpenter/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Queue" }));
    const tile = container.querySelector(".library-song-tile");
    expect(tile).toContainElement(screen.getByLabelText("Choose singer"));
    fireEvent.click(screen.getByRole("button", { name: "Kyle" }));
    await waitFor(() => expect(onAddSong).toHaveBeenCalledWith("song-1", "singer-1"));
    expect(screen.getByText("Who is singing?")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The selected singer is no longer in this session.",
    );
  });

  it("closes requester selection only after a successful add", async () => {
    const onAddSong = vi.fn().mockResolvedValue(true);
    renderSongList({ onAddSong });

    fireEvent.click(screen.getByRole("button", { name: /Sabrina Carpenter/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Queue" }));
    fireEvent.click(screen.getByRole("button", { name: "Kyle" }));

    await waitFor(() => expect(screen.queryByText("Who is singing?")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Add to Queue" })).toBeInTheDocument();
  });

  it("preserves search empty and artist collapse behavior", () => {
    const { rerender } = renderSongList();
    const artist = screen.getByRole("button", { name: /Sabrina Carpenter/ });
    fireEvent.click(artist);
    expect(artist).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(artist);
    expect(artist).toHaveAttribute("aria-expanded", "false");

    rerender(
      <LibrarySongList
        isSearchActive
        onAddSong={vi.fn()}
        queueError={null}
        singers={[]}
        songs={[]}
        totalSongCount={1}
      />,
    );
    expect(screen.getByText("No songs match this search.")).toBeInTheDocument();
  });
});
