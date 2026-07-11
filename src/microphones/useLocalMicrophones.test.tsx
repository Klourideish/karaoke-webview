import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalMicrophoneSource } from "./types";
import {
  LOCAL_MICROPHONE_REFRESH_INTERVAL_MS,
  sameSourceRegistry,
  useLocalMicrophones,
} from "./useLocalMicrophones";

const apiMocks = vi.hoisted(() => ({
  discoverLocalMicrophoneSources: vi.fn(),
}));

vi.mock("./api", () => ({
  discoverLocalMicrophoneSources: apiMocks.discoverLocalMicrophoneSources,
}));

const sourceA: LocalMicrophoneSource = {
  id: "windows-mic-a",
  displayName: "Desk microphone",
  kind: "windows-device",
  availability: "available",
  isDefault: true,
};

const sourceB: LocalMicrophoneSource = {
  id: "windows-mic-b",
  displayName: "USB microphone",
  kind: "windows-device",
  availability: "available",
  isDefault: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  apiMocks.discoverLocalMicrophoneSources.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function settleDiscovery() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advanceDiscoveryInterval() {
  await act(async () => {
    vi.advanceTimersByTime(LOCAL_MICROPHONE_REFRESH_INTERVAL_MS);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("live local microphone registry", () => {
  it("reconciles added, removed, and default devices while preserving stable IDs", async () => {
    const snapshots: LocalMicrophoneSource[][] = [
      [sourceA],
      [
        { ...sourceA, isDefault: false },
        { ...sourceB, isDefault: true },
      ],
      [{ ...sourceB, isDefault: true }],
    ];
    let snapshotIndex = 0;
    apiMocks.discoverLocalMicrophoneSources.mockImplementation(() =>
      Promise.resolve(snapshots[Math.min(snapshotIndex++, snapshots.length - 1)]),
    );

    const { result } = renderHook(() => useLocalMicrophones());
    await settleDiscovery();

    expect(result.current.sources).toEqual([sourceA]);
    const originalSourceAId = result.current.sources[0].id;

    await advanceDiscoveryInterval();

    expect(result.current.sources.map((source) => source.id)).toEqual([
      "windows-mic-a",
      "windows-mic-b",
    ]);
    expect(result.current.sources[0].id).toBe(originalSourceAId);
    expect(result.current.sources[0].isDefault).toBe(false);
    expect(result.current.sources[1].isDefault).toBe(true);

    await advanceDiscoveryInterval();

    expect(result.current.sources).toEqual([{ ...sourceB, isDefault: true }]);
    expect(apiMocks.discoverLocalMicrophoneSources).toHaveBeenCalledTimes(3);
  });

  it("recognizes unchanged authoritative snapshots", () => {
    expect(sameSourceRegistry([sourceA, sourceB], [sourceA, sourceB])).toBe(true);
    expect(sameSourceRegistry([sourceA], [{ ...sourceA, isDefault: false }])).toBe(false);
  });
});
