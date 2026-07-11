import { tabs, type AppTab } from "./appTabs";

export function TabRail({
  activeTab,
  onSelectTab,
}: {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
}) {
  return (
    <nav className="tab-rail" aria-label="Primary sections">
      {tabs.map((tab) => (
        <button
          aria-current={activeTab === tab.id ? "page" : undefined}
          aria-pressed={activeTab === tab.id}
          className="tab-button"
          key={tab.id}
          onClick={() => onSelectTab(tab.id)}
          type="button"
        >
          <span className="tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
