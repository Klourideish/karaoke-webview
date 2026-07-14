export type AppTab =
  "performance" | "library" | "queue" | "singers" | "mic" | "history" | "settings" | "developer";

export type TabGroup = "operational" | "configuration" | "engineering";

export type TabDefinition = {
  id: AppTab;
  label: string;
  heading: string;
  description: string;
  tooltip: string;
  group: TabGroup;
};

export const tabs: TabDefinition[] = [
  {
    id: "performance",
    label: "Performance",
    heading: "Performance",
    description: "Lyrics and live karaoke presentation area.",
    tooltip: "Display lyrics and control the current performance.",
    group: "operational",
  },
  {
    id: "library",
    label: "Library",
    heading: "Library",
    description: "Find songs and prepare future queue requests.",
    tooltip: "Browse songs and add them to the queue.",
    group: "operational",
  },
  {
    id: "queue",
    label: "Queue",
    heading: "Queue",
    description: "Upcoming performances and future vote ordering.",
    tooltip: "Manage upcoming singers and songs.",
    group: "operational",
  },
  {
    id: "singers",
    label: "Singers",
    heading: "Singers",
    description: "Session singer overview and future profile controls.",
    tooltip: "Add and organise singers.",
    group: "operational",
  },
  {
    id: "mic",
    label: "Microphones",
    heading: "Microphones",
    description: "Assign microphones to singers and check input.",
    tooltip: "Assign microphones and test input.",
    group: "operational",
  },
  {
    id: "history",
    label: "History",
    heading: "History",
    description: "Completed performances and future results.",
    tooltip: "Review the current session and previous sessions.",
    group: "operational",
  },
  {
    id: "settings",
    label: "Settings",
    heading: "Settings",
    description: "Application, library, display and audio preferences.",
    tooltip: "Configure the application.",
    group: "configuration",
  },
  {
    id: "developer",
    label: "Developer",
    heading: "Developer",
    description: "Protocol, capture, monitor and runtime diagnostics.",
    tooltip: "Open engineering diagnostics and development tools.",
    group: "engineering",
  },
];
