/**
 * PublishProductModeView: hosts the Publish productmode shell.
 *
 * Studio core contributes one baseline workspace — `package` — whose
 * single button produces a pure-client static artifact via the
 * `@sugarmagic/target-web` Vite build. Future plugin-contributed
 * workspaces (Provision / Release / Deploy from SugarDeploy, etc.)
 * render alongside via the same sub-nav, looked up by `productMode`
 * on the plugin's workspace contribution.
 *
 * Story 46.1 ships only the Package workspace; later stories layer
 * SugarDeploy's contributions on top.
 */

import { useMemo, useState } from "react";
import { Alert, Button, Code, Group, Loader, Stack, Text } from "@mantine/core";
import type {
  GameProject,
  PluginConfigurationRecord
} from "@sugarmagic/domain";
import { getDiscoveredPluginDefinition } from "@sugarmagic/plugins";
import type { PublishWorkspaceKind } from "@sugarmagic/shell";
import { BuildSubNav, PanelSection } from "@sugarmagic/ui";

interface PublishWorkspaceTab {
  id: string;
  label: string;
  icon: string;
}

const corePublishWorkspaceTabs: PublishWorkspaceTab[] = [
  { id: "package", label: "Package", icon: "📦" }
];

/**
 * Story 46.5 — plugin-contributed Publish workspace tab. App.tsx
 * assembles these from PluginPublishWorkspaceContribution metadata +
 * the matching StudioPluginWorkspaceDefinition.createWorkspaceView()
 * output. The hook renders the active tab's view in the relevant
 * panel slots; non-active tabs aren't rendered (no offscreen mount).
 */
export interface PluginPublishWorkspaceTab {
  workspaceKind: string;
  label: string;
  icon: string;
  view: {
    leftPanel: React.ReactNode;
    rightPanel: React.ReactNode;
    centerPanel?: React.ReactNode;
    viewportOverlay: React.ReactNode;
  };
}

export interface PublishProductModeViewProps {
  activePublishKind: PublishWorkspaceKind;
  gameProject: GameProject | null;
  pluginConfigurations: PluginConfigurationRecord[];
  onSelectKind: (kind: PublishWorkspaceKind) => void;
  /**
   * Story 46.5 — plugin-contributed Publish workspace tabs, ordered
   * by their PluginPublishWorkspaceContribution.order. Empty when no
   * publish-side plugin is installed (the productmode shows just the
   * Package tab).
   */
  pluginPublishWorkspaces?: PluginPublishWorkspaceTab[];
}

export interface PublishProductModeViewResult {
  subHeaderPanel: React.ReactNode;
  leftPanel: React.ReactNode | null;
  rightPanel: React.ReactNode;
  centerPanel?: React.ReactNode;
  viewportOverlay: React.ReactNode;
}

type PackageBuildState =
  | { phase: "idle" }
  | { phase: "building" }
  | { phase: "success"; distPath: string; sizeBytes: number; buildLog: string }
  | { phase: "failed"; reason: string; buildLog: string };

interface PackageBlocker {
  pluginId: string;
  pluginDisplayName: string;
  blockingKinds: string[];
}

/**
 * Compute the gating set for the Package button: every enabled plugin
 * whose discovered definition declares deployment requirements of kind
 * "proxy-route" or "secret" — both of those require a gateway, which
 * the pure-client Package output cannot provide.
 */
function findPackageBlockers(
  pluginConfigurations: PluginConfigurationRecord[]
): PackageBlocker[] {
  const blockers: PackageBlocker[] = [];
  for (const configuration of pluginConfigurations) {
    if (!configuration.enabled) continue;
    const definition = getDiscoveredPluginDefinition(configuration.pluginId);
    if (!definition) continue;
    const blockingKinds = new Set<string>();
    for (const requirement of definition.deploymentRequirements ?? []) {
      if (requirement.kind === "proxy-route" || requirement.kind === "secret") {
        blockingKinds.add(requirement.kind);
      }
    }
    if (blockingKinds.size > 0) {
      blockers.push({
        pluginId: configuration.pluginId,
        pluginDisplayName:
          definition.manifest.displayName ?? configuration.pluginId,
        blockingKinds: Array.from(blockingKinds).sort()
      });
    }
  }
  return blockers;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function PackageWorkspace(props: {
  gameProject: GameProject | null;
  pluginConfigurations: PluginConfigurationRecord[];
}) {
  const { gameProject, pluginConfigurations } = props;
  const [state, setState] = useState<PackageBuildState>({ phase: "idle" });

  const blockers = useMemo(
    () => findPackageBlockers(pluginConfigurations),
    [pluginConfigurations]
  );
  const blocked = blockers.length > 0;
  const disabledReason = blocked
    ? `${blockers
        .map(
          (b) =>
            `${b.pluginDisplayName} requires ${b.blockingKinds.join(" + ")}`
        )
        .join("; ")}. Use SugarDeploy's Deploy workspace once installed.`
    : null;

  async function runPackage() {
    if (blocked) return;
    if (!gameProject) {
      setState({
        phase: "failed",
        reason: "No project loaded.",
        buildLog: ""
      });
      return;
    }
    setState({ phase: "building" });
    try {
      const response = await fetch("/__studio/package-pure-client", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const payload = (await response.json()) as {
        ok: boolean;
        reason?: string;
        distPath?: string;
        sizeBytes?: number;
        buildLog?: string;
      };
      if (!payload.ok) {
        setState({
          phase: "failed",
          reason: payload.reason ?? `HTTP ${response.status}`,
          buildLog: payload.buildLog ?? ""
        });
        return;
      }
      setState({
        phase: "success",
        distPath: payload.distPath ?? "",
        sizeBytes: payload.sizeBytes ?? 0,
        buildLog: payload.buildLog ?? ""
      });
    } catch (error) {
      setState({
        phase: "failed",
        reason: error instanceof Error ? error.message : String(error),
        buildLog: ""
      });
    }
  }

  return (
    <Stack
      gap="lg"
      p="xl"
      h="100%"
      style={{
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden"
      }}
    >
      <Stack gap={4}>
        <Text fw={700} size="lg">
          Package
        </Text>
        <Text size="sm" c="var(--sm-color-subtext)">
          Build a self-contained playable artifact for the current
          project. Output is a static directory you can host anywhere
          (Netlify drag-and-drop, S3, GitHub Pages, opening
          <Code>index.html</Code> via <Code>file://</Code>, etc.). No
          gateway, no APIs, no hosted infrastructure — pure client.
        </Text>
      </Stack>

      {blocked ? (
        <Alert color="yellow" variant="light" title="Hosted publish required">
          <Stack gap="xs">
            <Text size="sm">
              The Package button is disabled because this project has
              plugins enabled that need a server-side gateway:
            </Text>
            <Stack gap={4}>
              {blockers.map((blocker) => (
                <Text key={blocker.pluginId} size="sm">
                  - {blocker.pluginDisplayName} ({blocker.blockingKinds.join(" + ")})
                </Text>
              ))}
            </Stack>
            <Text size="sm">
              Install the SugarDeploy plugin and use its Provision +
              Release + Deploy workspaces (also in the Publish
              productmode) to ship a hosted version that includes the
              gateway these plugins need.
            </Text>
          </Stack>
        </Alert>
      ) : null}

      <Group>
        <Button
          size="md"
          onClick={() => void runPackage()}
          disabled={blocked || state.phase === "building"}
          loading={state.phase === "building"}
          title={disabledReason ?? undefined}
        >
          Package
        </Button>
        {state.phase === "building" ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm">
              Running <Code>pnpm --filter @sugarmagic/target-web build</Code>...
            </Text>
          </Group>
        ) : null}
      </Group>

      {state.phase === "success" ? (
        <Alert color="green" variant="light" title="Build succeeded">
          <Stack gap="xs">
            <Text size="sm">Output ready at:</Text>
            <Code block>{state.distPath}</Code>
            <Text size="sm" c="var(--sm-color-subtext)">
              Size: {formatSize(state.sizeBytes)}
            </Text>
            <Text size="sm">
              Open <Code>index.html</Code> from that directory directly,
              or copy the directory contents to your static host of
              choice.
            </Text>
            {state.buildLog.trim().length > 0 ? (
              <Code block>{state.buildLog}</Code>
            ) : null}
          </Stack>
        </Alert>
      ) : null}

      {state.phase === "failed" ? (
        <Alert color="red" variant="light" title="Build failed">
          <Stack gap="xs">
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {state.reason}
            </Text>
            {state.buildLog.trim().length > 0 ? (
              <Code block>{state.buildLog}</Code>
            ) : null}
          </Stack>
        </Alert>
      ) : null}
    </Stack>
  );
}

export function usePublishProductModeView(
  props: PublishProductModeViewProps
): PublishProductModeViewResult {
  const {
    activePublishKind,
    gameProject,
    pluginConfigurations,
    onSelectKind,
    pluginPublishWorkspaces = []
  } = props;

  // Story 46.5 — Package (Studio core) is always first; plugin
  // contributions follow in PluginPublishWorkspaceContribution.order
  // (App.tsx pre-sorts the list it passes in).
  const workspaceTabs: PublishWorkspaceTab[] = [
    ...corePublishWorkspaceTabs,
    ...pluginPublishWorkspaces.map((entry) => ({
      id: entry.workspaceKind,
      label: entry.label,
      icon: entry.icon
    }))
  ];

  const activePluginWorkspace = pluginPublishWorkspaces.find(
    (entry) => entry.workspaceKind === activePublishKind
  );

  const isPackage = activePublishKind === "package";
  const isPlugin = activePluginWorkspace !== undefined;

  return {
    subHeaderPanel: (
      <BuildSubNav
        workspaceKinds={workspaceTabs}
        activeKindId={activePublishKind}
        onSelectKind={(id) => onSelectKind(id as PublishWorkspaceKind)}
      />
    ),
    leftPanel: isPlugin ? (
      activePluginWorkspace.view.leftPanel
    ) : (
      <PanelSection title="Publish" icon="🚀">
        <Stack gap="xs" p="sm">
          <Text size="xs" c="var(--sm-color-subtext)">
            Pick how to ship the current project.
          </Text>
        </Stack>
      </PanelSection>
    ),
    rightPanel: isPlugin ? activePluginWorkspace.view.rightPanel : null,
    centerPanel: isPackage ? (
      <PackageWorkspace
        gameProject={gameProject}
        pluginConfigurations={pluginConfigurations}
      />
    ) : isPlugin ? (
      activePluginWorkspace.view.centerPanel
    ) : (
      <Stack gap="sm" p="xl">
        <Text size="sm" c="var(--sm-color-overlay0)">
          Unknown publish workspace: <Code>{activePublishKind}</Code>
        </Text>
      </Stack>
    ),
    viewportOverlay: isPlugin
      ? activePluginWorkspace.view.viewportOverlay
      : null
  };
}
