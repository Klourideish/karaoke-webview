export type AppTab = "perform" | "library" | "mic" | "settings";

export type TabDefinition = {
  id: AppTab;
  label: string;
  heading: string;
  description: string;
};

export const tabs: TabDefinition[] = [
  {
    id: "perform",
    label: "Perform",
    heading: "Perform",
    description: "Future lyrics and live karaoke presentation area.",
  },
  {
    id: "library",
    label: "Library",
    heading: "Library",
    description: "Future local song browsing and search area.",
  },
  {
    id: "mic",
    label: "Microphones",
    heading: "Microphones",
    description: "Future local microphone controls and diagnostics.",
  },
  {
    id: "settings",
    label: "Settings",
    heading: "Settings",
    description: "Future application, library, display and audio preferences.",
  },
];
