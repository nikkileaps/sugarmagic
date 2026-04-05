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
import { useState } from "react";
import type { DeploymentSettings } from "@sugarmagic/domain";
import {
  type DeploymentActionExecutionResult,
  type DeploymentActionKind,
  listDeploymentTargets,
  normalizeGoogleCloudRunDeploymentTargetOverrides,
  normalizeLocalDeploymentTargetOverrides,
  planGameDeployment,
  SUGARDEPLOY_PLUGIN_ID
} from "@sugarmagic/plugins";
import type {
  PluginWorkspaceViewProps,
  StudioPluginWorkspaceDefinition
} from "../../sdk";

type SugarDeployCenterPanelProps = PluginWorkspaceViewProps;

function isDeploymentActionExecutionResult(
  value: unknown
): value is DeploymentActionExecutionResult {
  return (
    !!value &&
    typeof value === "object" &&
    "descriptor" in value &&
    "ok" in value &&
    "exitCode" in value &&
    "stdout" in value &&
    "stderr" in value
  );
}

function SugarDeployCenterPanel(props: SugarDeployCenterPanelProps) {
  const { gameProjectId, gameProject, onCommand } = props;
  const [actionState, setActionState] = useState<{
    kind: DeploymentActionKind | null;
    result: DeploymentActionExecutionResult | null;
    error: string | null;
    running: boolean;
  }>({
    kind: null,
    result: null,
    error: null,
    running: false
  });

  const plan = gameProject ? planGameDeployment(gameProject) : null;
  const selectedTargetId = gameProject?.deployment.deploymentTargetId ?? null;
  const localOverrides = normalizeLocalDeploymentTargetOverrides(
    gameProject?.deployment.targetOverrides.local,
    gameProject ?? undefined
  );
  const cloudRunOverrides = normalizeGoogleCloudRunDeploymentTargetOverrides(
    gameProject?.deployment.targetOverrides["google-cloud-run"],
    gameProject ?? undefined
  );

  function updateSettings(nextSettings: DeploymentSettings) {
    if (!gameProjectId || !gameProject) return;
    onCommand({
      kind: "UpdateDeploymentSettings",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "game-project",
        subjectId: gameProjectId
      },
      payload: {
        settings: nextSettings
      }
    });
  }

  function updateTarget(value: string | null) {
    if (!gameProject) return;
    updateSettings({
      ...gameProject.deployment,
      deploymentTargetId:
        value === "local" ||
        value === "google-cloud-run" ||
        value === "aws-fargate"
          ? value
          : null
    });
  }

  function updateTargetOverrides(
    targetId: "local" | "google-cloud-run" | "aws-fargate",
    patch: Record<string, unknown>
  ) {
    if (!gameProject) return;
    updateSettings({
      ...gameProject.deployment,
      targetOverrides: {
        ...gameProject.deployment.targetOverrides,
        [targetId]: {
          ...(gameProject.deployment.targetOverrides[targetId] ?? {}),
          ...patch
        }
      }
    });
  }

  async function runAction(actionKind: DeploymentActionKind) {
    if (!gameProject) return;
    setActionState({
      kind: actionKind,
      result: null,
      error: null,
      running: true
    });
    try {
      const response = await fetch("/__sugardeploy/action", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          actionKind,
          gameProject
        })
      });
      const rawBody = await response.text();
      let payload:
        | DeploymentActionExecutionResult
        | { message?: string; descriptor?: unknown }
        | null = null;
      if (rawBody.trim().length > 0) {
        try {
          payload = JSON.parse(rawBody) as
            | DeploymentActionExecutionResult
            | { message?: string; descriptor?: unknown };
        } catch {
          payload = null;
        }
      }
      if (!response.ok || !isDeploymentActionExecutionResult(payload)) {
        const message =
          payload && "message" in payload && typeof payload.message === "string"
            ? payload.message
            : rawBody.trim().length > 0
              ? rawBody
              : `SugarDeploy ${actionKind} failed.`;
        setActionState({
          kind: actionKind,
          result: null,
          error: `HTTP ${response.status} ${response.statusText}\n${message}`,
          running: false
        });
        return;
      }
      setActionState({
        kind: actionKind,
        result: payload,
        error: null,
        running: false
      });
    } catch (error) {
      setActionState({
        kind: actionKind,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        running: false
      });
    }
  }

  const hostActionsAvailable = import.meta.env.DEV;
  const actionBlockedReason = (() => {
    if (!hostActionsAvailable) {
      return "Host deployment actions are available in Studio dev mode only.";
    }
    if (!selectedTargetId) {
      return "Select a deployment target first.";
    }
    if (selectedTargetId === "local" && !localOverrides.workingDirectory.trim()) {
      return "Set Local Working Directory to the absolute path of the game root on disk before deploying.";
    }
    if (
      selectedTargetId === "google-cloud-run" &&
      !cloudRunOverrides.workingDirectory.trim()
    ) {
      return "Set Google Cloud Run Working Directory to the absolute path of the game root on disk before running deploy actions.";
    }
    return null;
  })();
  const actionsDisabled = actionBlockedReason != null;

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
          SugarDeploy Plugin
        </Text>
        <Text size="sm" c="var(--sm-color-subtext)">
          Choose a deployment target, inspect plugin requirements, and review the generated deployment surfaces that will be managed in the game root on save.
        </Text>
      </Stack>

      <Select
        label="Publish Target"
        data={[{ value: "web", label: "Web" }]}
        value={gameProject?.deployment.publishTargetId ?? "web"}
        disabled
      />

      <Select
        label="Deployment Target"
        placeholder="Select a deployment target"
        data={listDeploymentTargets().map((target) => ({
          value: target.targetId,
          label: `${target.displayName}${target.implemented ? "" : " (Planned)"}`
        }))}
        value={gameProject?.deployment.deploymentTargetId}
        onChange={updateTarget}
      />

      {selectedTargetId === "local" ? (
        <Stack gap="sm">
          <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
            Local Overrides
          </Text>
          <TextInput
            label="Working Directory"
            description="Absolute path to the game root on disk. Required for deploy actions because the browser host cannot infer the selected folder path."
            value={localOverrides.workingDirectory}
            onChange={(event) =>
              updateTargetOverrides("local", {
                workingDirectory: event.currentTarget.value
              })
            }
          />
          <TextInput
            label="Compose Project Name"
            value={localOverrides.composeProjectName}
            onChange={(event) =>
              updateTargetOverrides("local", {
                composeProjectName: event.currentTarget.value
              })
            }
          />
          <NumberInput
            label="Gateway Host Port Base"
            value={localOverrides.gatewayHostPortBase}
            min={1024}
            max={65535}
            onChange={(value) =>
              updateTargetOverrides("local", {
                gatewayHostPortBase: value
              })
            }
          />
        </Stack>
      ) : null}

      {selectedTargetId === "google-cloud-run" ? (
        <Stack gap="sm">
          <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
            Google Cloud Run Overrides
          </Text>
          <TextInput
            label="Working Directory"
            description="Absolute path to the game root on disk. Required for host-side deploy/status actions."
            value={cloudRunOverrides.workingDirectory}
            onChange={(event) =>
              updateTargetOverrides("google-cloud-run", {
                workingDirectory: event.currentTarget.value
              })
            }
          />
          <TextInput
            label="GCP Project Id"
            value={cloudRunOverrides.projectId}
            onChange={(event) =>
              updateTargetOverrides("google-cloud-run", {
                projectId: event.currentTarget.value
              })
            }
          />
          <TextInput
            label="Region"
            value={cloudRunOverrides.region}
            onChange={(event) =>
              updateTargetOverrides("google-cloud-run", {
                region: event.currentTarget.value
              })
            }
          />
          <TextInput
            label="Service Name Prefix"
            value={cloudRunOverrides.serviceNamePrefix}
            onChange={(event) =>
              updateTargetOverrides("google-cloud-run", {
                serviceNamePrefix: event.currentTarget.value
              })
            }
          />
          <NumberInput
            label="Container Port"
            value={cloudRunOverrides.containerPort}
            min={1024}
            max={65535}
            onChange={(value) =>
              updateTargetOverrides("google-cloud-run", {
                containerPort: value
              })
            }
          />
          <Group grow>
            <NumberInput
              label="Min Instances"
              value={cloudRunOverrides.minInstances}
              min={0}
              max={100}
              onChange={(value) =>
                updateTargetOverrides("google-cloud-run", {
                  minInstances: value
                })
              }
            />
            <NumberInput
              label="Max Instances"
              value={cloudRunOverrides.maxInstances}
              min={1}
              max={100}
              onChange={(value) =>
                updateTargetOverrides("google-cloud-run", {
                  maxInstances: value
                })
              }
            />
          </Group>
          <Select
            label="Ingress"
            data={[
              { value: "all", label: "All" },
              { value: "internal", label: "Internal" },
              {
                value: "internal-and-cloud-load-balancing",
                label: "Internal + Load Balancing"
              }
            ]}
            value={cloudRunOverrides.ingress}
            onChange={(value) =>
              updateTargetOverrides("google-cloud-run", {
                ingress: value ?? "all"
              })
            }
          />
          <Switch
            label="Allow unauthenticated"
            checked={cloudRunOverrides.allowUnauthenticated}
            onChange={(event) =>
              updateTargetOverrides("google-cloud-run", {
                allowUnauthenticated: event.currentTarget.checked
              })
            }
          />
        </Stack>
      ) : null}

      <Stack gap="xs">
        <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
          Deployment Actions
        </Text>
        <Group>
          <Button
            size="xs"
            onClick={() => runAction("deploy")}
            loading={actionState.running && actionState.kind === "deploy"}
            disabled={actionsDisabled}
          >
            Deploy
          </Button>
          <Button
            size="xs"
            variant="light"
            onClick={() => runAction("status")}
            loading={actionState.running && actionState.kind === "status"}
            disabled={actionsDisabled}
          >
            Status
          </Button>
          <Button
            size="xs"
            variant="light"
            color="red"
            onClick={() => runAction("stop")}
            loading={actionState.running && actionState.kind === "stop"}
            disabled={actionsDisabled}
          >
            Stop
          </Button>
          {plan?.deploymentTargetId === "local" ? (
            <Button
              size="xs"
              variant="subtle"
              onClick={() => runAction("health")}
              disabled={actionsDisabled}
            >
              Health
            </Button>
          ) : null}
        </Group>
        <Text size="sm" c="var(--sm-color-overlay0)">
          {actionBlockedReason ??
            "Save first, then use SugarDeploy actions. Working Directory must point at the game root on disk."}
        </Text>
      </Stack>

      {actionState.error ? (
        <Box
          p="md"
          style={{
            background: "rgba(160, 40, 40, 0.28)",
            border: "1px solid rgba(220, 80, 80, 0.45)",
            borderRadius: 8
          }}
        >
          <Stack gap="xs">
            <Text fw={700} size="sm">
              Action Failed
            </Text>
            <Code block>{actionState.error}</Code>
          </Stack>
        </Box>
      ) : null}

      {actionState.result ? (
        <Box
          p="md"
          style={{
            background: actionState.result.ok
              ? "rgba(30, 110, 50, 0.28)"
              : "rgba(160, 40, 40, 0.28)",
            border: actionState.result.ok
              ? "1px solid rgba(70, 180, 90, 0.45)"
              : "1px solid rgba(220, 80, 80, 0.45)",
            borderRadius: 8
          }}
        >
          <Stack gap="xs">
            <Text fw={700} size="sm">
              {`Last action: ${actionState.result.descriptor.actionKind}`}
            </Text>
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {actionState.result.message}
            </Text>
            {actionState.result.descriptor.command ? (
              <Code block>{`${actionState.result.descriptor.command.command} ${actionState.result.descriptor.command.args.join(" ")}\n${actionState.result.descriptor.command.cwd}`}</Code>
            ) : null}
            {actionState.result.descriptor.healthUrl ? (
              <Group gap="xs">
                <Text size="sm" c="var(--sm-color-subtext)">
                  Health:
                </Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => {
                    if (actionState.result?.descriptor.healthUrl) {
                      window.open(actionState.result.descriptor.healthUrl, "_blank", "noopener,noreferrer");
                    }
                  }}
                >
                  {actionState.result.descriptor.healthUrl}
                </Button>
              </Group>
            ) : null}
            {actionState.result.stdout.trim() ? (
              <Code block>{actionState.result.stdout}</Code>
            ) : null}
            {actionState.result.stderr.trim() ? (
              <Code block>{actionState.result.stderr}</Code>
            ) : null}
          </Stack>
        </Box>
      ) : null}

      {plan?.warnings.length ? (
        <Alert color="yellow" variant="light" title="Plan Warnings">
          <Stack gap={4}>
            {plan.warnings.map((warning) => (
              <Text key={warning} size="sm">
                {warning}
              </Text>
            ))}
          </Stack>
        </Alert>
      ) : null}

      {plan?.conflicts.length ? (
        <Alert color={plan.conflicts.some((conflict) => conflict.severity === "error") ? "red" : "yellow"} variant="light" title="Conflicts">
          <Stack gap={4}>
            {plan.conflicts.map((conflict) => (
              <Text key={conflict.conflictId} size="sm">
                [{conflict.severity}] {conflict.message}
              </Text>
            ))}
          </Stack>
        </Alert>
      ) : null}

      <Stack gap="xs">
        <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
          Requirement Sources
        </Text>
        {plan?.requirementSources.length ? (
          plan.requirementSources.map((source) => (
            <Group key={source.ownerId} gap="xs">
              <Badge variant="light" color="blue">
                {source.displayName}
              </Badge>
              <Text size="sm" c="var(--sm-color-subtext)">
                {source.requirements.length} requirements
              </Text>
            </Group>
          ))
        ) : (
          <Text size="sm" c="var(--sm-color-overlay0)">
            No enabled plugins are currently declaring deployment requirements.
          </Text>
        )}
      </Stack>

      <Stack gap="xs">
        <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
          Managed Files
        </Text>
        {plan?.managedFiles.length ? (
          plan.managedFiles.map((file) => (
            <Code key={file.relativePath} block>
              {file.relativePath}
            </Code>
          ))
        ) : (
          <Text size="sm" c="var(--sm-color-overlay0)">
            Select a deployment target to see generated deployment outputs.
          </Text>
        )}
      </Stack>

      <Alert color="blue" variant="light" title="Managed Files">
        <Text size="sm">
          SugarDeploy-generated files are managed surfaces. If you need customization, use deployment settings and extension points instead of editing generated files directly.
        </Text>
      </Alert>
    </Stack>
  );
}

export const pluginWorkspaceDefinition: StudioPluginWorkspaceDefinition = {
  pluginId: SUGARDEPLOY_PLUGIN_ID,
  workspaceKind: SUGARDEPLOY_PLUGIN_ID,
  createWorkspaceView(props) {
    return {
      leftPanel: null,
      rightPanel: null,
      centerPanel: <SugarDeployCenterPanel {...props} />,
      viewportOverlay: null
    };
  }
};
