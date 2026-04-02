import { createWebTargetAdapter } from "./runtimeHost";

const adapter = createWebTargetAdapter({
  hostKind: "published-web",
  compileProfile: "published-target",
  contentSource: "published-artifact"
});

export function App() {
  return (
    <main className="target-shell">
      <section className="card">
        <p className="eyebrow">Sugarmagic</p>
        <h1>Web target bootstrap is wired.</h1>
        <p>
          This remains a thin published web host over the shared runtime.
        </p>
        <dl className="details">
          <div>
            <dt>Host</dt>
            <dd>{adapter.boot.hostKind}</dd>
          </div>
          <div>
            <dt>Profile</dt>
            <dd>{adapter.boot.compileProfile}</dd>
          </div>
          <div>
            <dt>Runtime family</dt>
            <dd>{adapter.boot.runtimeFamily}</dd>
          </div>
          <div>
            <dt>Asset resolution</dt>
            <dd>{adapter.assetResolution}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
