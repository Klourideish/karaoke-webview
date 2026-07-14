import type {
  LocalMicrophoneChannel,
  LocalMicrophoneSource,
  MicrophoneAssignment,
} from "../microphones/types";

export type SyncStep =
  "choose-method" | "choose-microphone" | "enter-name" | "confirm" | "submitting" | "failed";

export function eligiblePhysicalMicrophones({
  assignments,
  channels,
  sources,
}: {
  assignments: readonly MicrophoneAssignment[];
  channels: readonly LocalMicrophoneChannel[];
  sources: readonly LocalMicrophoneSource[];
}) {
  const assignmentList = Array.isArray(assignments) ? assignments : [];
  const channelList = Array.isArray(channels) ? channels : [];
  const sourceList = Array.isArray(sources) ? sources : [];
  const assignedChannelIds = new Set(assignmentList.map((assignment) => assignment.channelId));
  const claimedSourceIds = new Set(
    channelList
      .filter((channel) => assignedChannelIds.has(channel.id))
      .map((channel) => channel.sourceId),
  );

  return sourceList.filter(
    (source) =>
      source.kind === "windows-device" &&
      source.availability === "available" &&
      !claimedSourceIds.has(source.id),
  );
}

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

export function displayNameHint(value: string) {
  const normalized = normalizeDisplayName(value);
  if (!normalized) {
    return "Enter a singer name.";
  }
  if ([...normalized].some((character) => /\p{Cc}/u.test(character))) {
    return "Singer names cannot contain control characters.";
  }
  if ([...normalized].length > 40) {
    return "Singer names can contain at most 40 characters.";
  }
  return null;
}
