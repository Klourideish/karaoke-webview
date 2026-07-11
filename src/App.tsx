import { useState } from "react";
import { AppShell } from "./app/AppShell";
import { tabs, type AppTab } from "./app/appTabs";
import type { Singer } from "./app/SingerBar";
import { useAudioPlayer } from "./audioPlayer";
import { useMediaLibrary } from "./media-library/useMediaLibrary";

const initialSingers: Singer[] = [
  { id: "singer-1", displayName: "Singer 1" },
  { id: "singer-2", displayName: "Singer 2" },
  { id: "singer-3", displayName: "Singer 3" },
  { id: "singer-4", displayName: "Singer 4" },
];

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("perform");
  const [singers, setSingers] = useState<Singer[]>(initialSingers);
  const [nextSingerNumber, setNextSingerNumber] = useState(initialSingers.length + 1);
  const mediaLibrary = useMediaLibrary();
  const audioPlayer = useAudioPlayer();
  const activeView = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  function addSinger() {
    const singerNumber = nextSingerNumber;
    setSingers((currentSingers) => [
      ...currentSingers,
      {
        id: `singer-${singerNumber}`,
        displayName: `Singer ${singerNumber}`,
      },
    ]);
    setNextSingerNumber((currentNumber) => currentNumber + 1);
  }

  function renameSinger(id: string, displayName: string) {
    setSingers((currentSingers) =>
      currentSingers.map((singer) =>
        singer.id === id
          ? {
              ...singer,
              displayName,
            }
          : singer,
      ),
    );
  }

  function removeSinger(id: string) {
    setSingers((currentSingers) => currentSingers.filter((singer) => singer.id !== id));
  }

  return (
    <AppShell
      activeTab={activeTab}
      activeView={activeView}
      audioPlayer={audioPlayer}
      mediaLibrary={mediaLibrary}
      onAddSinger={addSinger}
      onRemoveSinger={removeSinger}
      onRenameSinger={renameSinger}
      onSelectTab={setActiveTab}
      singers={singers}
    />
  );
}
