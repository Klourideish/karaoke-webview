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
import type { DevelopmentPairingProjection, PairingOfferProjection } from "./pairing/types";
import type { ParticipantCommitDiagnosticProjection } from "./session-singers/types";
import { idlePlaybackProjection, type PlaybackProjection } from "./playback/types";
import { emptyPerformanceProjection, type PerformanceProjection } from "./performance/types";
import { idleQueueProjection } from "./queue/useQueue";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
}));
const tauriEventMocks = vi.hoisted(() => ({ listen: vi.fn() }));

let nextAnimationFrameId = 1;
let animationFrameCallbacks = new Map<number, FrameRequestCallback>();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (filePath: string) => `asset://localhost/${encodeURIComponent(filePath)}`,
  invoke: tauriMocks.invoke,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: tauriMocks.open,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriEventMocks.listen,
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
  { id: "singer-1", displayName: "Dad", createdOrder: 1 },
  { id: "singer-2", displayName: "Mum", createdOrder: 2 },
  { id: "singer-3", displayName: "Jack", createdOrder: 3 },
  { id: "singer-4", displayName: "Ellie", createdOrder: 4 },
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

const idleDevelopmentPairingProjection: DevelopmentPairingProjection = {
  status: {
    activeOfferId: null,
    lifecycleState: null,
    hostAddress: null,
    controlPort: null,
    expiresInSeconds: null,
    expiresAt: null,
    lifetimeSeconds: null,
    claimedClientName: null,
    claimedClientDeviceId: null,
    participantSetupTokenIssued: false,
    pendingParticipant: null,
    acceptedParticipant: null,
    lastRevokedParticipant: null,
    lastRejectionReason: null,
    lastRejectionMessage: null,
  },
  diagnostics: {
    retainedOfferCount: 0,
    offersCreated: 0,
    offersExpired: 0,
    offersCancelled: 0,
    offersConsumed: 0,
    duplicateClaims: 0,
    invalidTokens: 0,
    proposalsReceived: 0,
    acceptedParticipants: 0,
    revokedParticipants: 0,
    rejectedProposals: 0,
  },
};

const developmentPairingOffer: PairingOfferProjection = {
  profileVersion: 0,
  offerId: "pairing-offer-1",
  hostDisplayName: "Karaoke Host",
  hostAddress: "192.168.1.78",
  controlPort: 45820,
  pairingToken: "pairing-token-for-tests",
  expiresAt: "2026-07-14T12:02:00Z",
  lifetimeSeconds: 120,
  pairingScope: { kind: "generic" },
  qrPayload: '{"type":"development_pairing_offer","profileVersion":0}',
};

const pendingDevelopmentPairingProjection: DevelopmentPairingProjection = {
  status: {
    ...idleDevelopmentPairingProjection.status,
    activeOfferId: developmentPairingOffer.offerId,
    lifecycleState: "awaiting-operator-approval",
    hostAddress: developmentPairingOffer.hostAddress,
    controlPort: developmentPairingOffer.controlPort,
    expiresInSeconds: 91,
    expiresAt: developmentPairingOffer.expiresAt,
    lifetimeSeconds: developmentPairingOffer.lifetimeSeconds,
    claimedClientName: "Kyle's Phone",
    claimedClientDeviceId: "android-device-1",
    participantSetupTokenIssued: true,
    pendingParticipant: {
      requestId: "participant-proposal-1",
      clientDeviceId: "android-device-1",
      clientName: "Kyle's Phone",
      localParticipantProfileId: "local-profile-1",
      preferredDisplayName: "Kyle",
      previousHostParticipantReference: null,
    },
  },
  diagnostics: {
    ...idleDevelopmentPairingProjection.diagnostics,
    retainedOfferCount: 1,
    offersCreated: 1,
    offersConsumed: 1,
    proposalsReceived: 1,
  },
};
let sessionSingerState: typeof initialSessionSingers = [];
let nextSessionSingerNumber = 1;
let playbackProjectionState: PlaybackProjection = structuredClone(idlePlaybackProjection);
let performanceProjectionState: PerformanceProjection = structuredClone(emptyPerformanceProjection);
let playbackSongs: MediaSong[] = [];
let playbackLyrics: LyricDocument;

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
  audioHandoffCapacityFrames: 4,
  audioHandoffQueueDepth: 0,
  audioHandoffMaximumQueueDepth: 0,
  audioHandoffDroppedFrames: 0,
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

type PlaybackMockArgs = {
  songId?: string;
  request?: {
    requestId?: string;
    songId?: string;
    attemptId?: string;
    performanceId?: string;
    kind?: "start-rejected" | "media-error";
    message?: string;
  };
};

function mockPlaybackInvoke(command: string, args?: PlaybackMockArgs) {
  if (command === "get_performance_projection") {
    return Promise.resolve(structuredClone(performanceProjectionState));
  }

  if (command === "create_performance") {
    const singer = sessionSingerState.find((candidate) => candidate.id === args?.request?.singerId);
    const song = playbackSongs.find((candidate) => candidate.id === args?.request?.songId);
    if (!singer || !song) {
      return Promise.reject({ reasonCode: "invalid-state", message: "Singer or song missing." });
    }
    performanceProjectionState = {
      revision: performanceProjectionState.revision + 1,
      active: {
        id: "performance-1",
        state: "countdown",
        performer: { id: singer.id, displayName: singer.displayName },
        song: { id: song.id, title: song.title, artist: song.artist },
        countdownDeadlineUnixMs: Date.now() + 3_000,
        countdownRemainingMs: 3_000,
        resultsDeadlineUnixMs: null,
        resultsRemainingMs: null,
        readiness: readyPerformanceMicrophoneReadiness,
        playback: { attemptId: null, state: "idle", startupPending: false },
        terminalReason: null,
        failure: null,
      },
      diagnostics: {
        ...performanceProjectionState.diagnostics,
        lastTransition: "Ready->Countdown",
      },
    };
    return Promise.resolve(structuredClone(performanceProjectionState));
  }

  if (command === "cancel_preparation" || command === "skip_performance") {
    if (!performanceProjectionState.active) {
      return Promise.reject({ reasonCode: "performance-not-found", message: "No Performance." });
    }
    performanceProjectionState = {
      ...performanceProjectionState,
      revision: performanceProjectionState.revision + 1,
      active: {
        ...performanceProjectionState.active,
        state: "stopped",
        terminalReason:
          command === "cancel_preparation" ? "cancelled-before-playback" : "skipped-by-operator",
      },
      diagnostics: {
        ...performanceProjectionState.diagnostics,
        lastTransition: "Countdown->Stopped",
      },
    };
    return Promise.resolve(structuredClone(performanceProjectionState));
  }

  if (command === "get_playback_projection") {
    return Promise.resolve(structuredClone(playbackProjectionState));
  }

  if (command === "request_song_playback") {
    const song = playbackSongs.find((candidate) => candidate.id === args?.request?.songId);
    if (!song) {
      return Promise.reject({ reasonCode: "song-not-found", message: "Song not found." });
    }
    if (["starting", "playing", "paused"].includes(playbackProjectionState.state)) {
      return Promise.reject({
        reasonCode: "playback-already-active",
        message: "Stop the current song before starting another one.",
      });
    }
    const attemptNumber = Number(playbackProjectionState.attemptId?.split("-").at(-1) ?? 0) + 1;
    playbackProjectionState = {
      ...playbackProjectionState,
      revision: playbackProjectionState.revision + 1,
      state: "starting",
      desiredAction: "start",
      attemptId: `playback-attempt-${attemptNumber}`,
      song: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        audioPath: song.audioPath,
      },
      failureReason: null,
      failureMessage: null,
      diagnostics: {
        ...playbackProjectionState.diagnostics,
        lastAdapterEvent: "start-requested",
      },
    };
    return Promise.resolve(structuredClone(playbackProjectionState));
  }

  if (command === "request_playback_pause") {
    playbackProjectionState = transitionPlayback("paused", "pause", "pause-requested");
    return Promise.resolve(structuredClone(playbackProjectionState));
  }

  if (command === "request_playback_resume") {
    playbackProjectionState = transitionPlayback("starting", "resume", "resume-requested");
    return Promise.resolve(structuredClone(playbackProjectionState));
  }

  if (command === "request_playback_stop") {
    playbackProjectionState = transitionPlayback("stopped", "stop", "stop-requested");
    return Promise.resolve(structuredClone(playbackProjectionState));
  }

  if (
    command === "report_playback_started" ||
    command === "report_playback_completed" ||
    command === "report_playback_failed"
  ) {
    if (args?.request?.attemptId !== playbackProjectionState.attemptId) {
      return Promise.reject({ reasonCode: "stale-attempt", message: "Stale playback attempt." });
    }
    if (command === "report_playback_started") {
      playbackProjectionState = transitionPlayback("playing", "none", "adapter-started");
    } else if (command === "report_playback_completed") {
      playbackProjectionState = transitionPlayback("completed", "none", "adapter-completed");
    } else {
      playbackProjectionState = {
        ...transitionPlayback("failed", "none", "adapter-failed"),
        failureReason:
          args?.request?.kind === "media-error" ? "media-failed" : "adapter-start-failed",
        failureMessage: args?.request?.message ?? "Playback failed.",
      };
    }
    return Promise.resolve(structuredClone(playbackProjectionState));
  }

  return null;
}

function transitionPlayback(
  state: PlaybackProjection["state"],
  desiredAction: PlaybackProjection["desiredAction"],
  lastAdapterEvent: string,
): PlaybackProjection {
  return {
    ...playbackProjectionState,
    revision: playbackProjectionState.revision + 1,
    state,
    desiredAction,
    diagnostics: {
      ...playbackProjectionState.diagnostics,
      lastAdapterEvent,
    },
  };
}

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
  playbackSongs = scanResult.songs.length > 0 ? scanResult.songs : populatedScanResult.songs;
  playbackLyrics = lyricResult;
  let monitorStatus = idleDiagnosticMonitorStatus;
  let monitorDiagnostics = idleDiagnosticMonitorDiagnostics;
  tauriMocks.invoke.mockImplementation(
    (
      command: string,
      args?: {
        songId?: string;
        sourceId?: string;
        singerId?: string;
        request?: {
          singerId?: string;
          displayName?: string | null;
          requestId?: string;
          sourceId?: string;
          songId?: string;
          attemptId?: string;
          kind?: "start-rejected" | "media-error";
          message?: string;
        };
      },
    ) => {
      const playbackResponse = mockPlaybackInvoke(command, args);
      if (playbackResponse) return playbackResponse;
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

      if (command === "parse_song_lyrics") {
        const songId = args?.songId ?? playbackSongs[0].id;
        return Promise.resolve({
          ...lyricResult,
          sourceSongId: songId,
        });
      }

      if (command === "refresh_media_library") {
        return Promise.resolve(scanResult);
      }

      if (command === "select_library_location") {
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

function mockSuccessfulLibraryInvoke(command: string, args?: PlaybackMockArgs) {
  const playbackResponse = mockPlaybackInvoke(command, args);
  if (playbackResponse) return playbackResponse;

  if (command === "parse_song_lyrics") {
    return Promise.resolve({
      ...playbackLyrics,
      sourceSongId: args?.songId ?? playbackSongs[0].id,
    });
  }
  if (command === "get_queue_projection") {
    return Promise.resolve(structuredClone(idleQueueProjection));
  }
  if (command === "load_library_settings") {
    return Promise.resolve({ libraryRoot: "C:\\Music" });
  }

  if (command === "load_library_index") {
    return Promise.resolve({ status: "miss", scanResult: null, message: null });
  }

  if (command === "refresh_media_library") {
    return Promise.resolve(populatedScanResult);
  }

  if (command === "select_library_location") {
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

  if (command === "get_development_pairing_status") {
    return Promise.resolve(idleDevelopmentPairingProjection);
  }

  if (command === "get_development_pairing_diagnostics") {
    return Promise.resolve(idleDevelopmentPairingProjection.diagnostics);
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
  tauriEventMocks.listen.mockReset();
  tauriEventMocks.listen.mockResolvedValue(() => undefined);
  playbackProjectionState = structuredClone(idlePlaybackProjection);
  performanceProjectionState = structuredClone(emptyPerformanceProjection);
  playbackSongs = populatedScanResult.songs;
  playbackLyrics = populatedLyricDocument;
  sessionSingerState = [];
  nextSessionSingerNumber = 1;
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

async function playSongFromLibrary(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  acknowledgeStart = true,
) {
  await user.click(screen.getByRole("button", { name: "Developer" }));
  const stop = screen.queryByRole("button", { name: "Stop playback" });
  if (stop && !stop.hasAttribute("disabled")) {
    await user.click(stop);
  }
  await user.click(screen.getByRole("button", { name: `Test playback: ${title}` }));
  const audio = getAudioElement();
  await waitFor(() => expect(audio.dataset.songId).toBe(playbackProjectionState.song?.id));
  if (acknowledgeStart) {
    fireEvent.playing(audio);
    await waitFor(() => expect(playbackProjectionState.state).toBe("playing"));
  }
  await user.click(screen.getByRole("button", { name: "Library" }));
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

  it("provides bounded accessible session-local lyric offset controls", async () => {
    const user = userEvent.setup();
    render(<App />);

    const earlier = screen.getByRole("button", {
      name: "Show lyrics 100 milliseconds earlier",
    });
    const later = screen.getByRole("button", {
      name: "Show lyrics 100 milliseconds later",
    });
    const reset = screen.getByRole("button", { name: "Reset lyric offset" });
    expect(screen.getByRole("status", { name: "Current lyric offset" })).toHaveTextContent("0 ms");
    expect(reset).toBeDisabled();

    for (let step = 0; step < 30; step += 1) fireEvent.click(earlier);
    expect(screen.getByRole("status", { name: "Current lyric offset" })).toHaveTextContent(
      "-3000 ms",
    );
    expect(earlier).toBeDisabled();
    expect(later).toBeEnabled();

    await user.click(reset);
    expect(screen.getByRole("status", { name: "Current lyric offset" })).toHaveTextContent("0 ms");
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
    expect(
      within(topBar).queryByRole("button", { name: /^(Play|Pause)$/ }),
    ).not.toBeInTheDocument();
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
    microphoneSelectionFailures?: number;
    pairingProjection?: DevelopmentPairingProjection;
    pairingProjectionAfterCreate?: DevelopmentPairingProjection;
    pairingCreateError?: { reasonCode: string; message: string };
    singers?: typeof initialSessionSingers;
  };

  function mockMicrophoneWorkspace(state: MicrophoneInvokeState = {}) {
    sessionSingerState = (state.singers ?? initialSessionSingers).map((singer) => ({ ...singer }));
    nextSessionSingerNumber =
      sessionSingerState.reduce((maximum, singer) => Math.max(maximum, singer.createdOrder), 0) + 1;
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
    let pairingProjection = state.pairingProjection ?? idleDevelopmentPairingProjection;
    let participantCommitDiagnostics: ParticipantCommitDiagnosticProjection = {
      ...emptyParticipantCommitDiagnostics,
    };
    let participantCommitFailures = state.participantCommitFailures ?? 0;
    const participantCommitResults = new Map<string, unknown>();
    const microphoneSelectionResults = new Map<string, unknown>();
    let nextChannelSequence = 2;
    let microphoneSelectionFailures = state.microphoneSelectionFailures ?? 0;

    tauriMocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "discover_local_microphone_sources") {
        return Promise.resolve(sources);
      }

      if (command === "get_participant_commit_diagnostics") {
        return Promise.resolve(participantCommitDiagnostics);
      }

      if (command === "get_development_pairing_status") {
        return Promise.resolve(pairingProjection);
      }

      if (command === "get_development_pairing_diagnostics") {
        return Promise.resolve(pairingProjection.diagnostics);
      }

      if (command === "create_development_pairing_offer") {
        if (state.pairingCreateError) {
          return Promise.reject(state.pairingCreateError);
        }
        pairingProjection =
          state.pairingProjectionAfterCreate ??
          ({
            status: {
              ...idleDevelopmentPairingProjection.status,
              activeOfferId: developmentPairingOffer.offerId,
              lifecycleState: "displayed",
              hostAddress: developmentPairingOffer.hostAddress,
              controlPort: developmentPairingOffer.controlPort,
              expiresInSeconds: developmentPairingOffer.lifetimeSeconds,
              expiresAt: developmentPairingOffer.expiresAt,
              lifetimeSeconds: developmentPairingOffer.lifetimeSeconds,
            },
            diagnostics: {
              ...idleDevelopmentPairingProjection.diagnostics,
              retainedOfferCount: 1,
              offersCreated: 1,
            },
          } satisfies DevelopmentPairingProjection);
        return Promise.resolve(developmentPairingOffer);
      }

      if (command === "cancel_development_pairing_offer") {
        pairingProjection = {
          ...pairingProjection,
          status: { ...pairingProjection.status, lifecycleState: "cancelled" },
          diagnostics: {
            ...pairingProjection.diagnostics,
            offersCancelled: pairingProjection.diagnostics.offersCancelled + 1,
          },
        };
        return Promise.resolve(pairingProjection);
      }

      if (command === "reject_development_pairing_proposal") {
        pairingProjection = {
          ...pairingProjection,
          status: {
            ...pairingProjection.status,
            lifecycleState: "rejected",
            lastRejectionReason: "policy-rejected",
            lastRejectionMessage: "The operator rejected this participant.",
          },
          diagnostics: {
            ...pairingProjection.diagnostics,
            rejectedProposals: pairingProjection.diagnostics.rejectedProposals + 1,
          },
        };
        return Promise.resolve(pairingProjection);
      }

      if (command === "accept_development_pairing_proposal") {
        const acceptedSinger = {
          id: `singer-${nextSessionSingerNumber}`,
          displayName:
            pairingProjection.status.pendingParticipant?.preferredDisplayName ?? "Phone Singer",
          createdOrder: nextSessionSingerNumber,
        };
        nextSessionSingerNumber += 1;
        sessionSingerState = [...sessionSingerState, acceptedSinger];
        pairingProjection = {
          ...pairingProjection,
          status: {
            ...pairingProjection.status,
            lifecycleState: "accepted",
            acceptedParticipant: {
              status: "accepted",
              hostDisplayName: "Karaoke Host",
              sessionSingerId: acceptedSinger.id,
              acceptedDisplayName: acceptedSinger.displayName,
              microphone: { state: "ready", message: "Microphone ready." },
              queuedSongCount: 0,
              nextUp: { state: "not-next" },
            },
          },
          diagnostics: {
            ...pairingProjection.diagnostics,
            acceptedParticipants: pairingProjection.diagnostics.acceptedParticipants + 1,
          },
        };
        return Promise.resolve(pairingProjection);
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

      if (command === "select_singer_microphone") {
        const request = (args?.request ?? {}) as {
          requestId?: string;
          sessionSingerId?: string;
          desiredSourceId?: string | null;
        };
        const requestId = request.requestId ?? "";
        const cached = microphoneSelectionResults.get(requestId);
        if (cached) {
          return Promise.resolve(cached);
        }
        if (microphoneSelectionFailures > 0) {
          microphoneSelectionFailures -= 1;
          return Promise.reject({
            reasonCode: "source-unavailable",
            message: "The selected microphone is not available.",
          });
        }
        const singerId = request.sessionSingerId ?? "";
        const existingAssignment = assignments.find(
          (assignment) => assignment.singerId === singerId,
        );
        if (!request.desiredSourceId) {
          const retainedChannel = existingAssignment
            ? (channels.find((channel) => channel.id === existingAssignment.channelId) ?? null)
            : null;
          assignments = assignments.filter((assignment) => assignment.singerId !== singerId);
          waitingStates = waitingStates.filter((waiting) => waiting.singerId !== singerId);
          const result = {
            sessionSingerId: singerId,
            status: "cleared" as const,
            channel: retainedChannel,
            assignment: null,
            sourceDisplayName: null,
          };
          microphoneSelectionResults.set(requestId, result);
          return Promise.resolve(result);
        }
        const source = sources.find((candidate) => candidate.id === request.desiredSourceId);
        let channel = existingAssignment
          ? channels.find((candidate) => candidate.id === existingAssignment.channelId)
          : channels.find(
              (candidate) =>
                candidate.sourceId === request.desiredSourceId &&
                !assignments.some((assignment) => assignment.channelId === candidate.id),
            );
        if (channel && existingAssignment && channel.sourceId !== request.desiredSourceId) {
          channel = {
            ...channel,
            sourceId: request.desiredSourceId,
            sourceDisplayName: source?.displayName ?? "Microphone",
            state: "available" as const,
          };
          channels = channels.map((candidate) =>
            candidate.id === channel?.id ? channel : candidate,
          );
        }
        if (!channel) {
          channel = {
            id: `microphone-channel-${nextChannelSequence++}`,
            sourceId: request.desiredSourceId,
            sourceDisplayName: source?.displayName ?? "Microphone",
            state: "available" as const,
          };
          channels = [...channels, channel];
        }
        const assignment =
          existingAssignment ??
          ({
            channelId: channel.id,
            singerId,
            method: "manual" as const,
            sequence: assignments.length + 1,
          } as const);
        assignments = assignments
          .filter((candidate) => candidate.singerId !== singerId)
          .concat(assignment);
        waitingStates = waitingStates.filter((waiting) => waiting.singerId !== singerId);
        const result = {
          sessionSingerId: singerId,
          status: "assigned" as const,
          channel,
          assignment,
          sourceDisplayName: source?.displayName ?? "Microphone",
        };
        microphoneSelectionResults.set(requestId, result);
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

  it("creates one development pairing offer and renders its QR projection", async () => {
    mockMicrophoneWorkspace({ sources: [discoveredMicrophones[0]] });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByDisplayValue("Dad")).toBeInTheDocument();
    expect(screen.queryByText(/empty singer/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Sync/ }));

    const dialog = screen.getByRole("dialog", { name: "Sync a singer" });
    expect(within(dialog).getByRole("button", { name: "Use physical microphone" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Connect phone" }));

    expect(await within(dialog).findByLabelText("Development pairing QR code")).toBeInTheDocument();
    expect(within(dialog).getByText("Host: 192.168.1.78:45820")).toBeInTheDocument();
    expect(within(dialog).getByText("Expires in 120 seconds.")).toBeInTheDocument();
    expect(
      tauriMocks.invoke.mock.calls.filter(
        ([command]) => command === "create_development_pairing_offer",
      ),
    ).toHaveLength(1);
  });

  it("keeps a typed offer-creation error visible after idle status polling", async () => {
    mockMicrophoneWorkspace({
      pairingCreateError: {
        reasonCode: "listener-not-active",
        message: "Start the insecure development listener before pairing a phone.",
      },
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Sync/ }));
    const dialog = screen.getByRole("dialog", { name: "Sync a singer" });
    await user.click(within(dialog).getByRole("button", { name: "Connect phone" }));

    const expected = "Start the insecure development listener in Developer before pairing a phone.";
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(expected);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(expected);
    expect(within(dialog).queryByLabelText("Development pairing QR code")).not.toBeInTheDocument();
  });

  it("does not duplicate pairing offer creation under StrictMode", async () => {
    mockMicrophoneWorkspace();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await user.click(await screen.findByRole("button", { name: /Sync/ }));
    const dialog = screen.getByRole("dialog", { name: "Sync a singer" });
    await user.click(within(dialog).getByRole("button", { name: "Connect phone" }));
    await within(dialog).findByLabelText("Development pairing QR code");

    expect(
      tauriMocks.invoke.mock.calls.filter(
        ([command]) => command === "create_development_pairing_offer",
      ),
    ).toHaveLength(1);
  });

  it("cancels the active pairing offer when the operator closes Sync", async () => {
    mockMicrophoneWorkspace();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Sync/ }));
    const dialog = screen.getByRole("dialog", { name: "Sync a singer" });
    await user.click(within(dialog).getByRole("button", { name: "Connect phone" }));
    await within(dialog).findByLabelText("Development pairing QR code");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(tauriMocks.invoke).toHaveBeenCalledWith("cancel_development_pairing_offer", {
      request: expect.objectContaining({ offerId: developmentPairingOffer.offerId }),
    });
    expect(screen.queryByRole("dialog", { name: "Sync a singer" })).not.toBeInTheDocument();
  });

  it("reviews and accepts a phone proposal through one Host decision", async () => {
    mockMicrophoneWorkspace({
      pairingProjectionAfterCreate: pendingDevelopmentPairingProjection,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Sync/ }));
    const dialog = screen.getByRole("dialog", { name: "Sync a singer" });
    await user.click(within(dialog).getByRole("button", { name: "Connect phone" }));

    expect(
      await within(dialog).findByRole("heading", { name: "Review participant" }),
    ).toBeVisible();
    expect(within(dialog).getByText("Kyle")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Accept participant" }));

    expect(tauriMocks.invoke).toHaveBeenCalledWith("accept_development_pairing_proposal", {
      request: expect.objectContaining({ offerId: developmentPairingOffer.offerId }),
    });
    expect(await within(dialog).findByText("Kyle was added to this session.")).toBeVisible();
    expect(await screen.findByDisplayValue("Kyle")).toBeVisible();
  });

  it("rejects a phone proposal without creating a singer", async () => {
    mockMicrophoneWorkspace({
      pairingProjectionAfterCreate: pendingDevelopmentPairingProjection,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Sync/ }));
    const dialog = screen.getByRole("dialog", { name: "Sync a singer" });
    await user.click(within(dialog).getByRole("button", { name: "Connect phone" }));
    await user.click(await within(dialog).findByRole("button", { name: "Reject" }));

    expect(await within(dialog).findByText("Participant not added")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Kyle, microphone/i })).not.toBeInTheDocument();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "create_session_singer_with_microphone",
      expect.anything(),
    );
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
    expect(within(singerList).getByText("Dad")).toBeInTheDocument();
    expect(within(singerList).getByText("Ellie")).toBeInTheDocument();
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
      expect(tauriMocks.invoke).toHaveBeenCalledWith("select_singer_microphone", {
        request: {
          requestId: expect.any(String),
          sessionSingerId: "singer-1",
          desiredSourceId: "windows-mic-primary",
        },
      }),
    );
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "select_singer_microphone"),
    ).toHaveLength(1);
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "create_microphone_channel",
      expect.anything(),
    );
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "assign_microphone_channel",
      expect.anything(),
    );
    await waitFor(() =>
      expect(within(singerOne).getByLabelText("Microphone")).toHaveValue("windows-mic-primary"),
    );
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
      expect(tauriMocks.invoke).toHaveBeenCalledWith("select_singer_microphone", {
        request: {
          requestId: expect.any(String),
          sessionSingerId: "singer-1",
          desiredSourceId: secondAvailableMicrophone.id,
        },
      }),
    );
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "replace_microphone_channel_source",
      expect.anything(),
    );
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "select_singer_microphone"),
    ).toHaveLength(1);
    await waitFor(() =>
      expect(within(singerOne).getByLabelText("Microphone")).toHaveValue("windows-mic-third"),
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
      expect(tauriMocks.invoke).toHaveBeenCalledWith("select_singer_microphone", {
        request: {
          requestId: expect.any(String),
          sessionSingerId: "singer-1",
          desiredSourceId: null,
        },
      }),
    );
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "unassign_microphone_channel",
      expect.anything(),
    );
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "remove_microphone_channel",
      expect.anything(),
    );
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "select_singer_microphone"),
    ).toHaveLength(1);
    await waitFor(() => expect(within(singerOne).getByLabelText("Microphone")).toHaveValue(""));
  });

  it("preserves the authoritative selection after failure and retries safely", async () => {
    mockMicrophoneWorkspace({
      sources: [discoveredMicrophones[0], secondAvailableMicrophone],
      channels: [microphoneChannel],
      assignments: [microphoneAssignment],
      microphoneSelectionFailures: 1,
    });
    const user = userEvent.setup();
    render(<App />);

    await openMicrophoneWorkspace(user);
    const singerOne = within(await screen.findByLabelText("Singer microphones")).getAllByRole(
      "article",
    )[0];
    const selector = within(singerOne).getByLabelText("Microphone");
    await user.selectOptions(selector, secondAvailableMicrophone.id);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The selected microphone is not available.",
    );
    expect(selector).toHaveValue(microphoneChannel.sourceId);
    const firstRequest = tauriMocks.invoke.mock.calls.find(
      ([command]) => command === "select_singer_microphone",
    )?.[1]?.request as { requestId: string };

    await user.selectOptions(selector, secondAvailableMicrophone.id);
    await waitFor(() => expect(selector).toHaveValue(secondAvailableMicrophone.id));
    const selectionCalls = tauriMocks.invoke.mock.calls.filter(
      ([command]) => command === "select_singer_microphone",
    );
    expect(selectionCalls).toHaveLength(2);
    expect((selectionCalls[1][1]?.request as { requestId: string }).requestId).toBe(
      firstRequest.requestId,
    );
  });

  it("does not duplicate microphone selection mutations under StrictMode", async () => {
    mockMicrophoneWorkspace({ sources: [discoveredMicrophones[0]] });
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await openMicrophoneWorkspace(user);
    const singerOne = within(await screen.findByLabelText("Singer microphones")).getAllByRole(
      "article",
    )[0];
    await user.selectOptions(within(singerOne).getByLabelText("Microphone"), "windows-mic-primary");

    await waitFor(() =>
      expect(
        tauriMocks.invoke.mock.calls.filter(([command]) => command === "select_singer_microphone"),
      ).toHaveLength(1),
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
      expect(within(singerBar).getByText("Dad, microphone ready")).toHaveClass("visually-hidden"),
    );
    expect(within(singerBar).getByText("Mum, microphone waiting")).toHaveClass("visually-hidden");
    expect(within(singerBar).getByText("Jack, microphone unavailable")).toHaveClass(
      "visually-hidden",
    );
    expect(within(singerBar).getByText("Ellie, microphone unassigned")).toHaveClass(
      "visually-hidden",
    );
    expect(singerBar.querySelector('[data-status="ready"]')).toHaveAttribute(
      "title",
      "Dad, microphone ready",
    );
    expect(singerBar.querySelector('[data-status="waiting"]')).toHaveAttribute(
      "title",
      "Mum, microphone waiting",
    );
    expect(singerBar.querySelector('[data-status="unavailable"]')).toHaveAttribute(
      "title",
      "Jack, microphone unavailable",
    );
    expect(singerBar.querySelector('[data-status="unassigned"]')).toHaveAttribute(
      "title",
      "Ellie, microphone unassigned",
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

    expect(within(singerOne).getByRole("meter", { name: "Dad input level" })).toHaveAttribute(
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

  it("stops explicit diagnostic capture when leaving its owning workspaces", async () => {
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
    await user.click(within(singerOne).getByRole("button", { name: "Test microphone" }));
    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("start_diagnostic_capture", {
        sourceId: microphoneChannel.sourceId,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Library" }));
    await waitFor(() =>
      expect(
        tauriMocks.invoke.mock.calls.filter(([command]) => command === "stop_diagnostic_capture"),
      ).toHaveLength(1),
    );

    await openMicrophoneWorkspace(user);
    const returnedSinger = within(await screen.findByLabelText("Singer microphones")).getAllByRole(
      "article",
    )[0];
    expect(within(returnedSinger).getByRole("meter", { name: "Dad input level" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "start_diagnostic_capture"),
    ).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Library" }));
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "stop_diagnostic_capture"),
    ).toHaveLength(1);
  });

  it("preserves capture across Microphones and Developer before stopping on exit", async () => {
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
    await user.click(within(singerOne).getByRole("button", { name: "Test microphone" }));
    await openDeveloperDiagnostics(user);

    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "stop_diagnostic_capture"),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Performance" }));
    await waitFor(() =>
      expect(
        tauriMocks.invoke.mock.calls.filter(([command]) => command === "stop_diagnostic_capture"),
      ).toHaveLength(1),
    );
  });

  it("does not duplicate workspace capture cleanup under StrictMode", async () => {
    mockMicrophoneWorkspace({
      channels: [microphoneChannel],
      assignments: [microphoneAssignment],
    });
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await openMicrophoneWorkspace(user);
    const singerOne = within(await screen.findByLabelText("Singer microphones")).getAllByRole(
      "article",
    )[0];
    await user.click(within(singerOne).getByRole("button", { name: "Test microphone" }));
    await user.click(screen.getByRole("button", { name: "Library" }));

    await waitFor(() =>
      expect(
        tauriMocks.invoke.mock.calls.filter(([command]) => command === "stop_diagnostic_capture"),
      ).toHaveLength(1),
    );
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
    expect(screen.getByText(/Capture handoff: 0\/4 frames/)).toBeInTheDocument();
  });

  it("shows accepted participant revocation in Developer diagnostics", async () => {
    mockMicrophoneWorkspace({
      pairingProjection: {
        status: {
          ...idleDevelopmentPairingProjection.status,
          lifecycleState: "accepted",
          lastRevokedParticipant: {
            sessionSingerId: "singer-1",
            acceptedDisplayName: "Kyle",
            reasonCode: "session-singer-removed",
            message: "The Host removed this participant from the karaoke session.",
          },
        },
        diagnostics: {
          ...idleDevelopmentPairingProjection.diagnostics,
          acceptedParticipants: 1,
          revokedParticipants: 1,
        },
      },
    });
    const user = userEvent.setup();
    render(<App />);

    await openDeveloperDiagnostics(user);

    expect(screen.getByText(/Accepted: 1 \/ Revoked: 1/)).toBeInTheDocument();
    expect(
      screen.getByText(/Last revocation: Kyle \(session-singer-removed\)/),
    ).toBeInTheDocument();
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

    expect(await screen.findByText("No library location selected")).toBeInTheDocument();
    expect(
      screen.getByText("Choose a library location to browse karaoke songs."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 songs · 0 artists")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Library location" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rescan" })).toBeDisabled();
  });

  it("cancelling folder selection preserves the current state", async () => {
    const user = userEvent.setup();
    tauriMocks.open.mockResolvedValue(null);
    render(<App />);

    await openLibraryWorkspace(user);
    await screen.findByText("No library location selected");
    await user.click(screen.getByRole("button", { name: "Library location" }));

    expect(tauriMocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false }),
    );
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "select_library_location",
      expect.objectContaining({ rootPath: expect.any(String) }),
    );
    expect(screen.getByText("No library location selected")).toBeInTheDocument();
  });

  it("successful folder selection persists the root and scans", async () => {
    const user = userEvent.setup();
    tauriMocks.open.mockResolvedValue("C:\\Music");
    mockInvokeWith({ scanResult: populatedScanResult });
    render(<App />);

    await openLibraryWorkspace(user);
    await screen.findByText("No library location selected");
    await user.click(screen.getByRole("button", { name: "Library location" }));

    await screen.findByRole("button", { name: /The Beatles/ });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("select_library_location", {
      rootPath: "C:\\Music",
    });
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith("save_library_root", expect.anything());
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith("scan_media_library", expect.anything());
  });

  it("restored folder triggers one scan", async () => {
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("refresh_media_library", {
        rootPath: "C:\\Music",
      }),
    );

    const scanCalls = tauriMocks.invoke.mock.calls.filter(
      ([command]) => command === "refresh_media_library",
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

      if (command === "refresh_media_library") {
        return pendingScan.promise;
      }

      if (command === "save_library_index") {
        return Promise.resolve();
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    render(<App />);
    await openLibraryWorkspace();

    const cachedArtist = await screen.findByRole("button", { name: /Cached Artist/ });
    expect(cachedArtist).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Refreshing library...")).toBeInTheDocument();

    pendingScan.resolve(populatedScanResult);

    expect(await screen.findByRole("button", { name: /The Beatles/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cached Artist/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Library updated")).not.toBeInTheDocument();
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

      if (command === "refresh_media_library") {
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
    expect(screen.getByRole("button", { name: /Cached Artist/ })).toBeInTheDocument();
    expect(screen.getByText("Refreshing library...")).toBeInTheDocument();

    pendingScan.resolve(populatedScanResult);
    expect(await screen.findByText("No songs match this search.")).toBeInTheDocument();
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

      if (command === "refresh_media_library") {
        return pendingScan.promise;
      }

      if (command === "save_library_index") {
        return Promise.resolve();
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    render(<App />);
    await openLibraryWorkspace();
    await screen.findByRole("button", { name: /Cached Artist/ });

    pendingScan.reject("The selected library folder is not available.");

    expect(
      await screen.findByText("The selected library folder is not available."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cached Artist/ })).toBeInTheDocument();
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

      if (command === "refresh_media_library") {
        return pendingScan.promise;
      }

      if (command === "save_library_index") {
        return Promise.resolve();
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    render(<App />);
    await openLibraryWorkspace();

    expect(await screen.findByText("Refreshing library...")).toBeInTheDocument();
    expect(screen.queryByText("Cached Song")).not.toBeInTheDocument();

    pendingScan.resolve(populatedScanResult);
    expect(await screen.findByRole("button", { name: /The Beatles/ })).toBeInTheDocument();
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

      if (command === "refresh_media_library") {
        return pendingScan.promise;
      }

      if (command === "save_library_index") {
        return Promise.resolve();
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    renderStrictApp();
    await openLibraryWorkspace();
    await screen.findByRole("button", { name: /Cached Artist/ });

    const scanCalls = tauriMocks.invoke.mock.calls.filter(
      ([command]) => command === "refresh_media_library",
    );
    expect(scanCalls).toHaveLength(1);

    pendingScan.resolve(populatedScanResult);
    expect(await screen.findByRole("button", { name: /The Beatles/ })).toBeInTheDocument();
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

      if (command === "refresh_media_library") {
        return pendingScan;
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    render(<App />);
    await openLibraryWorkspace();

    expect(await screen.findByText("Refreshing library...")).toBeInTheDocument();
    resolveScan(populatedScanResult);
    expect(await screen.findByRole("button", { name: /The Beatles/ })).toBeInTheDocument();
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

      if (command === "refresh_media_library") {
        return pendingScan.promise;
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    renderStrictApp();
    await openLibraryWorkspace();

    expect(await screen.findByText("Refreshing library...")).toBeInTheDocument();

    pendingScan.resolve(populatedScanResult);

    expect(await screen.findByRole("button", { name: /The Beatles/ })).toBeInTheDocument();
    expect(screen.getByText("2 songs · 2 artists")).toBeInTheDocument();
    expect(
      screen.queryByText("Scan complete · 3 folders · 5 files · 2 songs · 1 issues"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Refreshing library...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rescan" })).toBeEnabled();
  });

  it("renders songs and diagnostics from a successful scan", async () => {
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace();

    const beatles = await screen.findByRole("button", { name: /The Beatles/ });
    expect(screen.getByText("2 songs · 2 artists")).toBeInTheDocument();
    expect(beatles).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(beatles);
    expect(screen.getByText("Hey Jude")).toBeInTheDocument();
    expect(beatles).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(beatles);
    expect(beatles).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Hey Jude")).not.toBeInTheDocument();
    expect(screen.queryByText("Diagnostics (1)")).not.toBeInTheDocument();

    await openDeveloperWorkspace();
    await userEvent.click(screen.getByText("Diagnostics (1)"));
    expect(screen.getByText("Missing lyrics")).toBeInTheDocument();
    expect(screen.getByText("Loose\\Missing Lyrics.opus")).toBeInTheDocument();
  });

  it("loads a Library song into the persistent player and updates metadata", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByRole("button", { name: /The Beatles/ });

    await playSongFromLibrary(user, "Hey Jude");

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("request_song_playback", {
        request: {
          requestId: expect.any(String),
          songId: "song-a",
        },
      }),
    );
    const startCall = tauriMocks.invoke.mock.calls.find(
      ([command]) => command === "request_song_playback",
    );
    expect(startCall?.[1]).not.toHaveProperty("request.audioPath");
    expect(screen.getByRole("region", { name: "Current song information" })).toHaveTextContent(
      "The Beatles - Hey Jude",
    );
    expect(screen.getByRole("contentinfo", { name: "Media transport" })).toHaveTextContent(
      "Hey Jude",
    );
    expect(getAudioElement().src).toContain("The%20Beatles%20-%20Hey%20Jude.opus");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(tauriMocks.invoke).toHaveBeenCalledWith("report_playback_started", {
      request: { attemptId: "playback-attempt-1" },
    });
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "report_playback_started"),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Queue" })).toHaveTextContent(
      "No songs queued.",
    );
  });

  it("keeps one audio element mounted while switching workspaces", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    const { container } = render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByRole("button", { name: /The Beatles/ });
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
    await screen.findByRole("button", { name: /The Beatles/ });
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
    await screen.findByRole("button", { name: /The Beatles/ });
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

    expect(await screen.findByText("Paused")).toBeInTheDocument();
    const playButton = within(transport).getByRole("button", { name: "Play" });

    await user.click(playButton);
    fireEvent.playing(audio);
    expect(await within(transport).findByRole("button", { name: "Pause" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), { target: { value: "45" } });
    expect(audio.currentTime).toBe(45);

    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "35" } });
    expect(audio.volume).toBe(0.35);

    setAudioNumberProperty(audio, "currentTime", 125);
    audio.dataset.attemptId = "stale-playback-attempt";
    fireEvent.ended(audio);
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "report_playback_completed"),
    ).toHaveLength(0);
    audio.dataset.attemptId = "playback-attempt-1";
    fireEvent.ended(audio);
    expect(await screen.findByText("Ended")).toBeInTheDocument();
    expect(within(transport).getByText("No song loaded")).toBeInTheDocument();
    expect(within(transport).queryByText("Hey Jude")).not.toBeInTheDocument();
    fireEvent.ended(audio);
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "report_playback_completed"),
    ).toHaveLength(1);
    expect(within(transport).getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Queue" })).toHaveTextContent(
      "No songs queued.",
    );
  });

  it("handles rejected play promises and allows retry from the transport", async () => {
    const user = userEvent.setup();
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("blocked"));
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByRole("button", { name: /The Beatles/ });

    await playSongFromLibrary(user, "Hey Jude", false);

    expect(
      await screen.findByText("Playback could not start. Press Play to try again."),
    ).toBeInTheDocument();
    expect(tauriMocks.invoke).toHaveBeenCalledWith("report_playback_failed", {
      request: {
        attemptId: "playback-attempt-1",
        kind: "start-rejected",
        message: "Playback could not start. Press Play to try again.",
      },
    });

    vi.mocked(HTMLMediaElement.prototype.play).mockResolvedValueOnce(undefined);
    const transport = screen.getByRole("contentinfo", { name: "Media transport" });
    await user.click(within(transport).getByRole("button", { name: "Play" }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate Host playback requests or adapter reports under StrictMode", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    renderStrictApp();
    await openLibraryWorkspace(user);
    await screen.findByRole("button", { name: /The Beatles/ });

    await playSongFromLibrary(user, "Hey Jude");

    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "request_song_playback"),
    ).toHaveLength(1);
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "report_playback_started"),
    ).toHaveLength(1);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it("applies the Host stop projection to the persistent audio adapter", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByRole("button", { name: /The Beatles/ });
    await playSongFromLibrary(user, "Hey Jude");

    await user.click(screen.getByRole("button", { name: "Developer" }));
    await user.click(screen.getByRole("button", { name: "Stop playback" }));

    await waitFor(() => expect(playbackProjectionState.state).toBe("stopped"));
    await waitFor(() => expect(getAudioElement()).not.toHaveAttribute("src"));
    expect(tauriMocks.invoke).toHaveBeenCalledWith("request_playback_stop", {
      request: { requestId: expect.any(String) },
    });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("shows recoverable media errors and can replace the song afterward", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByRole("button", { name: /The Beatles/ });

    await playSongFromLibrary(user, "Hey Jude");
    const audio = getAudioElement();
    fireEvent.error(audio);
    expect(screen.getByText("Playback failed.")).toBeInTheDocument();

    await playSongFromLibrary(user, "Jóga");
    expect(screen.getByRole("region", { name: "Current song information" })).toHaveTextContent(
      "Björk - Jóga",
    );
  });

  it("parses lyrics for a loaded song and updates the Performance view from the audio clock", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByRole("button", { name: /The Beatles/ });

    await playSongFromLibrary(user, "Hey Jude");
    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("parse_song_lyrics", {
        songId: populatedScanResult.songs[0].id,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Performance" }));
    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 1.2);
    fireEvent.timeUpdate(audio);

    expect(await screen.findByText("Yesterday all my troubles")).toBeInTheDocument();
    expect(screen.getByText("Seemed so far away")).toBeInTheDocument();
  });

  it("promotes overlapping lyrics immediately within a three-row presentation window", async () => {
    const user = userEvent.setup();
    const longFirstLine =
      "First overlap line with punctuation, mixed CASE, and enough words to wrap naturally in a narrower performance window.";
    const overlappingLyrics: LyricDocument = {
      ...populatedLyricDocument,
      lines: [
        {
          ...populatedLyricDocument.lines[0],
          id: "overlap-first",
          beginMs: 1_000,
          endMs: 4_000,
          text: longFirstLine,
          segments: [],
        },
        {
          ...populatedLyricDocument.lines[1],
          id: "overlap-second",
          beginMs: 2_500,
          endMs: 5_000,
          text: "Second overlap line",
          segments: [],
        },
        {
          ...populatedLyricDocument.lines[1],
          id: "overlap-third",
          beginMs: 5_500,
          endMs: 6_500,
          text: "Third overlap line",
          segments: [],
        },
      ],
    };
    mockInvokeWith({
      loadRoot: "C:\\Music",
      scanResult: populatedScanResult,
      lyricResult: overlappingLyrics,
    });
    const { container } = render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByRole("button", { name: /The Beatles/ });
    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Performance" }));

    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 2.4);
    fireEvent.timeUpdate(audio);
    const longCurrentLine = await screen.findByText(longFirstLine);
    expect(longCurrentLine).toHaveClass("lyric-line-current");
    expect(longCurrentLine).toHaveTextContent(longFirstLine);
    const secondBeforePromotion = screen.getByText("Second overlap line");
    expect(secondBeforePromotion).toHaveAttribute("data-presentation-role", "upcoming");
    expect(secondBeforePromotion).toHaveClass("lyric-line-row", "lyric-line-upcoming");

    await user.click(screen.getByRole("button", { name: "Show lyrics 100 milliseconds earlier" }));

    const rows = await waitFor(() => {
      const nextRows = Array.from(container.querySelectorAll(".lyric-line-row"));
      expect(nextRows).toHaveLength(3);
      return nextRows;
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.getAttribute("data-presentation-role"))).toEqual([
      "previous",
      "current",
      "upcoming",
    ]);
    expect(rows.map((row) => row.getAttribute("data-presentation-lifecycle"))).toEqual([
      "leaving",
      "active",
      "pending",
    ]);
    expect(screen.getByText("Second overlap line")).toBe(secondBeforePromotion);
    expect(secondBeforePromotion).toHaveClass("lyric-line-row", "lyric-line-current");
    expect(secondBeforePromotion).not.toHaveClass("lyric-line-upcoming");
    expect(rows[0]).toHaveClass("lyric-line-previous");
    expect(rows[0]).toHaveAttribute("aria-hidden", "true");
    expect(rows[2]).toHaveAttribute("aria-hidden", "true");
    expect(rows[1]).not.toHaveAttribute("aria-hidden");
    expect(container.querySelector(".lyric-line-stack")).toHaveAttribute(
      "data-playback-time-ms",
      "2400",
    );
    expect(container.querySelector(".lyric-line-stack")).toHaveAttribute(
      "data-lyric-offset-ms",
      "-100",
    );
    expect(container.querySelector(".lyric-line-stack")).toHaveAttribute(
      "data-effective-time-ms",
      "2500",
    );
  });

  it("applies offset immediately and retains it across workspace navigation", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    const { container } = render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByRole("button", { name: /The Beatles/ });
    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Performance" }));

    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 1.2);
    fireEvent.timeUpdate(audio);
    expect(
      (await screen.findByText("Yesterday all my troubles")).closest(".lyric-line-row"),
    ).toHaveAttribute("data-presentation-lifecycle", "active");

    const later = screen.getByRole("button", {
      name: "Show lyrics 100 milliseconds later",
    });
    for (let step = 0; step < 5; step += 1) fireEvent.click(later);
    await waitFor(() =>
      expect(container.querySelector(".lyric-line-stack")).toHaveAttribute(
        "data-effective-time-ms",
        "700",
      ),
    );
    expect(
      screen.getByText("Yesterday all my troubles").closest(".lyric-line-row"),
    ).toHaveAttribute("data-presentation-lifecycle", "entering");
    expect(screen.getByRole("status", { name: "Current lyric offset" })).toHaveTextContent(
      "+500 ms",
    );

    setAudioNumberProperty(audio, "currentTime", 4.2);
    fireEvent.seeking(audio);
    await waitFor(() =>
      expect(container.querySelector(".lyric-line-stack")).toHaveAttribute(
        "data-effective-time-ms",
        "3700",
      ),
    );

    setAudioNumberProperty(audio, "currentTime", 1.2);
    fireEvent.seeking(audio);
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() =>
      expect(container.querySelector(".lyric-line-stack")).toHaveAttribute(
        "data-effective-time-ms",
        "700",
      ),
    );

    await user.click(screen.getByRole("button", { name: "Library" }));
    await user.click(screen.getByRole("button", { name: "Performance" }));
    expect(screen.getByRole("status", { name: "Current lyric offset" })).toHaveTextContent(
      "+500 ms",
    );

    await user.click(screen.getByRole("button", { name: "Reset lyric offset" }));
    await waitFor(() =>
      expect(container.querySelector(".lyric-line-stack")).toHaveAttribute(
        "data-effective-time-ms",
        "1200",
      ),
    );
    expect(
      screen.getByText("Yesterday all my troubles").closest(".lyric-line-row"),
    ).toHaveAttribute("data-presentation-lifecycle", "active");
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
    await screen.findByRole("button", { name: /The Beatles/ });
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
    expect(fragments[2]).toHaveClass("lyric-fragment-active");
    expect((fragments[2] as HTMLElement).style.textDecoration).toBe("");
    expect((fragments[2] as HTMLElement).style.borderBottom).toBe("");
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
    expect(screen.getByText("Time to celebrate")).toHaveAttribute(
      "data-presentation-role",
      "previous",
    );
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
    await screen.findByRole("button", { name: /The Beatles/ });
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
    await screen.findByRole("button", { name: /The Beatles/ });
    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Performance" }));
    await waitFor(() =>
      expect(container.querySelector(".lyric-line-current")?.textContent).toBe("lalala"),
    );

    const audio = getAudioElement();

    await waitFor(() => expect(animationFrameCallbacks.size).toBe(1));
    const scheduledFrameId = Array.from(animationFrameCallbacks.keys())[0];

    setAudioNumberProperty(audio, "currentTime", 1.02);
    fireEvent.timeUpdate(audio);
    expect(Array.from(animationFrameCallbacks.keys())).toEqual([scheduledFrameId]);
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

    await user.click(screen.getByRole("button", { name: "Pause" }));
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

    await user.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(playbackProjectionState.state).toBe("starting"));
    fireEvent.playing(audio);
    await waitFor(() => expect(playbackProjectionState.state).toBe("playing"));
    runAnimationFrame();
    await waitFor(() =>
      expect(container.querySelector('[data-fragment-id="rapid-c"]')).toHaveAttribute(
        "data-fragment-state",
        "active",
      ),
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
    await screen.findByRole("button", { name: /The Beatles/ });
    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Performance" }));
    await screen.findByText("Yesterday all my troubles");

    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 3);
    fireEvent.timeUpdate(audio);
    expect(screen.queryByLabelText("Instrumental section")).not.toBeInTheDocument();
    expect(screen.getByText("Seemed so far away")).toBeInTheDocument();
    expect(screen.getByText("Yesterday all my troubles")).toHaveAttribute(
      "data-presentation-role",
      "previous",
    );
    expect(screen.getByText("Yesterday all my troubles")).toHaveAttribute("aria-hidden", "true");
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
    expect(screen.getByText("Yesterday all my troubles")).toHaveAttribute(
      "data-presentation-role",
      "previous",
    );

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
    await screen.findByRole("button", { name: /The Beatles/ });
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
    await screen.findByRole("button", { name: /The Beatles/ });
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
    await screen.findByRole("button", { name: /The Beatles/ });
    await playSongFromLibrary(user, "Hey Jude");
    await user.click(screen.getByRole("button", { name: "Performance" }));

    const audio = getAudioElement();
    setAudioNumberProperty(audio, "currentTime", 1.2);
    fireEvent.timeUpdate(audio);
    expect(await screen.findByText("Yesterday all my troubles")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByText("Yesterday all my troubles")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.playing(audio);
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    setAudioNumberProperty(audio, "currentTime", 4.2);
    fireEvent.timeUpdate(audio);
    expect(screen.getByText("Seemed so far away")).toBeInTheDocument();
  });

  it("shows lyric parser failure without blocking playback", async () => {
    const user = userEvent.setup();
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    tauriMocks.invoke.mockImplementation((command: string, args?: PlaybackMockArgs) => {
      if (command === "parse_song_lyrics") {
        return Promise.reject("The lyric file is not a supported TTML document.");
      }
      return mockSuccessfulLibraryInvoke(command, args);
    });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByRole("button", { name: /The Beatles/ });

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
    tauriMocks.invoke.mockImplementation((command: string, args?: PlaybackMockArgs) => {
      if (command === "parse_song_lyrics") {
        const songId = args?.songId ?? populatedScanResult.songs[0].id;
        return Promise.resolve({
          ...populatedLyricDocument,
          sourceSongId: songId,
          lines: [
            {
              ...populatedLyricDocument.lines[0],
              id: `line-${songId}`,
              text: songId === "song-b" ? "Jóga lyric line" : "Yesterday all my troubles",
              segments: [],
            },
          ],
        });
      }
      return mockSuccessfulLibraryInvoke(command, args);
    });
    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByRole("button", { name: /The Beatles/ });
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

    expect(
      await screen.findByText("No supported karaoke songs were found in this folder."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 songs · 0 artists")).toBeInTheDocument();
  });

  it("shows a no-supported-media scan state", async () => {
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: noSupportedFilesScanResult });
    render(<App />);
    await openLibraryWorkspace();

    expect(
      await screen.findByText("No supported karaoke songs were found in this folder."),
    ).toBeInTheDocument();
  });

  it("shows an unpaired-candidates scan state with diagnostics", async () => {
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: unpairedCandidatesScanResult });
    render(<App />);
    await openLibraryWorkspace();

    expect(
      await screen.findByText("No supported karaoke songs were found in this folder."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Missing lyrics")).not.toBeInTheDocument();
    await openDeveloperWorkspace();
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
    await user.click(screen.getByRole("button", { name: /The Beatles/ }));
    expect(screen.getByText("Hey Jude")).toBeInTheDocument();
    expect(screen.queryByText("Jóga")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "jóga");
    await user.click(screen.getByRole("button", { name: /Björk/ }));
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

    expect(screen.getByText("No songs match this search.")).toBeInTheDocument();
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

      if (command === "refresh_media_library") {
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

    const beatles = await screen.findByRole("button", { name: /The Beatles/ });
    await user.click(beatles);
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

      if (command === "refresh_media_library") {
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
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "refresh_media_library"),
    ).toHaveLength(1);

    resolveScan(populatedScanResult);
    await screen.findByRole("button", { name: /The Beatles/ });
  });

  it("disables location changes while an authoritative refresh is active", async () => {
    const user = userEvent.setup();
    const pendingRefresh = createDeferred<LibraryScanResult>();
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "load_library_settings") {
        return Promise.resolve({ libraryRoot: "C:\\Music" });
      }
      if (command === "load_library_index") {
        return Promise.resolve({ status: "miss", scanResult: null, message: null });
      }
      if (command === "refresh_media_library") {
        return pendingRefresh.promise;
      }
      return mockSuccessfulLibraryInvoke(command);
    });

    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByText("Refreshing library...");
    expect(screen.getByRole("button", { name: "Library location" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rescan" })).toBeDisabled();

    pendingRefresh.resolve(populatedScanResult);
    expect(await screen.findByRole("button", { name: /The Beatles/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Library location" })).toBeEnabled();
  });

  it("does not duplicate folder selection under StrictMode", async () => {
    const user = userEvent.setup();
    tauriMocks.open.mockResolvedValue("C:\\Music");
    mockInvokeWith({ scanResult: populatedScanResult });

    renderStrictApp();
    await openLibraryWorkspace(user);
    await user.click(screen.getByRole("button", { name: "Library location" }));
    await screen.findByRole("button", { name: /The Beatles/ });

    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "select_library_location"),
    ).toHaveLength(1);
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

      if (command === "refresh_media_library") {
        return pendingScan.promise;
      }

      return Promise.resolve({ libraryRoot: "C:\\Music" });
    });

    renderStrictApp();
    await openLibraryWorkspace();
    await screen.findByText("Refreshing library...");

    pendingScan.reject("The selected library folder is not available.");

    expect(
      await screen.findByText("The selected library folder is not available."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Refreshing library...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rescan" })).toBeEnabled();
  });

  it("rescans through one Host refresh command and exposes no manual index action", async () => {
    const user = userEvent.setup();
    let refreshCount = 0;
    const pendingRescan = createDeferred<LibraryScanResult>();
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

      if (command === "refresh_media_library") {
        refreshCount += 1;
        return refreshCount === 1 ? Promise.resolve(populatedScanResult) : pendingRescan.promise;
      }

      return mockSuccessfulLibraryInvoke(command);
    });

    render(<App />);
    await openLibraryWorkspace(user);
    await screen.findByRole("button", { name: /The Beatles/ });

    expect(screen.queryByRole("button", { name: /index/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rescan" }));
    expect(screen.getByRole("button", { name: "Rescan" })).toBeDisabled();

    expect(tauriMocks.invoke).toHaveBeenLastCalledWith("refresh_media_library", {
      rootPath: "C:\\Music",
    });
    pendingRescan.resolve(rebuiltResult);
    expect(await screen.findByRole("button", { name: /New Artist/ })).toBeInTheDocument();
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "refresh_media_library"),
    ).toHaveLength(2);
  });

  it("does not show direct playback actions in Library", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await openLibraryWorkspace(user);

    const library = container.querySelector(".library-workspace");
    expect(library).not.toBeNull();
    expect(
      within(library as HTMLElement).queryByRole("button", { name: /play/i }),
    ).not.toBeInTheDocument();
    expect(
      within(library as HTMLElement).queryByRole("button", { name: /index/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Singer shell", () => {
  it("shows only the singer label and Sync action when the Host projection is empty", async () => {
    const { container } = render(<App />);
    const singerBar = screen.getByRole("region", { name: "Singer bar" });

    await waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledWith("list_session_singers"));
    expect(within(singerBar).getByText("Singers")).toBeInTheDocument();
    expect(within(singerBar).getByRole("button", { name: "+ Sync" })).toBeInTheDocument();
    expect(within(singerBar).queryByLabelText("Singer list")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".singer-item")).toHaveLength(0);
    expect(screen.queryByText(/^Singer [1-4]$/)).not.toBeInTheDocument();
  });

  it("renders Host projections and requests singer mutations without frontend-owned IDs", async () => {
    sessionSingerState = initialSessionSingers.map((singer) => ({ ...singer }));
    nextSessionSingerNumber = 5;
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("region", { name: "Singer bar" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Dad")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ellie")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Sync/ })).toBeInTheDocument();

    const singerTwoInput = screen.getByDisplayValue("Mum");
    await user.clear(singerTwoInput);
    await user.type(singerTwoInput, "Lead singer");
    fireEvent.blur(singerTwoInput);
    expect(screen.getByDisplayValue("Lead singer")).toBeInTheDocument();
    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("rename_session_singer", {
        request: { singerId: "singer-2", displayName: "Lead singer" },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Remove Dad" }));
    await waitFor(() => expect(screen.queryByDisplayValue("Dad")).not.toBeInTheDocument());
    expect(tauriMocks.invoke).toHaveBeenCalledWith("remove_session_singer", {
      singerId: "singer-1",
    });
    expect(screen.getByDisplayValue("Lead singer")).toBeInTheDocument();
  });

  it("loads Host singers once under StrictMode and does not recreate them", async () => {
    sessionSingerState = initialSessionSingers.map((singer) => ({ ...singer }));
    nextSessionSingerNumber = 5;
    renderStrictApp();
    expect(await screen.findByDisplayValue("Dad")).toBeInTheDocument();
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "list_session_singers"),
    ).toHaveLength(1);
    expect(
      tauriMocks.invoke.mock.calls.filter(([command]) => command === "create_session_singer"),
    ).toHaveLength(0);
  });

  it("creates a Host-owned Performance by singer and stable song ID", async () => {
    const user = userEvent.setup();
    sessionSingerState = initialSessionSingers.map((singer) => ({ ...singer }));
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openDeveloperWorkspace(user);

    await user.selectOptions(await screen.findByLabelText("Performer"), "singer-1");
    await user.selectOptions(screen.getByLabelText("Song"), "song-a");
    await user.click(screen.getByRole("button", { name: "Create Performance" }));

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("create_performance", {
        request: {
          requestId: expect.any(String),
          singerId: "singer-1",
          songId: "song-a",
        },
      }),
    );
    const request = tauriMocks.invoke.mock.calls.find(
      ([command]) => command === "create_performance",
    )?.[1]?.request;
    expect(request).not.toHaveProperty("audioPath");
    expect(request).not.toHaveProperty("lyricPath");

    await user.click(screen.getByRole("button", { name: "Performance" }));
    expect(await screen.findByText("Dad")).toBeInTheDocument();
    expect(screen.getByText("Hey Jude")).toBeInTheDocument();
    expect(screen.getByText("Starting in 3")).toBeInTheDocument();
  });

  it("does not duplicate a Performance mutation under StrictMode", async () => {
    const user = userEvent.setup();
    sessionSingerState = initialSessionSingers.map((singer) => ({ ...singer }));
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    renderStrictApp();
    await openDeveloperWorkspace(user);

    await user.selectOptions(await screen.findByLabelText("Performer"), "singer-1");
    await user.selectOptions(screen.getByLabelText("Song"), "song-a");
    await user.click(screen.getByRole("button", { name: "Create Performance" }));

    await waitFor(() =>
      expect(
        tauriMocks.invoke.mock.calls.filter(([command]) => command === "create_performance"),
      ).toHaveLength(1),
    );
  });

  it("requests preparation cancellation through the Host projection boundary", async () => {
    const user = userEvent.setup();
    sessionSingerState = initialSessionSingers.map((singer) => ({ ...singer }));
    mockInvokeWith({ loadRoot: "C:\\Music", scanResult: populatedScanResult });
    render(<App />);
    await openDeveloperWorkspace(user);
    await user.selectOptions(await screen.findByLabelText("Performer"), "singer-1");
    await user.selectOptions(screen.getByLabelText("Song"), "song-a");
    await user.click(screen.getByRole("button", { name: "Create Performance" }));
    await user.click(await screen.findByRole("button", { name: "Cancel preparation" }));

    expect(tauriMocks.invoke).toHaveBeenCalledWith("cancel_preparation", {
      request: {
        requestId: expect.any(String),
        performanceId: "performance-1",
      },
    });
    expect(await screen.findByText(/Lifecycle: stopped/)).toBeInTheDocument();
  });
});
