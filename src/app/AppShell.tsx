import type { AudioPlayer } from "../audioPlayer";
import { useMediaLibrary } from "../media-library/useMediaLibrary";
import { useLocalMicrophones } from "../microphones/useLocalMicrophones";
import { BottomMediaBar } from "../player/BottomMediaBar";
import { useSongLyrics } from "../useSongLyrics";
import { LibraryWorkspace } from "../workspaces/LibraryWorkspace";
import { MicrophoneWorkspace } from "../workspaces/MicrophoneWorkspace";
import { PerformWorkspace } from "../workspaces/PerformWorkspace";
import { PlaceholderWorkspace } from "../workspaces/PlaceholderWorkspace";
import { QueuePanel } from "./QueuePanel";
import { SingerBar, type Singer } from "./SingerBar";
import { TabRail } from "./TabRail";
import { TopInfoBar } from "./TopInfoBar";
import type { AppTab, TabDefinition } from "./appTabs";

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

  return (
    <div className="app-shell">
      <TopInfoBar audioPlayer={audioPlayer} />

      <div className="session-layout">
        <div className="nav-spacer" aria-hidden="true" />
        <SingerBar
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
  view,
}: {
  audioPlayer: AudioPlayer;
  lyrics: ReturnType<typeof useSongLyrics>;
  mediaLibrary: ReturnType<typeof useMediaLibrary>;
  microphones: ReturnType<typeof useLocalMicrophones>;
  view: TabDefinition;
}) {
  if (view.id === "perform") {
    return (
      <PerformWorkspace
        audioPlayer={audioPlayer}
        heading={view.heading}
        lyrics={lyrics}
        description={view.description}
      />
    );
  }

  if (view.id === "library") {
    return <LibraryWorkspace audioPlayer={audioPlayer} mediaLibrary={mediaLibrary} />;
  }

  if (view.id === "mic") {
    return <MicrophoneWorkspace discovery={microphones} />;
  }

  return <PlaceholderWorkspace view={view} />;
}
