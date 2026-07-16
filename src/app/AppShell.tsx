import { useEffect, useRef, useState } from "react";
import type { AudioPlayer } from "../audioPlayer";
import { adjustLyricOffsetMs } from "../lyricOffset";
import { useMediaLibrary } from "../media-library/useMediaLibrary";
import { useDiagnosticCapture } from "../microphones/useDiagnosticCapture";
import { useLocalMicrophones } from "../microphones/useLocalMicrophones";
import { useMicrophoneAssignments } from "../microphones/useMicrophoneAssignments";
import { useMicrophoneChannels } from "../microphones/useMicrophoneChannels";
import { useMicrophoneRecovery } from "../microphones/useMicrophoneRecovery";
import { BottomMediaBar } from "../player/BottomMediaBar";
import type { PerformanceController } from "../performance/usePerformance";
import type { ParticipantCommitProjection } from "../session-singers/types";
import { useParticipantCommitDiagnostics } from "../session-singers/useParticipantCommitDiagnostics";
import { SyncDialog } from "../sync/SyncDialog";
import { eligiblePhysicalMicrophones } from "../sync/types";
import { useSongLyrics } from "../useSongLyrics";
import { DeveloperWorkspace } from "../workspaces/DeveloperWorkspace";
import { LibraryWorkspace } from "../workspaces/LibraryWorkspace";
import { MicrophoneWorkspace } from "../workspaces/MicrophoneWorkspace";
import { PerformWorkspace } from "../workspaces/PerformWorkspace";
import { PlaceholderWorkspace } from "../workspaces/PlaceholderWorkspace";
import { QueueWorkspace } from "../workspaces/QueueWorkspace";
import { QueuePanel } from "./QueuePanel";
import { SingerBar, type Singer } from "./SingerBar";
import { TabRail } from "./TabRail";
import { TopInfoBar } from "./TopInfoBar";
import type { AppTab, TabDefinition } from "./appTabs";
import { buildSingerReadinessProjections } from "./singerReadiness";
import { useQueue } from "../queue/useQueue";

export function AppShell({
  activeTab,
  activeView,
  audioPlayer,
  mediaLibrary,
  performance,
  onCreateSingerWithMicrophone,
  onRemoveSinger,
  onRenameSinger,
  onRefreshSingers,
  onSelectTab,
  singerError,
  singerMutationPending,
  singers,
}: {
  activeTab: AppTab;
  activeView: TabDefinition;
  audioPlayer: AudioPlayer;
  mediaLibrary: ReturnType<typeof useMediaLibrary>;
  performance: PerformanceController;
  onCreateSingerWithMicrophone: (
    requestId: string,
    displayName: string,
    sourceId: string,
  ) => Promise<ParticipantCommitProjection>;
  onRemoveSinger: (id: string) => Promise<boolean>;
  onRenameSinger: (id: string, displayName: string) => Promise<unknown>;
  onRefreshSingers: () => Promise<unknown>;
  onSelectTab: (tab: AppTab) => void;
  singerError: string | null;
  singerMutationPending: string | null;
  singers: Singer[];
}) {
  const [syncOpen, setSyncOpen] = useState(false);
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0);
  const lyrics = useSongLyrics(audioPlayer.currentSong);
  const microphones = useLocalMicrophones();
  const microphoneAssignments = useMicrophoneAssignments(singers);
  const microphoneChannels = useMicrophoneChannels(microphones.sources);
  const microphoneRecovery = useMicrophoneRecovery(
    microphones.sources,
    microphoneChannels.channels,
  );
  const diagnosticCapture = useDiagnosticCapture();
  const diagnosticWorkspaceOwnsCapture = activeTab === "mic" || activeTab === "developer";
  const previousDiagnosticOwnership = useRef(diagnosticWorkspaceOwnsCapture);
  const stopDiagnosticCapture = diagnosticCapture.stop;
  useEffect(() => {
    if (previousDiagnosticOwnership.current && !diagnosticWorkspaceOwnsCapture) {
      void stopDiagnosticCapture();
    }
    previousDiagnosticOwnership.current = diagnosticWorkspaceOwnsCapture;
  }, [diagnosticWorkspaceOwnsCapture, stopDiagnosticCapture]);
  const participantCommitDiagnostics = useParticipantCommitDiagnostics();
  const singerReadiness = buildSingerReadinessProjections({
    assignments: microphoneAssignments.assignments,
    channels: microphoneChannels.channels,
    recoveryStates: microphoneRecovery.states,
    singers,
    waitingStates: microphoneAssignments.waitingStates,
  });
  const eligibleSyncSources = eligiblePhysicalMicrophones({
    assignments: microphoneAssignments.assignments,
    channels: microphoneChannels.channels,
    sources: microphones.sources,
  });

  const queue = useQueue();

  async function commitPhysicalParticipant(
    requestId: string,
    displayName: string,
    sourceId: string,
  ) {
    try {
      const result = await onCreateSingerWithMicrophone(requestId, displayName, sourceId);
      await microphoneChannels.refresh();
      return result;
    } finally {
      await participantCommitDiagnostics.refresh();
    }
  }

  return (
    <div className="app-shell">
      <TopInfoBar
        audioPlayer={audioPlayer}
        lyricOffsetMs={lyricOffsetMs}
        onAdjustLyricOffset={(deltaMs) => {
          setLyricOffsetMs((current) => adjustLyricOffsetMs(current, deltaMs));
        }}
        onResetLyricOffset={() => setLyricOffsetMs(0)}
      />

      <div className="session-layout">
        <div className="nav-spacer" aria-hidden="true" />
        <SingerBar
          readiness={singerReadiness}
          singers={singers}
          onOpenSync={() => setSyncOpen(true)}
          onRemoveSinger={onRemoveSinger}
          onRenameSinger={onRenameSinger}
          error={singerError}
          pendingMutation={singerMutationPending}
        />

        <TabRail activeTab={activeTab} onSelectTab={onSelectTab} />
        <main className="main-content" aria-labelledby="view-heading">
          <MainContent
            audioPlayer={audioPlayer}
            lyrics={lyrics}
            mediaLibrary={mediaLibrary}
            performance={performance}
            microphones={microphones}
            microphoneAssignments={microphoneAssignments}
            microphoneChannels={microphoneChannels}
            microphoneRecovery={microphoneRecovery}
            diagnosticCapture={diagnosticCapture}
            participantCommitDiagnostics={participantCommitDiagnostics}
            lyricOffsetMs={lyricOffsetMs}
            onSelectTab={onSelectTab}
            singers={singers}
            view={activeView}
            queue={queue}
          />
        </main>
        <QueuePanel queue={queue.projection} performance={performance.projection} />
      </div>

      <BottomMediaBar audioPlayer={audioPlayer} />
      {audioPlayer.audioElement}
      {syncOpen ? (
        <SyncDialog
          eligibleSources={eligibleSyncSources}
          onClose={() => setSyncOpen(false)}
          onCommit={commitPhysicalParticipant}
          onSuccess={() => setSyncOpen(false)}
          onPhoneAccepted={async () => {
            await onRefreshSingers();
            await Promise.all([
              microphoneAssignments.refresh(),
              microphoneChannels.refresh(),
              microphoneRecovery.refresh(),
              microphones.refresh(),
            ]);
          }}
        />
      ) : null}
    </div>
  );
}

function MainContent({
  audioPlayer,
  lyrics,
  mediaLibrary,
  performance,
  microphones,
  microphoneAssignments,
  microphoneChannels,
  microphoneRecovery,
  diagnosticCapture,
  participantCommitDiagnostics,
  lyricOffsetMs,
  onSelectTab,
  singers,
  view,
  queue,
}: {
  audioPlayer: AudioPlayer;
  lyrics: ReturnType<typeof useSongLyrics>;
  mediaLibrary: ReturnType<typeof useMediaLibrary>;
  performance: PerformanceController;
  microphones: ReturnType<typeof useLocalMicrophones>;
  microphoneAssignments: ReturnType<typeof useMicrophoneAssignments>;
  microphoneChannels: ReturnType<typeof useMicrophoneChannels>;
  microphoneRecovery: ReturnType<typeof useMicrophoneRecovery>;
  diagnosticCapture: ReturnType<typeof useDiagnosticCapture>;
  participantCommitDiagnostics: ReturnType<typeof useParticipantCommitDiagnostics>;
  lyricOffsetMs: number;
  onSelectTab: (tab: AppTab) => void;
  singers: Singer[];
  view: TabDefinition;
  queue: ReturnType<typeof useQueue>;
}) {
  if (view.id === "performance") {
    return (
      <PerformWorkspace
        audioPlayer={audioPlayer}
        lyricOffsetMs={lyricOffsetMs}
        lyrics={lyrics}
        performance={performance}
        queue={queue.projection}
      />
    );
  }

  if (view.id === "library") {
    return (
      <LibraryWorkspace
        mediaLibrary={mediaLibrary}
        singers={singers}
        onAddSong={queue.addSong}
        queueError={queue.error}
      />
    );
  }

  if (view.id === "queue") {
    return <QueueWorkspace queue={queue} singers={singers} performance={performance} />;
  }

  if (view.id === "mic") {
    return (
      <MicrophoneWorkspace
        assignments={microphoneAssignments}
        capture={diagnosticCapture}
        channelRegistry={microphoneChannels}
        discovery={microphones}
        onOpenDeveloper={() => onSelectTab("developer")}
        recovery={microphoneRecovery}
        singers={singers}
      />
    );
  }

  if (view.id === "developer") {
    return (
      <DeveloperWorkspace
        audioPlayer={audioPlayer}
        capture={diagnosticCapture}
        channelRegistry={microphoneChannels}
        discovery={microphones}
        participantCommitDiagnostics={participantCommitDiagnostics}
        mediaLibrary={mediaLibrary}
        performance={performance}
        recovery={microphoneRecovery}
        singers={singers}
        assignments={microphoneAssignments}
        queue={queue}
      />
    );
  }

  return <PlaceholderWorkspace view={view} />;
}
