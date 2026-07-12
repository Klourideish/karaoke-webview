import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { LyricDocument } from "./lyrics";
import type { LibraryScanResult, MediaSong } from "./media-library/types";
import type { LocalMicrophoneSource, PerformanceMicrophoneReadiness } from "./microphones/types";
import type { DiagnosticCaptureSnapshot } from "./microphones/diagnosticCapture";
import { DIAGNOSTIC_LEVEL_POLL_INTERVAL_MS } from "./microphones/useDiagnosticCapture";
import { LOCAL_MICROPHONE_REFRESH_INTERVAL_MS } from "./microphones/useLocalMicrophones";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
}));

let nextAnimationFrameId = 1;
let animationFrameCallbacks = new Map<number, FrameRequestCallback>();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (filePath: string) => `asset://localhost/${encodeURIComponent(filePath)}`,
  invoke: tauriMocks.invoke,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: tauriMocks.open,
}));

const emptyScanResult: LibraryScanResult = {
  rootPath: "C:\\Music",
  songs: [],
  issues: [],
  scannedDirectoryCount: 1,
  scannedFileCount: 0,
  supportedFileCount: 0,
  audioFileCount: 0,
  lyricFileCount: 0,
  completedAt: "1000Z",
};

const populatedScanResult: LibraryScanResult = {
  rootPath: "C:\\Music",
  songs: [
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
  ],
  issues: [
    {
      id: "issue-a",
      kind: "missing-lyrics",
      path: "Loose\\Missing Lyrics.opus",
      message: "This .opus file has no matching .ttml file in the same folder.",
    },
  ],
  scannedDirectoryCount: 3,
  scannedFileCount: 5,
  supportedFileCount: 4,
  audioFileCount: 2,
  lyricFileCount: 2,
  completedAt: "1000Z",
};

const cachedScanResult: LibraryScanResult = {
  ...populatedScanResult,
  songs: [
    {
      id: "song-cached",
      title: "Cached Song",
      artist: "Cached Artist",
      displayName: "Cached Artist - Cached Song",
      directoryPath: "C:\\Music\\Cached",
      audioPath: "C:\\Music\\Cached\\Cached Artist - Cached Song.opus",
      lyricPath: "C:\\Music\\Cached\\Cached Artist - Cached Song.ttml",
      fileStem: "Cached Artist - Cached Song",
    },
  ],
  issues: [],
  scannedDirectoryCount: 2,
  scannedFileCount: 2,
  supportedFileCount: 2,
  audioFileCount: 1,
  lyricFileCount: 1,
  completedAt: "900Z",
};

const noSupportedFilesScanResult: LibraryScanResult = {
  ...emptyScanResult,
  scannedDirectoryCount: 2,
  scannedFileCount: 4,
};

const discoveredMicrophones = [
  {
    id: "windows-mic-primary",
    displayName: "USB Microphone",
    kind: "windows-device" as const,
    availability: "available" as const,
    isDefault: true,
  },
  {
    id: "windows-mic-secondary",
    displayName: "USB Microphone",
    kind: "windows-device" as const,
    availability: "unavailable" as const,
    isDefault: false,
  },
];

const secondAvailableMicrophone = {
  id: "windows-mic-third",
  displayName: "Desk Microphone",
  kind: "windows-device" as const,
  availability: "available" as const,
  isDefault: false,
};

const microphoneChannel = {
  id: "microphone-channel-1",
  sourceId: "windows-mic-primary",
  sourceDisplayName: "USB Microphone",
  state: "available" as const,
};

const disconnectedMicrophoneChannel = {
  ...microphoneChannel,
  state: "disconnected" as const,
};

const microphoneAssignment = {
  channelId: "microphone-channel-1",
  singerId: "singer-1",
  method: "manual" as const,
  sequence: 1,
};

const microphoneWaitingState = {
  singerId: "singer-1",
  reason: "no-eligible-microphone" as const,
  message: "No available unassigned microphone channel or source was found.",
  sequence: 1,
};

const disconnectedRecoveryState = {
  channelId: microphoneChannel.id,
  status: "replacement-available" as const,
  sourcePresence: "missing" as const,
  reason: "One eligible replacement source is available; operator confirmation is required.",
  eligibleReplacementSourceIds: [secondAvailableMicrophone.id],
  automaticReplacementEligible: true,
};

const readyPerformanceMicrophoneReadiness: PerformanceMicrophoneReadiness = {
  status: "ready",
  mode: "standard",
  message: "Microphones are ready for Performance preparation.",
  lockedParticipants: [
    {
      singerId: "singer-1",
      channelId: microphoneChannel.id,
      sourceId: microphoneChannel.sourceId,
    },
  ],
  participants: [
    {
      singerId: "singer-1",
      status: "ready",
      reason: "ready",
      message: "Microphone path is ready for preparation.",
      assignment: microphoneAssignment,
      channel: microphoneChannel,
      recovery: null,
      captureAvailable: true,
    },
  ],
};

const idleCaptureSnapshot: DiagnosticCaptureSnapshot = {
  status: "idle",
  sessionId: null,
  sourceId: null,
  channelId: null,
  level: { rms: 0, peak: 0, clipping: false, sequence: 0 },
  error: null,
};

function activeCaptureSnapshot(
  sourceId = "windows-mic-primary",
  level = idleCaptureSnapshot.level,
): DiagnosticCaptureSnapshot {
  return {
    status: "active",
    sessionId: "diagnostic-capture-1",
    sourceId,
    channelId: `diagnostic-channel-${sourceId}`,
    level,
    error: null,
  };
}

const unpairedCandidatesScanResult: LibraryScanResult = {
  ...emptyScanResult,
  issues: [
    {
      id: "issue-unpaired",
      kind: "missing-lyrics",
      path: "Artist\\Artist - Song.opus",
      message: "This .opus file has no matching .ttml file in the same folder.",
    },
  ],
  scannedDirectoryCount: 2,
  scannedFileCount: 2,
  supportedFileCount: 1,
  audioFileCount: 1,
  lyricFileCount: 0,
};

const populatedLyricDocument: LyricDocument = {
  schemaVersion: 1,
  sourceSongId: "song-a",
  language: "en",
  warnings: [],
  lines: [
    {
      id: "line-a",
      beginMs: 1_000,
      endMs: 2_000,
      text: "Yesterday all my troubles",
      segments: [
        {
          id: "segment-a",
          beginMs: 1_000,
          endMs: 2_000,
          text: "Yesterday all my troubles",
          timingGranularity: "text",
          styleRefs: [],
        },
      ],
      role: null,
      region: null,
      styleRefs: [],
    },
    {
      id: "line-b",
      beginMs: 4_000,
      endMs: 5_000,
      text: "Seemed so far away",
      segments: [
        {
          id: "segment-b",
          beginMs: 4_000,
          endMs: 5_000,
          text: "Seemed so far away",
          timingGranularity: "text",
          styleRefs: [],
        },
      ],
      role: null,
      region: null,
      styleRefs: [],
    },
  ],
};

function mockInvokeWith({
  cacheResult = { status: "miss", scanResult: null, message: null },
  loadRoot = null,
  scanResult = emptyScanResult,
  lyricResult = populatedLyricDocument,
}: {
  cacheResult?: {
    status: "hit" | "miss" | "corrupt" | "root-mismatch" | "unsupported-schema";
    scanResult: LibraryScanResult | null;
    message: string | null;
  };
  loadRoot?: string | null;
  scanResult?: LibraryScanResult;
  lyricResult?: LyricDocument;
} = {}) {
  tauriMocks.invoke.mockImplementation(
    (command: string, args?: { song?: MediaSong; sourceId?: string }) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: loadRoot });
      }

      if (command === "save_library_root") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "load_library_index") {
        return Promise.resolve(cacheResult);
      }

      if (command === "save_library_index") {
        return Promise.resolve();
      }

      if (command === "clear_library_index") {
        return Promise.resolve();
      }

      if (command === "resolve_audio_source") {
        const firstSong = args?.song ?? scanResult.songs[0] ?? populatedScanResult.songs[0];
        return Promise.resolve({
          songId: firstSong.id,
          audioPath: firstSong.audioPath,
        });
      }

      if (command === "parse_song_lyrics") {
        const firstSong = args?.song ?? scanResult.songs[0] ?? populatedScanResult.songs[0];
        return Promise.resolve({
          ...lyricResult,
          sourceSongId: firstSong.id,
        });
      }

      if (command === "scan_media_library") {
        return Promise.resolve(scanResult);
      }

      if (command === "discover_local_microphone_sources") {
        return Promise.resolve([]);
      }

      if (command === "list_microphone_channels") {
        return Promise.resolve([]);
      }

      if (command === "sync_session_singers" || command === "list_microphone_assignments") {
        return Promise.resolve([]);
      }

      if (command === "list_microphone_waiting_states") {
        return Promise.resolve([]);
      }

      if (command === "get_microphone_recovery_states") {
        return Promise.resolve([]);
      }

      if (command === "evaluate_performance_microphone_readiness") {
        return Promise.resolve(readyPerformanceMicrophoneReadiness);
      }

      if (command === "start_diagnostic_capture") {
        return Promise.resolve(activeCaptureSnapshot(args?.sourceId));
      }

      if (command === "stop_diagnostic_capture" || command === "diagnostic_capture_snapshot") {
        return Promise.resolve(idleCaptureSnapshot);
      }

      return Promise.reject(new Error(`Unexpected command: ${command}`));
    },
  );
}

function mockSuccessfulLibraryInvoke(command: string) {
  if (command === "load_library_settings") {
    return Promise.resolve({ libraryRoot: "C:\\Music" });
  }

  if (command === "load_library_index") {
    return Promise.resolve({ status: "miss", scanResult: null, message: null });
  }

  if (command === "scan_media_library") {
    return Promise.resolve(populatedScanResult);
  }

  if (command === "save_library_index") {
    return Promise.resolve();
  }

  if (command === "save_library_root") {
    return Promise.resolve({ libraryRoot: "C:\\Music" });
  }

  if (command === "clear_library_index") {
    return Promise.resolve();
  }

  if (command === "discover_local_microphone_sources") {
    return Promise.resolve([]);
  }

  if (command === "list_microphone_channels") {
    return Promise.resolve([]);
  }

  if (command === "sync_session_singers" || command === "list_microphone_assignments") {
    return Promise.resolve([]);
  }

  if (command === "list_microphone_waiting_states") {
    return Promise.resolve([]);
  }

  if (command === "get_microphone_recovery_states") {
    return Promise.resolve([]);
  }

  if (command === "evaluate_performance_microphone_readiness") {
    return Promise.resolve(readyPerformanceMicrophoneReadiness);
  }

  if (command === "stop_diagnostic_capture" || command === "diagnostic_capture_snapshot") {
    return Promise.resolve(idleCaptureSnapshot);
  }

  return Promise.reject(new Error(`Unexpected command: ${command}`));
}

beforeEach(() => {
  tauriMocks.invoke.mockReset();
  tauriMocks.open.mockReset();
  tauriMocks.open.mockResolvedValue(null);
  nextAnimationFrameId = 1;
  animationFrameCallbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextAnimationFrameId;
    nextAnimationFrameId += 1;
    animationFrameCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    animationFrameCallbacks.delete(id);
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  mockInvokeWith();
});

afterEach(() => {
  vi.useRealTimers();
});

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

function renderStrictApp() {
  return render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

async function openLibraryWorkspace(user = userEvent.setup()) {
  await user.click(screen.getByRole("button", { name: "Library" }));
  return user;
}

async function openMicrophoneWorkspace(user = userEvent.setup()) {
  await user.click(screen.getByRole("button", { name: "Microphones" }));
  return user;
}

function getAudioElement() {
  return screen.getByTestId("persistent-audio-element") as HTMLAudioElement;
}

function setAudioNumberProperty(
  audio: HTMLAudioElement,
  property: "currentTime" | "duration",
  value: number,
) {
  Object.defineProperty(audio, property, {
    configurable: true,
    value,
    writable: true,
  });
}

function runAnimationFrame(time = 0) {
  const callbacks = Array.from(animationFrameCallbacks.values());
  animationFrameCallbacks.clear();
  act(() => {
    callbacks.forEach((callback) => callback(time));
  });
}

function getSongRow(title: string) {
  const row = screen.getByText(title).closest("article");
  if (!row) {
    throw new Error(`Could not find song row for ${title}`);
  }

  return row;
}

async function playSongFromLibrary(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(within(getSongRow(title)).getByRole("button", { name: "Play" }));
}

describe("App shell", () => {
  it("shows Perform as the default active workspace", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Karaoke Webview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Perform" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Perform" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("load_library_settings"));
  });

  it("renders readable horizontal navigation labels", async () => {
    const { container } = render(<App />);

    expect(screen.getByRole("button", { name: "Perform" })).toHaveTextContent("Perform");
    expect(screen.getByRole("button", { name: "Library" })).toHaveTextContent("Library");
    expect(screen.getByRole("button", { name: "Microphones" })).toHaveTextContent("Microphones");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveTextContent("Settings");
    expect(container.querySelector(".rotated-tab-label")).not.toBeInTheDocument();
    await waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("load_library_settings"));
  });

  it("keeps the queue and bottom transport rendered while Library is active", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Library" }));

    expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Queue" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: "Media transport" })).toBeInTheDocument();
  });

  it("keeps playback interaction only in the bottom transport", async () => {
    render(<App />);

    const topBar = screen.getByRole("banner", { name: "Application overview" });
    expect(within(topBar).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    await waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("load_library_settings"));
  });
});

describe("Microphone workspace", () => {
  it("shows loading and then an empty discovery state", async () => {
    const deferred = createDeferred<LocalMicrophoneSource[]>();
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return deferred.promise;
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);

    expect(screen.getByText("Discovering local microphone inputs...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();

    deferred.resolve([]);

    expect(
      await screen.findByText("No available local microphone inputs were found."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("renders available sources, hides unavailable sources, and keeps the default visible", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(discoveredMicrophones);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);

    expect(
      await screen.findByText("1 available local microphone input discovered."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "USB Microphone" })).toHaveLength(1);
    expect(screen.getByText("Default input")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("shows an available-source empty state when the registry contains only unavailable inputs", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve([discoveredMicrophones[1]]);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);

    expect(
      await screen.findByText("No available local microphone inputs were found."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "USB Microphone" })).not.toBeInTheDocument();
  });

  it("shows a recoverable discovery failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.reject(new Error("backend unavailable"));
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);

    expect(
      await screen.findByText("Could not discover local microphone inputs."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("refreshes discovery without creating channels or capture side effects", async () => {
    let discoveryCount = 0;
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        discoveryCount += 1;
        return Promise.resolve(discoveryCount === 1 ? [] : discoveredMicrophones);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await screen.findByText("No available local microphone inputs were found.");
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(
      await screen.findByText("1 available local microphone input discovered."),
    ).toBeInTheDocument();
    expect(discoveryCount).toBe(2);
    expect(screen.getByText("No microphone channels created.")).toBeInTheDocument();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "create_microphone_channel",
      expect.anything(),
    );
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "start_diagnostic_capture",
      expect.anything(),
    );
  });

  it("creates and removes a host-owned microphone channel", async () => {
    tauriMocks.invoke.mockImplementation((command: string, args?: { channelId?: string }) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(discoveredMicrophones);
      }
      if (command === "list_microphone_channels") {
        return Promise.resolve([]);
      }
      if (command === "create_microphone_channel") {
        return Promise.resolve(microphoneChannel);
      }
      if (command === "remove_microphone_channel") {
        expect(args?.channelId).toBe(microphoneChannel.id);
        return Promise.resolve();
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await screen.findByText("No microphone channels created.");
    await user.click(screen.getByRole("button", { name: "Create channel" }));

    expect(await screen.findByRole("heading", { name: microphoneChannel.id })).toBeInTheDocument();
    expect(tauriMocks.invoke).toHaveBeenCalledWith("create_microphone_channel", {
      sourceId: "windows-mic-primary",
    });

    await user.click(screen.getByRole("button", { name: "Release channel" }));

    expect(await screen.findByText("No microphone channels created.")).toBeInTheDocument();
    expect(tauriMocks.invoke).toHaveBeenCalledWith("remove_microphone_channel", {
      channelId: microphoneChannel.id,
    });
  });

  it("replaces a channel source without changing channel identity", async () => {
    const replaced = {
      ...microphoneChannel,
      sourceId: secondAvailableMicrophone.id,
      sourceDisplayName: secondAvailableMicrophone.displayName,
    };
    tauriMocks.invoke.mockImplementation(
      (command: string, args?: { channelId?: string; sourceId?: string }) => {
        if (command === "discover_local_microphone_sources") {
          return Promise.resolve([discoveredMicrophones[0], secondAvailableMicrophone]);
        }
        if (command === "list_microphone_channels") {
          return Promise.resolve([microphoneChannel]);
        }
        if (command === "replace_microphone_channel_source") {
          expect(args).toEqual({
            channelId: microphoneChannel.id,
            sourceId: secondAvailableMicrophone.id,
          });
          return Promise.resolve(replaced);
        }
        return mockSuccessfulLibraryInvoke(command);
      },
    );
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    const sourceSelect = await screen.findByRole("combobox", { name: "Source" });
    await user.selectOptions(sourceSelect, secondAvailableMicrophone.id);

    expect(await screen.findByText("Desk Microphone · Available")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: microphoneChannel.id })).toBeInTheDocument();
  });

  it("does not duplicate explicit channel creation in StrictMode", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(discoveredMicrophones);
      }
      if (command === "list_microphone_channels") {
        return Promise.resolve([]);
      }
      if (command === "create_microphone_channel") {
        return Promise.resolve(microphoneChannel);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    renderStrictApp();

    await openMicrophoneWorkspace(user);
    await user.click(await screen.findByRole("button", { name: "Create channel" }));
    await screen.findByRole("heading", { name: microphoneChannel.id });

    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "create_microphone_channel"),
    ).toHaveLength(1);
  });

  it("assigns and unassigns a channel without capture side effects", async () => {
    tauriMocks.invoke.mockImplementation(
      (command: string, args?: { channelId?: string; singerId?: string }) => {
        if (command === "discover_local_microphone_sources") {
          return Promise.resolve(discoveredMicrophones);
        }
        if (command === "list_microphone_channels") {
          return Promise.resolve([microphoneChannel]);
        }
        if (command === "sync_session_singers") {
          return Promise.resolve([]);
        }
        if (command === "assign_microphone_channel") {
          expect(args).toEqual({ channelId: microphoneChannel.id, singerId: "singer-1" });
          return Promise.resolve(microphoneAssignment);
        }
        if (command === "unassign_microphone_channel") {
          expect(args).toEqual({ channelId: microphoneChannel.id });
          return Promise.resolve();
        }
        return mockSuccessfulLibraryInvoke(command);
      },
    );
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    const assignmentSelect = await screen.findByRole("combobox", { name: "Assigned singer" });
    await user.selectOptions(assignmentSelect, "singer-1");

    expect(assignmentSelect).toHaveValue("singer-1");
    expect(screen.getByRole("button", { name: "Release channel" })).toBeDisabled();

    await user.selectOptions(assignmentSelect, "");

    expect(assignmentSelect).toHaveValue("");
    expect(screen.getByRole("button", { name: "Release channel" })).toBeEnabled();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "start_diagnostic_capture",
      expect.anything(),
    );
  });

  it("reassigns a channel and preserves it across workspace remount", async () => {
    const reassigned = { ...microphoneAssignment, singerId: "singer-2", sequence: 2 };
    tauriMocks.invoke.mockImplementation(
      (command: string, args?: { channelId?: string; singerId?: string }) => {
        if (command === "discover_local_microphone_sources") {
          return Promise.resolve(discoveredMicrophones);
        }
        if (command === "list_microphone_channels") {
          return Promise.resolve([microphoneChannel]);
        }
        if (command === "sync_session_singers") {
          return Promise.resolve([microphoneAssignment]);
        }
        if (command === "assign_microphone_channel") {
          expect(args).toEqual({ channelId: microphoneChannel.id, singerId: "singer-2" });
          return Promise.resolve(reassigned);
        }
        return mockSuccessfulLibraryInvoke(command);
      },
    );
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Assigned singer" }),
      "singer-2",
    );
    expect(screen.getByRole("combobox", { name: "Assigned singer" })).toHaveValue("singer-2");

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Microphones" }));

    expect(await screen.findByRole("combobox", { name: "Assigned singer" })).toHaveValue(
      "singer-2",
    );
  });

  it("does not duplicate explicit assignment in StrictMode", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(discoveredMicrophones);
      }
      if (command === "list_microphone_channels") {
        return Promise.resolve([microphoneChannel]);
      }
      if (command === "sync_session_singers") {
        return Promise.resolve([]);
      }
      if (command === "assign_microphone_channel") {
        return Promise.resolve(microphoneAssignment);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    renderStrictApp();

    await openMicrophoneWorkspace(user);
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Assigned singer" }),
      "singer-1",
    );

    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "assign_microphone_channel"),
    ).toHaveLength(1);
  });

  it("automatically assigns a singer and refreshes a newly created channel", async () => {
    let channels: (typeof microphoneChannel)[] = [];
    tauriMocks.invoke.mockImplementation((command: string, args?: { singerId?: string }) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(discoveredMicrophones);
      }
      if (command === "list_microphone_channels") {
        return Promise.resolve(channels);
      }
      if (command === "sync_session_singers" || command === "list_microphone_waiting_states") {
        return Promise.resolve([]);
      }
      if (command === "auto_assign_microphone_channel") {
        expect(args).toEqual({ singerId: "singer-1" });
        channels = [microphoneChannel];
        return Promise.resolve({
          status: "assigned",
          assignment: { ...microphoneAssignment, method: "automatic" },
          waitingState: null,
        });
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await user.click(screen.getAllByRole("button", { name: "Auto Assign" })[0]);

    expect(await screen.findByText(`${microphoneChannel.id} · Available`)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: microphoneChannel.id })).toBeInTheDocument();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "start_diagnostic_capture",
      expect.anything(),
    );
  });

  it("shows and explicitly clears a waiting-for-microphone reason", async () => {
    tauriMocks.invoke.mockImplementation((command: string, args?: { singerId?: string }) => {
      if (
        command === "discover_local_microphone_sources" ||
        command === "list_microphone_channels"
      ) {
        return Promise.resolve([]);
      }
      if (command === "sync_session_singers" || command === "list_microphone_waiting_states") {
        return Promise.resolve([]);
      }
      if (command === "auto_assign_microphone_channel") {
        return Promise.resolve({
          status: "waiting",
          assignment: null,
          waitingState: microphoneWaitingState,
        });
      }
      if (command === "clear_microphone_waiting_state") {
        expect(args).toEqual({ singerId: "singer-1" });
        return Promise.resolve();
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await user.click(screen.getAllByRole("button", { name: "Auto Assign" })[0]);

    expect(await screen.findByText(microphoneWaitingState.message)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear waiting status" }));
    expect(await screen.findAllByText("No microphone assigned.")).toHaveLength(4);
  });

  it("preserves waiting state across workspace remount", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (
        command === "discover_local_microphone_sources" ||
        command === "list_microphone_channels"
      ) {
        return Promise.resolve([]);
      }
      if (command === "sync_session_singers") {
        return Promise.resolve([]);
      }
      if (command === "list_microphone_waiting_states") {
        return Promise.resolve([microphoneWaitingState]);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    expect(await screen.findByText(microphoneWaitingState.message)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Microphones" }));

    expect(await screen.findByText(microphoneWaitingState.message)).toBeInTheDocument();
  });

  it("does not duplicate automatic assignment in StrictMode", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(discoveredMicrophones);
      }
      if (command === "list_microphone_channels") {
        return Promise.resolve([microphoneChannel]);
      }
      if (command === "sync_session_singers" || command === "list_microphone_waiting_states") {
        return Promise.resolve([]);
      }
      if (command === "auto_assign_microphone_channel") {
        return Promise.resolve({
          status: "assigned",
          assignment: { ...microphoneAssignment, method: "automatic" },
          waitingState: null,
        });
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    renderStrictApp();

    await openMicrophoneWorkspace(user);
    await user.click(screen.getAllByRole("button", { name: "Auto Assign" })[0]);
    await screen.findByText(`${microphoneChannel.id} · Available`);

    expect(
      tauriMocks.invoke.mock.calls.filter(
        ([command]) => command === "auto_assign_microphone_channel",
      ),
    ).toHaveLength(1);
  });

  it("keeps a disconnected channel assigned and separate from waiting state", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve([secondAvailableMicrophone]);
      }
      if (command === "list_microphone_channels") {
        return Promise.resolve([disconnectedMicrophoneChannel]);
      }
      if (command === "sync_session_singers") {
        return Promise.resolve([microphoneAssignment]);
      }
      if (command === "list_microphone_waiting_states") {
        return Promise.resolve([]);
      }
      if (command === "get_microphone_recovery_states") {
        return Promise.resolve([disconnectedRecoveryState]);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);

    expect(await screen.findByText(`${microphoneChannel.id} · Disconnected`)).toBeInTheDocument();
    expect(screen.getByText(/Recovery: Replacement Available/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Assigned singer" })).toHaveValue("singer-1");
    expect(screen.queryByText(microphoneWaitingState.message)).not.toBeInTheDocument();
  });

  it("retries the original source without changing assignment or starting capture", async () => {
    const failedState = {
      ...disconnectedRecoveryState,
      status: "recovery-failed" as const,
      reason: "The original microphone source is still unavailable.",
    };
    let retryFailed = false;
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve([secondAvailableMicrophone]);
      }
      if (command === "list_microphone_channels") {
        return Promise.resolve([disconnectedMicrophoneChannel]);
      }
      if (command === "sync_session_singers") {
        return Promise.resolve([microphoneAssignment]);
      }
      if (command === "list_microphone_waiting_states") {
        return Promise.resolve([]);
      }
      if (command === "get_microphone_recovery_states") {
        return Promise.resolve([retryFailed ? failedState : disconnectedRecoveryState]);
      }
      if (command === "retry_microphone_channel_source") {
        retryFailed = true;
        return Promise.resolve(failedState);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    renderStrictApp();

    await openMicrophoneWorkspace(user);
    await user.click(await screen.findByRole("button", { name: "Retry original source" }));

    expect(await screen.findByText(/Recovery: Recovery Failed/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Assigned singer" })).toHaveValue("singer-1");
    expect(
      tauriMocks.invoke.mock.calls.filter(
        ([command]) => command === "retry_microphone_channel_source",
      ),
    ).toHaveLength(1);
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "start_diagnostic_capture",
      expect.anything(),
    );
  });

  it("explicitly replaces a disconnected source while preserving channel and assignment", async () => {
    const recoveredChannel = {
      ...microphoneChannel,
      sourceId: secondAvailableMicrophone.id,
      sourceDisplayName: secondAvailableMicrophone.displayName,
    };
    tauriMocks.invoke.mockImplementation(
      (command: string, args?: { channelId?: string; sourceId?: string }) => {
        if (command === "discover_local_microphone_sources") {
          return Promise.resolve([secondAvailableMicrophone]);
        }
        if (command === "list_microphone_channels") {
          return Promise.resolve([disconnectedMicrophoneChannel]);
        }
        if (command === "sync_session_singers") {
          return Promise.resolve([microphoneAssignment]);
        }
        if (command === "list_microphone_waiting_states") {
          return Promise.resolve([]);
        }
        if (command === "get_microphone_recovery_states") {
          return Promise.resolve([disconnectedRecoveryState]);
        }
        if (command === "replace_disconnected_microphone_channel_source") {
          expect(args).toEqual({
            channelId: microphoneChannel.id,
            sourceId: secondAvailableMicrophone.id,
          });
          return Promise.resolve(recoveredChannel);
        }
        return mockSuccessfulLibraryInvoke(command);
      },
    );
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Replace source" }),
      secondAvailableMicrophone.id,
    );

    expect(await screen.findByText("Desk Microphone · Available")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: microphoneChannel.id })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Assigned singer" })).toHaveValue("singer-1");
  });

  it("leaves a disconnected channel assigned across workspace remount", async () => {
    const heldState = {
      ...disconnectedRecoveryState,
      status: "disconnected" as const,
      reason: "Left assigned while the operator decides how to recover it.",
    };
    let held = false;
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve([secondAvailableMicrophone]);
      }
      if (command === "list_microphone_channels") {
        return Promise.resolve([disconnectedMicrophoneChannel]);
      }
      if (command === "sync_session_singers") {
        return Promise.resolve([microphoneAssignment]);
      }
      if (command === "list_microphone_waiting_states") {
        return Promise.resolve([]);
      }
      if (command === "get_microphone_recovery_states") {
        return Promise.resolve([held ? heldState : disconnectedRecoveryState]);
      }
      if (command === "leave_microphone_channel_assigned") {
        held = true;
        return Promise.resolve(heldState);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await user.click(await screen.findByRole("button", { name: "Leave assigned" }));
    expect(await screen.findByText(/Left assigned while/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Microphones" }));

    expect(await screen.findByText(/Left assigned while/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Assigned singer" })).toHaveValue("singer-1");
  });

  it("checks Standard performance microphone readiness for assigned participants", async () => {
    tauriMocks.invoke.mockImplementation(
      (command: string, args?: { request?: { participantSingerIds?: string[] } }) => {
        if (command === "discover_local_microphone_sources") {
          return Promise.resolve(discoveredMicrophones);
        }
        if (command === "list_microphone_channels") {
          return Promise.resolve([microphoneChannel]);
        }
        if (command === "sync_session_singers") {
          return Promise.resolve([microphoneAssignment]);
        }
        if (command === "list_microphone_waiting_states") {
          return Promise.resolve([]);
        }
        if (command === "evaluate_performance_microphone_readiness") {
          expect(args).toEqual({
            request: {
              mode: "standard",
              participantSingerIds: ["singer-1"],
              allowAutomaticRecovery: true,
              phase: "preparing",
            },
          });
          return Promise.resolve(readyPerformanceMicrophoneReadiness);
        }
        return mockSuccessfulLibraryInvoke(command);
      },
    );
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await user.click(await screen.findByRole("button", { name: "Check readiness" }));

    expect(await screen.findByText(/Status: Ready/)).toBeInTheDocument();
    expect(screen.getByText("Locked microphone participant: 1")).toBeInTheDocument();
    expect(screen.getByText("Ready · Ready")).toBeInTheDocument();
    expect(screen.getAllByText(`${microphoneChannel.id} · Available`).length).toBeGreaterThan(0);
  });

  it("shows diagnostic capture as a Performance readiness blocker", async () => {
    const blockedReadiness: PerformanceMicrophoneReadiness = {
      ...readyPerformanceMicrophoneReadiness,
      status: "blocked",
      message: "Stop diagnostic capture before preparing this Performance.",
      lockedParticipants: [],
      participants: [
        {
          ...readyPerformanceMicrophoneReadiness.participants[0],
          status: "blocked",
          reason: "diagnostic-session-active",
          message: "A diagnostic capture session is using this microphone source.",
          captureAvailable: false,
        },
      ],
    };
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(discoveredMicrophones);
      }
      if (command === "list_microphone_channels") {
        return Promise.resolve([microphoneChannel]);
      }
      if (command === "sync_session_singers") {
        return Promise.resolve([microphoneAssignment]);
      }
      if (command === "list_microphone_waiting_states") {
        return Promise.resolve([]);
      }
      if (command === "evaluate_performance_microphone_readiness") {
        return Promise.resolve(blockedReadiness);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await user.click(await screen.findByRole("button", { name: "Check readiness" }));

    expect(await screen.findByText(/Status: Blocked/)).toBeInTheDocument();
    expect(screen.getByText(/Diagnostic Session Active/)).toBeInTheDocument();
    expect(
      screen.getByText("A diagnostic capture session is using this microphone source."),
    ).toBeInTheDocument();
  });

  it("refreshes visible channel and recovery state after readiness performs safe recovery", async () => {
    const recoveredChannel = {
      ...microphoneChannel,
      sourceId: secondAvailableMicrophone.id,
      sourceDisplayName: secondAvailableMicrophone.displayName,
    };
    const recoveredReadiness: PerformanceMicrophoneReadiness = {
      ...readyPerformanceMicrophoneReadiness,
      lockedParticipants: [
        {
          singerId: "singer-1",
          channelId: recoveredChannel.id,
          sourceId: recoveredChannel.sourceId,
        },
      ],
      participants: [
        {
          ...readyPerformanceMicrophoneReadiness.participants[0],
          channel: recoveredChannel,
        },
      ],
    };
    let recovered = false;
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve([secondAvailableMicrophone]);
      }
      if (command === "list_microphone_channels") {
        return Promise.resolve([recovered ? recoveredChannel : disconnectedMicrophoneChannel]);
      }
      if (command === "sync_session_singers") {
        return Promise.resolve([microphoneAssignment]);
      }
      if (command === "list_microphone_waiting_states") {
        return Promise.resolve([]);
      }
      if (command === "get_microphone_recovery_states") {
        return Promise.resolve(recovered ? [] : [disconnectedRecoveryState]);
      }
      if (command === "evaluate_performance_microphone_readiness") {
        recovered = true;
        return Promise.resolve(recoveredReadiness);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    expect(await screen.findByText("USB Microphone · Disconnected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check readiness" }));

    expect(await screen.findByText("Desk Microphone · Available")).toBeInTheDocument();
    expect(screen.getByText(/Status: Ready/)).toBeInTheDocument();
  });

  it("updates the visible registry after an automatic discovery refresh", async () => {
    vi.useFakeTimers();
    let discoveryCount = 0;
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        discoveryCount += 1;
        return Promise.resolve(discoveryCount === 1 ? [] : discoveredMicrophones);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Microphones" }));
    expect(
      screen.getByText("No available local microphone inputs were found."),
    ).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(LOCAL_MICROPHONE_REFRESH_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("1 available local microphone input discovered.")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "USB Microphone" })).toHaveLength(1);
  });

  it("keeps the diagnostic meter idle until Start Test is explicitly used", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(discoveredMicrophones);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await screen.findByText("State: Idle");

    expect(screen.getByRole("meter", { name: "RMS level" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("meter", { name: "Peak level" })).toHaveAttribute("aria-valuenow", "0");
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "start_diagnostic_capture",
      expect.anything(),
    );
  });

  it("starts, updates normalized levels, reports clipping, and stops", async () => {
    vi.useFakeTimers();
    const levelSnapshot = activeCaptureSnapshot("windows-mic-primary", {
      rms: 0.4,
      peak: 0.995,
      clipping: true,
      sequence: 2,
    });
    tauriMocks.invoke.mockImplementation((command: string, args?: { sourceId?: string }) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(discoveredMicrophones);
      }
      if (command === "start_diagnostic_capture") {
        return Promise.resolve(activeCaptureSnapshot(args?.sourceId));
      }
      if (command === "diagnostic_capture_snapshot") {
        return Promise.resolve(levelSnapshot);
      }
      if (command === "stop_diagnostic_capture") {
        return Promise.resolve(idleCaptureSnapshot);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Microphones" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Test" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("State: Active")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(DIAGNOSTIC_LEVEL_POLL_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("meter", { name: "RMS level" })).toHaveAttribute(
      "aria-valuenow",
      "0.4",
    );
    expect(screen.getByRole("meter", { name: "Peak level" })).toHaveAttribute(
      "aria-valuenow",
      "0.995",
    );
    expect(screen.getByText("Clipping detected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop Test" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("State: Idle")).toBeInTheDocument();
  });

  it("ignores a stale level snapshot after the session stops", async () => {
    vi.useFakeTimers();
    const pendingSnapshot = createDeferred<DiagnosticCaptureSnapshot>();
    tauriMocks.invoke.mockImplementation((command: string, args?: { sourceId?: string }) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(discoveredMicrophones);
      }
      if (command === "start_diagnostic_capture") {
        return Promise.resolve(activeCaptureSnapshot(args?.sourceId));
      }
      if (command === "diagnostic_capture_snapshot") {
        return pendingSnapshot.promise;
      }
      if (command === "stop_diagnostic_capture") {
        return Promise.resolve(idleCaptureSnapshot);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Microphones" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Test" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(DIAGNOSTIC_LEVEL_POLL_INTERVAL_MS);
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop Test" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    pendingSnapshot.resolve(
      activeCaptureSnapshot("windows-mic-primary", {
        rms: 0.8,
        peak: 0.9,
        clipping: false,
        sequence: 9,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("State: Idle")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "RMS level" })).toHaveAttribute("aria-valuenow", "0");
  });

  it("stops active capture before changing microphone selection", async () => {
    tauriMocks.invoke.mockImplementation((command: string, args?: { sourceId?: string }) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve([discoveredMicrophones[0], secondAvailableMicrophone]);
      }
      if (command === "start_diagnostic_capture") {
        return Promise.resolve(activeCaptureSnapshot(args?.sourceId));
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await user.click(screen.getByRole("button", { name: "Start Test" }));
    await screen.findByText("State: Active");
    await user.selectOptions(screen.getByLabelText("Microphone"), "windows-mic-third");

    await waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("stop_diagnostic_capture"));
    expect(screen.getByLabelText("Microphone")).toHaveValue("windows-mic-third");
  });

  it("stops active capture when the diagnostic workspace closes", async () => {
    tauriMocks.invoke.mockImplementation((command: string, args?: { sourceId?: string }) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(discoveredMicrophones);
      }
      if (command === "start_diagnostic_capture") {
        return Promise.resolve(activeCaptureSnapshot(args?.sourceId));
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await user.click(screen.getByRole("button", { name: "Start Test" }));
    await screen.findByText("State: Active");
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("stop_diagnostic_capture"));
  });

  it("stops active capture when the selected microphone disconnects", async () => {
    vi.useFakeTimers();
    let connected = true;
    const active = activeCaptureSnapshot();
    tauriMocks.invoke.mockImplementation((command: string, args?: { sourceId?: string }) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(connected ? discoveredMicrophones : []);
      }
      if (command === "start_diagnostic_capture") {
        return Promise.resolve(activeCaptureSnapshot(args?.sourceId));
      }
      if (command === "diagnostic_capture_snapshot") {
        return Promise.resolve(active);
      }
      if (command === "stop_diagnostic_capture") {
        return Promise.resolve(idleCaptureSnapshot);
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Microphones" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Test" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    connected = false;
    await act(async () => {
      vi.advanceTimersByTime(LOCAL_MICROPHONE_REFRESH_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith("stop_diagnostic_capture");
    expect(screen.getByText("State: Idle")).toBeInTheDocument();
  });

  it("shows a failed state when capture cannot start", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(discoveredMicrophones);
      }
      if (command === "start_diagnostic_capture") {
        return Promise.reject(new Error("device busy"));
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await user.click(screen.getByRole("button", { name: "Start Test" }));

    expect(await screen.findByText("State: Failed")).toBeInTheDocument();
    expect(screen.getByText("Could not start the microphone test.")).toBeInTheDocument();
  });
});

describe("Library workspace", () => {
  it("shows the no-folder-selected state", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openLibraryWorkspace(user);

    expect(await screen.findByText("No music folder selected.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Choose music folder" }).length).toBeGreaterThan(
      0,
    );
  });

  it("cancelling folder selection preserves the current state", async () => {
    const user = userEvent.setup();
    tauriMocks.open.mockResolvedValue(null);
    render(<App />);

    await openLibraryWorkspace(user);
    await screen.findByText("No music folder selected.");
    await user.click(screen.getAllByRole("button", { name: "Choose music folder" })[0]);

    expect(tauriMocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false }),
    );
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "save_library_root",
      expect.objectContaining({ rootPath: expect.any(String) }),
    );
    expect(screen.getByText("No music folder selected.")).toBeInTheDocument();
  });

  it("successful folder selection persists the root and scans", async () => {
    const user = userEvent.setup();
    tauriMocks.open.mockResolvedValue("C:\\Music");
    mockInvokeWith({ scanResult: populatedScanResult });
    render(<App />);

    await openLibraryWorkspace(user);
    await screen.findByText("No music folder selected.");
    await user.click(screen.getAllByRole("button", { name: "Choose music folder" })[0]);

    await screen.findByText("Hey Jude");
    expect(tauriMocks.invoke).toHaveBeenCalledWith("save_library_root", { rootPath: "C:\\Music" });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("scan_media_library", { rootPath: "C:\\Music" });
  });

  it("restored folder triggers one scan", async () => {
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("scan_media_library", {
        rootPath: "C:\\Music",
      }),
    );

    const scanCalls = tauriMocks.invoke.mock.calls.filter(
      ([command]) => command === "scan_media_library",
    );
    expect(scanCalls).toHaveLength(1);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("load_library_index", {
      rootPath: "C:\\Music",
    });
  });

  it("shows cached songs before background validation resolves", async () => {
    const pendingScan = createDeferred<LibraryScanResult>();
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "load_library_index") {
        return Promise.resolve({
          status: "hit",
          scanResult: cachedScanResult,
          message: null,
        });
      }

      if (command === "scan_media_library") {
        return pendingScan.promise;
      }

      if (command === "save_library_index") {
        return Promise.resolve();
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    render(<App />);
    await openLibraryWorkspace();

    expect(await screen.findByText("Cached Song")).toBeInTheDocument();
    expect(screen.getByText("Showing saved library · checking for changes...")).toBeInTheDocument();

    pendingScan.resolve(populatedScanResult);

    expect(await screen.findByText("Hey Jude")).toBeInTheDocument();
    expect(screen.queryByText("Cached Song")).not.toBeInTheDocument();
    expect(screen.getByText("Library updated")).toBeInTheDocument();
  });

  it("keeps cached songs searchable while validation is running", async () => {
    const user = userEvent.setup();
    const pendingScan = createDeferred<LibraryScanResult>();
    mockInvokeWith({
      loadRoot: "C:\\Music",
      cacheResult: {
        status: "hit",
        scanResult: cachedScanResult,
        message: null,
      },
    });
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "load_library_index") {
        return Promise.resolve({
          status: "hit",
          scanResult: cachedScanResult,
          message: null,
        });
      }

      if (command === "scan_media_library") {
        return pendingScan.promise;
      }

      if (command === "save_library_index") {
        return Promise.resolve();
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    render(<App />);
    await openLibraryWorkspace(user);

    await user.type(await screen.findByLabelText("Search library"), "cached artist");
    expect(screen.getByText("Cached Song")).toBeInTheDocument();
    expect(screen.getByText("Showing saved library · checking for changes...")).toBeInTheDocument();

    pendingScan.resolve(populatedScanResult);
    expect(await screen.findByText("No search results")).toBeInTheDocument();
  });

  it("preserves cached songs when background validation fails", async () => {
    const pendingScan = createDeferred<LibraryScanResult>();
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "load_library_index") {
        return Promise.resolve({
          status: "hit",
          scanResult: cachedScanResult,
          message: null,
        });
      }

      if (command === "scan_media_library") {
        return pendingScan.promise;
      }

      if (command === "save_library_index") {
        return Promise.resolve();
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    render(<App />);
    await openLibraryWorkspace();
    await screen.findByText("Cached Song");

    pendingScan.reject("The selected library folder is not available.");

    expect(
      await screen.findByText("Library check failed · showing last known results"),
    ).toBeInTheDocument();
    expect(screen.getByText("Cached Song")).toBeInTheDocument();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "save_library_index",
      expect.objectContaining({ scanResult: expect.anything() }),
    );
  });

  it("does not render a root-mismatched cache", async () => {
    const pendingScan = createDeferred<LibraryScanResult>();
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "load_library_index") {
        return Promise.resolve({
          status: "root-mismatch",
          scanResult: null,
          message: null,
        });
      }

      if (command === "scan_media_library") {
        return pendingScan.promise;
      }

      if (command === "save_library_index") {
        return Promise.resolve();
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    render(<App />);
    await openLibraryWorkspace();

    expect(await screen.findByText("Checking library for changes...")).toBeInTheDocument();
    expect(screen.queryByText("Cached Song")).not.toBeInTheDocument();

    pendingScan.resolve(populatedScanResult);
    expect(await screen.findByText("Hey Jude")).toBeInTheDocument();
  });

  it("does not duplicate authoritative validation scans in StrictMode", async () => {
    const pendingScan = createDeferred<LibraryScanResult>();
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "load_library_index") {
        return Promise.resolve({
          status: "hit",
          scanResult: cachedScanResult,
          message: null,
        });
      }

      if (command === "scan_media_library") {
        return pendingScan.promise;
      }

      if (command === "save_library_index") {
        return Promise.resolve();
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    renderStrictApp();
    await openLibraryWorkspace();
    await screen.findByText("Cached Song");

    const scanCalls = tauriMocks.invoke.mock.calls.filter(
      ([command]) => command === "scan_media_library",
    );
    expect(scanCalls).toHaveLength(1);

    pendingScan.resolve(populatedScanResult);
    expect(await screen.findByText("Hey Jude")).toBeInTheDocument();
  });

  it("renders loading state while scanning", async () => {
    let resolveScan: (value: LibraryScanResult) => void = () => undefined;
    const pendingScan = new Promise<LibraryScanResult>((resolve) => {
      resolveScan = resolve;
    });
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "scan_media_library") {
        return pendingScan;
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    render(<App />);
    await openLibraryWorkspace();

    expect(await screen.findByText("Scanning for .opus and .ttml pairs...")).toBeInTheDocument();
    resolveScan(populatedScanResult);
    expect(await screen.findByText("Hey Jude")).toBeInTheDocument();
  });

  it("exits restoring and scanning after a successful restored-root scan in StrictMode", async () => {
    const pendingScan = createDeferred<LibraryScanResult>();
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "scan_media_library") {
        return pendingScan.promise;
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    renderStrictApp();
    await openLibraryWorkspace();

    expect(await screen.findByText("Scanning for .opus and .ttml pairs...")).toBeInTheDocument();

    pendingScan.resolve(populatedScanResult);

    expect(await screen.findByText("Hey Jude")).toBeInTheDocument();
    expect(
      screen.getByText("Scan complete · 3 folders · 5 files · 2 songs · 1 issues"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Restoring saved library folder...")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Scanning for .opus and .ttml pairs...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rescan" })).toBeEnabled();
  });

  it("renders songs and diagnostics from a successful scan", async () => {
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace();

    expect(await screen.findByText("Hey Jude")).toBeInTheDocument();
    expect(
      screen.getByText("Scan complete · 3 folders · 5 files · 2 songs · 1 issues"),
    ).toBeInTheDocument();
    expect(screen.getByText("The Beatles")).toBeInTheDocument();
    expect(screen.getByText("Diagnostics (1)")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Diagnostics (1)"));
    expect(screen.getByText("Missing lyrics")).toBeInTheDocument();
    expect(screen.getByText("Loose\\Missing Lyrics.opus")).toBeInTheDocument();
  });

  it("loads a Library song into the persistent player and updates metadata", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");

    await playSongFromLibrary(user, "Hey Jude");

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("resolve_audio_source", {
        song: populatedScanResult.songs[0],
      }),
    );
    expect(screen.getByRole("region", { name: "Current song information" })).toHaveTextContent(
      "The Beatles - Hey Jude",
    );
    expect(screen.getByRole("contentinfo", { name: "Media transport" })).toHaveTextContent(
      "Hey Jude",
    );
    expect(getAudioElement().src).toContain("The%20Beatles%20-%20Hey%20Jude.opus");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Queue" })).toHaveTextContent(
      "No songs queued yet.",
    );
  });

  it("keeps one audio element mounted while switching workspaces", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    const { container } = render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");
    const audio = getAudioElement();

    await user.click(screen.getByRole("button", { name: "Perform" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Library" }));

    expect(container.querySelectorAll("audio")).toHaveLength(1);
    expect(getAudioElement()).toBe(audio);
  });

  it("preserves the playing transport label while switching workspaces", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");
    await playSongFromLibrary(user, "Hey Jude");

    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Perform" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("reflects media events for duration, time, seek, volume, pause, and ended", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");
    await playSongFromLibrary(user, "Hey Jude");

    const audio = getAudioElement();
    const transport = screen.getByRole("contentinfo", { name: "Media transport" });
    setAudioNumberProperty(audio, "duration", 125);
    setAudioNumberProperty(audio, "currentTime", 30);
    fireEvent.loadedMetadata(audio);
    fireEvent.timeUpdate(audio);

    expect(screen.getByText("0:30")).toBeInTheDocument();
    expect(screen.getByText("2:05")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();

    fireEvent.pause(audio);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(within(transport).getByRole("button", { name: "Play" })).toBeInTheDocument();

    fireEvent.play(audio);
    expect(within(transport).getByRole("button", { name: "Pause" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), { target: { value: "45" } });
    expect(audio.currentTime).toBe(45);

    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "35" } });
    expect(audio.volume).toBe(0.35);

    setAudioNumberProperty(audio, "currentTime", 125);
    fireEvent.ended(audio);
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(within(transport).getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Queue" })).toHaveTextContent(
      "No songs queued yet.",
    );
  });

  it("handles rejected play promises and allows retry from the transport", async () => {
    const user = userEvent.setup();
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("blocked"));
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");

    await playSongFromLibrary(user, "Hey Jude");

    expect(
      await screen.findByText("Playback could not start. Press Play to try again."),
    ).toBeInTheDocument();

    vi.mocked(HTMLMediaElement.prototype.play).mockResolvedValueOnce(undefined);
    const transport = screen.getByRole("contentinfo", { name: "Media transport" });
    await user.click(within(transport).getByRole("button", { name: "Play" }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it("shows recoverable media errors and can replace the song afterward", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");

    await playSongFromLibrary(user, "Hey Jude");
    const audio = getAudioElement();
    fireEvent.error(audio);
    expect(screen.getByText("Playback failed.")).toBeInTheDocument();

    const secondSongRow = screen.getByText("Jóga").closest("article");
    expect(secondSongRow).not.toBeNull();
    await user.click(within(secondSongRow as HTMLElement).getByRole("button", { name: "Play" }));
    expect(screen.getByRole("region", { name: "Current song information" })).toHaveTextContent(
      "Björk - Jóga",
    );
  });

  it("parses lyrics for a loaded song and updates the Perform view from the audio clock", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");

    await playSongFromLibrary(user, "Hey Jude");
    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("parse_song_lyrics", {
        song: populatedScanResult.songs[0],
      }),
    );

    await user.click(screen.getByRole("button", { name: "Perform" }));
    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 1.2);
    fireEvent.timeUpdate(audio);

    expect(await screen.findByText("Yesterday all my troubles")).toBeInTheDocument();
    expect(screen.getByText("Seemed so far away")).toBeInTheDocument();
  });

  it("renders current lyric fragments in source order with static fragment states", async () => {
    const user = userEvent.setup();
    const fragmentLyricDocument: LyricDocument = {
      ...populatedLyricDocument,
      lines: [
        {
          id: "line-fragments",
          beginMs: 1_000,
          endMs: 3_000,
          text: "Time to celebrate",
          role: null,
          region: null,
          styleRefs: [],
          segments: [
            {
              id: "fragment-time",
              beginMs: 1_000,
              endMs: 1_500,
              text: "Time ",
              timingGranularity: "text",
              styleRefs: [],
            },
            {
              id: "fragment-to",
              beginMs: 1_500,
              endMs: 2_000,
              text: "to ",
              timingGranularity: "text",
              styleRefs: [],
            },
            {
              id: "fragment-cele",
              beginMs: 2_000,
              endMs: 2_500,
              text: "cele",
              timingGranularity: "text",
              styleRefs: [],
            },
            {
              id: "fragment-brate",
              beginMs: 2_500,
              endMs: 3_000,
              text: "brate",
              timingGranularity: "text",
              styleRefs: [],
            },
          ],
        },
        {
          id: "line-korean",
          beginMs: 4_000,
          endMs: 5_000,
          text: "다음 줄",
          role: null,
          region: null,
          styleRefs: [],
          segments: [
            {
              id: "fragment-korean",
              beginMs: 4_000,
              endMs: 5_000,
              text: "다음 줄",
              timingGranularity: "text",
              styleRefs: [],
            },
          ],
        },
      ],
    };
    mockInvokeWith({
      loadRoot: "C:\\Music",
      scanResult: populatedScanResult,
      lyricResult: fragmentLyricDocument,
    });
    const { container } = render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");
    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Perform" }));

    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 2.1);
    fireEvent.timeUpdate(audio);

    await waitFor(() => {
      expect(container.querySelector(".lyric-line-current")?.textContent).toBe("Time to celebrate");
    });
    const fragments = Array.from(container.querySelectorAll(".lyric-fragment"));
    expect(fragments).toHaveLength(4);
    expect(fragments.map((fragment) => fragment.textContent)).toEqual([
      "Time ",
      "to ",
      "cele",
      "brate",
    ]);
    expect(fragments.map((fragment) => fragment.getAttribute("data-fragment-state"))).toEqual([
      "past",
      "past",
      "active",
      "upcoming",
    ]);
    expect(fragments.map((fragment) => fragment.getAttribute("data-fill-progress"))).toEqual([
      "1.000",
      "1.000",
      "0.200",
      "0.000",
    ]);
    expect((fragments[2] as HTMLElement).style.getPropertyValue("--lyric-fill-progress")).toBe(
      "0.2",
    );
    expect(fragments.map((fragment) => fragment.getAttribute("data-text"))).toEqual([
      "Time ",
      "to ",
      "cele",
      "brate",
    ]);
    expect(container.querySelector(".lyric-line-secondary")?.textContent).toBe("다음 줄");
    expect(
      container.querySelector(".lyric-line-secondary .lyric-fragment"),
    ).not.toBeInTheDocument();

    setAudioNumberProperty(audio, "currentTime", 4.2);
    fireEvent.timeUpdate(audio);
    expect(await screen.findByText("다음 줄")).toBeInTheDocument();
    expect(screen.queryByText("Time to celebrate")).not.toBeInTheDocument();
  });

  it("keeps line-level-only lyrics visible without marking a timed fragment active", async () => {
    const user = userEvent.setup();
    mockInvokeWith({
      loadRoot: "C:\\Music",
      scanResult: populatedScanResult,
      lyricResult: {
        ...populatedLyricDocument,
        lines: [
          {
            id: "line-only",
            beginMs: 1_000,
            endMs: 2_000,
            text: "Whole line lyric",
            role: null,
            region: null,
            styleRefs: [],
            segments: [
              {
                id: "line-only-segment",
                beginMs: 1_000,
                endMs: 2_000,
                text: "Whole line lyric",
                timingGranularity: "text",
                styleRefs: [],
              },
            ],
          },
        ],
      },
    });
    const { container } = render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");
    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Perform" }));

    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 1.2);
    fireEvent.timeUpdate(audio);

    expect(await screen.findByText("Whole line lyric")).toBeInTheDocument();
    expect(container.querySelector(".lyric-fragment-active")).not.toBeInTheDocument();
    expect(container.querySelector(".lyric-fragment")).toHaveAttribute(
      "data-fill-progress",
      "0.000",
    );
  });

  it("updates rapid lyric fragments from animation frames between sparse timeupdate events", async () => {
    const user = userEvent.setup();
    mockInvokeWith({
      loadRoot: "C:\\Music",
      scanResult: populatedScanResult,
      lyricResult: {
        ...populatedLyricDocument,
        lines: [
          {
            id: "rapid-line",
            beginMs: 1_000,
            endMs: 1_240,
            text: "lalala",
            role: null,
            region: null,
            styleRefs: [],
            segments: [
              {
                id: "rapid-a",
                beginMs: 1_000,
                endMs: 1_040,
                text: "la",
                timingGranularity: "text",
                styleRefs: [],
              },
              {
                id: "rapid-b",
                beginMs: 1_040,
                endMs: 1_120,
                text: "la",
                timingGranularity: "text",
                styleRefs: [],
              },
              {
                id: "rapid-c",
                beginMs: 1_120,
                endMs: 1_240,
                text: "la",
                timingGranularity: "text",
                styleRefs: [],
              },
            ],
          },
        ],
      },
    });
    const { container, unmount } = render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");
    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Perform" }));
    await waitFor(() =>
      expect(container.querySelector(".lyric-line-current")?.textContent).toBe("lalala"),
    );

    const audio = getAudioElement();
    fireEvent.play(audio);

    setAudioNumberProperty(audio, "currentTime", 1.02);
    runAnimationFrame();
    await waitFor(() =>
      expect(container.querySelector('[data-fragment-id="rapid-a"]')).toHaveAttribute(
        "data-fragment-state",
        "active",
      ),
    );
    expect(container.querySelector('[data-fragment-id="rapid-a"]')).toHaveAttribute(
      "data-fill-progress",
      "0.500",
    );

    setAudioNumberProperty(audio, "currentTime", 1.08);
    runAnimationFrame();
    expect(container.querySelector('[data-fragment-id="rapid-b"]')).toHaveAttribute(
      "data-fragment-state",
      "active",
    );
    expect(container.querySelector('[data-fragment-id="rapid-b"]')).toHaveAttribute(
      "data-fill-progress",
      "0.500",
    );

    fireEvent.pause(audio);
    const queuedFrameCount = animationFrameCallbacks.size;
    setAudioNumberProperty(audio, "currentTime", 1.16);
    runAnimationFrame();
    expect(container.querySelector('[data-fragment-id="rapid-c"]')).not.toHaveAttribute(
      "data-fragment-state",
      "active",
    );
    expect(container.querySelector('[data-fragment-id="rapid-b"]')).toHaveAttribute(
      "data-fill-progress",
      "0.500",
    );
    expect(animationFrameCallbacks.size).toBeLessThanOrEqual(queuedFrameCount);

    fireEvent.play(audio);
    runAnimationFrame();
    expect(container.querySelector('[data-fragment-id="rapid-c"]')).toHaveAttribute(
      "data-fragment-state",
      "active",
    );
    expect(container.querySelector('[data-fragment-id="rapid-c"]')).toHaveAttribute(
      "data-fill-progress",
      "0.333",
    );

    unmount();
    expect(animationFrameCallbacks.size).toBe(0);
  });

  it("keeps brief lyric gaps stable and responds to rapid seeks", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    const { container } = render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");
    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Perform" }));
    await screen.findByText("Yesterday all my troubles");

    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 3);
    fireEvent.timeUpdate(audio);
    expect(screen.queryByLabelText("Instrumental section")).not.toBeInTheDocument();
    expect(screen.getByText("Seemed so far away")).toBeInTheDocument();
    expect(screen.queryByText("Yesterday all my troubles")).not.toBeInTheDocument();
    expect(container.querySelector(".lyric-fragment")).toHaveAttribute(
      "data-fragment-state",
      "upcoming",
    );
    expect(container.querySelector(".lyric-fragment")).toHaveAttribute(
      "data-fill-progress",
      "0.000",
    );

    setAudioNumberProperty(audio, "currentTime", 4.2);
    fireEvent.timeUpdate(audio);
    expect(screen.getByText("Seemed so far away")).toBeInTheDocument();
    expect(screen.queryByText("Yesterday all my troubles")).not.toBeInTheDocument();

    setAudioNumberProperty(audio, "currentTime", 1.1);
    fireEvent.timeUpdate(audio);
    expect(screen.getByText("Yesterday all my troubles")).toBeInTheDocument();
  });

  it("shows Instrumental only for meaningful internal gaps", async () => {
    const user = userEvent.setup();
    mockInvokeWith({
      loadRoot: "C:\\Music",
      scanResult: populatedScanResult,
      lyricResult: {
        ...populatedLyricDocument,
        lines: [
          populatedLyricDocument.lines[0],
          {
            ...populatedLyricDocument.lines[1],
            beginMs: 8_000,
            endMs: 9_000,
          },
        ],
      },
    });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");
    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Perform" }));

    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 5);
    fireEvent.timeUpdate(audio);

    expect(await screen.findByLabelText("Instrumental section")).toBeInTheDocument();
    expect(screen.getByText("Seemed so far away")).toBeInTheDocument();
  });

  it("does not show Instrumental before the first lyric or after the final lyric", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");
    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Perform" }));
    await screen.findByText("Yesterday all my troubles");

    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 0.5);
    fireEvent.timeUpdate(audio);
    expect(screen.queryByLabelText("Instrumental section")).not.toBeInTheDocument();
    expect(screen.getByText("Yesterday all my troubles")).toBeInTheDocument();

    setAudioNumberProperty(audio, "currentTime", 6);
    fireEvent.timeUpdate(audio);
    expect(screen.queryByLabelText("Instrumental section")).not.toBeInTheDocument();
    expect(screen.queryByText("Yesterday all my troubles")).not.toBeInTheDocument();
    expect(screen.queryByText("Seemed so far away")).not.toBeInTheDocument();
  });

  it("keeps the lyric state stable while paused and continues after resume", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");
    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Perform" }));

    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 1.2);
    fireEvent.timeUpdate(audio);
    expect(await screen.findByText("Yesterday all my troubles")).toBeInTheDocument();

    fireEvent.pause(audio);
    expect(screen.getByText("Yesterday all my troubles")).toBeInTheDocument();

    fireEvent.play(audio);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    setAudioNumberProperty(audio, "currentTime", 4.2);
    fireEvent.timeUpdate(audio);
    expect(screen.getByText("Seemed so far away")).toBeInTheDocument();
  });

  it("shows lyric parser failure without blocking playback", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    tauriMocks.invoke.mockImplementation((command: string, args?: { song?: MediaSong }) => {
      if (command === "parse_song_lyrics") {
        return Promise.reject("The lyric file is not a supported TTML document.");
      }
      if (command === "resolve_audio_source") {
        const song = args?.song ?? populatedScanResult.songs[0];
        return Promise.resolve({ songId: song.id, audioPath: song.audioPath });
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");

    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Perform" }));

    expect(
      await screen.findByText("The lyric file is not a supported TTML document."),
    ).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: "Media transport" })).toHaveTextContent(
      "Hey Jude",
    );
  });

  it("replaces lyrics when loading another song", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    tauriMocks.invoke.mockImplementation((command: string, args?: { song?: MediaSong }) => {
      if (command === "parse_song_lyrics") {
        const song = args?.song ?? populatedScanResult.songs[0];
        return Promise.resolve({
          ...populatedLyricDocument,
          sourceSongId: song.id,
          lines: [
            {
              ...populatedLyricDocument.lines[0],
              id: `line-${song.id}`,
              text: song.id === "song-b" ? "Jóga lyric line" : "Yesterday all my troubles",
              segments: [],
            },
          ],
        });
      }
      if (command === "resolve_audio_source") {
        const song = args?.song ?? populatedScanResult.songs[0];
        return Promise.resolve({ songId: song.id, audioPath: song.audioPath });
      }
      return mockSuccessfulLibraryInvoke(command);
    });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");
    await playSongFromLibrary(user, "Hey Jude");
    await playSongFromLibrary(user, "Jóga");
    await user.click(screen.getByRole("button", { name: "Perform" }));

    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 1.2);
    fireEvent.timeUpdate(audio);

    expect(await screen.findByText("Jóga lyric line")).toBeInTheDocument();
    expect(screen.queryByText("Yesterday all my troubles")).not.toBeInTheDocument();
  });

  it("shows a zero-file scan state", async () => {
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: emptyScanResult });
    render(<App />);
    await openLibraryWorkspace();

    expect(await screen.findByText("No files inspected")).toBeInTheDocument();
    expect(
      screen.getByText("The selected folder could not be scanned or contains no files."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Scan complete · 1 folders · 0 files · 0 songs · 0 issues"),
    ).toBeInTheDocument();
  });

  it("shows a no-supported-media scan state", async () => {
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: noSupportedFilesScanResult });
    render(<App />);
    await openLibraryWorkspace();

    expect(await screen.findByText("No supported karaoke files found")).toBeInTheDocument();
    expect(
      screen.getByText("The scan did not find any .opus or .ttml files in the selected folder."),
    ).toBeInTheDocument();
  });

  it("shows an unpaired-candidates scan state with diagnostics", async () => {
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: unpairedCandidatesScanResult });
    render(<App />);
    await openLibraryWorkspace();

    expect(await screen.findByText("No valid songs found")).toBeInTheDocument();
    expect(
      screen.getByText(
        ".opus and .ttml files must have matching filename stems and be in the same folder. Open diagnostics for details.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText("Diagnostics (1)"));
    expect(screen.getByText("Missing lyrics")).toBeInTheDocument();
  });

  it("searches by artist and title and clears back to all results", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);

    const search = await screen.findByLabelText("Search library");
    await user.type(search, "beatles");
    expect(screen.getByText("Hey Jude")).toBeInTheDocument();
    expect(screen.queryByText("Jóga")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "jóga");
    expect(screen.getByText("Jóga")).toBeInTheDocument();
    expect(screen.queryByText("Hey Jude")).not.toBeInTheDocument();

    await user.clear(search);
    expect(screen.getByText("Hey Jude")).toBeInTheDocument();
    expect(screen.getByText("Jóga")).toBeInTheDocument();
  });

  it("shows a no-search-results state", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);

    await user.type(await screen.findByLabelText("Search library"), "nothing matches");

    expect(screen.getByText("No search results")).toBeInTheDocument();
    expect(
      screen.getByText("Clear the search field to show the complete library."),
    ).toBeInTheDocument();
  });

  it("keeps stale successful results visible after a failed rescan", async () => {
    const user = userEvent.setup();
    let scanCount = 0;
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "scan_media_library") {
        scanCount += 1;
        if (scanCount === 1) {
          return Promise.resolve(populatedScanResult);
        }

        return Promise.reject("The selected library folder is not available.");
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });
    render(<App />);
    await openLibraryWorkspace(user);

    await screen.findByText("Hey Jude");
    await user.click(screen.getByRole("button", { name: "Rescan" }));

    expect(
      await screen.findByText("The selected library folder is not available."),
    ).toBeInTheDocument();
    expect(screen.getByText("Hey Jude")).toBeInTheDocument();
  });

  it("prevents duplicate rescan invocations while scanning", async () => {
    const user = userEvent.setup();
    let resolveScan: (value: LibraryScanResult) => void = () => undefined;
    const pendingScan = new Promise<LibraryScanResult>((resolve) => {
      resolveScan = resolve;
    });
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "scan_media_library") {
        return pendingScan;
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });
    render(<App />);
    await openLibraryWorkspace(user);

    const rescan = await screen.findByRole("button", { name: "Rescan" });
    expect(rescan).toBeDisabled();
    await user.click(rescan);
    await user.click(rescan);
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "scan_media_library"),
    ).toHaveLength(1);

    resolveScan(populatedScanResult);
    await screen.findByText("Hey Jude");
  });

  it("queues a newly selected folder while a restore scan is still running", async () => {
    const user = userEvent.setup();
    let resolveInitialScan: (value: LibraryScanResult) => void = () => undefined;
    const pendingInitialScan = new Promise<LibraryScanResult>((resolve) => {
      resolveInitialScan = resolve;
    });
    tauriMocks.open.mockResolvedValue("C:\\Music");
    tauriMocks.invoke.mockImplementation((command: string, args?: { rootPath?: string }) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\OldMusic" });
      }

      if (command === "save_library_root") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "load_library_index") {
        return Promise.resolve({ status: "miss", scanResult: null, message: null });
      }

      if (command === "save_library_index") {
        return Promise.resolve();
      }

      if (command === "scan_media_library" && args?.rootPath === "C:\\OldMusic") {
        return pendingInitialScan;
      }

      if (command === "scan_media_library" && args?.rootPath === "C:\\Music") {
        return Promise.resolve(populatedScanResult);
      }

      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Scanning for .opus and .ttml pairs...");
    await user.click(screen.getByRole("button", { name: "Change folder" }));

    resolveInitialScan(emptyScanResult);

    expect(await screen.findByText("Hey Jude")).toBeInTheDocument();
    expect(tauriMocks.invoke).toHaveBeenCalledWith("scan_media_library", {
      rootPath: "C:\\Music",
    });
  });

  it("keeps a queued selected-root scan authoritative when the restore scan settles first", async () => {
    const user = userEvent.setup();
    const pendingInitialScan = createDeferred<LibraryScanResult>();
    const oldRootResult: LibraryScanResult = {
      ...emptyScanResult,
      rootPath: "C:\\OldMusic",
    };

    tauriMocks.open.mockResolvedValue("C:\\Music");
    tauriMocks.invoke.mockImplementation((command: string, args?: { rootPath?: string }) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\OldMusic" });
      }

      if (command === "save_library_root") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "load_library_index") {
        return Promise.resolve({ status: "miss", scanResult: null, message: null });
      }

      if (command === "save_library_index") {
        return Promise.resolve();
      }

      if (command === "scan_media_library" && args?.rootPath === "C:\\OldMusic") {
        return pendingInitialScan.promise;
      }

      if (command === "scan_media_library" && args?.rootPath === "C:\\Music") {
        return Promise.resolve(populatedScanResult);
      }

      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    renderStrictApp();
    await openLibraryWorkspace(user);
    await screen.findByText("Scanning for .opus and .ttml pairs...");

    await user.click(screen.getByRole("button", { name: "Change folder" }));
    pendingInitialScan.resolve(oldRootResult);

    expect(await screen.findByText("Hey Jude")).toBeInTheDocument();
    expect(screen.getByText(/Selected folder:/)).toHaveTextContent("C:\\Music");
    expect(screen.queryByText("No files inspected")).not.toBeInTheDocument();
    expect(
      screen.getByText("Scan complete · 3 folders · 5 files · 2 songs · 1 issues"),
    ).toBeInTheDocument();
  });

  it("exits loading state after a restored-root scan failure", async () => {
    const pendingScan = createDeferred<LibraryScanResult>();
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "scan_media_library") {
        return pendingScan.promise;
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    renderStrictApp();
    await openLibraryWorkspace();
    await screen.findByText("Scanning for .opus and .ttml pairs...");

    pendingScan.reject("The selected library folder is not available.");

    expect(
      await screen.findByText("The selected library folder is not available."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Restoring saved library folder...")).not.toBeInTheDocument();
    expect(screen.queryByText("Scanning for .opus and .ttml pairs...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rescan" })).toBeEnabled();
  });

  it("rebuilds the library index with a guarded fresh scan", async () => {
    const user = userEvent.setup();
    let scanCount = 0;
    const pendingRebuildScan = createDeferred<LibraryScanResult>();
    const rebuiltResult: LibraryScanResult = {
      ...populatedScanResult,
      songs: [
        ...populatedScanResult.songs,
        {
          id: "song-new",
          title: "New Song",
          artist: "New Artist",
          displayName: "New Artist - New Song",
          directoryPath: "C:\\Music\\New",
          audioPath: "C:\\Music\\New\\New Artist - New Song.opus",
          lyricPath: "C:\\Music\\New\\New Artist - New Song.ttml",
          fileStem: "New Artist - New Song",
        },
      ],
    };
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }

      if (command === "load_library_index") {
        return Promise.resolve({ status: "miss", scanResult: null, message: null });
      }

      if (command === "scan_media_library") {
        scanCount += 1;
        return scanCount === 1 ? Promise.resolve(populatedScanResult) : pendingRebuildScan.promise;
      }

      if (command === "clear_library_index" || command === "save_library_index") {
        return Promise.resolve();
      }

      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Hey Jude");

    await user.click(screen.getByRole("button", { name: "Rebuild library index" }));
    expect(screen.getByRole("button", { name: "Rebuild library index" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Rebuild library index" }));

    expect(tauriMocks.invoke).toHaveBeenCalledWith("clear_library_index", {
      rootPath: "C:\\Music",
    });
    pendingRebuildScan.resolve(rebuiltResult);
    expect(await screen.findByText("New Song")).toBeInTheDocument();
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "scan_media_library"),
    ).toHaveLength(2);
  });

  it("does not show queue actions in Library", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openLibraryWorkspace(user);

    expect(screen.queryByRole("button", { name: /add to queue/i })).not.toBeInTheDocument();
  });
});

describe("Singer shell", () => {
  it("renders and updates the local singer bar", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("region", { name: "Singer bar" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Singer 1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Singer 4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add singer" }));
    expect(screen.getByDisplayValue("Singer 5")).toBeInTheDocument();

    const singerTwoInput = screen.getByDisplayValue("Singer 2");
    await user.clear(singerTwoInput);
    await user.type(singerTwoInput, "Lead singer");
    expect(screen.getByDisplayValue("Lead singer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Singer 1" }));
    expect(screen.queryByDisplayValue("Singer 1")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Lead singer")).toBeInTheDocument();
  });
});
