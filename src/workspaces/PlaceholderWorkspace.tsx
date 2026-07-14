import type { TabDefinition } from "../app/appTabs";

export function PlaceholderWorkspace({ view }: { view: TabDefinition }) {
  return (
    <section className="view-panel">
      <h2 id="view-heading" className="visually-hidden">
        {view.heading}
      </h2>
      <p className="placeholder-copy">Workspace not implemented yet.</p>
    </section>
  );
}
