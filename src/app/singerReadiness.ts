import type { SessionSingerId } from "../host-domain/types";
import type {
  LocalMicrophoneChannel,
  MicrophoneAssignment,
  MicrophoneRecoveryState,
  MicrophoneWaitingState,
} from "../microphones/types";
import type { Singer } from "./SingerBar";

export type SingerReadinessStatus = "ready" | "waiting" | "unavailable" | "unassigned";

export type SingerReadinessProjection = {
  singerId: SessionSingerId;
  status: SingerReadinessStatus;
  label: string;
};

export function buildSingerReadinessProjections({
  assignments,
  channels,
  recoveryStates,
  singers,
  waitingStates,
}: {
  assignments: MicrophoneAssignment[];
  channels: LocalMicrophoneChannel[];
  recoveryStates: MicrophoneRecoveryState[];
  singers: Singer[];
  waitingStates: MicrophoneWaitingState[];
}): SingerReadinessProjection[] {
  const assignmentList = Array.isArray(assignments) ? assignments : [];
  const channelList = Array.isArray(channels) ? channels : [];
  const recoveryList = Array.isArray(recoveryStates) ? recoveryStates : [];
  const waitingList = Array.isArray(waitingStates) ? waitingStates : [];

  return singers.map((singer) => {
    const assignment = assignmentList.find((candidate) => candidate.singerId === singer.id) ?? null;
    const waiting = waitingList.some((candidate) => candidate.singerId === singer.id);
    const channel = assignment
      ? (channelList.find((candidate) => candidate.id === assignment.channelId) ?? null)
      : null;
    const recovery = channel
      ? (recoveryList.find((candidate) => candidate.channelId === channel.id) ?? null)
      : null;

    const status = singerReadinessStatus({ assignment, channel, recovery, waiting });
    return {
      singerId: singer.id,
      status,
      label: singerReadinessLabel(singer.displayName, status),
    };
  });
}

function singerReadinessStatus({
  assignment,
  channel,
  recovery,
  waiting,
}: {
  assignment: MicrophoneAssignment | null;
  channel: LocalMicrophoneChannel | null;
  recovery: MicrophoneRecoveryState | null;
  waiting: boolean;
}): SingerReadinessStatus {
  if (channel?.state === "available" && recovery?.status !== "recovery-failed") {
    return "ready";
  }
  if (
    waiting ||
    recovery?.status === "replacement-available" ||
    recovery?.status === "recovering"
  ) {
    return "waiting";
  }
  if (channel?.state === "disconnected" || recovery?.status === "recovery-failed") {
    return "unavailable";
  }
  if (!assignment) {
    return "unassigned";
  }
  return "unavailable";
}

function singerReadinessLabel(singerName: string, status: SingerReadinessStatus) {
  switch (status) {
    case "ready":
      return `${singerName}, microphone ready`;
    case "waiting":
      return `${singerName}, microphone waiting`;
    case "unavailable":
      return `${singerName}, microphone unavailable`;
    case "unassigned":
      return `${singerName}, microphone unassigned`;
  }
}
