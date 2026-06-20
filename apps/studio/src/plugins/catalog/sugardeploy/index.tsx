import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
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
  collectSecretEnvBindings,
  listDeploymentTargets,
  normalizeGoogleCloudRunDeploymentTargetOverrides,
  normalizeLocalDeploymentTargetOverrides,
  planGameDeployment,
  type SecretEnvBinding,
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

// Story 45.5 — per-secret status pulled from /__sugardeploy/secret-status.
// "loading" while the fetch is in flight; "ready" after the response arrives
// (with isSet + version metadata); "error" when the probe itself fails. The
// "missing" sub-state in ready handles the case where the Secret Manager
// container itself doesn't exist yet (Setup Infra hasn't run).
type SecretStatusState =
  | { phase: "loading" }
  | {
      phase: "ready";
      isSet: boolean;
      latestVersion: string | null;
      createdAt: string | null;
      containerMissing: boolean;
      message: string;
    }
  | { phase: "error"; message: string };

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

// Story 45.5 — Set Value modal body. Lives at module scope so it has its
// own component lifecycle: when the modal closes, this unmounts, and the
// typed `value` in its useState vanishes. The parent NEVER holds the
// value — it lives only in this child's local state while the modal is
// open, then it's gone. Submit hands the value to onSubmit (which calls
// the network) and the variable goes out of scope as soon as the submit
// settles. The PasswordInput's masked-by-default + reveal toggle is the
// UX cue that this is a secret.
interface SecretValueFormProps {
  secretKey: string;
  secretManagerName: string;
  envVarName: string;
  submitting: boolean;
  error: string | null;
  onSubmit(value: string): void;
  onCancel(): void;
}
function SecretValueForm(props: SecretValueFormProps) {
  const [value, setValue] = useState("");
  const tooLong = value.length > 0 && new Blob([value]).size > 64 * 1024;
  const canSubmit = !props.submitting && value.length > 0 && !tooLong;
  return (
    <Stack>
      <Stack gap={2}>
        <Text size="sm">
          Writing a new version to <Code>{props.secretManagerName}</Code>.
        </Text>
        <Text size="xs" c="var(--sm-color-subtext)">
          Bound to env var <Code>{props.envVarName}</Code> at request time. The
          value is sent via stdin to <Code>gcloud secrets versions add</Code>;
          it never appears in argv, shell history, or Studio logs.
        </Text>
      </Stack>
      <PasswordInput
        label="Value"
        description={`Max 64 KiB. Pasting fine; the field is masked by default.`}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        error={
          tooLong
            ? "Value exceeds 64 KiB (Secret Manager's per-version limit)."
            : null
        }
        autoFocus
      />
      {props.error ? (
        <Text size="sm" c="red">
          {props.error}
        </Text>
      ) : null}
      <Group justify="flex-end">
        <Button variant="light" onClick={props.onCancel} disabled={props.submitting}>
          Cancel
        </Button>
        <Button
          onClick={() => props.onSubmit(value)}
          loading={props.submitting}
          disabled={!canSubmit}
        >
          Set Value
        </Button>
      </Group>
    </Stack>
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

  // Story 45.7 — template-drift probe. Reads the on-disk
  // `# SUGARMAGIC TEMPLATE VERSION:` stamp and compares against the
  // plugin's current CLOUD_RUN_TEMPLATE_VERSION. When on-disk is older,
  // the banner renders non-blockingly above the action buttons. State is
  // tri-mode: `idle` before we know the result, `loaded` with the parsed
  // numbers, `error` if the host route failed (banner hides — no false
  // positives from a flaky probe).
  const [templateDriftState, setTemplateDriftState] = useState<{
    phase: "idle" | "loaded" | "error";
    onDiskVersion: number | null;
    currentVersion: number | null;
    fileExists: boolean;
  }>({
    phase: "idle",
    onDiskVersion: null,
    currentVersion: null,
    fileExists: false
  });

  // Story 45.5 — Secrets section state. Status is per-secret (keyed by
  // secretKey). Set-Value modal holds the secretKey it's open for and a
  // submitting flag; the typed VALUE lives only inside the SecretValueForm
  // child (which unmounts on close), so the parent never holds plaintext.
  const [secretStatusByKey, setSecretStatusByKey] = useState<
    Record<string, SecretStatusState>
  >({});
  const [setValueModalState, setSetValueModalState] = useState<{
    open: boolean;
    secretKey: string | null;
    submitting: boolean;
    error: string | null;
    lastResultMessage: string | null;
  }>({
    open: false,
    secretKey: null,
    submitting: false,
    error: null,
    lastResultMessage: null
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
      // When the payload has the full DeploymentActionExecutionResult shape
      // (descriptor + exitCode + stdout + stderr + message), surface IT
      // regardless of HTTP status. A 500 with a structured payload means the
      // script ran and failed cleanly — the stdout/stderr are what the user
      // actually needs to see, not "HTTP 500." Only the malformed-response
      // path gets the error-string fallback.
      if (isDeploymentActionExecutionResult(payload)) {
        setActionState({
          kind: actionKind,
          result: payload,
          error: null,
          running: false
        });
        // Story 45.7 — Setup Infra (and any other action that touches the
        // template-stamped file) regenerates main.tf, so re-probe the
        // template version once the action settles. Cheap (one fs read)
        // and the banner needs to clear without a manual refresh.
        if (payload.ok) {
          void probeTemplateVersion();
        }
        return;
      }
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

  // Story 45.7 — template-drift probe (POST /__sugardeploy/template-version
  // → reads the on-disk stamp). Triggers: mount (when working dir + cloud
  // run target resolve), workingDirectory change, and every successful
  // action (because Setup Infra / Deploy can both leave behind a freshly
  // regenerated `main.tf` from a current template). Save-triggered
  // regeneration is picked up via the managedFiles ref change.
  const cloudRunWorkingDirectory = cloudRunOverrides.workingDirectory;
  async function probeTemplateVersion() {
    if (!cloudRunWorkingDirectory) return;
    try {
      const response = await fetch("/__sugardeploy/template-version", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workingDirectory: cloudRunWorkingDirectory })
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        fileExists?: boolean;
        onDiskVersion?: number | null;
        currentVersion?: number | null;
      } | null;
      if (!payload?.ok) {
        setTemplateDriftState({
          phase: "error",
          onDiskVersion: null,
          currentVersion: null,
          fileExists: false
        });
        return;
      }
      setTemplateDriftState({
        phase: "loaded",
        onDiskVersion: payload.onDiskVersion ?? null,
        currentVersion: payload.currentVersion ?? null,
        fileExists: payload.fileExists ?? false
      });
    } catch {
      setTemplateDriftState({
        phase: "error",
        onDiskVersion: null,
        currentVersion: null,
        fileExists: false
      });
    }
  }

  useEffect(() => {
    if (
      selectedTargetId === "google-cloud-run" &&
      cloudRunWorkingDirectory &&
      hostActionsAvailable
    ) {
      void probeTemplateVersion();
    } else {
      setTemplateDriftState({
        phase: "idle",
        onDiskVersion: null,
        currentVersion: null,
        fileExists: false
      });
    }
    // probeTemplateVersion closes over the working dir; re-run on
    // workingDir / target change AND on managedFiles ref change so a
    // save-triggered regeneration clears the banner without manual refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedTargetId,
    cloudRunWorkingDirectory,
    hostActionsAvailable,
    plan?.managedFiles
  ]);

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

  // Story 45.5 — Secrets section. Bindings come from the plan +
  // serviceNamePrefix (single source of truth shared with terraform tfvars
  // generator + deploy.sh generator + the host-side resolveSecretContext).
  // Empty array when no enabled plugin declares secrets.
  const secretBindings: SecretEnvBinding[] =
    plan && selectedTargetId === "google-cloud-run" && cloudRunOverrides.serviceNamePrefix
      ? collectSecretEnvBindings(plan, cloudRunOverrides.serviceNamePrefix)
      : [];
  const secretBindingsKey = secretBindings.map((b) => b.secretKey).join("|");

  async function fetchSecretStatus(secretKey: string) {
    if (!gameProject) return;
    setSecretStatusByKey((prev) => ({
      ...prev,
      [secretKey]: { phase: "loading" }
    }));
    try {
      const response = await fetch("/__sugardeploy/secret-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secretKey, gameProject })
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        isSet?: boolean;
        latestVersion?: string | null;
        createdAt?: string | null;
        message?: string;
        stderr?: string;
      } | null;
      if (!response.ok && !payload?.ok) {
        setSecretStatusByKey((prev) => ({
          ...prev,
          [secretKey]: {
            phase: "error",
            message: payload?.message ?? `HTTP ${response.status}`
          }
        }));
        return;
      }
      // ok=true with isSet=false + a "container does not exist" message
      // means terraform hasn't created the container yet; surface that as
      // a distinct state so the UI can suggest Setup Infra.
      const containerMissing = !payload?.isSet && /container .* does not exist/i.test(
        payload?.message ?? ""
      );
      setSecretStatusByKey((prev) => ({
        ...prev,
        [secretKey]: {
          phase: "ready",
          isSet: payload?.isSet === true,
          latestVersion: payload?.latestVersion ?? null,
          createdAt: payload?.createdAt ?? null,
          containerMissing,
          message: payload?.message ?? ""
        }
      }));
    } catch (error) {
      setSecretStatusByKey((prev) => ({
        ...prev,
        [secretKey]: {
          phase: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      }));
    }
  }

  useEffect(() => {
    // Only probe statuses when the GCP project is owned AND we're on the
    // Cloud Run target. Before Setup Infra, the Secret Manager containers
    // don't exist; the per-secret probe would noise-up with "container
    // missing" for every secret. Defer until ownership flips to owned.
    if (
      !hostActionsAvailable ||
      selectedTargetId !== "google-cloud-run" ||
      probeState.status !== "owned" ||
      secretBindings.length === 0
    ) {
      return;
    }
    for (const binding of secretBindings) {
      void fetchSecretStatus(binding.secretKey);
    }
    // secretBindingsKey collapses the binding array identity to a stable
    // signature that only changes when the set of declared secrets changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedTargetId,
    probeState.status,
    secretBindingsKey,
    hostActionsAvailable
  ]);

  function openSetValueModal(secretKey: string) {
    setSetValueModalState({
      open: true,
      secretKey,
      submitting: false,
      error: null,
      lastResultMessage: null
    });
  }

  function closeSetValueModal() {
    // Reset the entire modal state on close. This unmounts SecretValueForm,
    // which is the component that holds the typed VALUE in its own state —
    // unmounting clears that state, so the value never persists past the
    // modal lifecycle. This is the architectural promise: parent state
    // never touches the value, child state vanishes on close.
    setSetValueModalState({
      open: false,
      secretKey: null,
      submitting: false,
      error: null,
      lastResultMessage: null
    });
  }

  async function submitSecretValue(secretKey: string, value: string) {
    if (!gameProject) return;
    setSetValueModalState((prev) => ({
      ...prev,
      submitting: true,
      error: null,
      lastResultMessage: null
    }));
    try {
      const response = await fetch("/__sugardeploy/set-secret-value", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secretKey, value, gameProject })
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
      } | null;
      const ok = response.ok && payload?.ok === true;
      if (!ok) {
        setSetValueModalState((prev) => ({
          ...prev,
          submitting: false,
          error: payload?.message ?? `HTTP ${response.status}`,
          lastResultMessage: null
        }));
        return;
      }
      // Success: close the modal (which unmounts the form holding the value
      // in its local state) and re-fetch the secret's status so the UI
      // updates to "Set ✓". The value variable goes out of scope here.
      closeSetValueModal();
      await fetchSecretStatus(secretKey);
    } catch (error) {
      setSetValueModalState((prev) => ({
        ...prev,
        submitting: false,
        error: error instanceof Error ? error.message : String(error),
        lastResultMessage: null
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
          <Select
            label="Gateway Auth Mode"
            description='"none" leaves the deployed gateway publicly reachable — fine for verification, dangerous for plugin routes that cost money. "bearer" gates every route except /health behind a shared deployment secret (gateway-shared-token); set the value via the Secrets section. Plan 046 expands this enum with real per-user identity providers (Supabase, Auth0, etc.).'
            data={[
              { value: "none", label: "None (public, no auth check)" },
              { value: "bearer", label: "Bearer (shared deployment token)" }
            ]}
            value={cloudRunOverrides.gatewayAuthMode}
            onChange={(value) =>
              updateTargetOverrides("google-cloud-run", {
                gatewayAuthMode:
                  value === "bearer" ? "bearer" : "none"
              })
            }
          />
        </Stack>
      ) : null}

      {selectedTargetId === "google-cloud-run" ? (
        <Stack gap="xs">
          <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
            Secrets
          </Text>
          {secretBindings.length === 0 ? (
            <Text size="sm" c="var(--sm-color-overlay0)">
              No enabled plugins declare secrets. Enable SugarAgent (or another
              secret-declaring plugin) to populate this list.
            </Text>
          ) : probeState.status !== "owned" ? (
            <Text size="sm" c="var(--sm-color-overlay0)">
              Create the GCP Project and run Setup Infra first — Secret Manager
              containers are created by terraform and can't be probed before
              they exist.
            </Text>
          ) : (
            secretBindings.map((binding) => {
              const status = secretStatusByKey[binding.secretKey];
              return (
                <Group
                  key={binding.secretKey}
                  justify="space-between"
                  wrap="nowrap"
                  align="flex-start"
                  p="sm"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 6
                  }}
                >
                  <Stack gap={2} style={{ minWidth: 0 }}>
                    <Group gap="xs" wrap="nowrap">
                      <Code>{binding.secretKey}</Code>
                      {status?.phase === "ready" && status.isSet ? (
                        <Badge color="green" variant="light">
                          Set ✓{" "}
                          {status.latestVersion
                            ? `(v${status.latestVersion})`
                            : ""}
                        </Badge>
                      ) : status?.phase === "ready" && status.containerMissing ? (
                        <Badge color="yellow" variant="light">
                          Container missing
                        </Badge>
                      ) : status?.phase === "ready" ? (
                        <Badge color="gray" variant="light">
                          Not Set
                        </Badge>
                      ) : status?.phase === "loading" ? (
                        <Badge color="gray" variant="light">
                          Checking…
                        </Badge>
                      ) : status?.phase === "error" ? (
                        <Badge color="red" variant="light">
                          Probe error
                        </Badge>
                      ) : null}
                    </Group>
                    <Text size="xs" c="var(--sm-color-subtext)">
                      <Code>{binding.secretManagerName}</Code> · binds to{" "}
                      <Code>{binding.envVarName}</Code>
                    </Text>
                    {status?.phase === "error" ? (
                      <Text size="xs" c="red">
                        {status.message}
                      </Text>
                    ) : null}
                  </Stack>
                  <Button
                    size="xs"
                    onClick={() => openSetValueModal(binding.secretKey)}
                    disabled={
                      status?.phase === "ready" && status.containerMissing
                    }
                  >
                    Set Value
                  </Button>
                </Group>
              );
            })
          )}
        </Stack>
      ) : null}

      <Stack gap="xs">
        <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
          Deployment Actions
        </Text>
        {/* Story 45.7 — non-blocking template-drift banner. Only renders
            when we have a confirmed older on-disk stamp; absent / parse-
            failed / equal / newer → no banner (avoid false positives that
            would train the user to ignore it). Save or Setup Infra
            regenerates the file and the next probe clears this. */}
        {selectedTargetId === "google-cloud-run" &&
        templateDriftState.phase === "loaded" &&
        templateDriftState.fileExists &&
        templateDriftState.onDiskVersion !== null &&
        templateDriftState.currentVersion !== null &&
        templateDriftState.onDiskVersion < templateDriftState.currentVersion ? (
          <Alert color="yellow" variant="light" title="Template drift">
            <Text size="sm">
              The on-disk terraform template stamp is{" "}
              <Code>v{templateDriftState.onDiskVersion}</Code>; the current
              SugarDeploy template is{" "}
              <Code>v{templateDriftState.currentVersion}</Code>. Save the
              project (or run Setup Infra) to regenerate{" "}
              <Code>main.tf</Code> with the current template; the banner
              will clear automatically.
            </Text>
          </Alert>
        ) : null}
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
            variant="subtle"
            onClick={() => runAction("health")}
            loading={actionState.running && actionState.kind === "health"}
            disabled={actionsDisabled}
          >
            Health
          </Button>
          <Button
            size="xs"
            variant="filled"
            color="red"
            onClick={() => runAction("destroy")}
            loading={actionState.running && actionState.kind === "destroy"}
            disabled={actionsDisabled}
          >
            Destroy
          </Button>
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

      <Modal
        opened={setValueModalState.open}
        onClose={closeSetValueModal}
        title={
          setValueModalState.secretKey
            ? `Set value for ${setValueModalState.secretKey}`
            : "Set value"
        }
        centered
        size="md"
      >
        {setValueModalState.open && setValueModalState.secretKey ? (
          (() => {
            const binding = secretBindings.find(
              (b) => b.secretKey === setValueModalState.secretKey
            );
            if (!binding) {
              return (
                <Text size="sm" c="red">
                  Couldn't find binding for{" "}
                  <Code>{setValueModalState.secretKey}</Code> — the plan may
                  have changed since the modal opened.
                </Text>
              );
            }
            return (
              <SecretValueForm
                secretKey={binding.secretKey}
                secretManagerName={binding.secretManagerName}
                envVarName={binding.envVarName}
                submitting={setValueModalState.submitting}
                error={setValueModalState.error}
                onCancel={closeSetValueModal}
                onSubmit={(value) =>
                  void submitSecretValue(binding.secretKey, value)
                }
              />
            );
          })()
        ) : null}
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
