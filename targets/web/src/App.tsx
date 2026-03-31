import { createRuntimeBootModel } from "@sugarmagic/runtime-core";
import { createBrowserRuntimeAdapter } from "@sugarmagic/runtime-web";

const boot = createRuntimeBootModel({
  hostKind: "published-web",
  compileProfile: "published-target",
  contentSource: "published-artifact"
});

const adapter = createBrowserRuntimeAdapter({
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
          This remains a thin host and now resolves its boot model through the
          same shared runtime-facing packages as studio.
        </p>
        <dl className="details">
          <div>
            <dt>Host</dt>
            <dd>{boot.hostKind}</dd>
          </div>
          <div>
            <dt>Profile</dt>
            <dd>{boot.compileProfile}</dd>
          </div>
          <div>
            <dt>Runtime family</dt>
            <dd>{boot.runtimeFamily}</dd>
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
