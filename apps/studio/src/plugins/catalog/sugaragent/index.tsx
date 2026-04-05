import { useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput
} from "@mantine/core";
import { getPluginConfiguration } from "@sugarmagic/domain";
import {
  SUGARAGENT_PLUGIN_ID,
  ensureDiscoveredPluginConfiguration,
  normalizeSugarAgentPluginConfig
} from "@sugarmagic/plugins";
import { Inspector } from "@sugarmagic/ui";
import type {
  PluginWorkspaceViewProps,
  StudioPluginWorkspaceDefinition
} from "../../sdk";
import { readStudioPluginRuntimeEnvironment } from "../../../runtimeEnv";

interface SugarAgentLoreStatusResponse {
  ok: boolean;
  sourceKind: "local" | "github";
  sourceReady: boolean;
  sourcePath: string | null;
  vectorStoreId: string | null;
  pageCount: number;
  chunkCount: number;
  warnings: string[];
  ingest?: {
    active: boolean;
    phase: string;
    pageCount: number;
    chunkCount: number;
    uploadedCount: number;
    currentChunkId: string | null;
    message: string;
    warnings: string[];
    startedAt: string | null;
    completedAt: string | null;
  };
}

interface SugarAgentLorePageSummary {
  pageId: string;
  title: string;
  relativePath: string;
  sectionCount: number;
}

interface SugarAgentLorePagesResponse {
  ok: boolean;
  pages: SugarAgentLorePageSummary[];
  warnings: string[];
}

interface SugarAgentLoreIngestResponse {
  ok: boolean;
  mode: "overwrite";
  pageCount: number;
  chunkCount: number;
  uploadedCount: number;
  warnings: string[];
  vectorStoreId: string | null;
}

type SugarAgentLoreActionKind = "status" | "pages" | "ingest";

type SugarAgentCenterPanelProps = PluginWorkspaceViewProps;

function normalizeGatewayBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isLoreStatusResponse(value: unknown): value is SugarAgentLoreStatusResponse {
  return !!value && typeof value === "object" && "sourceKind" in value && "pageCount" in value;
}

function isLorePagesResponse(value: unknown): value is SugarAgentLorePagesResponse {
  return !!value && typeof value === "object" && Array.isArray((value as { pages?: unknown[] }).pages);
}

function isLoreIngestResponse(value: unknown): value is SugarAgentLoreIngestResponse {
  return (
    !!value &&
    typeof value === "object" &&
    "mode" in value &&
    "uploadedCount" in value &&
    "chunkCount" in value
  );
}

function SugarAgentCenterPanel(props: SugarAgentCenterPanelProps) {
  const { gameProjectId, pluginConfigurations, onCommand } = props;
  const [actionState, setActionState] = useState<{
    kind: SugarAgentLoreActionKind | null;
    running: boolean;
    error: string | null;
    status: SugarAgentLoreStatusResponse | null;
    pages: SugarAgentLorePageSummary[];
    ingest: SugarAgentLoreIngestResponse | null;
  }>({
    kind: null,
    running: false,
    error: null,
    status: null,
    pages: [],
    ingest: null
  });

  const configuration = ensureDiscoveredPluginConfiguration(
    pluginConfigurations,
    SUGARAGENT_PLUGIN_ID,
    true
  );
  const runtimeEnvironment = readStudioPluginRuntimeEnvironment();
  const sugarAgent = normalizeSugarAgentPluginConfig(
    getPluginConfiguration(pluginConfigurations, SUGARAGENT_PLUGIN_ID)?.config ??
      configuration.config
  );
  const proxyBaseUrl = normalizeGatewayBaseUrl(
    runtimeEnvironment.SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL ?? sugarAgent.proxyBaseUrl
  );

  async function fetchLoreStatus(): Promise<SugarAgentLoreStatusResponse | null> {
    if (!proxyBaseUrl) return null;
    const response = await fetch(`${proxyBaseUrl}/api/sugaragent/lore/status`);
    const payload = (await response.json()) as unknown;
    return isLoreStatusResponse(payload) ? payload : null;
  }

  function updateConfig(patch: Record<string, unknown>) {
    if (!gameProjectId) return;
    onCommand({
      kind: "UpdatePluginConfiguration",
      target: {
        aggregateKind: "plugin-config",
        aggregateId: configuration.identity.id
      },
      subject: {
        subjectKind: "plugin-configuration",
        subjectId: configuration.identity.id
      },
      payload: {
        configuration: {
          ...configuration,
          enabled: true,
          config: {
            ...configuration.config,
            ...patch
          }
        }
      }
    });
  }

  async function runLoreAction(kind: SugarAgentLoreActionKind) {
    if (!proxyBaseUrl) return;
    setActionState((current) => ({
      ...current,
      kind,
      running: true,
      error: null,
      ...(kind === "ingest" ? { ingest: null } : {})
    }));

    const url =
      kind === "status"
        ? `${proxyBaseUrl}/api/sugaragent/lore/status`
        : kind === "pages"
          ? `${proxyBaseUrl}/api/sugaragent/lore/pages`
          : `${proxyBaseUrl}/api/sugaragent/lore/ingest`;

    let pollTimer: number | null = null;
    try {
      if (kind === "ingest") {
        try {
          const status = await fetchLoreStatus();
          if (status) {
            setActionState((current) => ({
              ...current,
              status
            }));
          }
        } catch {
          // Ignore initial polling errors; the ingest request itself is authoritative.
        }

        pollTimer = window.setInterval(() => {
          void fetchLoreStatus()
            .then((status) => {
              if (!status) return;
              setActionState((current) => ({
                ...current,
                status
              }));
            })
            .catch(() => {
              // Keep the ingest request authoritative; transient polling failure
              // should not replace the main result path.
            });
        }, 700);
      }

      const response = await fetch(url, {
        method: kind === "ingest" ? "POST" : "GET",
        headers: {
          "content-type": "application/json"
        },
        body: kind === "ingest" ? JSON.stringify({ mode: "overwrite" }) : undefined
      });
      const raw = await response.text();
      let payload: unknown = null;
      if (raw.trim()) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = raw;
        }
      }

      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "message" in payload
            ? String((payload as { message?: unknown }).message ?? raw)
            : raw || `SugarAgent lore ${kind} failed.`;
        setActionState((current) => ({
          ...current,
          kind,
          running: false,
          error: `HTTP ${response.status} ${response.statusText}\n${message}`
        }));
        return;
      }

      const latestStatus =
        kind === "ingest"
          ? await fetchLoreStatus().catch(() => null)
          : null;

      setActionState((current) => ({
        ...current,
        kind,
        running: false,
        error: null,
        status: latestStatus ??
          (isLoreStatusResponse(payload)
          ? payload
          : kind === "ingest" && current.status
            ? current.status
            : current.status),
        pages: isLorePagesResponse(payload) ? payload.pages : current.pages,
        ingest: isLoreIngestResponse(payload) ? payload : current.ingest
      }));
    } catch (error) {
      setActionState((current) => ({
        ...current,
        kind,
        running: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    } finally {
      if (pollTimer != null) {
        window.clearInterval(pollTimer);
      }
    }
  }

  const actionsDisabledReason = (() => {
    if (!proxyBaseUrl) {
      return "Configure VITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL so the workspace can reach the SugarDeploy gateway.";
    }
    if (sugarAgent.loreSourceKind === "local" && !sugarAgent.loreLocalPath.trim()) {
      return "Set the local lore repo path first, then save and redeploy SugarDeploy so the gateway mounts it.";
    }
    if (sugarAgent.loreSourceKind === "github" && !sugarAgent.loreRepositoryUrl.trim()) {
      return "Set the lore repository URL first. GitHub-backed lore ingest is planned but not implemented yet.";
    }
    return null;
  })();
  const actionsDisabled = actionState.running || actionsDisabledReason != null;

  return (
    <Stack gap="lg" p="xl" h="100%" style={{ minHeight: 0, overflowY: "auto" }}>
      <Stack gap={4}>
        <Text fw={700} size="lg">
          SugarAgent Plugin
        </Text>
        <Text size="sm" c="var(--sm-color-subtext)">
          SugarAgent conversation runtime is configured here, but authored world lore now comes from the lore wiki. NPCs bind to a canonical lore page id, and the gateway owns lore discovery and vector-store ingest.
        </Text>
      </Stack>

      <Alert color="blue" variant="light" title="Local .env">
        <Stack gap={4}>
          <Text size="sm">
            Set these in your local Studio <Code>.env</Code> file:
          </Text>
          <Code block>
            {`# Optional proxy mode through SugarDeploy\nVITE_SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL=http://localhost:8787\n\n# Direct browser-to-vendor mode (still supported)\nVITE_SUGARMAGIC_ANTHROPIC_API_KEY=...\nVITE_SUGARMAGIC_ANTHROPIC_MODEL=claude-sonnet-4-5\nVITE_SUGARMAGIC_OPENAI_API_KEY=...\nVITE_SUGARMAGIC_OPENAI_EMBEDDING_MODEL=text-embedding-3-small\nVITE_SUGARMAGIC_OPENAI_VECTOR_STORE_ID=...`}
          </Code>
        </Stack>
      </Alert>

      <Stack gap="xs">
        <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
          Lore Source
        </Text>
        <Select
          label="Source Kind"
          data={[
            { value: "local", label: "Local Checked-Out Repo" },
            { value: "github", label: "GitHub Repo (Planned)" }
          ]}
          value={sugarAgent.loreSourceKind}
          onChange={(value) =>
            updateConfig({
              loreSourceKind: value === "github" ? "github" : "local"
            })
          }
        />
        {sugarAgent.loreSourceKind === "local" ? (
          <TextInput
            label="Local Lore Repo Path"
            description="Absolute path to the checked-out lore wiki repo. Save, then redeploy SugarDeploy so the local gateway mounts this path."
            placeholder="/Users/nikki/projects/world-lore"
            value={sugarAgent.loreLocalPath}
            onChange={(event) =>
              updateConfig({ loreLocalPath: event.currentTarget.value })
            }
          />
        ) : (
          <>
            <TextInput
              label="Repository URL"
              placeholder="https://github.com/org/world-lore"
              value={sugarAgent.loreRepositoryUrl}
              onChange={(event) =>
                updateConfig({ loreRepositoryUrl: event.currentTarget.value })
              }
            />
            <TextInput
              label="Repository Ref"
              placeholder="main"
              value={sugarAgent.loreRepositoryRef}
              onChange={(event) =>
                updateConfig({ loreRepositoryRef: event.currentTarget.value })
              }
            />
          </>
        )}
      </Stack>

      <Stack gap="xs">
        <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
          Runtime Behavior
        </Text>
        <NumberInput
          label="Max Evidence Results"
          min={1}
          max={8}
          value={sugarAgent.maxEvidenceResults}
          onChange={(value) =>
            updateConfig({
              maxEvidenceResults:
                typeof value === "number" && Number.isFinite(value)
                  ? value
                  : sugarAgent.maxEvidenceResults
            })
          }
        />
        <Switch
          label="Structured Debug Logging"
          checked={sugarAgent.debugLogging}
          onChange={(event) =>
            updateConfig({ debugLogging: event.currentTarget.checked })
          }
        />
      </Stack>

      <Stack gap="xs">
        <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
          Lore Actions
        </Text>
        <Group>
          <Button
            size="xs"
            variant="light"
            disabled={actionsDisabled}
            loading={actionState.running && actionState.kind === "status"}
            onClick={() => void runLoreAction("status")}
          >
            Status
          </Button>
          <Button
            size="xs"
            variant="light"
            disabled={actionsDisabled}
            loading={actionState.running && actionState.kind === "pages"}
            onClick={() => void runLoreAction("pages")}
          >
            Refresh Pages
          </Button>
          <Button
            size="xs"
            color="green"
            disabled={actionsDisabled}
            loading={actionState.running && actionState.kind === "ingest"}
            onClick={() => void runLoreAction("ingest")}
          >
            Ingest Lore
          </Button>
        </Group>
        <Text size="xs" c="var(--sm-color-overlay0)">
          {actionsDisabledReason ??
            "The gateway parses the lore wiki, chunks it, and overwrites the live vector store from this source."}
        </Text>
      </Stack>

      {actionState.error ? (
        <Box
          p="md"
          style={{
            borderRadius: 8,
            border: "1px solid color-mix(in srgb, var(--mantine-color-red-7) 55%, transparent)",
            background: "color-mix(in srgb, var(--mantine-color-red-9) 22%, transparent)"
          }}
        >
          <Stack gap="xs">
            <Text fw={600} c="var(--mantine-color-red-2)">Action Failed</Text>
            <Code block style={{ whiteSpace: "pre-wrap" }}>{actionState.error}</Code>
          </Stack>
        </Box>
      ) : null}

      {actionState.status ? (
        <Box
          p="md"
          style={{
            borderRadius: 8,
            border: "1px solid color-mix(in srgb, var(--mantine-color-blue-7) 45%, transparent)",
            background: "color-mix(in srgb, var(--mantine-color-blue-9) 16%, transparent)"
          }}
        >
          <Stack gap="xs">
            <Text fw={600}>Gateway Lore Status</Text>
            <Group gap="xs">
              <Badge color={actionState.status.sourceReady ? "green" : "yellow"}>
                {actionState.status.sourceReady ? "source ready" : "source not ready"}
              </Badge>
              <Badge color={actionState.status.vectorStoreId ? "blue" : "yellow"}>
                vector store {actionState.status.vectorStoreId ? "configured" : "missing"}
              </Badge>
            </Group>
            <Code block style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(actionState.status, null, 2)}
            </Code>
          </Stack>
        </Box>
      ) : null}

      {actionState.ingest ? (
        <Box
          p="md"
          style={{
            borderRadius: 8,
            border: "1px solid color-mix(in srgb, var(--mantine-color-green-7) 45%, transparent)",
            background: "color-mix(in srgb, var(--mantine-color-green-9) 16%, transparent)"
          }}
        >
          <Stack gap="xs">
            <Text fw={600}>Last Lore Ingest</Text>
            <Code block style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(actionState.ingest, null, 2)}
            </Code>
          </Stack>
        </Box>
      ) : null}

      {actionState.running && actionState.kind === "ingest" && actionState.status?.ingest ? (
        <Box
          p="md"
          style={{
            borderRadius: 8,
            border: "1px solid color-mix(in srgb, var(--mantine-color-yellow-7) 45%, transparent)",
            background: "color-mix(in srgb, var(--mantine-color-yellow-9) 16%, transparent)"
          }}
        >
          <Stack gap="xs">
            <Text fw={600}>Lore Ingest Progress</Text>
            <Text size="sm">
              {actionState.status.ingest.phase === "parsed"
                ? `Parsed ${actionState.status.ingest.pageCount} pages into ${actionState.status.ingest.chunkCount} chunks.`
                : actionState.status.ingest.phase === "uploading"
                  ? `Uploaded ${actionState.status.ingest.uploadedCount}/${actionState.status.ingest.chunkCount} chunks.`
                  : actionState.status.ingest.phase === "waiting-for-indexing"
                    ? `Waiting for indexing: ${actionState.status.ingest.currentChunkId ?? "current chunk"}.`
                    : actionState.status.ingest.message}
            </Text>
            <Code block style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(actionState.status.ingest, null, 2)}
            </Code>
          </Stack>
        </Box>
      ) : null}

      {actionState.pages.length > 0 ? (
        <Stack gap="xs">
          <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
            Discovered Lore Pages
          </Text>
          <Stack gap="xs">
            {actionState.pages.slice(0, 24).map((page) => (
              <Box
                key={page.pageId}
                p="sm"
                style={{
                  borderRadius: 8,
                  border: "1px solid var(--sm-panel-border)",
                  background: "color-mix(in srgb, var(--sm-panel-bg) 88%, black 12%)"
                }}
              >
                <Stack gap={2}>
                  <Group gap="xs">
                    <Badge color="indigo">{page.pageId}</Badge>
                    <Text size="sm" fw={600}>{page.title}</Text>
                  </Group>
                  <Text size="xs" c="var(--sm-color-subtext)">
                    {page.relativePath} · {page.sectionCount} sections
                  </Text>
                </Stack>
              </Box>
            ))}
          </Stack>
          {actionState.pages.length > 24 ? (
            <Text size="xs" c="var(--sm-color-overlay0)">
              Showing 24 of {actionState.pages.length} discovered pages.
            </Text>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}

export const pluginWorkspaceDefinition: StudioPluginWorkspaceDefinition = {
  pluginId: SUGARAGENT_PLUGIN_ID,
  workspaceKind: SUGARAGENT_PLUGIN_ID,
  createWorkspaceView(props) {
    const runtimeEnvironment = readStudioPluginRuntimeEnvironment();

    return {
      leftPanel: null,
      rightPanel: (
        <Inspector selectionLabel="sugaragent">
          <Stack gap="xs">
            <Text size="sm" c="var(--sm-color-subtext)">
              SugarAgent keeps conversation orchestration in the runtime, while lore discovery and vector-store ingest now live behind the gateway.
            </Text>
            <Text size="xs" c="var(--sm-color-overlay0)">
              Current env status: proxy {runtimeEnvironment.SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL ? "configured" : "off"}, LLM {runtimeEnvironment.SUGARMAGIC_ANTHROPIC_API_KEY ? "configured" : "missing"}, embeddings {runtimeEnvironment.SUGARMAGIC_OPENAI_API_KEY ? "configured" : "missing"}, vector store {runtimeEnvironment.SUGARMAGIC_OPENAI_VECTOR_STORE_ID ? "configured" : "missing"}
            </Text>
          </Stack>
        </Inspector>
      ),
      centerPanel: <SugarAgentCenterPanel {...props} />,
      viewportOverlay: null
    };
  }
};
