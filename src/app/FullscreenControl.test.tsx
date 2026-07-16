import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FullscreenControl } from "./FullscreenControl";
import { useFullscreenWindow } from "./useFullscreenWindow";

const windowMocks = vi.hoisted(() => ({
  isFullscreen: vi.fn(),
  setFullscreen: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMocks,
}));

let nativeFullscreen = false;

function FullscreenHarness() {
  const fullscreen = useFullscreenWindow();
  return <FullscreenControl fullscreen={fullscreen} />;
}

beforeEach(() => {
  nativeFullscreen = false;
  windowMocks.isFullscreen.mockReset();
  windowMocks.setFullscreen.mockReset();
  windowMocks.isFullscreen.mockImplementation(() => Promise.resolve(nativeFullscreen));
  windowMocks.setFullscreen.mockImplementation((nextFullscreen: boolean) => {
    nativeFullscreen = nextFullscreen;
    return Promise.resolve();
  });
});

describe("FullscreenControl", () => {
  it("requests fullscreen from the native window and updates its accessible label", async () => {
    const user = userEvent.setup();
    render(<FullscreenHarness />);

    const enter = await screen.findByRole("button", { name: "Enter fullscreen" });
    expect(enter).toHaveAttribute("title", "Enter fullscreen (F11). Escape exits fullscreen.");
    await user.click(enter);
    expect(windowMocks.setFullscreen).toHaveBeenCalledWith(true);
    expect(await screen.findByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();
  });

  it("toggles with F11 without duplicate handling under StrictMode", async () => {
    render(
      <StrictMode>
        <FullscreenHarness />
      </StrictMode>,
    );
    await screen.findByRole("button", { name: "Enter fullscreen" });

    fireEvent.keyDown(window, { key: "F11" });

    await waitFor(() => expect(windowMocks.setFullscreen).toHaveBeenCalledTimes(1));
    expect(windowMocks.setFullscreen).toHaveBeenCalledWith(true);
  });

  it("uses Escape only to exit an active fullscreen window", async () => {
    const user = userEvent.setup();
    render(<FullscreenHarness />);
    const enter = await screen.findByRole("button", { name: "Enter fullscreen" });

    const windowedEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(windowedEscape);
    expect(windowedEscape.defaultPrevented).toBe(false);
    expect(windowMocks.setFullscreen).not.toHaveBeenCalled();

    await user.click(enter);
    await screen.findByRole("button", { name: "Exit fullscreen" });
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(windowMocks.setFullscreen).toHaveBeenLastCalledWith(false));
    expect(await screen.findByRole("button", { name: "Enter fullscreen" })).toBeInTheDocument();
  });

  it("keeps the verified native state and reports a failed request", async () => {
    const user = userEvent.setup();
    nativeFullscreen = true;
    windowMocks.setFullscreen.mockRejectedValueOnce(new Error("native failure"));
    render(<FullscreenHarness />);

    await user.click(await screen.findByRole("button", { name: "Exit fullscreen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Fullscreen could not be changed. Try again.",
    );
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();
  });
});
