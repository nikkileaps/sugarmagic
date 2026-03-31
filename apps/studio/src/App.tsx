import { useMemo } from "react";
import { productModes } from "@sugarmagic/productmodes";
import { createRuntimeBootModel } from "@sugarmagic/runtime-core";
import { createBrowserRuntimeAdapter } from "@sugarmagic/runtime-web";
import { createShellModel, createShellStore } from "@sugarmagic/shell";
import { useStore } from "zustand";

const shellStore = createShellStore("build");

shellStore.getState().setActiveWorkspace("build:region:bootstrap");
shellStore.getState().setSelection(["region-root"]);

const boot = createRuntimeBootModel({
  hostKind: "studio",
  compileProfile: "authoring-preview",
  contentSource: "authored-game-root"
});

const adapter = createBrowserRuntimeAdapter({
  hostKind: "studio",
  compileProfile: "authoring-preview",
  contentSource: "authored-game-root"
});

export function App() {
  const activeProductMode = useStore(shellStore, (state) => state.activeProductMode);
  const activeWorkspaceId = useStore(shellStore, (state) => state.activeWorkspaceId);
  const selectionCount = useStore(shellStore, (state) => state.selection.entityIds.length);

  const shell = useMemo(
    () =>
      createShellModel({
        title: "Sugarmagic Studio",
        workspaceId: activeWorkspaceId ?? "build:region:bootstrap",
        workspaceKind: "RegionWorkspace",
        subjectId: "bootstrap-region",
        productModeId: activeProductMode
      }),
    [activeProductMode, activeWorkspaceId]
  );

  return (
    <main className="app-shell">
      <section className="card">
        <p className="eyebrow">Sugarmagic</p>
        <h1>Studio bootstrap is wired.</h1>
        <p>
          This host remains a thin composition shell and now boots through the
          shared runtime-facing packages.
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
          <div>
            <dt>Workspace</dt>
            <dd>{shell.workspaceHost.workspaceKind}</dd>
          </div>
          <div>
            <dt>Selection count</dt>
            <dd>{selectionCount}</dd>
          </div>
        </dl>
        <div className="mode-row">
          {productModes.map((mode) => (
            <button
              key={mode.id}
              className={mode.id === activeProductMode ? "mode-button active" : "mode-button"}
              type="button"
              onClick={() => shellStore.getState().setActiveProductMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="workspace-copy">
          Active workspace: <strong>{activeWorkspaceId}</strong>
        </p>
      </section>
    </main>
  );
}
