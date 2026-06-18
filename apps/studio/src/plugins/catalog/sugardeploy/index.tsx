import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip
} from "@mantine/core";
import { useEffect, useState } from "react";
import type { DeploymentSettings } from "@sugarmagic/domain";
import {
  type DeploymentActionExecutionResult,
  type DeploymentActionKind,
  GCP_SERVICE_ACCOUNT_ID_MAX_LENGTH,
  GCP_SERVICE_ACCOUNT_ID_REGEX,
  GITHUB_REPO_REGEX,
  listDeploymentTargets,
  normalizeGoogleCloudRunDeploymentTargetOverrides,
  normalizeLocalDeploymentTargetOverrides,
  planGameDeployment,
  stripGithubRepoPrefixes,
  SUGARDEPLOY_PLUGIN_ID
} from "@sugarmagic/plugins";
import type {
  PluginWorkspaceViewProps,
  StudioPluginWorkspaceDefinition
} from "../../sdk";

type SugarDeployCenterPanelProps = PluginWorkspaceViewProps;

// Story 45.4.5 — state shapes for the Create GCP Project button.
// Status semantics changed in 45.4.7 fix: GCP intentionally can't
// distinguish "doesn't exist" from "no access" on its project APIs (it
// would leak existence info), so the probe collapses to "do I own this?"
// The "globally taken by someone else" case surfaces only when the create
// attempt itself fails — see the create endpoint's stderr-pattern check.
type GcpProjectProbeStatus = "owned" | "not-owned" | "unknown";

interface ProbeState {
  phase: "idle" | "probing" | "done";
  status: GcpProjectProbeStatus | null;
  message: string | null;
}

interface BillingAccountSummary {
  id: string;
  displayName: string;
  currencyCode?: string;
}

interface CreateProjectState {
  phase: "idle" | "listing-billing" | "picking-billing" | "creating" | "result";
  billingAccounts: BillingAccountSummary[];
  selectedBillingAccountId: string | null;
  result: {
    ok: boolean;
    message: string;
    stdout?: string;
    stderr?: string;
  } | null;
  error: string | null;
}

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

  // Story 45.4.5 — Create GCP Project button state machine.
  const [probeState, setProbeState] = useState<ProbeState>({
    phase: "idle",
    status: null,
    message: null
  });
  const [createState, setCreateState] = useState<CreateProjectState>({
    phase: "idle",
    billingAccounts: [],
    selectedBillingAccountId: null,
    result: null,
    error: null
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
  // Raw persisted overrides (pre-normalize). Form fields bind their `value`
  // here so blank stays blank visually; the normalized value above shows up
  // as the placeholder so users can see what the auto-derived default would
  // be without it pretending to be their input.
  const rawCloudRunOverrides = (gameProject?.deployment.targetOverrides[
    "google-cloud-run"
  ] ?? {}) as Record<string, unknown>;
  function rawCloudRunString(key: string): string {
    const value = rawCloudRunOverrides[key];
    return typeof value === "string" ? value : "";
  }
  const rawGithubRepo = rawCloudRunString("githubRepo");
  const githubRepoError =
    rawGithubRepo.length > 0 && !GITHUB_REPO_REGEX.test(rawGithubRepo)
      ? "Expected owner/repo (e.g. nikki/wordlark)"
      : null;

  // Runtime SA account_id validation. Two cases the user can hit:
  // (1) override IS filled in but doesn't match GCP's rules → show what
  //     the rule is so the user can fix the string.
  // (2) override is blank AND the auto-derived `${serviceNamePrefix}-runtime`
  //     would exceed GCP's 30-char limit → tell the user the autoderived
  //     value won't fit and they need to set the override.
  // Both surface inline as `error` on the TextInput so the user doesn't
  // discover the problem via a confusing gcloud failure during Setup Infra.
  const rawRuntimeServiceAccount = rawCloudRunString("runtimeServiceAccountName");
  const autoDerivedRuntimeServiceAccount = `${cloudRunOverrides.serviceNamePrefix}-runtime`;
  const runtimeServiceAccountError = (() => {
    if (rawRuntimeServiceAccount.length > 0) {
      return GCP_SERVICE_ACCOUNT_ID_REGEX.test(rawRuntimeServiceAccount)
        ? null
        : `Must be 6–${GCP_SERVICE_ACCOUNT_ID_MAX_LENGTH} chars, lowercase, start with a letter, end with letter/digit, only [a-z0-9-].`;
    }
    if (autoDerivedRuntimeServiceAccount.length > GCP_SERVICE_ACCOUNT_ID_MAX_LENGTH) {
      return `Auto-derived "${autoDerivedRuntimeServiceAccount}" is ${autoDerivedRuntimeServiceAccount.length} chars (over GCP's ${GCP_SERVICE_ACCOUNT_ID_MAX_LENGTH}-char limit). Set an override below (e.g. \`runtime\`).`;
    }
    return null;
  })();

  // Story 45.4.7 — lazy-generate the per-major-version GCP project id suffix.
  // 36^5 = ~60M combinations is plenty for one-developer collision avoidance;
  // generated client-side via crypto.getRandomValues and persisted via the
  // idempotent EnsureVersionedProjectIdentifier command (never overwrites
  // existing entries, so worktrees / `git checkout v1.0.0` keep their
  // historical suffix).
  function generateProjectIdSuffix(): string {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] % 60466176).toString(36).padStart(5, "0");
  }

  useEffect(() => {
    if (
      !gameProjectId ||
      !gameProject ||
      selectedTargetId !== "google-cloud-run"
    ) {
      return;
    }
    const key = `v${gameProject.majorVersion}`;
    if (gameProject.versionedProjectIdentifiers[key]) return;
    onCommand({
      kind: "EnsureVersionedProjectIdentifier",
      target: {
        aggregateKind: "game-project",
        aggregateId: gameProjectId
      },
      subject: {
        subjectKind: "game-project",
        subjectId: gameProjectId
      },
      payload: {
        majorVersion: gameProject.majorVersion,
        suffix: generateProjectIdSuffix()
      }
    });
    // onCommand is stable from props; gameProject changes drive re-eval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gameProjectId,
    selectedTargetId,
    gameProject?.majorVersion,
    gameProject?.versionedProjectIdentifiers
  ]);

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

  // Story 45.4.5 — probe the resolved GCP project id and let the result drive
  // both the Create GCP Project button's state and the Setup Infra gate. The
  // resolved id comes from the same normalizer the tfvars generator uses, so
  // probe / create / terraform all hit the same project.
  const resolvedGcpProjectId = cloudRunOverrides.projectId;

  async function probeProject() {
    if (!resolvedGcpProjectId) return;
    setProbeState({ phase: "probing", status: null, message: null });
    try {
      const response = await fetch("/__sugardeploy/probe-gcp-project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: resolvedGcpProjectId })
      });
      const payload = (await response
        .json()
        .catch(() => null)) as {
        ok?: boolean;
        status?: GcpProjectProbeStatus;
        message?: string;
      } | null;
      setProbeState({
        phase: "done",
        status: payload?.status ?? "unknown",
        message:
          payload?.message ??
          (response.ok ? null : `Probe failed (HTTP ${response.status}).`)
      });
    } catch (error) {
      setProbeState({
        phase: "done",
        status: "unknown",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  useEffect(() => {
    if (
      selectedTargetId === "google-cloud-run" &&
      resolvedGcpProjectId &&
      hostActionsAvailable
    ) {
      void probeProject();
    } else {
      setProbeState({ phase: "idle", status: null, message: null });
    }
    // probeProject closes over the resolved id; re-run on id / target change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTargetId, resolvedGcpProjectId, hostActionsAvailable]);

  async function handleCreateGcpProjectClick() {
    if (!gameProject || !resolvedGcpProjectId) return;
    setCreateState((prev) => ({
      ...prev,
      phase: "listing-billing",
      error: null,
      result: null
    }));
    try {
      const response = await fetch("/__sugardeploy/list-billing-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        accounts?: BillingAccountSummary[];
        message?: string;
      } | null;
      if (!response.ok || !payload?.ok) {
        setCreateState((prev) => ({
          ...prev,
          phase: "idle",
          error:
            payload?.message ??
            `list-billing-accounts failed (HTTP ${response.status}).`
        }));
        return;
      }
      const accounts = payload.accounts ?? [];
      if (accounts.length === 0) {
        setCreateState((prev) => ({
          ...prev,
          phase: "idle",
          error:
            "No open billing accounts found. Create one at https://console.cloud.google.com/billing then retry."
        }));
        return;
      }
      if (accounts.length === 1) {
        // Single open account — auto-pick, no modal.
        await runCreateProject(accounts[0].id);
        return;
      }
      // 2+ open accounts — open the selector modal.
      setCreateState((prev) => ({
        ...prev,
        phase: "picking-billing",
        billingAccounts: accounts,
        selectedBillingAccountId: accounts[0].id,
        error: null
      }));
    } catch (error) {
      setCreateState((prev) => ({
        ...prev,
        phase: "idle",
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  async function runCreateProject(billingAccountId: string) {
    if (!gameProject || !resolvedGcpProjectId) return;
    setCreateState((prev) => ({
      ...prev,
      phase: "creating",
      selectedBillingAccountId: billingAccountId,
      error: null
    }));
    try {
      const response = await fetch("/__sugardeploy/create-gcp-project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: resolvedGcpProjectId,
          displayName: gameProject.displayName,
          majorVersion: gameProject.majorVersion,
          billingAccountId
        })
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        stdout?: string;
        stderr?: string;
      } | null;
      const ok = response.ok && payload?.ok === true;
      setCreateState((prev) => ({
        ...prev,
        phase: "result",
        result: {
          ok,
          message:
            payload?.message ??
            (ok
              ? "GCP project ready."
              : `create-gcp-project failed (HTTP ${response.status}).`),
          stdout: payload?.stdout,
          stderr: payload?.stderr
        }
      }));
      if (ok) {
        // Re-probe so the button flips to "GCP Project ready ✓".
        await probeProject();
      }
    } catch (error) {
      setCreateState((prev) => ({
        ...prev,
        phase: "result",
        result: {
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        }
      }));
    }
  }

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

  // Story 45.4.5: derive the Create GCP Project button's label / variant /
  // disabled state from probe + create phases. Precedence: in-flight create
  // > in-flight billing list > in-flight probe > final probe status.
  const createButtonInfo: {
    label: string;
    variant: "filled" | "subtle" | "outline";
    color?: string;
    loading: boolean;
    disabled: boolean;
  } = (() => {
    if (createState.phase === "creating") {
      return {
        label: "Creating GCP Project…",
        variant: "filled",
        loading: true,
        disabled: true
      };
    }
    if (createState.phase === "listing-billing") {
      return {
        label: "Looking up billing…",
        variant: "filled",
        loading: true,
        disabled: true
      };
    }
    if (probeState.phase === "probing") {
      return {
        label: "Checking GCP Project…",
        variant: "subtle",
        loading: true,
        disabled: true
      };
    }
    if (probeState.status === "owned") {
      return {
        label: "GCP Project ready ✓",
        variant: "subtle",
        loading: false,
        disabled: true
      };
    }
    return {
      label: "Create GCP Project",
      variant: "filled",
      loading: false,
      disabled: actionsDisabled
    };
  })();

  const setupInfraBlockedByProbe =
    selectedTargetId === "google-cloud-run" && probeState.status !== "owned";

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
            description="Leave blank to auto-derive from project identity and major version."
            placeholder={cloudRunOverrides.projectId}
            value={rawCloudRunString("projectId")}
            onChange={(event) =>
              updateTargetOverrides("google-cloud-run", {
                projectId: event.currentTarget.value
              })
            }
          />
          <TextInput
            label="Region"
            description="GCP region for Cloud Run and Artifact Registry."
            placeholder={cloudRunOverrides.region}
            value={rawCloudRunString("region")}
            onChange={(event) =>
              updateTargetOverrides("google-cloud-run", {
                region: event.currentTarget.value
              })
            }
          />
          <TextInput
            label="Service Name Prefix"
            description="Leave blank to auto-derive from project identity and major version. Used for Artifact Registry repo, Secret Manager containers, and the WIF pool name."
            placeholder={cloudRunOverrides.serviceNamePrefix}
            value={rawCloudRunString("serviceNamePrefix")}
            onChange={(event) =>
              updateTargetOverrides("google-cloud-run", {
                serviceNamePrefix: event.currentTarget.value
              })
            }
          />
          <TextInput
            label="GitHub Repository"
            description="owner/repo form. Drives the Workload Identity Federation binding so GitHub Actions in this repo can deploy. Pasting a full GitHub URL or git@ clone URL is fine — the prefix and trailing .git get stripped automatically."
            placeholder="nikki/wordlark"
            value={rawGithubRepo}
            error={githubRepoError}
            onChange={(event) =>
              updateTargetOverrides("google-cloud-run", {
                githubRepo: stripGithubRepoPrefixes(event.currentTarget.value)
              })
            }
          />
          <TextInput
            label="Runtime Service Account Name"
            description="Optional. The account_id (left of @) for the Cloud Run runtime service account. Leave blank to auto-derive as ${serviceNamePrefix}-runtime."
            placeholder={autoDerivedRuntimeServiceAccount}
            value={rawRuntimeServiceAccount}
            error={runtimeServiceAccountError}
            onChange={(event) =>
              updateTargetOverrides("google-cloud-run", {
                runtimeServiceAccountName: event.currentTarget.value
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
        {selectedTargetId === "google-cloud-run" ? (
          <Group>
            <Tooltip
              label={
                probeState.status === "owned"
                  ? `\`${resolvedGcpProjectId}\` is provisioned and ready.`
                  : probeState.status === "unknown"
                    ? probeState.message ?? "Could not determine project ownership."
                    : "Run gcloud projects create + billing link + services enable. Idempotent — safe to re-run."
              }
              withinPortal
              multiline
              w={320}
            >
              <Button
                size="xs"
                variant={createButtonInfo.variant}
                color={createButtonInfo.color}
                onClick={handleCreateGcpProjectClick}
                loading={createButtonInfo.loading}
                disabled={createButtonInfo.disabled}
              >
                {createButtonInfo.label}
              </Button>
            </Tooltip>
            <Tooltip
              label={
                actionBlockedReason ??
                "Create the GCP Project first — Setup Infra runs terraform against it."
              }
              disabled={!setupInfraBlockedByProbe && !actionsDisabled}
              withinPortal
              multiline
              w={320}
            >
              <Button
                size="xs"
                variant="filled"
                onClick={() => runAction("setup-infra")}
                loading={
                  actionState.running && actionState.kind === "setup-infra"
                }
                disabled={actionsDisabled || setupInfraBlockedByProbe}
                title="Run terraform init + apply against the GCP project to stand up Artifact Registry, runtime SA, IAM, WIF, and empty Secret Manager containers. Idempotent — safe to re-run."
              >
                Setup Infra
              </Button>
            </Tooltip>
            <Button
              size="xs"
              variant="outline"
              color="red"
              onClick={() => {
                const confirmed = window.confirm(
                  "Teardown Infra will delete every declared Cloud Run service in this project AND run `terraform destroy` against all SugarDeploy-managed infrastructure (Artifact Registry, runtime SA, IAM bindings, WIF, Secret Manager containers).\n\n" +
                    "Secret VALUES are destroyed with the containers. The GCP project itself stays.\n\n" +
                    "This is destructive. Proceed?"
                );
                if (confirmed) runAction("teardown-infra");
              }}
              loading={
                actionState.running && actionState.kind === "teardown-infra"
              }
              disabled={actionsDisabled}
              title="Delete Cloud Run services first, then `terraform destroy`. The GCP project itself is not deleted (use `gcloud projects delete` for that)."
            >
              Teardown Infra
            </Button>
          </Group>
        ) : null}
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

      {createState.error ? (
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
              Create GCP Project failed
            </Text>
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {createState.error}
            </Text>
          </Stack>
        </Box>
      ) : null}

      {createState.result ? (
        <Box
          p="md"
          style={{
            background: createState.result.ok
              ? "rgba(30, 110, 50, 0.28)"
              : "rgba(160, 40, 40, 0.28)",
            border: createState.result.ok
              ? "1px solid rgba(70, 180, 90, 0.45)"
              : "1px solid rgba(220, 80, 80, 0.45)",
            borderRadius: 8
          }}
        >
          <Stack gap="xs">
            <Text fw={700} size="sm">
              {createState.result.ok
                ? "Create GCP Project succeeded"
                : "Create GCP Project failed"}
            </Text>
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {createState.result.message}
            </Text>
            {createState.result.stdout?.trim() ? (
              <Code block>{createState.result.stdout}</Code>
            ) : null}
            {createState.result.stderr?.trim() ? (
              <Code block>{createState.result.stderr}</Code>
            ) : null}
          </Stack>
        </Box>
      ) : null}

      <Modal
        opened={createState.phase === "picking-billing"}
        onClose={() =>
          setCreateState((prev) => ({ ...prev, phase: "idle" }))
        }
        title="Select Billing Account"
        centered
        size="md"
      >
        <Stack>
          <Text size="sm">
            More than one open billing account on this host. Pick the one to
            charge for{" "}
            <Code>{resolvedGcpProjectId}</Code>.
          </Text>
          <Select
            label="Billing Account"
            data={createState.billingAccounts.map((acct) => ({
              value: acct.id,
              label: `${acct.displayName} (${acct.id})`
            }))}
            value={createState.selectedBillingAccountId}
            onChange={(value) =>
              setCreateState((prev) => ({
                ...prev,
                selectedBillingAccountId: value
              }))
            }
          />
          <Group justify="flex-end">
            <Button
              variant="light"
              onClick={() =>
                setCreateState((prev) => ({ ...prev, phase: "idle" }))
              }
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (createState.selectedBillingAccountId) {
                  void runCreateProject(createState.selectedBillingAccountId);
                }
              }}
              disabled={!createState.selectedBillingAccountId}
            >
              Use This Account
            </Button>
          </Group>
        </Stack>
      </Modal>

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
