import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { LyricDocument } from "./lyrics";
import type { LibraryScanResult, MediaSong } from "./media-library/types";
import type {
  DevelopmentProtocolStatus,
  DevelopmentStreamDiagnostics,
  LocalMicrophoneSource,
  PerformanceMicrophoneReadiness,
} from "./microphones/types";
import type { DiagnosticCaptureSnapshot } from "./microphones/diagnosticCapture";
import type { ParticipantCommitDiagnosticProjection } from "./session-singers/types";

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

const initialSessionSingers = [
  { id: "singer-1", displayName: "Singer 1", createdOrder: 1 },
  { id: "singer-2", displayName: "Singer 2", createdOrder: 2 },
  { id: "singer-3", displayName: "Singer 3", createdOrder: 3 },
  { id: "singer-4", displayName: "Singer 4", createdOrder: 4 },
];

const emptyParticipantCommitDiagnostics = {
  requestId: null,
  outcome: "none" as const,
  singerName: null,
  sourceDisplayName: null,
  microphoneState: null,
  rollbackOccurred: false,
  failureReason: null,
  failureMessage: null,
};
let sessionSingerState = initialSessionSingers.map((singer) => ({ ...singer }));
let nextSessionSingerNumber = 5;

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

const stoppedDevelopmentStatus: DevelopmentProtocolStatus = {
  listenerState: "stopped",
  bindAddress: "127.0.0.1",
  tcpPort: 45820,
  udpPort: 45821,
  connectedClientCount: 0,
  currentConnectionId: null,
  currentSessionId: null,
  connectedClientName: null,
  sourceId: null,
  streamAuthorized: false,
  activeStreamId: null,
  sourceHealth: "disconnected",
  lastHeartbeatAgeMs: null,
  malformedControlMessages: 0,
  rejectedControlMessages: 0,
  closureReason: null,
  error: null,
};

const activeDevelopmentStatus: DevelopmentProtocolStatus = {
  ...stoppedDevelopmentStatus,
  listenerState: "listening",
  connectedClientCount: 1,
  currentConnectionId: "development-connection-1",
  currentSessionId: "development-session-1",
  connectedClientName: "Android Test",
  sourceId: "network-mic-development-1",
  streamAuthorized: true,
  activeStreamId: 1,
  sourceHealth: "healthy",
};

const idleDevelopmentDiagnostics: DevelopmentStreamDiagnostics = {
  activeStreamId: null,
  packetsReceived: 0,
  validPackets: 0,
  malformedPackets: 0,
  unauthorizedPackets: 0,
  duplicatePackets: 0,
  stalePackets: 0,
  latePackets: 0,
  sequenceGaps: 0,
  estimatedPacketLoss: 0,
  receiverQueueDepth: 0,
  maximumQueueDepth: 0,
  jitterWindowDepth: 0,
  jitterTargetMs: 30,
  jitterMaxMs: 60,
  currentSourceHealth: "disconnected",
  lastValidPacketAgeMs: null,
  level: { rms: 0, peak: 0, clipping: false, sequence: 0 },
};
const idleDiagnosticMonitorStatus = {
  attemptId: null,
  state: "idle" as const,
  sourceId: null,
  outputDeviceId: null,
  gain: 0.25,
  message: null,
  failureReason: null,
};

const activeDiagnosticMonitorStatus = {
  ...idleDiagnosticMonitorStatus,
  attemptId: "diagnostic-monitor-1",
  state: "active" as const,
  sourceId: "windows-mic-primary",
  outputDeviceId: "default",
  message: "Diagnostic monitoring is active.",
};

const idleDiagnosticMonitorDiagnostics = {
  queueCapacity: 8,
  queueDepth: 0,
  maximumQueueDepth: 0,
  droppedMonitorFrames: 0,
  underruns: 0,
  resets: 0,
  bufferedLatencyMs: 0,
  inputSampleRateHz: null,
  outputSampleRateHz: null,
  inputChannels: null,
  outputChannels: null,
  gain: 0.25,
  samplesConsumed: 0,
  samplesWritten: 0,
  syntheticSilenceSamples: 0,
};

const diagnosticOutputDevices = [
  { id: "default", displayName: "Default Windows output", isDefault: true },
];
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
    (
      command: string,
      args?: {
        song?: MediaSong;
        sourceId?: string;
        singerId?: string;
        request?: {
          singerId?: string;
          displayName?: string | null;
          requestId?: string;
          sourceId?: string;
        };
      },
    ) => {
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

      if (command === "list_session_singers") {
        return Promise.resolve(sessionSingerState.map((singer) => ({ ...singer })));
      }

      if (command === "create_session_singer") {
        const singer = {
          id: `singer-${nextSessionSingerNumber}`,
          displayName: args?.request?.displayName ?? `Singer ${nextSessionSingerNumber}`,
          createdOrder: nextSessionSingerNumber,
        };
        nextSessionSingerNumber += 1;
        sessionSingerState = [...sessionSingerState, singer];
        return Promise.resolve(singer);
      }

      if (command === "create_session_singer_with_microphone") {
        const singer = {
          id: `singer-${nextSessionSingerNumber}`,
          displayName: args?.request?.displayName ?? `Singer ${nextSessionSingerNumber}`,
          createdOrder: nextSessionSingerNumber,
        };
        nextSessionSingerNumber += 1;
        sessionSingerState = [...sessionSingerState, singer];
        return Promise.resolve({
          sessionSinger: singer,
          microphoneState: "ready",
          sourceDisplayName: "USB Microphone",
          assignmentSucceeded: true,
        });
      }

      if (command === "get_participant_commit_diagnostics") {
        return Promise.resolve(emptyParticipantCommitDiagnostics);
      }

      if (command === "rename_session_singer") {
        const singerId = args?.request?.singerId;
        const displayName = args?.request?.displayName ?? "";
        const singer = sessionSingerState.find((candidate) => candidate.id === singerId);
        if (!singer) {
          return Promise.reject({ reasonCode: "singer-not-found", message: "Singer not found." });
        }
        const renamed = { ...singer, displayName };
        sessionSingerState = sessionSingerState.map((candidate) =>
          candidate.id === singerId ? renamed : candidate,
        );
        return Promise.resolve(renamed);
      }

      if (command === "remove_session_singer") {
        const singer = sessionSingerState.find((candidate) => candidate.id === args?.singerId);
        if (!singer) {
          return Promise.reject({ reasonCode: "singer-not-found", message: "Singer not found." });
        }
        sessionSingerState = sessionSingerState.filter((candidate) => candidate.id !== singer.id);
        return Promise.resolve(singer);
      }

      if (command === "get_development_protocol_status") {
        return Promise.resolve(stoppedDevelopmentStatus);
      }

      if (command === "get_development_stream_diagnostics") {
        return Promise.resolve(idleDevelopmentDiagnostics);
      }

      if (command === "start_development_protocol_listener") {
        return Promise.resolve({
          status: activeDevelopmentStatus,
          diagnostics: { ...idleDevelopmentDiagnostics, activeStreamId: 1 },
          sources: [],
        });
      }

      if (command === "stop_development_protocol_listener") {
        return Promise.resolve({
          status: stoppedDevelopmentStatus,
          diagnostics: idleDevelopmentDiagnostics,
          sources: [],
        });
      }

      if (command === "list_development_network_sources") {
        return Promise.resolve([]);
      }

      if (command === "list_diagnostic_output_devices") {
        return Promise.resolve(diagnosticOutputDevices);
      }

      if (command === "get_diagnostic_monitor_status") {
        return Promise.resolve(monitorStatus);
      }

      if (command === "get_diagnostic_monitor_diagnostics") {
        return Promise.resolve(monitorDiagnostics);
      }

      if (command === "start_diagnostic_monitor") {
        monitorStatus = activeDiagnosticMonitorStatus;
        monitorDiagnostics = {
          ...idleDiagnosticMonitorDiagnostics,
          queueDepth: 1,
          maximumQueueDepth: 1,
          inputSampleRateHz: 48000,
          outputSampleRateHz: 48000,
          inputChannels: 1,
          outputChannels: 2,
          samplesConsumed: 480,
          samplesWritten: 480,
        };
        return Promise.resolve(monitorStatus);
      }

      if (command === "stop_diagnostic_monitor") {
        monitorStatus = idleDiagnosticMonitorStatus;
        monitorDiagnostics = idleDiagnosticMonitorDiagnostics;
        return Promise.resolve(monitorStatus);
      }

      if (command === "list_microphone_channels") {
        return Promise.resolve([]);
      }

      if (command === "list_microphone_assignments") {
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

      return mockSuccessfulLibraryInvoke(command);
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

  if (command === "list_session_singers") {
    return Promise.resolve(sessionSingerState.map((singer) => ({ ...singer })));
  }

  if (command === "get_participant_commit_diagnostics") {
    return Promise.resolve(emptyParticipantCommitDiagnostics);
  }

  if (command === "get_development_protocol_status") {
    return Promise.resolve(stoppedDevelopmentStatus);
  }

  if (command === "get_development_stream_diagnostics") {
    return Promise.resolve(idleDevelopmentDiagnostics);
  }

  if (command === "start_development_protocol_listener") {
    return Promise.resolve({
      status: activeDevelopmentStatus,
      diagnostics: idleDevelopmentDiagnostics,
      sources: [],
    });
  }

  if (command === "stop_development_protocol_listener") {
    return Promise.resolve({
      status: stoppedDevelopmentStatus,
      diagnostics: idleDevelopmentDiagnostics,
      sources: [],
    });
  }

  if (command === "list_development_network_sources") {
    return Promise.resolve([]);
  }

  if (command === "list_diagnostic_output_devices") {
    return Promise.resolve(diagnosticOutputDevices);
  }

  if (command === "get_diagnostic_monitor_status") {
    return Promise.resolve(idleDiagnosticMonitorStatus);
  }

  if (command === "get_diagnostic_monitor_diagnostics") {
    return Promise.resolve(idleDiagnosticMonitorDiagnostics);
  }

  if (command === "start_diagnostic_monitor") {
    return Promise.resolve(activeDiagnosticMonitorStatus);
  }

  if (command === "stop_diagnostic_monitor") {
    return Promise.resolve(idleDiagnosticMonitorStatus);
  }
  if (command === "list_microphone_channels") {
    return Promise.resolve([]);
  }

  if (command === "list_microphone_assignments") {
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
  sessionSingerState = initialSessionSingers.map((singer) => ({ ...singer }));
  nextSessionSingerNumber = 5;
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

async function openDeveloperWorkspace(user = userEvent.setup()) {
  await user.click(screen.getByRole("button", { name: "Developer" }));
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
  it("shows Performance as the default active workspace", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Karaoke Webview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Performance" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("load_library_settings"));
  });

  it("renders readable horizontal navigation labels", async () => {
    const { container } = render(<App />);
    const navigation = screen.getByRole("navigation", { name: "Primary sections" });
    const navButtons = within(navigation).getAllByRole("button");

    expect(navButtons.map((button) => button.textContent)).toEqual([
      "Performance",
      "Library",
      "Queue",
      "Singers",
      "Microphones",
      "History",
      "Settings",
      "Developer",
    ]);
    expect(screen.queryByRole("button", { name: "Home" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Library" })).toHaveTextContent("Library");
    expect(screen.getByRole("button", { name: "Queue" })).toHaveTextContent("Queue");
    expect(screen.getByRole("button", { name: "Performance" })).toHaveTextContent("Performance");
    expect(screen.getByRole("button", { name: "Singers" })).toHaveTextContent("Singers");
    expect(screen.getByRole("button", { name: "Microphones" })).toHaveTextContent("Microphones");
    expect(screen.getByRole("button", { name: "History" })).toHaveTextContent("History");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveTextContent("Settings");
    expect(screen.getByRole("button", { name: "Developer" })).toHaveAttribute(
      "data-tab-group",
      "engineering",
    );
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(container.querySelector(".rotated-tab-label")).not.toBeInTheDocument();
    await waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("load_library_settings"));
  });

  it("shows accessible delayed navigation help on hover and focus", async () => {
    render(<App />);
    await waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("load_library_settings"));
    vi.useFakeTimers();

    const library = screen.getByRole("button", { name: "Library" });
    fireEvent.mouseEnter(library);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(599));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Browse songs and add them to the queue.",
    );
    expect(library).toHaveAttribute("aria-describedby", "library-tab-tooltip");

    fireEvent.mouseLeave(library);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    const developer = screen.getByRole("button", { name: "Developer" });
    fireEvent.focus(developer);
    act(() => vi.advanceTimersByTime(600));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Open engineering diagnostics and development tools.",
    );

    fireEvent.blur(developer);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("keeps the queue and bottom transport rendered while Library is active", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Library" }));

    expect(screen.getByRole("heading", { name: "Library" })).toHaveClass("visually-hidden");
    expect(screen.getByRole("complementary", { name: "Queue" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: "Media transport" })).toBeInTheDocument();
  });

  it("keeps normal workspace content free of obsolete heading wrappers", async () => {
    const { container } = render(<App />);

    expect(container.querySelector(".perform-view .workspace-header")).not.toBeInTheDocument();
    expect(container.querySelector(".performance-stage")).toBeInTheDocument();

    await openLibraryWorkspace(userEvent.setup());

    expect(container.querySelector(".library-workspace .workspace-header")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Library" })).toHaveClass("visually-hidden");
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
  type MicrophoneInvokeState = {
    sources?: LocalMicrophoneSource[];
    channels?: (typeof microphoneChannel)[];
    assignments?: (typeof microphoneAssignment)[];
    waitingStates?: (typeof microphoneWaitingState)[];
    recoveryStates?: (typeof disconnectedRecoveryState)[];
    captureSnapshot?: DiagnosticCaptureSnapshot;
    developmentStatus?: DevelopmentProtocolStatus;
    developmentDiagnostics?: DevelopmentStreamDiagnostics;
    monitorStatus?: typeof idleDiagnosticMonitorStatus;
    monitorDiagnostics?: typeof idleDiagnosticMonitorDiagnostics;
    participantCommitFailures?: number;
  };

  function mockMicrophoneWorkspace(state: MicrophoneInvokeState = {}) {
    let sources = state.sources ?? discoveredMicrophones;
    let channels = state.channels ? [...state.channels] : [];
    let assignments = state.assignments ? [...state.assignments] : [];
    let waitingStates = state.waitingStates ? [...state.waitingStates] : [];
    let recoveryStates = state.recoveryStates ? [...state.recoveryStates] : [];
    let captureSnapshot = state.captureSnapshot ?? idleCaptureSnapshot;
    let developmentStatus = state.developmentStatus ?? stoppedDevelopmentStatus;
    let developmentDiagnostics = state.developmentDiagnostics ?? idleDevelopmentDiagnostics;
    let monitorStatus = state.monitorStatus ?? idleDiagnosticMonitorStatus;
    let monitorDiagnostics = state.monitorDiagnostics ?? idleDiagnosticMonitorDiagnostics;
    let participantCommitDiagnostics: ParticipantCommitDiagnosticProjection = {
      ...emptyParticipantCommitDiagnostics,
    };
    let participantCommitFailures = state.participantCommitFailures ?? 0;
    const participantCommitResults = new Map<string, unknown>();
    let nextChannelSequence = 2;

    tauriMocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(sources);
      }

      if (command === "get_participant_commit_diagnostics") {
        return Promise.resolve(participantCommitDiagnostics);
      }

      if (command === "create_session_singer_with_microphone") {
        const request = (args?.request ?? {}) as {
          requestId?: string;
          displayName?: string;
          sourceId?: string;
        };
        const requestId = request.requestId ?? "";
        const cached = participantCommitResults.get(requestId);
        if (cached) {
          return Promise.resolve(cached);
        }
        const source = sources.find((candidate) => candidate.id === request.sourceId);
        if (participantCommitFailures > 0) {
          participantCommitFailures -= 1;
          participantCommitDiagnostics = {
            requestId,
            outcome: "failure",
            singerName: request.displayName ?? null,
            sourceDisplayName: source?.displayName ?? null,
            microphoneState: null,
            rollbackOccurred: false,
            failureReason: "source-unavailable",
            failureMessage: "The selected microphone is not available.",
          };
          return Promise.reject({
            reasonCode: "source-unavailable",
            message: "The selected microphone is not available.",
          });
        }
        const singer = {
          id: `singer-${nextSessionSingerNumber}`,
          displayName: request.displayName ?? `Singer ${nextSessionSingerNumber}`,
          createdOrder: nextSessionSingerNumber,
        };
        nextSessionSingerNumber += 1;
        sessionSingerState = [...sessionSingerState, singer];
        const existingChannel = channels.find((channel) => channel.sourceId === request.sourceId);
        const channel =
          existingChannel ??
          ({
            id: `microphone-channel-${nextChannelSequence++}`,
            sourceId: request.sourceId ?? "",
            sourceDisplayName: source?.displayName ?? "Microphone",
            state: "available" as const,
          } as const);
        if (!existingChannel) {
          channels = [...channels, channel];
        }
        assignments = assignments.concat({
          channelId: channel.id,
          singerId: singer.id,
          method: "manual" as const,
          sequence: assignments.length + 1,
        });
        const result = {
          sessionSinger: singer,
          microphoneState: "ready" as const,
          sourceDisplayName: source?.displayName ?? "Microphone",
          assignmentSucceeded: true,
        };
        participantCommitResults.set(requestId, result);
        participantCommitDiagnostics = {
          requestId,
          outcome: "success",
          singerName: singer.displayName,
          sourceDisplayName: result.sourceDisplayName,
          microphoneState: "ready",
          rollbackOccurred: false,
          failureReason: null,
          failureMessage: null,
        };
        return Promise.resolve(result);
      }

      if (command === "list_diagnostic_output_devices") {
        return Promise.resolve(diagnosticOutputDevices);
      }

      if (command === "get_diagnostic_monitor_status") {
        return Promise.resolve(monitorStatus);
      }

      if (command === "get_diagnostic_monitor_diagnostics") {
        return Promise.resolve(monitorDiagnostics);
      }

      if (command === "start_diagnostic_monitor") {
        monitorStatus = activeDiagnosticMonitorStatus;
        monitorDiagnostics = {
          ...idleDiagnosticMonitorDiagnostics,
          queueDepth: 1,
          maximumQueueDepth: 1,
          inputSampleRateHz: 48000,
          outputSampleRateHz: 48000,
          inputChannels: 1,
          outputChannels: 2,
          samplesConsumed: 480,
          samplesWritten: 480,
        };
        return Promise.resolve(monitorStatus);
      }

      if (command === "stop_diagnostic_monitor") {
        monitorStatus = idleDiagnosticMonitorStatus;
        monitorDiagnostics = idleDiagnosticMonitorDiagnostics;
        return Promise.resolve(monitorStatus);
      }

      if (command === "list_microphone_channels") {
        return Promise.resolve(channels);
      }

      if (command === "create_microphone_channel") {
        const sourceId = String(args?.sourceId ?? "");
        const source = sources.find((candidate) => candidate.id === sourceId);
        const created = {
          id: `microphone-channel-${nextChannelSequence++}`,
          sourceId,
          sourceDisplayName: source?.displayName ?? "Microphone",
          state: "available" as const,
        };
        channels = [...channels, created];
        return Promise.resolve(created);
      }

      if (command === "remove_microphone_channel") {
        const channelId = String(args?.channelId ?? "");
        channels = channels.filter((channel) => channel.id !== channelId);
        assignments = assignments.filter((assignment) => assignment.channelId !== channelId);
        return Promise.resolve();
      }

      if (
        command === "replace_microphone_channel_source" ||
        command === "replace_disconnected_microphone_channel_source"
      ) {
        const channelId = String(args?.channelId ?? "");
        const sourceId = String(args?.sourceId ?? "");
        const source = sources.find((candidate) => candidate.id === sourceId);
        const replaced = {
          id: channelId,
          sourceId,
          sourceDisplayName: source?.displayName ?? "Microphone",
          state: "available" as const,
        };
        channels = channels.map((channel) => (channel.id === channelId ? replaced : channel));
        recoveryStates = recoveryStates.filter((state) => state.channelId !== channelId);
        return Promise.resolve(replaced);
      }

      if (command === "list_microphone_assignments") {
        return Promise.resolve(assignments);
      }

      if (command === "assign_microphone_channel") {
        const channelId = String(args?.channelId ?? "");
        const singerId = String(args?.singerId ?? "");
        const assigned = {
          channelId,
          singerId,
          method: "manual" as const,
          sequence: assignments.length + 1,
        };
        assignments = assignments
          .filter(
            (assignment) => assignment.channelId !== channelId && assignment.singerId !== singerId,
          )
          .concat(assigned);
        waitingStates = waitingStates.filter((waiting) => waiting.singerId !== singerId);
        return Promise.resolve(assigned);
      }

      if (command === "unassign_microphone_channel") {
        const channelId = String(args?.channelId ?? "");
        assignments = assignments.filter((assignment) => assignment.channelId !== channelId);
        return Promise.resolve();
      }

      if (command === "auto_assign_microphone_channel") {
        const singerId = String(args?.singerId ?? "");
        const unassignedChannel = channels.find(
          (channel) => !assignments.some((assignment) => assignment.channelId === channel.id),
        );
        if (!unassignedChannel) {
          const waiting = { ...microphoneWaitingState, singerId };
          waitingStates = waitingStates
            .filter((state) => state.singerId !== singerId)
            .concat(waiting);
          return Promise.resolve({ assignment: null, waiting });
        }
        const assigned = {
          channelId: unassignedChannel.id,
          singerId,
          method: "automatic" as const,
          sequence: assignments.length + 1,
        };
        assignments = assignments
          .filter((assignment) => assignment.singerId !== singerId)
          .concat(assigned);
        waitingStates = waitingStates.filter((state) => state.singerId !== singerId);
        return Promise.resolve({ assignment: assigned, waiting: null });
      }

      if (command === "list_microphone_waiting_states") {
        return Promise.resolve(waitingStates);
      }

      if (command === "clear_microphone_waiting_state") {
        const singerId = String(args?.singerId ?? "");
        waitingStates = waitingStates.filter((state) => state.singerId !== singerId);
        return Promise.resolve();
      }

      if (command === "get_microphone_recovery_states") {
        return Promise.resolve(recoveryStates);
      }

      if (command === "retry_microphone_channel_source") {
        const channelId = String(args?.channelId ?? "");
        const state = recoveryStates.find((candidate) => candidate.channelId === channelId) ?? {
          ...disconnectedRecoveryState,
          channelId,
        };
        return Promise.resolve(state);
      }

      if (command === "leave_microphone_channel_assigned") {
        const channelId = String(args?.channelId ?? "");
        const state = recoveryStates.find((candidate) => candidate.channelId === channelId) ?? {
          ...disconnectedRecoveryState,
          channelId,
        };
        return Promise.resolve(state);
      }

      if (command === "evaluate_performance_microphone_readiness") {
        return Promise.resolve(readyPerformanceMicrophoneReadiness);
      }

      if (command === "start_diagnostic_capture") {
        captureSnapshot = activeCaptureSnapshot(String(args?.sourceId ?? ""), {
          rms: 0.48,
          peak: 0.64,
          clipping: false,
          sequence: 1,
        });
        return Promise.resolve(captureSnapshot);
      }

      if (command === "stop_diagnostic_capture") {
        captureSnapshot = idleCaptureSnapshot;
        return Promise.resolve(captureSnapshot);
      }

      if (command === "diagnostic_capture_snapshot") {
        return Promise.resolve(captureSnapshot);
      }

      if (command === "get_development_protocol_status") {
        return Promise.resolve(developmentStatus);
      }

      if (command === "get_development_stream_diagnostics") {
        return Promise.resolve(developmentDiagnostics);
      }

      if (command === "start_development_protocol_listener") {
        developmentStatus = activeDevelopmentStatus;
        developmentDiagnostics = { ...idleDevelopmentDiagnostics, activeStreamId: 1 };
        sources = [
          ...sources,
          {
            id: activeDevelopmentStatus.sourceId ?? "network-mic-development-1",
            displayName: "Android Test",
            kind: "network-client" as const,
            availability: "available" as const,
            isDefault: false,
          },
        ];
        return Promise.resolve({
          status: developmentStatus,
          diagnostics: developmentDiagnostics,
          sources,
        });
      }

      if (command === "stop_development_protocol_listener") {
        developmentStatus = stoppedDevelopmentStatus;
        developmentDiagnostics = idleDevelopmentDiagnostics;
        return Promise.resolve({
          status: developmentStatus,
          diagnostics: developmentDiagnostics,
          sources: [],
        });
      }

      if (command === "list_development_network_sources") {
        return Promise.resolve(sources.filter((source) => source.kind === "network-client"));
      }

      return mockSuccessfulLibraryInvoke(command);
    });
  }

  async function openDeveloperDiagnostics(user: ReturnType<typeof userEvent.setup>) {
    const handoff = screen.queryByRole("button", { name: "Open Developer diagnostics" });
    if (handoff) {
      await user.click(handoff);
      return;
    }
    await openDeveloperWorkspace(user);
  }

  async function openPhysicalSync(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /Sync/ }));
    const dialog = screen.getByRole("dialog", { name: "Sync a singer" });
    await user.click(within(dialog).getByRole("button", { name: "Use physical microphone" }));
    return dialog;
  }

  async function completePhysicalSync(
    user: ReturnType<typeof userEvent.setup>,
    sourceId = "windows-mic-primary",
    displayName = "Kyle",
  ) {
    const dialog = await openPhysicalSync(user);
    await user.selectOptions(within(dialog).getByLabelText("Microphone"), sourceId);
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.type(within(dialog).getByLabelText("Singer name"), displayName);
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    return dialog;
  }

  it("opens a restrained Sync dialog with phone pairing clearly deferred", async () => {
    mockMicrophoneWorkspace({ sources: [discoveredMicrophones[0]] });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByDisplayValue("Singer 1")).toBeInTheDocument();
    expect(screen.queryByText(/empty singer/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Sync/ }));

    const dialog = screen.getByRole("dialog", { name: "Sync a singer" });
    expect(within(dialog).getByRole("button", { name: "Connect phone" })).toBeDisabled();
    expect(within(dialog).getByText("QR pairing will be added in P5-002.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Use physical microphone" })).toBeEnabled();
  });

  it("keeps selection, Back, and Cancel non-mutating", async () => {
    mockMicrophoneWorkspace({ sources: [discoveredMicrophones[0]] });
    const user = userEvent.setup();
    render(<App />);

    const dialog = await openPhysicalSync(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Microphone"),
      discoveredMicrophones[0].id,
    );
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "create_session_singer_with_microphone",
      expect.anything(),
    );

    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Sync a singer" })).not.toBeInTheDocument();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "create_session_singer_with_microphone",
      expect.anything(),
    );
  });

  it("shows only eligible unclaimed physical microphone sources", async () => {
    const networkSource = {
      id: "network-mic-development-1",
      displayName: "Android Test",
      kind: "network-client" as const,
      availability: "available" as const,
      isDefault: false as const,
    };
    mockMicrophoneWorkspace({
      sources: [...discoveredMicrophones, secondAvailableMicrophone, networkSource],
      channels: [microphoneChannel],
      assignments: [microphoneAssignment],
    });
    const user = userEvent.setup();
    render(<App />);

    const dialog = await openPhysicalSync(user);
    const selector = within(dialog).getByLabelText("Microphone");
    expect(within(selector).getByRole("option", { name: "Desk Microphone" })).toBeInTheDocument();
    expect(within(selector).queryByText("USB Microphone")).not.toBeInTheDocument();
    expect(within(selector).queryByText("Android Test")).not.toBeInTheDocument();
  });

  it("commits physical onboarding once and updates Host projections", async () => {
    mockMicrophoneWorkspace({ sources: [discoveredMicrophones[0]] });
    const user = userEvent.setup();
    render(<App />);

    const dialog = await completePhysicalSync(user);
    expect(within(dialog).getByText("Kyle")).toBeInTheDocument();
    expect(within(dialog).getByText("USB Microphone")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Create singer and assign microphone" }),
    );

    expect(await screen.findByDisplayValue("Kyle")).toBeInTheDocument();
    expect(screen.getByText("Kyle, microphone ready")).toBeInTheDocument();
    const commitCalls = tauriMocks.invoke.mock.calls.filter(
      ([command]) => command === "create_session_singer_with_microphone",
    );
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]?.[1]).toEqual({
      request: {
        requestId: expect.any(String),
        displayName: "Kyle",
        sourceId: "windows-mic-primary",
      },
    });
    expect(commitCalls[0]?.[1]?.request).not.toHaveProperty("singerId");
  });

  it("preserves failed form state and reuses the request ID for retry", async () => {
    mockMicrophoneWorkspace({
      sources: [discoveredMicrophones[0]],
      participantCommitFailures: 1,
    });
    const user = userEvent.setup();
    render(<App />);

    const dialog = await completePhysicalSync(user);
    const confirm = within(dialog).getByRole("button", {
      name: "Create singer and assign microphone",
    });
    await user.click(confirm);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The selected microphone is not available.",
    );
    expect(within(dialog).getByText("Kyle")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Kyle")).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Create singer and assign microphone" }),
    );

    expect(await screen.findByDisplayValue("Kyle")).toBeInTheDocument();
    const requests = tauriMocks.invoke.mock.calls
      .filter(([command]) => command === "create_session_singer_with_microphone")
      .map(([, args]) => args?.request?.requestId);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
  });

  it("requires a valid singer name before confirmation", async () => {
    mockMicrophoneWorkspace({ sources: [discoveredMicrophones[0]] });
    const user = userEvent.setup();
    render(<App />);

    const dialog = await openPhysicalSync(user);
    await user.selectOptions(within(dialog).getByLabelText("Microphone"), "windows-mic-primary");
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(within(dialog).getByRole("button", { name: "Next" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter a singer name.");
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "create_session_singer_with_microphone",
      expect.anything(),
    );
  });

  it("shows participant commit success and failure only in Developer diagnostics", async () => {
    mockMicrophoneWorkspace({ sources: [discoveredMicrophones[0]] });
    const user = userEvent.setup();
    render(<App />);

    const dialog = await completePhysicalSync(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Create singer and assign microphone" }),
    );
    expect(screen.queryByText("Participant onboarding verification")).not.toBeInTheDocument();

    await openDeveloperWorkspace(user);
    const panel = screen
      .getByRole("heading", { name: "Participant onboarding verification" })
      .closest("section");
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByText("Result: Success")).toBeInTheDocument();
    expect(
      within(panel as HTMLElement).getByText(/Singer: Kyle \/ Source: USB Microphone/),
    ).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText(/Rollback: No/)).toBeInTheDocument();
  });

  it("projects participant commit failures in Developer without exposing them to operators", async () => {
    mockMicrophoneWorkspace({
      sources: [discoveredMicrophones[0]],
      participantCommitFailures: 1,
    });
    const user = userEvent.setup();
    render(<App />);

    const dialog = await completePhysicalSync(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Create singer and assign microphone" }),
    );
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Participant onboarding verification")).not.toBeInTheDocument();

    await openDeveloperWorkspace(user);
    const panel = screen
      .getByRole("heading", { name: "Participant onboarding verification" })
      .closest("section");
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByText("Result: Failure")).toBeInTheDocument();
    expect(
      within(panel as HTMLElement).getByText(/The selected microphone is not available/),
    ).toBeInTheDocument();
  });

  it("does not duplicate participant commits under StrictMode", async () => {
    mockMicrophoneWorkspace({ sources: [discoveredMicrophones[0]] });
    const user = userEvent.setup();
    renderStrictApp();

    const dialog = await completePhysicalSync(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Create singer and assign microphone" }),
    );

    await waitFor(() =>
      expect(
        tauriMocks.invoke.mock.calls.filter(
          ([command]) => command === "create_session_singer_with_microphone",
        ),
      ).toHaveLength(1),
    );
  });

  it("shows loading and then an empty available-microphone state", async () => {
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

    expect(screen.getByText("Finding microphones...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();

    deferred.resolve([]);

    expect(await screen.findByText("No available microphones were found.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("renders one singer-centered row per singer without internal IDs in the normal flow", async () => {
    mockMicrophoneWorkspace();
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);

    const singerList = await screen.findByLabelText("Singer microphones");
    const rows = within(singerList).getAllByRole("article");
    expect(rows).toHaveLength(4);
    expect(within(singerList).getByText("Singer 1")).toBeInTheDocument();
    expect(within(singerList).getByText("Singer 4")).toBeInTheDocument();
    expect(within(singerList).queryByText("microphone-channel-1")).not.toBeInTheDocument();
    expect(within(singerList).queryByText("windows-mic-primary")).not.toBeInTheDocument();
    expect(within(singerList).queryByText(/MicrophoneChannel/i)).not.toBeInTheDocument();
    expect(within(singerList).queryByText(/CaptureSession/i)).not.toBeInTheDocument();
  });

  it("creates and assigns a microphone when an unassigned singer chooses one", async () => {
    mockMicrophoneWorkspace({ sources: [discoveredMicrophones[0]] });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    const singerOne = within(await screen.findByLabelText("Singer microphones")).getAllByRole(
      "article",
    )[0];

    await user.selectOptions(within(singerOne).getByLabelText("Microphone"), "windows-mic-primary");

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("create_microphone_channel", {
        sourceId: "windows-mic-primary",
      }),
    );
    expect(tauriMocks.invoke).toHaveBeenCalledWith("assign_microphone_channel", {
      channelId: expect.stringMatching(/^microphone-channel-/),
      singerId: "singer-1",
    });
  });

  it("changes an assigned singer microphone through source replacement", async () => {
    mockMicrophoneWorkspace({
      sources: [discoveredMicrophones[0], secondAvailableMicrophone],
      channels: [microphoneChannel],
      assignments: [microphoneAssignment],
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    const singerOne = within(await screen.findByLabelText("Singer microphones")).getAllByRole(
      "article",
    )[0];

    await user.selectOptions(within(singerOne).getByLabelText("Microphone"), "windows-mic-third");

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("replace_microphone_channel_source", {
        channelId: microphoneChannel.id,
        sourceId: secondAvailableMicrophone.id,
      }),
    );
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "unassign_microphone_channel",
      expect.anything(),
    );
  });

  it("clears an assigned singer without removing the channel", async () => {
    mockMicrophoneWorkspace({
      channels: [microphoneChannel],
      assignments: [microphoneAssignment],
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    const singerOne = within(await screen.findByLabelText("Singer microphones")).getAllByRole(
      "article",
    )[0];

    await user.selectOptions(within(singerOne).getByLabelText("Microphone"), "");

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("unassign_microphone_channel", {
        channelId: microphoneChannel.id,
      }),
    );
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "remove_microphone_channel",
      expect.anything(),
    );
  });

  it("keeps unavailable microphones out of normal choices while preserving the default indicator", async () => {
    const unavailable = {
      id: "windows-mic-offline",
      displayName: "Offline Microphone",
      kind: "windows-device" as const,
      availability: "unavailable" as const,
      isDefault: false,
    };
    mockMicrophoneWorkspace({ sources: [discoveredMicrophones[0], unavailable] });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);

    const singerOne = within(await screen.findByLabelText("Singer microphones")).getAllByRole(
      "article",
    )[0];
    const selector = within(singerOne).getByLabelText("Microphone");
    expect(
      within(selector).getByRole("option", { name: "USB Microphone (Default)" }),
    ).toBeInTheDocument();
    expect(
      within(selector).queryByRole("option", { name: "Offline Microphone" }),
    ).not.toBeInTheDocument();
  });

  it("shows a disconnected assigned microphone with plain recovery actions", async () => {
    mockMicrophoneWorkspace({
      sources: [secondAvailableMicrophone],
      channels: [disconnectedMicrophoneChannel],
      assignments: [microphoneAssignment],
      recoveryStates: [disconnectedRecoveryState],
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    const singerOne = within(await screen.findByLabelText("Singer microphones")).getAllByRole(
      "article",
    )[0];

    expect(within(singerOne).getByText("Disconnected")).toBeInTheDocument();
    expect(within(singerOne).getByText("USB Microphone is disconnected.")).toBeInTheDocument();
    expect(
      within(singerOne).getByRole("option", { name: "USB Microphone (Disconnected)" }),
    ).toBeDisabled();
    expect(within(singerOne).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(singerOne).getByRole("button", { name: "Leave unassigned" })).toBeInTheDocument();
    expect(within(singerOne).queryByText("replacement-available")).not.toBeInTheDocument();

    await user.click(within(singerOne).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("retry_microphone_channel_source", {
        channelId: microphoneChannel.id,
      }),
    );
  });

  it("represents waiting and unassigned singers with public status language", async () => {
    mockMicrophoneWorkspace({ waitingStates: [microphoneWaitingState] });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);

    const rows = within(await screen.findByLabelText("Singer microphones")).getAllByRole("article");
    expect(within(rows[0]).getByText("Waiting")).toBeInTheDocument();
    expect(within(rows[0]).getByText(microphoneWaitingState.message)).toBeInTheDocument();
    expect(within(rows[1]).getByText("Unassigned")).toBeInTheDocument();
    expect(within(rows[1]).getByText("No microphone selected.")).toBeInTheDocument();
  });

  it("projects compact singer-bar microphone readiness without visible status text", async () => {
    const secondChannel = {
      ...disconnectedMicrophoneChannel,
      id: "microphone-channel-2",
      sourceId: "windows-mic-secondary",
    };
    mockMicrophoneWorkspace({
      channels: [microphoneChannel, secondChannel],
      assignments: [
        microphoneAssignment,
        {
          channelId: secondChannel.id,
          singerId: "singer-3",
          method: "manual",
          sequence: 2,
        },
      ],
      recoveryStates: [
        {
          ...disconnectedRecoveryState,
          channelId: secondChannel.id,
          status: "recovery-failed",
        },
      ],
      waitingStates: [
        {
          ...microphoneWaitingState,
          singerId: "singer-2",
        },
      ],
    });
    render(<App />);

    const singerBar = screen.getByRole("region", { name: "Singer bar" });
    expect(within(singerBar).getByText("Singers")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(singerBar).getByText("Singer 1, microphone ready")).toHaveClass(
        "visually-hidden",
      ),
    );
    expect(within(singerBar).getByText("Singer 2, microphone waiting")).toHaveClass(
      "visually-hidden",
    );
    expect(within(singerBar).getByText("Singer 3, microphone unavailable")).toHaveClass(
      "visually-hidden",
    );
    expect(within(singerBar).getByText("Singer 4, microphone unassigned")).toHaveClass(
      "visually-hidden",
    );
    expect(singerBar.querySelector('[data-status="ready"]')).toHaveAttribute(
      "title",
      "Singer 1, microphone ready",
    );
    expect(singerBar.querySelector('[data-status="waiting"]')).toHaveAttribute(
      "title",
      "Singer 2, microphone waiting",
    );
    expect(singerBar.querySelector('[data-status="unavailable"]')).toHaveAttribute(
      "title",
      "Singer 3, microphone unavailable",
    );
    expect(singerBar.querySelector('[data-status="unassigned"]')).toHaveAttribute(
      "title",
      "Singer 4, microphone unassigned",
    );
    expect(within(singerBar).queryByText(/^Ready$/)).not.toBeInTheDocument();
    expect(within(singerBar).queryByText(/^Waiting$/)).not.toBeInTheDocument();
  });

  it("renders a simple input meter and starts capture only after Test microphone", async () => {
    mockMicrophoneWorkspace({
      channels: [microphoneChannel],
      assignments: [microphoneAssignment],
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    const singerOne = within(await screen.findByLabelText("Singer microphones")).getAllByRole(
      "article",
    )[0];

    expect(within(singerOne).getByRole("meter", { name: "Singer 1 input level" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "start_diagnostic_capture",
      expect.anything(),
    );

    await user.click(within(singerOne).getByRole("button", { name: "Test microphone" }));

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("start_diagnostic_capture", {
        sourceId: microphoneChannel.sourceId,
      }),
    );
    expect(within(singerOne).queryByText(/RMS|Peak|Clipping|sequence/i)).not.toBeInTheDocument();
  });

  it("keeps development controls accessible but outside the primary singer flow", async () => {
    mockMicrophoneWorkspace();
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);

    const singerList = await screen.findByLabelText("Singer microphones");
    expect(
      within(singerList).queryByRole("button", { name: "Start Listener" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Developer diagnostics")).toBeInTheDocument();

    await openDeveloperDiagnostics(user);

    expect(screen.getByText(/INSECURE DEVELOPMENT CONNECTION/)).toBeInTheDocument();
    expect(screen.getByLabelText("Bind address")).toHaveValue("127.0.0.1");
    expect(screen.getByLabelText("TCP port")).toHaveValue(45820);
    expect(screen.getByLabelText("UDP port")).toHaveValue(45821);
    expect(screen.getByText(/Listener: Stopped \/ TCP 45820 \/ UDP 45821/)).toBeInTheDocument();
  });

  it("removes redundant operator workspace heading copy while preserving Developer context", async () => {
    mockMicrophoneWorkspace();
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);

    expect(screen.getByRole("heading", { name: "Microphones" })).toHaveClass("visually-hidden");
    expect(screen.queryByText("Operator")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Assign microphones to singers and check that input is working."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();

    await openDeveloperDiagnostics(user);

    expect(screen.getByRole("heading", { name: "Developer" })).not.toHaveClass("visually-hidden");
    expect(
      screen.getByText(/Protocol, capture, monitor and runtime diagnostics/),
    ).toBeInTheDocument();
  });

  it("passes edited development listener bind address and ports to the Host", async () => {
    mockMicrophoneWorkspace();
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await openDeveloperDiagnostics(user);

    await user.clear(screen.getByLabelText("Bind address"));
    await user.type(screen.getByLabelText("Bind address"), "192.168.1.78");
    await user.clear(screen.getByLabelText("TCP port"));
    await user.type(screen.getByLabelText("TCP port"), "45920");
    await user.clear(screen.getByLabelText("UDP port"));
    await user.type(screen.getByLabelText("UDP port"), "45921");
    await user.click(screen.getByRole("button", { name: "Start Listener" }));

    expect(tauriMocks.invoke).toHaveBeenCalledWith("start_development_protocol_listener", {
      request: { bindAddress: "192.168.1.78", tcpPort: 45920, udpPort: 45921 },
    });
    expect(await screen.findByText(/Client: Android Test/)).toBeInTheDocument();
  });

  it("rejects invalid development listener ports before invoking the Host", async () => {
    mockMicrophoneWorkspace();
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await openDeveloperDiagnostics(user);

    await user.clear(screen.getByLabelText("TCP port"));
    await user.type(screen.getByLabelText("TCP port"), "70000");
    await user.click(screen.getByRole("button", { name: "Start Listener" }));

    expect(screen.getByText("Ports must be whole numbers from 1 to 65535.")).toBeInTheDocument();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "start_development_protocol_listener",
      expect.anything(),
    );
  });

  it("disables development listener fields while listening and renders the actual bound endpoint", async () => {
    mockMicrophoneWorkspace({ developmentStatus: activeDevelopmentStatus });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await openDeveloperDiagnostics(user);

    expect(screen.getByLabelText("Bind address")).toBeDisabled();
    expect(screen.getByLabelText("TCP port")).toBeDisabled();
    expect(screen.getByLabelText("UDP port")).toBeDisabled();
    expect(
      screen.getByText(/Listener: Listening \/ TCP 45820 \/ UDP 45821 \/ 127.0.0.1/),
    ).toBeInTheDocument();
  });

  it("does not duplicate listener start under React StrictMode", async () => {
    mockMicrophoneWorkspace();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await openMicrophoneWorkspace(user);
    await openDeveloperDiagnostics(user);
    await user.click(screen.getByRole("button", { name: "Start Listener" }));

    await waitFor(() =>
      expect(
        tauriMocks.invoke.mock.calls.filter(
          ([command]) => command === "start_development_protocol_listener",
        ),
      ).toHaveLength(1),
    );
  });
  it("starts and stops diagnostic audio monitoring from Developer diagnostics", async () => {
    mockMicrophoneWorkspace({
      sources: [discoveredMicrophones[0]],
      channels: [microphoneChannel],
      assignments: [microphoneAssignment],
      captureSnapshot: activeCaptureSnapshot(),
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await openDeveloperDiagnostics(user);

    await user.selectOptions(screen.getByLabelText("Source"), "windows-mic-primary");
    await user.clear(screen.getByLabelText("Gain"));
    await user.type(screen.getByLabelText("Gain"), "35");
    await user.click(screen.getByRole("button", { name: "Start Monitoring" }));

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("start_diagnostic_monitor", {
        request: { sourceId: "windows-mic-primary", outputDeviceId: "default", gain: 0.35 },
      }),
    );
    expect(await screen.findByText(/Status: Active/)).toBeInTheDocument();
    expect(screen.getByText(/Queue: 1\/8/)).toBeInTheDocument();
    expect(screen.getByText(/Samples written: 480/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop Monitoring" }));

    await waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("stop_diagnostic_monitor"));
  });

  it("rejects invalid diagnostic monitor gain before invoking the Host", async () => {
    mockMicrophoneWorkspace({
      sources: [discoveredMicrophones[0]],
      captureSnapshot: activeCaptureSnapshot(),
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    await openDeveloperDiagnostics(user);

    await user.selectOptions(screen.getByLabelText("Source"), "windows-mic-primary");
    await user.clear(screen.getByLabelText("Gain"));
    await user.type(screen.getByLabelText("Gain"), "125");
    await user.click(screen.getByRole("button", { name: "Start Monitoring" }));

    expect(screen.getByText("Gain must be a number from 0 to 100.")).toBeInTheDocument();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "start_diagnostic_monitor",
      expect.anything(),
    );
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
      if (command === "list_session_singers") {
        return Promise.resolve(initialSessionSingers);
      }
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
      if (command === "list_session_singers") {
        return Promise.resolve(initialSessionSingers);
      }
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
      if (command === "list_session_singers") {
        return Promise.resolve(initialSessionSingers);
      }
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
      if (command === "list_session_singers") {
        return Promise.resolve(initialSessionSingers);
      }
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
      if (command === "list_session_singers") {
        return Promise.resolve(initialSessionSingers);
      }
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
      if (command === "list_session_singers") {
        return Promise.resolve(initialSessionSingers);
      }
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
      if (command === "list_session_singers") {
        return Promise.resolve(initialSessionSingers);
      }
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

    await user.click(screen.getByRole("button", { name: "Performance" }));
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

    await user.click(screen.getByRole("button", { name: "Performance" }));
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

  it("parses lyrics for a loaded song and updates the Performance view from the audio clock", async () => {
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

    await user.click(screen.getByRole("button", { name: "Performance" }));
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
    await user.click(screen.getByRole("button", { name: "Performance" }));

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
    await user.click(screen.getByRole("button", { name: "Performance" }));

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
    await user.click(screen.getByRole("button", { name: "Performance" }));
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
    await user.click(screen.getByRole("button", { name: "Performance" }));
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
    await user.click(screen.getByRole("button", { name: "Performance" }));

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
    await user.click(screen.getByRole("button", { name: "Performance" }));
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
    await user.click(screen.getByRole("button", { name: "Performance" }));

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
    await user.click(screen.getByRole("button", { name: "Performance" }));

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
    await user.click(screen.getByRole("button", { name: "Performance" }));

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
      if (command === "list_session_singers") {
        return Promise.resolve(initialSessionSingers);
      }
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
      if (command === "list_session_singers") {
        return Promise.resolve(initialSessionSingers);
      }
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

      return mockSuccessfulLibraryInvoke(command);
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

      return mockSuccessfulLibraryInvoke(command);
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
      if (command === "list_session_singers") {
        return Promise.resolve(initialSessionSingers);
      }
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

      return mockSuccessfulLibraryInvoke(command);
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
  it("renders Host projections and requests singer mutations without frontend-owned IDs", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("region", { name: "Singer bar" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Singer 1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Singer 4")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Sync/ })).toBeInTheDocument();

    const singerTwoInput = screen.getByDisplayValue("Singer 2");
    await user.clear(singerTwoInput);
    await user.type(singerTwoInput, "Lead singer");
    fireEvent.blur(singerTwoInput);
    expect(screen.getByDisplayValue("Lead singer")).toBeInTheDocument();
    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("rename_session_singer", {
        request: { singerId: "singer-2", displayName: "Lead singer" },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Remove Singer 1" }));
    await waitFor(() => expect(screen.queryByDisplayValue("Singer 1")).not.toBeInTheDocument());
    expect(tauriMocks.invoke).toHaveBeenCalledWith("remove_session_singer", {
      singerId: "singer-1",
    });
    expect(screen.getByDisplayValue("Lead singer")).toBeInTheDocument();
  });

  it("loads Host singers once under StrictMode and does not recreate them", async () => {
    renderStrictApp();
    expect(await screen.findByDisplayValue("Singer 1")).toBeInTheDocument();
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "list_session_singers"),
    ).toHaveLength(1);
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "create_session_singer"),
    ).toHaveLength(0);
  });
});
