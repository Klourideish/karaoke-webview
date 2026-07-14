import { useEffect, useRef, useState } from "react";
import { tabs, type AppTab, type TabGroup } from "./appTabs";

const TOOLTIP_DELAY_MS = 600;

const groupLabels: Record<TabGroup, string> = {
  operational: "Operational",
  configuration: "Configuration",
  engineering: "Engineering",
};

export function TabRail({
  activeTab,
  onSelectTab,
}: {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
}) {
  const groups = Array.from(new Set(tabs.map((tab) => tab.group)));
  const [visibleTooltipTab, setVisibleTooltipTab] = useState<AppTab | null>(null);
  const tooltipTimerRef = useRef<number | null>(null);

  function clearTooltipTimer() {
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
  }

  function scheduleTooltip(tab: AppTab) {
    clearTooltipTimer();
    tooltipTimerRef.current = window.setTimeout(() => {
      setVisibleTooltipTab(tab);
      tooltipTimerRef.current = null;
    }, TOOLTIP_DELAY_MS);
  }

  function hideTooltip() {
    clearTooltipTimer();
    setVisibleTooltipTab(null);
  }

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current !== null) {
        window.clearTimeout(tooltipTimerRef.current);
      }
    };
  }, []);

  return (
    <nav className="tab-rail" aria-label="Primary sections">
      {groups.map((group) => (
        <div className="tab-group" key={group}>
          <p className="tab-group-label">{groupLabels[group]}</p>
          {tabs
            .filter((tab) => tab.group === group)
            .map((tab) => (
              <button
                aria-current={activeTab === tab.id ? "page" : undefined}
                aria-describedby={
                  visibleTooltipTab === tab.id ? `${tab.id}-tab-tooltip` : undefined
                }
                aria-pressed={activeTab === tab.id}
                className="tab-button"
                data-tab-group={group}
                key={tab.id}
                onBlur={hideTooltip}
                onClick={() => onSelectTab(tab.id)}
                onFocus={() => scheduleTooltip(tab.id)}
                onMouseEnter={() => scheduleTooltip(tab.id)}
                onMouseLeave={hideTooltip}
                type="button"
              >
                <span className="tab-label">{tab.label}</span>
                {visibleTooltipTab === tab.id ? (
                  <span className="tab-tooltip" id={`${tab.id}-tab-tooltip`} role="tooltip">
                    {tab.tooltip}
                  </span>
                ) : null}
              </button>
            ))}
        </div>
      ))}
    </nav>
  );
}
