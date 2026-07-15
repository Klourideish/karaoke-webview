import { useState } from "react";
import { AppShell } from "./app/AppShell";
import { tabs, type AppTab } from "./app/appTabs";
import { useAudioPlayer } from "./audioPlayer";
import { useMediaLibrary } from "./media-library/useMediaLibrary";
import { useSessionSingers } from "./session-singers/useSessionSingers";

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("performance");
  const sessionSingers = useSessionSingers();
  const mediaLibrary = useMediaLibrary();
  const audioPlayer = useAudioPlayer();
  const activeView = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <AppShell
      activeTab={activeTab}
      activeView={activeView}
      audioPlayer={audioPlayer}
      mediaLibrary={mediaLibrary}
      onCreateSingerWithMicrophone={sessionSingers.createWithMicrophone}
      onRemoveSinger={sessionSingers.remove}
      onRenameSinger={sessionSingers.rename}
      onRefreshSingers={sessionSingers.refresh}
      onSelectTab={setActiveTab}
      singerError={sessionSingers.error}
      singerMutationPending={sessionSingers.pendingSingerId}
      singers={sessionSingers.singers}
    />
  );
}
