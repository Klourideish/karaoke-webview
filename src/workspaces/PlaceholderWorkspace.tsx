import type { TabDefinition } from "../app/appTabs";

export function PlaceholderWorkspace({ view }: { view: TabDefinition }) {
  return (
    <section className="view-panel">
      <div className="view-heading-group">
        <p className="region-label">Workspace</p>
        <h2 id="view-heading">{view.heading}</h2>
      </div>
      <p className="view-description">{view.description}</p>
    </section>
  );
}
