import type { AudioPlayer } from "../audioPlayer";
import { useMediaLibrary } from "../media-library/useMediaLibrary";
import { useDiagnosticCapture } from "../microphones/useDiagnosticCapture";
import { useLocalMicrophones } from "../microphones/useLocalMicrophones";
import { useMicrophoneAssignments } from "../microphones/useMicrophoneAssignments";
import { useMicrophoneChannels } from "../microphones/useMicrophoneChannels";
import { useMicrophoneRecovery } from "../microphones/useMicrophoneRecovery";
import { BottomMediaBar } from "../player/BottomMediaBar";
import { useSongLyrics } from "../useSongLyrics";
import { DeveloperWorkspace } from "../workspaces/DeveloperWorkspace";
import { LibraryWorkspace } from "../workspaces/LibraryWorkspace";
import { MicrophoneWorkspace } from "../workspaces/MicrophoneWorkspace";
import { PerformWorkspace } from "../workspaces/PerformWorkspace";
import { PlaceholderWorkspace } from "../workspaces/PlaceholderWorkspace";
import { QueuePanel } from "./QueuePanel";
import { SingerBar, type Singer } from "./SingerBar";
import { TabRail } from "./TabRail";
import { TopInfoBar } from "./TopInfoBar";
import type { AppTab, TabDefinition } from "./appTabs";
import { buildSingerReadinessProjections } from "./singerReadiness";

export function AppShell({
  activeTab,
  activeView,
  audioPlayer,
  mediaLibrary,
  onAddSinger,
  onRemoveSinger,
  onRenameSinger,
  onSelectTab,
  singers,
}: {
  activeTab: AppTab;
  activeView: TabDefinition;
  audioPlayer: AudioPlayer;
  mediaLibrary: ReturnType<typeof useMediaLibrary>;
  onAddSinger: () => void;
  onRemoveSinger: (id: string) => void;
  onRenameSinger: (id: string, displayName: string) => void;
  onSelectTab: (tab: AppTab) => void;
  singers: Singer[];
}) {
  const lyrics = useSongLyrics(audioPlayer.currentSong);
  const microphones = useLocalMicrophones();
  const microphoneAssignments = useMicrophoneAssignments(singers);
  const microphoneChannels = useMicrophoneChannels(microphones.sources);
  const microphoneRecovery = useMicrophoneRecovery(
    microphones.sources,
    microphoneChannels.channels,
  );
  const diagnosticCapture = useDiagnosticCapture();
  const singerReadiness = buildSingerReadinessProjections({
    assignments: microphoneAssignments.assignments,
    channels: microphoneChannels.channels,
    recoveryStates: microphoneRecovery.states,
    singers,
    waitingStates: microphoneAssignments.waitingStates,
  });

  return (
    <div className="app-shell">
      <TopInfoBar audioPlayer={audioPlayer} />

      <div className="session-layout">
        <div className="nav-spacer" aria-hidden="true" />
        <SingerBar
          readiness={singerReadiness}
          singers={singers}
          onAddSinger={onAddSinger}
          onRemoveSinger={onRemoveSinger}
          onRenameSinger={onRenameSinger}
        />

        <TabRail activeTab={activeTab} onSelectTab={onSelectTab} />
        <main className="main-content" aria-labelledby="view-heading">
          <MainContent
            audioPlayer={audioPlayer}
            lyrics={lyrics}
            mediaLibrary={mediaLibrary}
            microphones={microphones}
            microphoneAssignments={microphoneAssignments}
            microphoneChannels={microphoneChannels}
            microphoneRecovery={microphoneRecovery}
            diagnosticCapture={diagnosticCapture}
            onSelectTab={onSelectTab}
            singers={singers}
            view={activeView}
          />
        </main>
        <QueuePanel />
      </div>

      <BottomMediaBar audioPlayer={audioPlayer} />
      {audioPlayer.audioElement}
    </div>
  );
}

function MainContent({
  audioPlayer,
  lyrics,
  mediaLibrary,
  microphones,
  microphoneAssignments,
  microphoneChannels,
  microphoneRecovery,
  diagnosticCapture,
  onSelectTab,
  singers,
  view,
}: {
  audioPlayer: AudioPlayer;
  lyrics: ReturnType<typeof useSongLyrics>;
  mediaLibrary: ReturnType<typeof useMediaLibrary>;
  microphones: ReturnType<typeof useLocalMicrophones>;
  microphoneAssignments: ReturnType<typeof useMicrophoneAssignments>;
  microphoneChannels: ReturnType<typeof useMicrophoneChannels>;
  microphoneRecovery: ReturnType<typeof useMicrophoneRecovery>;
  diagnosticCapture: ReturnType<typeof useDiagnosticCapture>;
  onSelectTab: (tab: AppTab) => void;
  singers: Singer[];
  view: TabDefinition;
}) {
  if (view.id === "performance") {
    return <PerformWorkspace audioPlayer={audioPlayer} lyrics={lyrics} />;
  }

  if (view.id === "library") {
    return <LibraryWorkspace audioPlayer={audioPlayer} mediaLibrary={mediaLibrary} />;
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
        capture={diagnosticCapture}
        channelRegistry={microphoneChannels}
        discovery={microphones}
        recovery={microphoneRecovery}
        singers={singers}
        assignments={microphoneAssignments}
      />
    );
  }

  return <PlaceholderWorkspace view={view} />;
}
