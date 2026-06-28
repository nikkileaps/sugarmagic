import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Menu,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Tooltip
} from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { DeploymentSettings } from "@sugarmagic/domain";
import {
  buildSetVersionedProjectIdentifierCommand,
  buildAppendDeployHistoryCommand,
  buildUpdateDeployHistoryEntryCommand,
  buildUpdateDeploymentSettingsCommand,
  type DeploymentActionExecutionResult,
  type DeploymentActionKind,
  GCP_SERVICE_ACCOUNT_ID_MAX_LENGTH,
  GCP_SERVICE_ACCOUNT_ID_REGEX,
  GITHUB_REPO_REGEX,
  collectSecretEnvBindings,
  deriveEffectiveGatewayAuthMode,
  getDeployHistory,
  getDeploymentSettings,
  getPublishSettings,
  getVersionedProjectIdentifiers,
  type GroupedVersionMajor,
  isValidNetlifySiteId,
  listDeploymentTargets,
  listFrontendDeploymentTargets,
  normalizeGoogleCloudRunDeploymentTargetOverrides,
  normalizeLocalDeploymentTargetOverrides,
  normalizeNetlifyDeploymentTargetOverrides,
  planGameDeployment,
  type SecretEnvBinding,
  stripGithubRepoPrefixes,
  SUGARDEPLOY_PLUGIN_ID
} from "@sugarmagic/plugins";
import type {
  PluginWorkspaceViewProps,
  StudioPluginWorkspaceDefinition
} from "../../sdk";

/**
 * Story 46.5 — SugarDeploy's Provision / Release / Deploy publish
 * workspaces are all rendered by SugarDeployCenterPanel; the `view`
 * prop tells it which slice to show.
 *
 *   - "provision": stand-up surface. Sources (working dir + GitHub
 *     repo), Targets (Local / Cloud Run with all per-target settings),
 *     Secrets, Create-GCP-Project + Setup-Infra + Teardown-Infra
 *     buttons, the template-drift banner, plan warnings + conflicts +
 *     requirement sources. The "what's wired up" side of the plugin.
 *
 *   - "release": cut-new-major-version surface. Version metadata +
 *     history with the Release-New-Version trigger; the cut saga
 *     modal renders on top.
 *
 *   - "deploy": daily-driver surface. Health + Status chips and
 *     Deploy + Destroy buttons; inline result/error boxes for those
 *     actions plus the chip-result modal.
 *
 * The combo-context badge row (version > publish target / deployment
 * target) renders in all three views as a slim header so the user
 * always sees what they're operating on.
 */
type SugarDeployView = "provision" | "release" | "deploy";

type SugarDeployCenterPanelProps = PluginWorkspaceViewProps & {
  view: SugarDeployView;
};

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
  const { gameProjectId, gameProject, onCommand, requestSave, view } = props;
  const isProvision = view === "provision";
  const isRelease = view === "release";
  const isDeploy = view === "deploy";
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
  // Story 46.7 — extended to also carry the GHA workflow drift signal
  // (workflowOnDiskVersion < workflowCurrentVersion). Both signals come
  // from the same probe endpoint, so they live on the same state slot.
  const [templateDriftState, setTemplateDriftState] = useState<{
    phase: "idle" | "loaded" | "error";
    onDiskVersion: number | null;
    currentVersion: number | null;
    fileExists: boolean;
    workflowOnDiskVersion: number | null;
    workflowCurrentVersion: number | null;
    workflowFileExists: boolean;
  }>({
    phase: "idle",
    onDiskVersion: null,
    currentVersion: null,
    fileExists: false,
    workflowOnDiskVersion: null,
    workflowCurrentVersion: null,
    workflowFileExists: false
  });

  // Story 45.8.5 — Current Version panel chip state. Health auto-probes
  // silently on mount so the chip carries a meaningful colour the moment
  // the workspace opens; Status is on-click only since `gcloud run
  // services list` is multi-second and we don't want every mount to fan
  // out to GCP. Both update when the corresponding action runs through
  // the result-box flow (so clicking the chip surfaces the full stdout
  // in the existing result box AND refreshes the chip). `ok === null`
  // renders as grey "Unknown"; true → green; false → red.
  type ChipProbeState = {
    phase: "idle" | "probing" | "loaded";
    ok: boolean | null;
    message: string;
  };
  const [healthChip, setHealthChip] = useState<ChipProbeState>({
    phase: "idle",
    ok: null,
    message: "Not probed yet."
  });
  const [statusChip, setStatusChip] = useState<ChipProbeState>({
    phase: "idle",
    ok: null,
    message: "Click to query gcloud."
  });

  // Story 45.8.5 — chip-result modal. Clicking the Health or Status
  // chip in the Action Bar runs the matching action AND opens this
  // modal; the modal shows the result/error/stdout/stderr instead of
  // injecting a result box inline below the workspace (the chip is a
  // small affordance, not a fan-out trigger to a multi-second-output
  // section that's now stranded mid-workspace). Set to non-null to
  // open; null = closed.
  const [chipModalKind, setChipModalKind] = useState<
    "health" | "status" | null
  >(null);

  // Story 45.8 — Release New Version (Cut New Major Version) modal.
  // Phase machine drives the modal body: from `checking` (prepare host
  // action in flight) -> `ready` (preview the planned cut) -> `cutting`
  // (each step of the saga as it runs) -> `success` or `failed`. `null`
  // is "modal closed."
  type ReleaseModalState =
    | null
    | { phase: "checking" }
    | { phase: "preflight-failed"; reason: string }
    | {
        phase: "ready";
        priorMajor: number;
        newMajorVersion: number;
        newSuffix: string;
        newProjectId: string;
        newTagName: string;
        commitMessage: string;
        workingDirectory: string;
      }
    | {
        phase: "cutting";
        step: "tagging" | "bumping" | "persisting" | "committing";
        priorMajor: number;
        newMajorVersion: number;
        newTagName: string;
        commitMessage: string;
        workingDirectory: string;
        newSuffix: string;
      }
    | {
        phase: "success";
        newMajorVersion: number;
        newTagName: string;
        commitMessage: string;
      }
    | {
        phase: "failed";
        reason: string;
        recoveryNotes: string[];
      };
  const [releaseModalState, setReleaseModalState] = useState<ReleaseModalState>(null);

  // Story 46.12 — Tag Patch Version modal. Mirrors the cut-major
  // phase machine but stays git-only: no plugin-state changes, no
  // GCP project, no commit. The host endpoint runs all pre-flight
  // checks (clean tree, HEAD reachable from v{major}.0.0, base tag
  // exists) plus computes the next patch number; `dryRun: true`
  // returns the plan, `dryRun: false` actually creates the tag.
  type TagPatchModalState =
    | null
    | { phase: "checking" }
    | { phase: "preflight-failed"; reason: string }
    | {
        phase: "ready";
        major: number;
        nextTag: string;
        baseTag: string;
        workingDirectory: string;
      }
    | { phase: "tagging"; nextTag: string }
    | { phase: "success"; tagName: string }
    | { phase: "failed"; reason: string };
  const [tagPatchModalState, setTagPatchModalState] =
    useState<TagPatchModalState>(null);

  // Story 46.12 — live git tag list driving the version history
  // sub-rows. Plugin state tracks only major-version suffixes (a
  // GCP-slot concern); patch tags exist in git alone, fetched on
  // mount + after every Tag Patch action so the UI doesn't drift.
  const [versionTagsByMajor, setVersionTagsByMajor] = useState<
    GroupedVersionMajor[] | null
  >(null);
  const [versionTagsLoadError, setVersionTagsLoadError] = useState<string | null>(
    null
  );

  // Story 46.8 — Setup GitHub Workflow modal state machine.
  // - prompting: user enters NETLIFY_AUTH_TOKEN
  // - running: POST is in flight
  // - success: green panel with stdout
  // - failed: red panel with reason + stdout/stderr
  // The token value is held in modal-local state only; it's piped
  // straight to the host endpoint and never written into the project.
  type SetupGithubWorkflowModalState =
    | null
    | { phase: "prompting"; netlifyAuthToken: string }
    | { phase: "running" }
    | {
        phase: "success";
        message: string;
        stdout: string;
        stderr: string;
      }
    | {
        phase: "failed";
        reason: string;
        stdout: string;
        stderr: string;
      };
  const [setupGithubWorkflowState, setSetupGithubWorkflowState] =
    useState<SetupGithubWorkflowModalState>(null);
  const setupGithubWorkflowOpen = setupGithubWorkflowState !== null;
  const setupGithubWorkflowBusy =
    setupGithubWorkflowState?.phase === "running";

  // Story 053.6 — Deploy-workflow dispatch + poll state machine.
  // - preview: preflight is in flight (or has just returned); UI
  //   shows the deploy plan for BOTH repos (game + sugarmagic
  //   engine): branch, current head sha, files about to be
  //   auto-committed, untracked files skipped, ahead-of-remote
  //   count. nikki confirms the plan and dispatch executes it.
  // - preview-failed: preflight couldn't even read the state
  //   (missing tool, no upstream branch, etc.). Recoverable
  //   errors live here; dirty/unpushed are NOT failures anymore
  //   in this flow.
  // - dispatching: dispatch endpoint is in flight; it auto-commits,
  //   auto-pushes, then runs `gh workflow run`.
  // - dispatch-failed: dispatch returned ok=false (e.g. a git
  //   conflict during push, or gh workflow run failed).
  // - tracking: dispatched OK; polling status. `runId` keys the
  //   history entry the poll loop keeps fresh
  interface DeployPlanRepo {
    workingDirectory: string;
    branch: string;
    headSha: string;
    trackedDirtyFiles: string[];
    untrackedFiles: string[];
    aheadCount: number;
    hasUpstream: boolean;
  }
  interface DeployPlan {
    game: DeployPlanRepo;
    engine: DeployPlanRepo;
    upstreamWarnings: string[];
  }
  type DeployWorkflowState =
    | null
    | {
        phase: "preview";
        loading: boolean;
        ref?: string;
        headSha?: string;
        plan?: DeployPlan;
        reason?: string;
      }
    | { phase: "preview-failed"; reason: string }
    | { phase: "dispatching" }
    | { phase: "dispatch-failed"; reason: string; stdout: string; stderr: string }
    | {
        phase: "tracking";
        runId: number;
        runUrl: string;
        ref: string;
        headSha: string;
        status: string;
        conclusion: string | null;
        jobs: Array<{
          name: string;
          status: string;
          conclusion: string | null;
          url: string;
        }>;
      };
  const [deployWorkflowState, setDeployWorkflowState] =
    useState<DeployWorkflowState>(null);
  const deployWorkflowOpen = deployWorkflowState !== null;
  // Refs/timers for the poll loop — kept off React state so the
  // 4-second tick doesn't churn the whole component tree.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRunIdRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      activeRunIdRef.current = null;
    };
  }, []);
  const releaseModalOpen = releaseModalState !== null;
  const releaseModalBusy =
    releaseModalState?.phase === "checking" ||
    releaseModalState?.phase === "cutting";

  const tagPatchModalOpen = tagPatchModalState !== null;
  const tagPatchModalBusy =
    tagPatchModalState?.phase === "checking" ||
    tagPatchModalState?.phase === "tagging";

  // Story 45.8.5 — placeholder for the "+ add publish target" tab
  // that lands in plan 047. Today's data model carries a singular
  // publishTargetId; this modal makes the affordance discoverable
  // without lying about wired behaviour.
  const [addTargetModalOpen, setAddTargetModalOpen] = useState(false);

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
  // Story 45.7.5 — SugarDeploy state reads route through the plugin-state
  // helpers, NOT through `gameProject.deployment` / `gameProject.versionedProjectIdentifiers`.
  // The two top-level fields are being removed from GameProject; the
  // helpers handle the new-shape (pluginConfigurations slot) and
  // legacy-shape reads transparently.
  const deploymentSettings = gameProject
    ? getDeploymentSettings(gameProject)
    : null;
  // Story 46.2 — publish settings live in the SugarDeploy plugin slot
  // alongside deployment settings. Reads route through the typed
  // helper, NOT through `gameProject.deployment.publishTargetId`
  // (which no longer exists on the type).
  const publishSettings = gameProject ? getPublishSettings(gameProject) : null;
  const versionedProjectIdentifiers = gameProject
    ? getVersionedProjectIdentifiers(gameProject)
    : {};
  // Story 46.10 — deploy history (per-GHA-run rows). Persisted in the
  // SugarDeploy plugin slot; the live status of the in-flight row is
  // patched as the poll loop ticks.
  const deployHistory = gameProject ? getDeployHistory(gameProject) : [];
  const selectedTargetId =
    deploymentSettings?.backendDeploymentTargetId ?? null;
  // Story 46.6 — parallel frontend-target state. Frontend has no "local"
  // fallback (no equivalent of a docker-compose static host yet), so the
  // strip can legitimately be empty until the user adds Netlify via "+".
  const selectedFrontendTargetId =
    deploymentSettings?.frontendDeploymentTargetId ?? null;
  const netlifyOverrides = normalizeNetlifyDeploymentTargetOverrides(
    deploymentSettings?.targetOverrides.netlify
  );
  const netlifySiteIdInput =
    typeof deploymentSettings?.targetOverrides.netlify?.siteId === "string"
      ? (deploymentSettings.targetOverrides.netlify.siteId as string)
      : "";
  const netlifySiteIdError =
    netlifySiteIdInput.length > 0 && !isValidNetlifySiteId(netlifySiteIdInput)
      ? "Netlify site ids are lowercase hex + dashes, usually a UUID."
      : null;
  const localOverrides = normalizeLocalDeploymentTargetOverrides(
    deploymentSettings?.targetOverrides.local,
    gameProject ?? undefined
  );
  const cloudRunOverrides = normalizeGoogleCloudRunDeploymentTargetOverrides(
    deploymentSettings?.targetOverrides["google-cloud-run"],
    gameProject ?? undefined
  );
  // Raw persisted overrides (pre-normalize). Form fields bind their `value`
  // here so blank stays blank visually; the normalized value above shows up
  // as the placeholder so users can see what the auto-derived default would
  // be without it pretending to be their input.
  const rawCloudRunOverrides = (deploymentSettings?.targetOverrides[
    "google-cloud-run"
  ] ?? {}) as Record<string, unknown>;
  function rawCloudRunString(key: string): string {
    const value = rawCloudRunOverrides[key];
    return typeof value === "string" ? value : "";
  }
  // Story 45.8.5 — githubRepo lives on DeploymentSettings (project-level)
  // now, not in per-target overrides. Field reads from there directly.
  const rawGithubRepo = deploymentSettings?.githubRepo ?? "";
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
    // Story 45.7.5 — suffix register routes through the SugarDeploy
    // plugin-state slot via the typed builder. The builder is idempotent:
    // returns null when the entry for this major already exists (preserves
    // the historical-suffix-is-immutable rule from Story 45.4.7).
    const command = buildSetVersionedProjectIdentifierCommand(
      gameProject,
      gameProject.majorVersion,
      generateProjectIdSuffix()
    );
    if (command) onCommand(command);
    // onCommand is stable from props; gameProject changes drive re-eval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gameProjectId,
    selectedTargetId,
    gameProject?.majorVersion,
    gameProject?.pluginConfigurations
  ]);

  function updateSettings(nextSettings: DeploymentSettings) {
    if (!gameProjectId || !gameProject) return;
    // Story 45.7.5 — settings writes route through the plugin-state
    // builder, NOT the deprecated UpdateDeploymentSettings command. The
    // builder lands the settings in pluginConfigurations[id="sugardeploy"].config.
    onCommand(buildUpdateDeploymentSettingsCommand(gameProject, nextSettings));
  }

  function updateTarget(value: string | null) {
    if (!gameProject) return;
    const current = getDeploymentSettings(gameProject);
    updateSettings({
      ...current,
      backendDeploymentTargetId:
        value === "local" || value === "google-cloud-run" ? value : null
    });
  }

  function updateTargetOverrides(
    targetId: "local" | "google-cloud-run",
    patch: Record<string, unknown>
  ) {
    if (!gameProject) return;
    const current = getDeploymentSettings(gameProject);
    updateSettings({
      ...current,
      targetOverrides: {
        ...current.targetOverrides,
        [targetId]: {
          ...(current.targetOverrides[targetId] ?? {}),
          ...patch
        }
      }
    });
  }

  // Story 45.8.5 — "+" Targets-tab flow. Adds a target to the project
  // (so it persists as a tab even after switching away) AND makes it
  // the active target in one updateSettings call to avoid losing the
  // overrides write to React's batched state. The empty-record entry
  // is what keeps the target in `configured` after a tab switch.
  function addTarget(targetId: "local" | "google-cloud-run") {
    if (!gameProject) return;
    const current = getDeploymentSettings(gameProject);
    updateSettings({
      ...current,
      backendDeploymentTargetId: targetId,
      targetOverrides: {
        ...current.targetOverrides,
        [targetId]: current.targetOverrides[targetId] ?? {}
      }
    });
  }

  // Story 46.10 — deploy-workflow handlers. The modal hits these in
  // sequence: openDeployWorkflowModal() runs preflight, then on
  // confirm dispatchDeployWorkflow() POSTs the dispatch endpoint and
  // kicks off the status poll loop.
  async function openDeployWorkflowModal() {
    if (!gameProject || !deploymentSettings) return;
    setDeployWorkflowState({ phase: "preview", loading: true });
    try {
      const response = await fetch("/__sugardeploy/preflight-deploy-workflow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workingDirectory: deploymentSettings.workingDirectory ?? "",
          githubRepo: deploymentSettings.githubRepo ?? ""
        })
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        ref?: string;
        headSha?: string;
        plan?: DeployPlan;
        reason?: string;
      } | null;
      if (!payload?.ok) {
        setDeployWorkflowState({
          phase: "preview-failed",
          reason: payload?.reason ?? `HTTP ${response.status}`
        });
        return;
      }
      setDeployWorkflowState({
        phase: "preview",
        loading: false,
        ref: payload.ref,
        headSha: payload.headSha,
        plan: payload.plan
      });
    } catch (error) {
      setDeployWorkflowState({
        phase: "preview-failed",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function dispatchDeployWorkflow() {
    if (!gameProject || !deploymentSettings) return;
    setDeployWorkflowState({ phase: "dispatching" });
    try {
      const response = await fetch("/__sugardeploy/dispatch-deploy-workflow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workingDirectory: deploymentSettings.workingDirectory ?? "",
          githubRepo: deploymentSettings.githubRepo ?? ""
        })
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        runId?: number;
        runUrl?: string;
        ref?: string;
        headSha?: string;
        reason?: string;
        stdout?: string;
        stderr?: string;
      } | null;
      if (!payload?.ok || typeof payload.runId !== "number") {
        setDeployWorkflowState({
          phase: "dispatch-failed",
          reason: payload?.reason ?? `HTTP ${response.status}`,
          stdout: payload?.stdout ?? "",
          stderr: payload?.stderr ?? ""
        });
        return;
      }
      const runId = payload.runId;
      const runUrl = payload.runUrl ?? "";
      const ref = payload.ref ?? "";
      const headSha = payload.headSha ?? "";
      // Persist the dispatched run as a history entry. Subsequent
      // poll cycles update status/conclusion via
      // buildUpdateDeployHistoryEntryCommand below.
      onCommand(
        buildAppendDeployHistoryCommand(gameProject, {
          runId,
          runUrl,
          ref,
          headSha,
          dispatchedAt: new Date().toISOString(),
          status: "queued",
          conclusion: null
        })
      );
      setDeployWorkflowState({
        phase: "tracking",
        runId,
        runUrl,
        ref,
        headSha,
        status: "queued",
        conclusion: null,
        jobs: []
      });
      activeRunIdRef.current = runId;
      void pollDeployWorkflowStatus(runId);
    } catch (error) {
      setDeployWorkflowState({
        phase: "dispatch-failed",
        reason: error instanceof Error ? error.message : String(error),
        stdout: "",
        stderr: ""
      });
    }
  }

  async function pollDeployWorkflowStatus(runId: number) {
    if (!gameProject || !deploymentSettings) return;
    if (activeRunIdRef.current !== runId) return;
    try {
      const response = await fetch("/__sugardeploy/get-deploy-workflow-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          githubRepo: deploymentSettings.githubRepo ?? "",
          runId
        })
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        status?: string;
        conclusion?: string | null;
        url?: string;
        jobs?: Array<{
          name: string;
          status: string;
          conclusion: string | null;
          url: string;
        }>;
      } | null;
      if (payload?.ok) {
        setDeployWorkflowState((prev) =>
          prev?.phase === "tracking" && prev.runId === runId
            ? {
                ...prev,
                status: payload.status ?? prev.status,
                conclusion: payload.conclusion ?? null,
                jobs: payload.jobs ?? prev.jobs
              }
            : prev
        );
        // Patch the history entry too — only when something
        // observable changed, to avoid command churn.
        const patchCmd = buildUpdateDeployHistoryEntryCommand(
          gameProject,
          runId,
          {
            status: payload.status ?? "queued",
            conclusion: payload.conclusion ?? null
          }
        );
        if (patchCmd) onCommand(patchCmd);
        const terminal =
          payload.status === "completed" || payload.conclusion !== null;
        if (terminal) {
          activeRunIdRef.current = null;
          return;
        }
      }
    } catch {
      // Swallow transient poll errors; the next tick will retry.
    }
    if (activeRunIdRef.current !== runId) return;
    pollTimerRef.current = setTimeout(
      () => void pollDeployWorkflowStatus(runId),
      4000
    );
  }

  async function rerunFailedJobs(runId: number) {
    if (!deploymentSettings) return;
    try {
      await fetch("/__sugardeploy/rerun-failed-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          githubRepo: deploymentSettings.githubRepo ?? "",
          runId
        })
      });
      // Resume polling — gh kicks off a fresh run for the failed jobs,
      // tracked under the same runId.
      activeRunIdRef.current = runId;
      void pollDeployWorkflowStatus(runId);
    } catch {
      // Silent — the user can re-trigger from the GitHub UI if it
      // didn't take.
    }
  }

  // Story 46.8 — submit handler for Setup GitHub Workflow. Pipes the
  // NETLIFY_AUTH_TOKEN to the host endpoint; the value is forgotten
  // after the fetch returns so it never enters persisted state.
  async function runSetupGithubWorkflow(netlifyAuthToken: string) {
    if (!gameProject) return;
    setSetupGithubWorkflowState({ phase: "running" });
    try {
      const response = await fetch("/__sugardeploy/setup-github-workflow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workingDirectory: deploymentSettings?.workingDirectory ?? "",
          githubRepo: deploymentSettings?.githubRepo ?? "",
          netlifyAuthToken
        })
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        reason?: string;
        stdout?: string;
        stderr?: string;
      } | null;
      if (!payload?.ok) {
        setSetupGithubWorkflowState({
          phase: "failed",
          reason: payload?.reason ?? `HTTP ${response.status}`,
          stdout: payload?.stdout ?? "",
          stderr: payload?.stderr ?? ""
        });
        return;
      }
      setSetupGithubWorkflowState({
        phase: "success",
        message: payload.message ?? "Done.",
        stdout: payload.stdout ?? "",
        stderr: payload.stderr ?? ""
      });
    } catch (error) {
      setSetupGithubWorkflowState({
        phase: "failed",
        reason: error instanceof Error ? error.message : String(error),
        stdout: "",
        stderr: ""
      });
    }
  }

  // Story 46.6 — frontend-axis equivalents of the backend updaters above.
  // Same shape (write to targetOverrides + the matching id slot) so the
  // serialized DeploymentSettings remains symmetric across roles.
  function updateFrontendTarget(value: string | null) {
    if (!gameProject) return;
    const current = getDeploymentSettings(gameProject);
    updateSettings({
      ...current,
      frontendDeploymentTargetId: value === "netlify" ? "netlify" : null
    });
  }

  function addFrontendTarget(targetId: "netlify") {
    if (!gameProject) return;
    const current = getDeploymentSettings(gameProject);
    updateSettings({
      ...current,
      frontendDeploymentTargetId: targetId,
      targetOverrides: {
        ...current.targetOverrides,
        [targetId]: current.targetOverrides[targetId] ?? {}
      }
    });
  }

  function updateFrontendTargetOverrides(
    targetId: "netlify",
    patch: Record<string, unknown>
  ) {
    if (!gameProject) return;
    const current = getDeploymentSettings(gameProject);
    updateSettings({
      ...current,
      targetOverrides: {
        ...current.targetOverrides,
        [targetId]: {
          ...(current.targetOverrides[targetId] ?? {}),
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
    // Story 45.8.5 — flip the chip to "probing" so the spinner shows
    // immediately. Result settles via the existing isDeploymentAction
    // ExecutionResult branch below.
    if (actionKind === "health") {
      setHealthChip((prev) => ({ ...prev, phase: "probing" }));
    } else if (actionKind === "status") {
      setStatusChip((prev) => ({ ...prev, phase: "probing" }));
    }
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
        // Story 45.8.5 — keep the Current Version panel chips in sync
        // with the latest action outcome. Click the Health chip → it
        // runs the health action → result lands in the result box AND
        // the chip flips green/red. Same for Status. Other actions
        // (deploy, destroy, setup-infra) don't drive these chips.
        if (actionKind === "health") {
          setHealthChip({
            phase: "loaded",
            ok: payload.ok,
            message: payload.message
          });
        } else if (actionKind === "status") {
          setStatusChip({
            phase: "loaded",
            ok: payload.ok,
            message: payload.message
          });
        }
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
        workflowFileExists?: boolean;
        workflowOnDiskVersion?: number | null;
        workflowCurrentVersion?: number | null;
      } | null;
      if (!payload?.ok) {
        setTemplateDriftState({
          phase: "error",
          onDiskVersion: null,
          currentVersion: null,
          fileExists: false,
          workflowOnDiskVersion: null,
          workflowCurrentVersion: null,
          workflowFileExists: false
        });
        return;
      }
      setTemplateDriftState({
        phase: "loaded",
        onDiskVersion: payload.onDiskVersion ?? null,
        currentVersion: payload.currentVersion ?? null,
        fileExists: payload.fileExists ?? false,
        workflowOnDiskVersion: payload.workflowOnDiskVersion ?? null,
        workflowCurrentVersion: payload.workflowCurrentVersion ?? null,
        workflowFileExists: payload.workflowFileExists ?? false
      });
    } catch {
      setTemplateDriftState({
        phase: "error",
        onDiskVersion: null,
        currentVersion: null,
        fileExists: false,
        workflowOnDiskVersion: null,
        workflowCurrentVersion: null,
        workflowFileExists: false
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
        fileExists: false,
        workflowOnDiskVersion: null,
        workflowCurrentVersion: null,
        workflowFileExists: false
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

  // Story 45.8.5 — silent health probe at mount-time so the Current
  // Version panel's Health chip carries a real colour as soon as the
  // workspace opens. Reuses the existing /action endpoint with
  // actionKind:"health" but writes ONLY to healthChip — never to
  // actionState — so the user doesn't see a result box pop in
  // unbidden. Status is on-click only (multi-second gcloud call).
  async function probeHealthSilent() {
    if (!gameProject) return;
    setHealthChip((prev) => ({ ...prev, phase: "probing" }));
    try {
      const response = await fetch("/__sugardeploy/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionKind: "health", gameProject })
      });
      const rawBody = await response.text();
      let payload: DeploymentActionExecutionResult | null = null;
      if (rawBody.trim().length > 0) {
        try {
          const parsed = JSON.parse(rawBody);
          if (isDeploymentActionExecutionResult(parsed)) {
            payload = parsed;
          }
        } catch {
          payload = null;
        }
      }
      if (payload) {
        setHealthChip({
          phase: "loaded",
          ok: payload.ok,
          message: payload.message
        });
      } else {
        setHealthChip({
          phase: "loaded",
          ok: false,
          message: `HTTP ${response.status} ${response.statusText}`
        });
      }
    } catch (error) {
      setHealthChip({
        phase: "loaded",
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  useEffect(() => {
    if (
      selectedTargetId === "google-cloud-run" &&
      cloudRunWorkingDirectory &&
      hostActionsAvailable &&
      gameProject
    ) {
      void probeHealthSilent();
    } else {
      setHealthChip({
        phase: "idle",
        ok: null,
        message: "Not probed yet."
      });
      setStatusChip({
        phase: "idle",
        ok: null,
        message: "Click to query gcloud."
      });
    }
    // probeHealthSilent closes over gameProject; re-probe on workingDir /
    // target / gameProject change. Project re-save flips this too, which
    // is right — a save can change the deployed shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedTargetId,
    cloudRunWorkingDirectory,
    hostActionsAvailable,
    gameProject
  ]);

  // Story 45.8 — Cut New Major Version saga.
  //
  // Phase 1: prepare. Open the modal in "checking" state and fire the
  // prepare-cut-major-version host action. The host runs all pre-flight
  // checks server-side (git on PATH, clean tree, tag doesn't exist).
  // If pre-flight passes, generate the new suffix client-side and
  // transition to "ready" with the proposed plan; otherwise "preflight-
  // failed" with the reason. No side effects in this phase.
  async function openReleaseModalAndPrepare() {
    if (!gameProject) return;
    const priorMajor = gameProject.majorVersion;
    const workingDirectory =
      getDeploymentSettings(gameProject).workingDirectory ?? "";
    setReleaseModalState({ phase: "checking" });
    try {
      const response = await fetch(
        "/__sugardeploy/prepare-cut-major-version",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workingDirectory, priorMajor })
        }
      );
      const payload = (await response.json()) as {
        ok: boolean;
        reason?: string;
      };
      if (!payload.ok) {
        setReleaseModalState({
          phase: "preflight-failed",
          reason: payload.reason ?? "Pre-flight check failed."
        });
        return;
      }
      const newMajorVersion = priorMajor + 1;
      const newSuffix = generateProjectIdSuffix();
      const slug = gameProject.identity.id || "sugarmagic-game";
      const newProjectId = `${slug}-v${newMajorVersion}-${newSuffix}`;
      const newTagName = `v${priorMajor}.0.0`;
      const commitMessage = `chore: bump major version to ${newMajorVersion}`;
      setReleaseModalState({
        phase: "ready",
        priorMajor,
        newMajorVersion,
        newSuffix,
        newProjectId,
        newTagName,
        commitMessage,
        workingDirectory
      });
    } catch (error) {
      setReleaseModalState({
        phase: "preflight-failed",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Phase 2: cut. User confirmed; walk the saga steps and update modal
  // state as each one runs / settles. Best-effort rollback when a side-
  // effect step fails; manual escape-hatch instructions when rollback
  // itself can't complete.
  async function runCutSaga(plan: {
    priorMajor: number;
    newMajorVersion: number;
    newSuffix: string;
    newTagName: string;
    commitMessage: string;
    workingDirectory: string;
  }): Promise<void> {
    if (!gameProject) return;
    const { priorMajor, newMajorVersion, newSuffix, newTagName, commitMessage, workingDirectory } = plan;

    // Step 1: tag the prior major at current HEAD. First side effect.
    setReleaseModalState({
      phase: "cutting",
      step: "tagging",
      priorMajor,
      newMajorVersion,
      newTagName,
      commitMessage,
      workingDirectory,
      newSuffix
    });
    const tagResp = await fetch("/__sugardeploy/tag-prior-major", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workingDirectory, priorMajor })
    });
    const tagPayload = (await tagResp.json()) as {
      ok: boolean;
      reason?: string;
    };
    if (!tagPayload.ok) {
      setReleaseModalState({
        phase: "failed",
        reason: `Tagging the prior major failed: ${tagPayload.reason ?? "unknown"}`,
        recoveryNotes: []
      });
      return;
    }

    // Step 2: dispatch the in-memory bumps. Two dispatches: BumpMajorVersion
    // sets gameProject.majorVersion; the suffix-register writes the
    // SugarDeploy plugin slot via UpdatePluginConfiguration.
    setReleaseModalState({
      phase: "cutting",
      step: "bumping",
      priorMajor,
      newMajorVersion,
      newTagName,
      commitMessage,
      workingDirectory,
      newSuffix
    });
    if (!gameProjectId) {
      // Can't address the aggregate without an id — bail and roll back.
      await bestEffortUntag(workingDirectory, priorMajor);
      setReleaseModalState({
        phase: "failed",
        reason: "No project id available to dispatch BumpMajorVersion.",
        recoveryNotes: []
      });
      return;
    }
    onCommand({
      kind: "BumpMajorVersion",
      target: { aggregateKind: "game-project", aggregateId: gameProjectId },
      subject: { subjectKind: "game-project", subjectId: gameProjectId },
      payload: { newMajorVersion }
    });
    const suffixCommand = buildSetVersionedProjectIdentifierCommand(
      gameProject,
      newMajorVersion,
      newSuffix
    );
    if (suffixCommand) onCommand(suffixCommand);

    // Step 3: persist the in-memory state. saveProjectWithManagedFiles
    // also regenerates the deploy.sh + terraform files for the new
    // major version, so the commit step picks them up. The session-
    // store reads of gameProject for this save happen synchronously
    // INSIDE requestSave — the dispatches above are reflected because
    // the store updates after the synchronous onCommand calls return.
    setReleaseModalState({
      phase: "cutting",
      step: "persisting",
      priorMajor,
      newMajorVersion,
      newTagName,
      commitMessage,
      workingDirectory,
      newSuffix
    });
    const saveResult = await requestSave();
    if (!saveResult.ok) {
      const untagOk = await bestEffortUntag(workingDirectory, priorMajor);
      const recoveryNotes: string[] = [];
      if (!untagOk) {
        recoveryNotes.push(
          `Untag failed — run \`git -C ${workingDirectory} tag -d ${newTagName}\` manually to clean up.`
        );
      }
      recoveryNotes.push(
        "The in-memory session was bumped but the project.sgrmagic save failed. Use the Studio's Reload button to discard the in-memory bump, or fix the save error and try again."
      );
      setReleaseModalState({
        phase: "failed",
        reason: `Persist failed: ${saveResult.reason ?? "unknown"}`,
        recoveryNotes
      });
      return;
    }

    // Step 4: commit the bumped project.sgrmagic + regenerated managed
    // files. After this succeeds, the cut is fully realized: tag exists,
    // disk reflects the new major, commit captures the bump.
    setReleaseModalState({
      phase: "cutting",
      step: "committing",
      priorMajor,
      newMajorVersion,
      newTagName,
      commitMessage,
      workingDirectory,
      newSuffix
    });
    const commitResp = await fetch("/__sugardeploy/commit-major-version-bump", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workingDirectory, newMajor: newMajorVersion })
    });
    const commitPayload = (await commitResp.json()) as {
      ok: boolean;
      reason?: string;
    };
    if (!commitPayload.ok) {
      // Persist already wrote to disk, so rolling back fully would
      // require restoring prior project.sgrmagic + managed files via
      // a second save. That's out of scope for v1; surface the state
      // clearly and tell the user what's left to do by hand.
      setReleaseModalState({
        phase: "failed",
        reason: `Commit failed: ${commitPayload.reason ?? "unknown"}`,
        recoveryNotes: [
          `The tag ${newTagName} was created, and the bumped project.sgrmagic + managed files are saved to disk, but \`git commit\` failed.`,
          `Fix the underlying issue, then run from ${workingDirectory}:`,
          `  git add -u`,
          `  git commit -m "${commitMessage}"`,
          "(If you'd rather start over: `git tag -d ${newTagName}` to drop the tag, then Reload the project in Studio to discard the in-memory bump, and use git checkout to revert the modified files.)"
        ]
      });
      return;
    }

    setReleaseModalState({
      phase: "success",
      newMajorVersion,
      newTagName,
      commitMessage
    });
  }

  async function bestEffortUntag(
    workingDirectory: string,
    priorMajor: number
  ): Promise<boolean> {
    try {
      const resp = await fetch("/__sugardeploy/untag-prior-major", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workingDirectory, priorMajor })
      });
      const payload = (await resp.json()) as { ok: boolean };
      return payload.ok === true;
    } catch {
      return false;
    }
  }

  // Story 46.12 — fetch the live tag list from git via the host
  // middleware. Called on mount + after every Tag Patch action so
  // the version history list always reflects on-disk reality.
  async function refreshVersionTags() {
    if (!gameProject) return;
    const workingDirectory =
      getDeploymentSettings(gameProject).workingDirectory ?? "";
    if (workingDirectory.length === 0) {
      setVersionTagsByMajor(null);
      setVersionTagsLoadError(null);
      return;
    }
    try {
      const response = await fetch("/__sugardeploy/list-version-tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workingDirectory })
      });
      const payload = (await response.json()) as {
        ok: boolean;
        reason?: string;
        majors?: GroupedVersionMajor[];
      };
      if (!payload.ok) {
        setVersionTagsByMajor(null);
        setVersionTagsLoadError(payload.reason ?? "Failed to list version tags.");
        return;
      }
      setVersionTagsByMajor(payload.majors ?? []);
      setVersionTagsLoadError(null);
    } catch (error) {
      setVersionTagsByMajor(null);
      setVersionTagsLoadError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // Fetch on mount and whenever workingDirectory changes. The Release
  // workspace is the only consumer today; fetching unconditionally keeps
  // the data fresh without coupling to view state (cheap: one read-only
  // `git tag --list`).
  const workingDirectoryForVersionTags =
    gameProject
      ? getDeploymentSettings(gameProject).workingDirectory ?? ""
      : "";
  useEffect(() => {
    void refreshVersionTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingDirectoryForVersionTags]);

  // Story 46.12 — Tag Patch Version saga.
  //
  // Phase 1: preview. Open the modal in "checking" state and call
  // tag-patch-version with `dryRun: true`. The host runs every
  // pre-flight check (git on PATH, clean tree, base tag reachable
  // from HEAD) and returns the next patch tag without creating it.
  // No side effects in this phase.
  async function openTagPatchModalAndPrepare() {
    if (!gameProject) return;
    const major = gameProject.majorVersion;
    const workingDirectory =
      getDeploymentSettings(gameProject).workingDirectory ?? "";
    setTagPatchModalState({ phase: "checking" });
    try {
      const response = await fetch("/__sugardeploy/tag-patch-version", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workingDirectory, major, dryRun: true })
      });
      const payload = (await response.json()) as {
        ok: boolean;
        reason?: string;
        tagName?: string;
        baseTag?: string;
      };
      if (!payload.ok || !payload.tagName || !payload.baseTag) {
        setTagPatchModalState({
          phase: "preflight-failed",
          reason: payload.reason ?? "Pre-flight check failed."
        });
        return;
      }
      setTagPatchModalState({
        phase: "ready",
        major,
        nextTag: payload.tagName,
        baseTag: payload.baseTag,
        workingDirectory
      });
    } catch (error) {
      setTagPatchModalState({
        phase: "preflight-failed",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Phase 2: tag. User confirmed; call the same endpoint without
  // dryRun. The host re-runs every pre-flight check before creating
  // the tag — Studio's "ready" state is advisory, not authoritative,
  // so an external git operation racing the modal still fails safely.
  async function runTagPatchSaga(workingDirectory: string, major: number) {
    setTagPatchModalState({ phase: "tagging", nextTag: "" });
    try {
      const response = await fetch("/__sugardeploy/tag-patch-version", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workingDirectory, major })
      });
      const payload = (await response.json()) as {
        ok: boolean;
        reason?: string;
        tagName?: string;
      };
      if (!payload.ok || !payload.tagName) {
        setTagPatchModalState({
          phase: "failed",
          reason: payload.reason ?? "git tag failed."
        });
        return;
      }
      setTagPatchModalState({ phase: "success", tagName: payload.tagName });
      // Refresh the version history so the new tag renders as a
      // sub-row under its major.
      void refreshVersionTags();
    } catch (error) {
      setTagPatchModalState({
        phase: "failed",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

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
      {/* Story 46.5 — per-view title row. Provision is "what's wired
          up"; Release is "cut new major version"; Deploy is "daily
          driver — ship + observe". */}
      <Stack gap={4}>
        <Text fw={700} size="lg">
          {isProvision
            ? "Provision"
            : isRelease
              ? "Release"
              : "Deploy"}
        </Text>
        <Text size="sm" c="var(--sm-color-subtext)">
          {isProvision
            ? "Configure sources, deployment targets, and secrets. Stand up infrastructure with Setup Infra."
            : isRelease
              ? "Cut a new major version: tag the current commit, bump majorVersion, register a fresh GCP project suffix."
              : "Ship the current version to the selected publish + deployment target. Health + Status chips probe the live service."}
        </Text>
      </Stack>

      {/* Story 46.5 — Action Bar. Now rendered in every Publish-side
          workspace (Provision / Release / Deploy) with view-specific
          inner content. The combo-context badge row stays constant so
          the user always sees what they're operating on; chips and
          actions are sliced per view. */}
      {selectedTargetId && gameProject ? (
        <Box
          p="md"
          style={{
            border: "1px solid var(--sm-color-surface3)",
            borderRadius: 8,
            background: "var(--sm-color-surface1)"
          }}
        >
          <Stack gap="sm">
            <Group justify="space-between" wrap="nowrap" align="center">
              <Group gap="xs" align="center" wrap="nowrap">
                <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                  {isProvision ? "Provision" : isRelease ? "Release" : "Deploy"}
                </Text>
                <Badge size="lg" variant="filled" color="blue">
                  v{gameProject.majorVersion}
                </Badge>
                <Text size="sm" c="var(--sm-color-subtext)">
                  &gt;
                </Text>
                <Badge size="lg" variant="light" color="gray">
                  {publishSettings?.publishTargetId === "web"
                    ? "Web"
                    : publishSettings?.publishTargetId}
                </Badge>
                <Text size="sm" c="var(--sm-color-subtext)">
                  /
                </Text>
                <Badge size="lg" variant="light" color="gray">
                  {selectedTargetId === "google-cloud-run"
                    ? "Google Cloud Run"
                    : selectedTargetId === "local"
                      ? "Local"
                      : selectedTargetId}
                </Badge>
                {/* Story 46.6 — frontend axis badge, only shown when
                    a frontend target is configured. Same divider +
                    badge shape as the backend slot so the combo
                    context reads "version > publish / backend / frontend". */}
                {selectedFrontendTargetId ? (
                  <>
                    <Text size="sm" c="var(--sm-color-subtext)">
                      /
                    </Text>
                    <Badge size="lg" variant="light" color="gray">
                      {selectedFrontendTargetId === "netlify"
                        ? "Netlify"
                        : selectedFrontendTargetId}
                    </Badge>
                  </>
                ) : null}
              </Group>
              {isDeploy ? (
                <Group gap="xs">
                  <Tooltip
                    label={healthChip.message || "Click to re-probe."}
                    withinPortal
                    multiline
                    w={320}
                  >
                    <Badge
                      size="lg"
                      variant="light"
                      color={
                        healthChip.phase === "probing"
                          ? "gray"
                          : healthChip.ok === null
                            ? "gray"
                            : healthChip.ok
                              ? "green"
                              : "red"
                      }
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        setChipModalKind("health");
                        void runAction("health");
                      }}
                    >
                      {healthChip.phase === "probing"
                        ? "Health: probing…"
                        : healthChip.ok === null
                          ? "Health: unknown"
                          : healthChip.ok
                            ? "Health: OK"
                            : "Health: down"}
                    </Badge>
                  </Tooltip>
                  <Tooltip
                    label={statusChip.message || "Click to query gcloud."}
                    withinPortal
                    multiline
                    w={320}
                  >
                    <Badge
                      size="lg"
                      variant="light"
                      color={
                        statusChip.phase === "probing"
                          ? "gray"
                          : statusChip.ok === null
                            ? "gray"
                            : statusChip.ok
                              ? "green"
                              : "red"
                      }
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        setChipModalKind("status");
                        void runAction("status");
                      }}
                    >
                      {statusChip.phase === "probing"
                        ? "Status: querying…"
                        : statusChip.ok === null
                          ? "Status: unknown"
                          : statusChip.ok
                            ? "Status: OK"
                            : "Status: error"}
                    </Badge>
                  </Tooltip>
                </Group>
              ) : null}
            </Group>

            {/* Story 45.7 — template-drift banner. Provision view
                only — it's a Setup-Infra-fixes-it kind of alert. */}
            {isProvision &&
            selectedTargetId === "google-cloud-run" &&
            templateDriftState.phase === "loaded" &&
            templateDriftState.fileExists &&
            templateDriftState.onDiskVersion !== null &&
            templateDriftState.currentVersion !== null &&
            templateDriftState.onDiskVersion < templateDriftState.currentVersion ? (
              <Alert color="yellow" variant="light" title="Template drift">
                <Text size="sm">
                  The on-disk terraform template stamp is{" "}
                  <Code>v{templateDriftState.onDiskVersion}</Code>; the
                  current SugarDeploy template is{" "}
                  <Code>v{templateDriftState.currentVersion}</Code>. Save
                  the project (or run Setup Infra) to regenerate{" "}
                  <Code>main.tf</Code>; the banner will clear
                  automatically.
                </Text>
              </Alert>
            ) : null}

            {/* Story 46.7 — GHA workflow-drift banner. Same shape as
                terraform drift; reads the workflow stamp from the same
                probe. Save (or future Setup GitHub Workflow button)
                regenerates and clears. */}
            {isProvision &&
            templateDriftState.phase === "loaded" &&
            templateDriftState.workflowFileExists &&
            templateDriftState.workflowOnDiskVersion !== null &&
            templateDriftState.workflowCurrentVersion !== null &&
            templateDriftState.workflowOnDiskVersion <
              templateDriftState.workflowCurrentVersion ? (
              <Alert color="yellow" variant="light" title="Workflow drift">
                <Text size="sm">
                  The on-disk GitHub Actions workflow stamp is{" "}
                  <Code>v{templateDriftState.workflowOnDiskVersion}</Code>;
                  the current SugarDeploy workflow template is{" "}
                  <Code>v{templateDriftState.workflowCurrentVersion}</Code>.
                  Save the project to regenerate{" "}
                  <Code>.github/workflows/sugardeploy-deploy.yml</Code>;
                  the banner will clear automatically.
                </Text>
              </Alert>
            ) : null}

            {isProvision && selectedTargetId === "google-cloud-run" ? (
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

            {/* Story 46.8 — Setup GitHub Workflow. Available in
                Provision regardless of backend target (frontend-only
                projects still need NETLIFY_AUTH_TOKEN synced into the
                repo). Disabled until GitHub Repository is set on
                Sources because we can't address a repo without it. */}
            {isProvision ? (
              <Group>
                <Tooltip
                  label={
                    !deploymentSettings?.githubRepo
                      ? "Fill in GitHub Repository under Sources first — Setup GitHub Workflow uses it to address the right repo."
                      : "Sync repo VARS (WIF provider + runtime SA email from terraform outputs) and the NETLIFY_AUTH_TOKEN secret via the gh CLI. Idempotent — re-running re-syncs."
                  }
                  withinPortal
                  multiline
                  w={320}
                >
                  <Button
                    size="xs"
                    variant="filled"
                    color="grape"
                    disabled={!deploymentSettings?.githubRepo}
                    onClick={() =>
                      setSetupGithubWorkflowState({
                        phase: "prompting",
                        netlifyAuthToken: ""
                      })
                    }
                  >
                    Setup GitHub Workflow
                  </Button>
                </Tooltip>
              </Group>
            ) : null}

            {/* Story 46.10 — Deploy fires the GHA workflow rather
                than running gcloud-run-deploy inline. Destroy still
                runs gcloud inline (it tears down the live Cloud Run
                service, no need to round-trip through GHA). */}
            {isDeploy ? (
              <Group>
                <Button
                  size="xs"
                  onClick={() => openDeployWorkflowModal()}
                  disabled={
                    actionsDisabled ||
                    deployWorkflowState?.phase === "preview" ||
                    deployWorkflowState?.phase === "dispatching"
                  }
                  loading={
                    deployWorkflowState?.phase === "preview" ||
                    deployWorkflowState?.phase === "dispatching"
                  }
                >
                  Deploy
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
            ) : null}

            {!isRelease ? (
              <Text size="sm" c="var(--sm-color-overlay0)">
                {actionBlockedReason ??
                  (isDeploy
                    ? "Click a chip to probe. Save first, then use Deploy/Destroy. Working Directory must point at the game root on disk."
                    : "Save first, then use the buttons. Working Directory must point at the game root on disk.")}
              </Text>
            ) : null}
          </Stack>
        </Box>
      ) : null}

      {/* Story 46.10 — per-deploy history list. Deploy view only.
          Newest-first; the in-flight row's status updates live via
          the 4s poll loop. Each row links to the GHA run. */}
      {isDeploy && gameProject ? (
        <Stack gap="sm">
          <Group gap="xs" align="baseline">
            <Text fw={700} size="md">
              Deploys
            </Text>
            <Text size="xs" c="var(--sm-color-subtext)">
              — per-GHA-run history
            </Text>
          </Group>
          {deployHistory.length === 0 ? (
            <Text size="sm" c="var(--sm-color-overlay0)">
              No deploys yet. Click Deploy above to dispatch the first one.
            </Text>
          ) : (
            <Box
              p="sm"
              style={{
                border: "1px solid var(--sm-color-surface3)",
                borderRadius: 8,
                background: "var(--sm-color-surface1)"
              }}
            >
              <Stack gap="xs">
                {deployHistory.map((entry) => {
                  const isActive =
                    deployWorkflowState?.phase === "tracking" &&
                    deployWorkflowState.runId === entry.runId;
                  const status = isActive
                    ? deployWorkflowState.status
                    : entry.status;
                  const conclusion = isActive
                    ? deployWorkflowState.conclusion
                    : entry.conclusion;
                  const badgeColor =
                    conclusion === "success"
                      ? "green"
                      : conclusion === null
                        ? "blue"
                        : "red";
                  return (
                    <Group
                      key={entry.runId}
                      justify="space-between"
                      wrap="nowrap"
                      align="center"
                    >
                      <Group gap="xs" wrap="nowrap" align="center">
                        <Badge
                          size="md"
                          variant="light"
                          color={badgeColor}
                        >
                          {conclusion ?? status}
                        </Badge>
                        <Code>{entry.ref}</Code>
                        <Text size="xs" c="var(--sm-color-subtext)">
                          {entry.headSha.slice(0, 7)} ·{" "}
                          {new Date(entry.dispatchedAt).toLocaleString()}
                        </Text>
                      </Group>
                      <Group gap="xs">
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          onClick={() =>
                            window.open(
                              entry.runUrl,
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }
                        >
                          View run
                        </Button>
                        {entry.netlifyDeployUrl ? (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            onClick={() =>
                              window.open(
                                entry.netlifyDeployUrl ?? "",
                                "_blank",
                                "noopener,noreferrer"
                              )
                            }
                          >
                            Netlify
                          </Button>
                        ) : null}
                        {entry.cloudRunRevisionUrl ? (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            onClick={() =>
                              window.open(
                                entry.cloudRunRevisionUrl ?? "",
                                "_blank",
                                "noopener,noreferrer"
                              )
                            }
                          >
                            Cloud Run
                          </Button>
                        ) : null}
                      </Group>
                    </Group>
                  );
                })}
              </Stack>
            </Box>
          )}
        </Stack>
      ) : null}

      {/* Story 45.8.5 / 46.5 — Version panel. Release view only —
          version metadata + history + the Release-New-Version trigger
          live here. History rows render newest-first; the current
          major flags "(active)". */}
      {isRelease && gameProject ? (
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Group gap="xs" align="baseline">
              <Text fw={700} size="md">
                Version
              </Text>
              <Text size="xs" c="var(--sm-color-subtext)">
                — release metadata, independent of publish + deployment targets
              </Text>
            </Group>
            <Group gap="xs">
              <Button
                size="xs"
                variant="default"
                onClick={() => void openTagPatchModalAndPrepare()}
              >
                Tag Patch Version
              </Button>
              <Button
                size="xs"
                variant="filled"
                onClick={() => void openReleaseModalAndPrepare()}
              >
                Release New Version
              </Button>
            </Group>
          </Group>
          <Box
            p="sm"
            style={{
              border: "1px solid var(--sm-color-surface3)",
              borderRadius: 8,
              background: "var(--sm-color-surface1)"
            }}
          >
            <Stack gap="xs">
              {(() => {
                const slug = gameProject.identity.id || "sugarmagic-game";
                const entries = Object.entries(versionedProjectIdentifiers)
                  .map(([key, suffix]) => {
                    const match = /^v(\d+)$/.exec(key);
                    return match
                      ? {
                          version: Number(match[1]),
                          key,
                          suffix,
                          gcpProjectId: `${slug}-${key}-${suffix}`
                        }
                      : null;
                  })
                  .filter(
                    (entry): entry is {
                      version: number;
                      key: string;
                      suffix: string;
                      gcpProjectId: string;
                    } => entry !== null
                  )
                  .sort((a, b) => b.version - a.version);
                if (entries.length === 0) {
                  return (
                    <Text size="sm" c="var(--sm-color-subtext)">
                      No version suffixes recorded yet. The current major
                      (<Code>v{gameProject.majorVersion}</Code>) will register
                      on the next SugarDeploy save.
                    </Text>
                  );
                }
                return entries.map((entry) => {
                  const isActive = entry.version === gameProject.majorVersion;
                  // Story 46.12 — patches for this major come from the
                  // live git tag list (versionTagsByMajor). Plugin
                  // state intentionally does NOT mirror patch tags;
                  // git is the source of truth for `v{N}.0.M`.
                  const patches =
                    versionTagsByMajor?.find(
                      (group) => group.major === entry.version
                    )?.patches ?? [];
                  return (
                    <Stack key={entry.key} gap={2}>
                      <Group
                        justify="space-between"
                        wrap="nowrap"
                        align="center"
                      >
                        <Group gap="xs" align="center" wrap="nowrap">
                          <Badge
                            size="md"
                            variant={isActive ? "filled" : "light"}
                            color={isActive ? "blue" : "gray"}
                          >
                            v{entry.version}
                          </Badge>
                          {isActive ? (
                            <Text size="xs" c="var(--sm-color-subtext)">
                              (active)
                            </Text>
                          ) : null}
                        </Group>
                        <Code>{entry.gcpProjectId}</Code>
                      </Group>
                      {patches.map((patch) => (
                        <Group
                          key={patch.tag}
                          gap="xs"
                          wrap="nowrap"
                          align="center"
                          pl="lg"
                        >
                          <Text size="xs" c="var(--sm-color-subtext)">
                            +
                          </Text>
                          <Code>{patch.tag}</Code>
                        </Group>
                      ))}
                    </Stack>
                  );
                });
              })()}
              {versionTagsLoadError ? (
                <Text size="xs" c="var(--sm-color-subtext)">
                  Couldn't read tags from git: {versionTagsLoadError}
                </Text>
              ) : null}
            </Stack>
          </Box>
        </Stack>
      ) : null}

      {/* Story 45.8.5 / 46.5 — Sources panel. Provision view only —
          Working Directory + GitHub Repository describe the *source*
          the deployment runs against; configured once during stand-up. */}
      {isProvision && gameProject ? (
        <Stack gap="sm">
          <Group gap="xs" align="baseline">
            <Text fw={700} size="md">
              Sources
            </Text>
            <Text size="xs" c="var(--sm-color-subtext)">
              — shared across all targets
            </Text>
          </Group>
          <Box
            p="sm"
            style={{
              border: "1px solid var(--sm-color-surface3)",
              borderRadius: 8,
              background: "var(--sm-color-surface1)"
            }}
          >
            <SimpleGrid cols={2} spacing="sm" verticalSpacing="sm">
              <TextInput
                label="Working Directory"
                description="Absolute path to the game root on disk. Required for any host-side deploy/status action."
                value={deploymentSettings?.workingDirectory ?? ""}
                onChange={(event) => {
                  if (!gameProject) return;
                  updateSettings({
                    ...getDeploymentSettings(gameProject),
                    workingDirectory: event.currentTarget.value
                  });
                }}
              />
              <TextInput
                label="GitHub Repository"
                description="Drives the GCR target's Workload Identity Federation binding so GitHub Actions in this repo can deploy. Pasting a full GitHub URL or git@ clone URL is fine — the prefix and trailing .git get stripped automatically."
                placeholder="nikki/wordlark"
                value={rawGithubRepo}
                error={githubRepoError}
                onChange={(event) => {
                  if (!gameProject) return;
                  updateSettings({
                    ...getDeploymentSettings(gameProject),
                    githubRepo: stripGithubRepoPrefixes(event.currentTarget.value)
                  });
                }}
              />
            </SimpleGrid>
          </Box>
        </Stack>
      ) : null}

      {/* Story 45.8.5 — Targets panel. Mirrors the Version panel's
          visual structure (title row + bordered card with surface1
          background) for visual consistency. Configured targets render
          as tabs; Local is always first; a "+" tab on the far right
          opens a menu of unselected deployment targets (Mantine Menu
          wraps a dummy Tabs.Tab so the affordance reads as a tab).
          Switching tabs flips deploymentTargetId; the "+" picker calls
          addTarget which both selects AND seeds an empty overrides
          entry so the tab persists after the user switches away. GCP
          Project Id is intentionally not exposed — it auto-derives
          from versioned slug + suffix per 45.4.7 and is shown in the
          Version panel above. */}
      {isProvision && gameProject ? (() => {
        const allTargets = listDeploymentTargets();
        const configured = new Set<string>();
        configured.add("local");
        if (selectedTargetId && selectedTargetId !== "local") {
          configured.add(selectedTargetId);
        }
        const currentSettings = getDeploymentSettings(gameProject);
        for (const key of Object.keys(currentSettings.targetOverrides ?? {})) {
          configured.add(key);
        }
        const configuredList = allTargets
          .filter((t) => configured.has(t.targetId))
          .sort((a, b) => {
            if (a.targetId === "local") return -1;
            if (b.targetId === "local") return 1;
            return a.displayName.localeCompare(b.displayName);
          });
        const availableToAdd = allTargets.filter(
          (t) => !configured.has(t.targetId)
        );
        const tabValue = selectedTargetId ?? "local";
        return (
          <Stack gap="sm">
            <Group gap="xs" align="baseline">
              <Text fw={700} size="md">
                Backend Targets
              </Text>
              <Text size="xs" c="var(--sm-color-subtext)">
                — services + secrets (where the game backend runs)
              </Text>
            </Group>
            <Box
              p="sm"
              style={{
                border: "1px solid var(--sm-color-surface3)",
                borderRadius: 8,
                background: "var(--sm-color-surface1)"
              }}
            >
              <Tabs
                value={tabValue}
                onChange={(value) => {
                  if (!value || value === "__add__") return;
                  if (value === "local" || value === "google-cloud-run") {
                    updateTarget(value);
                  }
                }}
              >
                <Tabs.List>
                  {configuredList.map((t) => (
                    <Tabs.Tab key={t.targetId} value={t.targetId}>
                      {t.displayName}
                    </Tabs.Tab>
                  ))}
                  {/* Story 45.8.5 — the "+" affordance sits in Tabs.List
                      but is NOT a Tabs.Tab. Wrapping Tabs.Tab in Menu.Target
                      crashes Mantine: Menu.Target clones the child and
                      injects onClick/ref, which collides with Tabs.Tab's
                      parent-context wiring. Render a plain Button instead,
                      styled compact so it reads as a tab affordance. */}
                  <Menu
                    shadow="md"
                    position="bottom-start"
                    disabled={availableToAdd.length === 0}
                  >
                    <Menu.Target>
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color="gray"
                        disabled={availableToAdd.length === 0}
                        title={
                          availableToAdd.length === 0
                            ? "All available deployment targets already configured."
                            : "Add a deployment target."
                        }
                        style={{ alignSelf: "center", marginLeft: 4 }}
                      >
                        +
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Label>Add a deployment target</Menu.Label>
                      {availableToAdd.map((t) => (
                        <Menu.Item
                          key={t.targetId}
                          onClick={() => {
                            if (
                              t.targetId === "local" ||
                              t.targetId === "google-cloud-run"
                            ) {
                              addTarget(t.targetId);
                            }
                          }}
                        >
                          {t.displayName}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                </Tabs.List>

                <Tabs.Panel value="local" pt="sm">
                  <Stack gap="sm">
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
                </Tabs.Panel>

                <Tabs.Panel value="google-cloud-run" pt="sm">
                  {/* Story 45.8.5 — subsections inside the GCR tab.
                      Three logical groupings:
                      - Service: identity + location (workspace path,
                        repo, region, naming, runtime SA).
                      - Gateway: how the deployed gateway listens and
                        who's allowed through (port, ingress, auth).
                      - Scale: horizontal-scale knobs (min/max instances).
                      Each subsection has an uppercase subheader and a
                      two-column SimpleGrid for its fields. */}
                  <Stack gap="lg">
                    <Stack gap="sm">
                      <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                        Service
                      </Text>
                      <SimpleGrid cols={2} spacing="sm" verticalSpacing="sm">
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
                      </SimpleGrid>
                    </Stack>

                    <Stack gap="sm">
                      <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                        Gateway
                      </Text>
                      <SimpleGrid cols={2} spacing="sm" verticalSpacing="sm">
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
                        <Select
                          label="Gateway Auth Mode"
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
                          style={{ gridColumn: "1 / -1" }}
                        />
                      </SimpleGrid>
                    </Stack>

                    <Stack gap="sm">
                      <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                        Scale
                      </Text>
                      <SimpleGrid cols={2} spacing="sm" verticalSpacing="sm">
                        <NumberInput
                          label="Min Instances"
                          description="Cloud Run keeps at least this many warm. 0 = scale-to-zero (cold starts); 1 = keep one warm for snappy in-game dialog."
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
                          description="Hard ceiling on horizontal scale-out. Caps runaway cost from a bug or burst."
                          value={cloudRunOverrides.maxInstances}
                          min={1}
                          max={100}
                          onChange={(value) =>
                            updateTargetOverrides("google-cloud-run", {
                              maxInstances: value
                            })
                          }
                        />
                      </SimpleGrid>
                    </Stack>
                  </Stack>
                </Tabs.Panel>
              </Tabs>
            </Box>
          </Stack>
        );
      })() : null}

      {/* Story 46.6 — Frontend Targets panel. Parallel to Backend
          Targets above; lists static-hosting destinations (Netlify
          today). Empty strip is legal — frontend deployment is
          opt-in. The "+" picker adds Netlify; selecting it flips
          frontendDeploymentTargetId and seeds an overrides slot so
          the next save regenerates deployment/netlify/. */}
      {isProvision && gameProject ? (() => {
        const allFrontendTargets = listFrontendDeploymentTargets();
        const currentSettings = getDeploymentSettings(gameProject);
        const configured = new Set<string>();
        if (selectedFrontendTargetId) {
          configured.add(selectedFrontendTargetId);
        }
        for (const key of Object.keys(currentSettings.targetOverrides ?? {})) {
          if (allFrontendTargets.some((t) => t.targetId === key)) {
            configured.add(key);
          }
        }
        const configuredList = allFrontendTargets.filter((t) =>
          configured.has(t.targetId)
        );
        const availableToAdd = allFrontendTargets.filter(
          (t) => !configured.has(t.targetId)
        );
        const tabValue = selectedFrontendTargetId ?? "__none__";
        return (
          <Stack gap="sm">
            <Group gap="xs" align="baseline">
              <Text fw={700} size="md">
                Frontend Targets
              </Text>
            </Group>
            <Box
              p="sm"
              style={{
                border: "1px solid var(--sm-color-surface3)",
                borderRadius: 8,
                background: "var(--sm-color-surface1)"
              }}
            >
              {configuredList.length === 0 ? (
                <Group justify="space-between" align="center">
                  <Text size="sm" c="var(--sm-color-overlay0)">
                    No frontend target configured. Add Netlify to
                    generate the static-host build config.
                  </Text>
                  <Menu
                    shadow="md"
                    position="bottom-end"
                    disabled={availableToAdd.length === 0}
                  >
                    <Menu.Target>
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color="gray"
                        disabled={availableToAdd.length === 0}
                      >
                        + Add Frontend Target
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Label>Add a frontend target</Menu.Label>
                      {availableToAdd.map((t) => (
                        <Menu.Item
                          key={t.targetId}
                          onClick={() => {
                            if (t.targetId === "netlify") {
                              addFrontendTarget("netlify");
                            }
                          }}
                        >
                          {t.displayName}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              ) : (
                <Tabs
                  value={tabValue}
                  onChange={(value) => {
                    if (!value || value === "__add__") return;
                    if (value === "netlify") {
                      updateFrontendTarget("netlify");
                    }
                  }}
                >
                  <Tabs.List>
                    {configuredList.map((t) => (
                      <Tabs.Tab key={t.targetId} value={t.targetId}>
                        {t.displayName}
                      </Tabs.Tab>
                    ))}
                    <Menu
                      shadow="md"
                      position="bottom-start"
                      disabled={availableToAdd.length === 0}
                    >
                      <Menu.Target>
                        <Button
                          size="compact-sm"
                          variant="subtle"
                          color="gray"
                          disabled={availableToAdd.length === 0}
                          title={
                            availableToAdd.length === 0
                              ? "All available frontend targets are configured."
                              : "Add a frontend deployment target."
                          }
                          style={{ alignSelf: "center", marginLeft: 4 }}
                        >
                          +
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Label>Add a frontend target</Menu.Label>
                        {availableToAdd.map((t) => (
                          <Menu.Item
                            key={t.targetId}
                            onClick={() => {
                              if (t.targetId === "netlify") {
                                addFrontendTarget("netlify");
                              }
                            }}
                          >
                            {t.displayName}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  </Tabs.List>

                  <Tabs.Panel value="netlify" pt="sm">
                    <Stack gap="sm">
                      <SimpleGrid cols={2} spacing="sm" verticalSpacing="sm">
                        <TextInput
                          label="Site ID"
                          description="Netlify site UUID. Available from `netlify sites:list` or the site settings page."
                          placeholder="12345678-90ab-cdef-1234-567890abcdef"
                          value={netlifySiteIdInput}
                          error={netlifySiteIdError}
                          onChange={(event) =>
                            updateFrontendTargetOverrides("netlify", {
                              siteId: event.currentTarget.value
                            })
                          }
                        />
                        <TextInput
                          label="Site Name"
                          description="Human-readable site name (for the generated README)."
                          placeholder="wordlark-v1"
                          value={netlifyOverrides.siteName}
                          onChange={(event) =>
                            updateFrontendTargetOverrides("netlify", {
                              siteName: event.currentTarget.value
                            })
                          }
                        />
                        <Select
                          label="Production Context"
                          description="Which Netlify deploy context the GHA workflow targets."
                          data={[
                            { value: "production", label: "Production" },
                            { value: "deploy-preview", label: "Deploy Preview" },
                            { value: "branch-deploy", label: "Branch Deploy" }
                          ]}
                          value={netlifyOverrides.productionContext}
                          onChange={(value) =>
                            updateFrontendTargetOverrides("netlify", {
                              productionContext:
                                value === "deploy-preview" ||
                                value === "branch-deploy"
                                  ? value
                                  : "production"
                            })
                          }
                          style={{ gridColumn: "1 / -1" }}
                        />
                      </SimpleGrid>
                    </Stack>
                  </Tabs.Panel>
                </Tabs>
              )}
            </Box>
          </Stack>
        );
      })() : null}

      {isProvision && selectedTargetId === "google-cloud-run" ? (
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


      {/* Story 45.8.5 / 46.5 — inline result/error boxes are
          suppressed for Health + Status (they surface in the chip
          modal). For the other actions, results render in the view
          that owns them: Deploy view shows deploy/destroy results,
          Provision view shows setup-infra/teardown-infra/create-gcp-
          project results. */}
      {actionState.error &&
      ((isDeploy &&
        (actionState.kind === "deploy" || actionState.kind === "destroy")) ||
        (isProvision &&
          (actionState.kind === "setup-infra" ||
            actionState.kind === "teardown-infra"))) ? (
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

      {actionState.result &&
      ((isDeploy &&
        (actionState.result.descriptor.actionKind === "deploy" ||
          actionState.result.descriptor.actionKind === "destroy")) ||
        (isProvision &&
          (actionState.result.descriptor.actionKind === "setup-infra" ||
            actionState.result.descriptor.actionKind === "teardown-infra"))) ? (
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

      {isProvision && createState.error ? (
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

      {isProvision && createState.result ? (
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

      {/* Story 45.8.5 — chip-result modal. Opens when the user clicks
          the Health or Status chip; shows running / ok / error / stdout
          / stderr for that probe in-place instead of injecting a result
          box mid-workspace. Reads from actionState but guards on
          chipModalKind matching the action that's in flight or last
          settled, so a stale result from a different action doesn't
          leak in. */}
      <Modal
        opened={chipModalKind !== null}
        onClose={() => setChipModalKind(null)}
        title={
          chipModalKind === "health"
            ? "Health probe"
            : chipModalKind === "status"
              ? "Status probe"
              : ""
        }
        centered
        size="lg"
      >
        {actionState.running && actionState.kind === chipModalKind ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm">
              {chipModalKind === "status"
                ? "Querying gcloud..."
                : "Probing..."}
            </Text>
          </Group>
        ) : actionState.error && actionState.kind === chipModalKind ? (
          <Stack gap="xs">
            <Text fw={700} size="sm" c="red">
              Action failed
            </Text>
            <Code block>{actionState.error}</Code>
          </Stack>
        ) : actionState.result &&
          actionState.result.descriptor.actionKind === chipModalKind ? (
          <Stack gap="xs">
            <Text fw={700} size="sm" c={actionState.result.ok ? "green" : "red"}>
              {actionState.result.ok ? "OK" : "Failed"}
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
                      window.open(
                        actionState.result.descriptor.healthUrl,
                        "_blank",
                        "noopener,noreferrer"
                      );
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
        ) : (
          <Text size="sm" c="var(--sm-color-subtext)">
            Waiting for probe to start...
          </Text>
        )}
      </Modal>

      {/* Story 45.8 — Cut New Major Version modal. Phase machine in the
          parent component (releaseModalState) drives what we render here.
          Closed by setting state to null; user can dismiss only when the
          saga is idle (not in checking/cutting). */}
      <Modal
        opened={releaseModalOpen}
        onClose={() => {
          if (releaseModalBusy) return;
          setReleaseModalState(null);
        }}
        title="Release New Version"
        centered
        size="lg"
        closeOnClickOutside={!releaseModalBusy}
        closeOnEscape={!releaseModalBusy}
        withCloseButton={!releaseModalBusy}
      >
        {releaseModalState?.phase === "checking" ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm">Running pre-flight checks...</Text>
          </Group>
        ) : null}

        {releaseModalState?.phase === "preflight-failed" ? (
          <Stack>
            <Alert color="red" variant="light" title="Pre-flight failed">
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {releaseModalState.reason}
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button
                variant="subtle"
                onClick={() => setReleaseModalState(null)}
              >
                Close
              </Button>
            </Group>
          </Stack>
        ) : null}

        {releaseModalState?.phase === "ready" ? (
          <Stack>
            <Text size="sm">
              Cutting a new major version produces a git tag at the
              current commit, bumps the project's{" "}
              <Code>majorVersion</Code>, registers a fresh GCP project
              suffix for the new major, and creates a commit capturing
              the bump. The previous major's GCP project keeps running
              untouched; future deploys target the new major.
            </Text>
            <Box
              p="sm"
              style={{
                border: "1px solid var(--sm-color-surface3)",
                borderRadius: 8,
                background: "var(--sm-color-surface1)"
              }}
            >
              <Stack gap="xs">
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" c="var(--sm-color-subtext)" w={180}>
                    Tag to create:
                  </Text>
                  <Code>{releaseModalState.newTagName}</Code>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" c="var(--sm-color-subtext)" w={180}>
                    New major version:
                  </Text>
                  <Code>v{releaseModalState.newMajorVersion}</Code>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" c="var(--sm-color-subtext)" w={180}>
                    New GCP project id:
                  </Text>
                  <Code>{releaseModalState.newProjectId}</Code>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" c="var(--sm-color-subtext)" w={180}>
                    Commit message:
                  </Text>
                  <Code>{releaseModalState.commitMessage}</Code>
                </Group>
              </Stack>
            </Box>
            <Alert color="blue" variant="light" title="Commits locally">
              <Text size="sm">
                This commits to your local git repository. Push to the
                remote yourself when you're ready (`git push && git push
                --tags`).
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button
                variant="subtle"
                onClick={() => setReleaseModalState(null)}
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  if (releaseModalState.phase !== "ready") return;
                  const {
                    priorMajor,
                    newMajorVersion,
                    newSuffix,
                    newTagName,
                    commitMessage,
                    workingDirectory
                  } = releaseModalState;
                  void runCutSaga({
                    priorMajor,
                    newMajorVersion,
                    newSuffix,
                    newTagName,
                    commitMessage,
                    workingDirectory
                  });
                }}
              >
                Cut Version
              </Button>
            </Group>
          </Stack>
        ) : null}

        {releaseModalState?.phase === "cutting" ? (
          <Stack>
            <Group gap="xs">
              <Loader size="sm" />
              <Text size="sm">
                {releaseModalState.step === "tagging"
                  ? `Creating git tag ${releaseModalState.newTagName}...`
                  : releaseModalState.step === "bumping"
                    ? `Bumping majorVersion to v${releaseModalState.newMajorVersion}...`
                    : releaseModalState.step === "persisting"
                      ? "Persisting project.sgrmagic and regenerating deploy files..."
                      : "Committing the bump..."}
              </Text>
            </Group>
          </Stack>
        ) : null}

        {releaseModalState?.phase === "success" ? (
          <Stack>
            <Alert color="green" variant="light" title="Done">
              <Stack gap="xs">
                <Text size="sm">
                  Tag <Code>{releaseModalState.newTagName}</Code> created,
                  major version bumped to{" "}
                  <Code>v{releaseModalState.newMajorVersion}</Code>, and
                  the bump committed locally.
                </Text>
                <Text size="sm" c="var(--sm-color-subtext)">
                  Commit message: <Code>{releaseModalState.commitMessage}</Code>
                </Text>
                <Text size="sm" c="var(--sm-color-subtext)">
                  Next: the SugarDeploy section now resolves the default
                  project id to v{releaseModalState.newMajorVersion}.
                  Click Create GCP Project + Setup Infra + Deploy to
                  stand up the new major.
                </Text>
              </Stack>
            </Alert>
            <Group justify="flex-end">
              <Button onClick={() => setReleaseModalState(null)}>Close</Button>
            </Group>
          </Stack>
        ) : null}

        {releaseModalState?.phase === "failed" ? (
          <Stack>
            <Alert color="red" variant="light" title="Cut failed">
              <Stack gap="xs">
                <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                  {releaseModalState.reason}
                </Text>
                {releaseModalState.recoveryNotes.length > 0 ? (
                  <Stack gap={4}>
                    <Text size="sm" fw={600}>
                      What to do next:
                    </Text>
                    {releaseModalState.recoveryNotes.map((note, index) => (
                      <Text
                        key={index}
                        size="sm"
                        style={{ whiteSpace: "pre-wrap" }}
                      >
                        {note}
                      </Text>
                    ))}
                  </Stack>
                ) : null}
              </Stack>
            </Alert>
            <Group justify="flex-end">
              <Button onClick={() => setReleaseModalState(null)}>Close</Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>

      {/* Story 46.12 — Tag Patch Version modal. Mirrors the cut-major
          modal's phase machine but stays git-only: no plugin-state
          mutations, no GCP project, no commit. */}
      <Modal
        opened={tagPatchModalOpen}
        onClose={() => {
          if (tagPatchModalBusy) return;
          setTagPatchModalState(null);
        }}
        title="Tag Patch Version"
        centered
        size="lg"
        closeOnClickOutside={!tagPatchModalBusy}
        closeOnEscape={!tagPatchModalBusy}
        withCloseButton={!tagPatchModalBusy}
      >
        {tagPatchModalState?.phase === "checking" ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm">Running pre-flight checks...</Text>
          </Group>
        ) : null}

        {tagPatchModalState?.phase === "preflight-failed" ? (
          <Stack>
            <Alert color="red" variant="light" title="Pre-flight failed">
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {tagPatchModalState.reason}
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button
                variant="subtle"
                onClick={() => setTagPatchModalState(null)}
              >
                Close
              </Button>
            </Group>
          </Stack>
        ) : null}

        {tagPatchModalState?.phase === "ready" ? (
          <Stack>
            <Text size="sm">
              A patch tag anchors a new commit to an existing major
              version's deployment slot. No <Code>majorVersion</Code>{" "}
              bump, no GCP project change, no commit — just{" "}
              <Code>git tag</Code> at HEAD.
            </Text>
            <Box
              p="sm"
              style={{
                border: "1px solid var(--sm-color-surface3)",
                borderRadius: 8,
                background: "var(--sm-color-surface1)"
              }}
            >
              <Stack gap="xs">
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" c="var(--sm-color-subtext)" w={180}>
                    Tag to create:
                  </Text>
                  <Code>{tagPatchModalState.nextTag}</Code>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" c="var(--sm-color-subtext)" w={180}>
                    Anchored to major:
                  </Text>
                  <Code>{tagPatchModalState.baseTag}</Code>
                </Group>
              </Stack>
            </Box>
            <Group justify="flex-end">
              <Button
                variant="subtle"
                onClick={() => setTagPatchModalState(null)}
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  if (tagPatchModalState.phase !== "ready") return;
                  const { workingDirectory, major } = tagPatchModalState;
                  void runTagPatchSaga(workingDirectory, major);
                }}
              >
                Tag Patch
              </Button>
            </Group>
          </Stack>
        ) : null}

        {tagPatchModalState?.phase === "tagging" ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm">Creating git tag...</Text>
          </Group>
        ) : null}

        {tagPatchModalState?.phase === "success" ? (
          <Stack>
            <Alert color="green" variant="light" title="Done">
              <Stack gap="xs">
                <Text size="sm">
                  Tag <Code>{tagPatchModalState.tagName}</Code> created
                  locally at HEAD.
                </Text>
                <Text size="sm" c="var(--sm-color-subtext)">
                  Push to deploy:
                </Text>
                <Code block>{`git push --tags`}</Code>
                <Text size="sm" c="var(--sm-color-subtext)">
                  Pushing the tag fires the GHA workflow's tag trigger,
                  which redeploys the v
                  {tagPatchModalState.tagName.split(".")[0].slice(1)}{" "}
                  slot.
                </Text>
              </Stack>
            </Alert>
            <Group justify="flex-end">
              <Button onClick={() => setTagPatchModalState(null)}>Close</Button>
            </Group>
          </Stack>
        ) : null}

        {tagPatchModalState?.phase === "failed" ? (
          <Stack>
            <Alert color="red" variant="light" title="Tag failed">
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {tagPatchModalState.reason}
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button onClick={() => setTagPatchModalState(null)}>Close</Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>

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

      {/* Story 46.8 — Setup GitHub Workflow modal. State machine in
          the parent (setupGithubWorkflowState). The NETLIFY_AUTH_TOKEN
          input is local-only — never written to project state. Submit
          pipes it to /__sugardeploy/setup-github-workflow which forwards
          to `gh secret set` via stdin so the value never appears in
          argv. Idempotent — re-clicking re-syncs. */}
      <Modal
        opened={setupGithubWorkflowOpen}
        onClose={() => {
          if (setupGithubWorkflowBusy) return;
          setSetupGithubWorkflowState(null);
        }}
        title="Setup GitHub Workflow"
        centered
        size="lg"
        closeOnClickOutside={!setupGithubWorkflowBusy}
        closeOnEscape={!setupGithubWorkflowBusy}
        withCloseButton={!setupGithubWorkflowBusy}
      >
        {setupGithubWorkflowState?.phase === "prompting" ? (
          <Stack>
            <Text size="sm">
              Syncs the GitHub repo's vars + secrets so the workflow
              generated at{" "}
              <Code>.github/workflows/sugardeploy-deploy.yml</Code> has
              what it needs to deploy. The token is piped to{" "}
              <Code>gh secret set</Code> via stdin and never persisted
              by Studio.
            </Text>
            <PasswordInput
              label="NETLIFY_AUTH_TOKEN"
              description="Netlify personal access token with permission to deploy to your site. In Netlify: click your name/avatar at the BOTTOM-LEFT of the sidebar → User settings → Applications → OAuth → New access token."
              value={setupGithubWorkflowState.netlifyAuthToken}
              onChange={(event) =>
                setSetupGithubWorkflowState({
                  phase: "prompting",
                  netlifyAuthToken: event.currentTarget.value
                })
              }
            />
            <Group justify="flex-end">
              <Button
                variant="subtle"
                onClick={() => setSetupGithubWorkflowState(null)}
              >
                Close
              </Button>
              <Button
                disabled={
                  setupGithubWorkflowState.netlifyAuthToken.trim().length === 0
                }
                onClick={() =>
                  void runSetupGithubWorkflow(
                    setupGithubWorkflowState.netlifyAuthToken
                  )
                }
              >
                Sync to GitHub
              </Button>
            </Group>
          </Stack>
        ) : null}

        {setupGithubWorkflowState?.phase === "running" ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm">
              Running gh + terraform output... this can take a few seconds.
            </Text>
          </Group>
        ) : null}

        {setupGithubWorkflowState?.phase === "success" ? (
          <Stack>
            <Alert color="green" variant="light" title="Synced">
              <Stack gap="xs">
                <Text size="sm">{setupGithubWorkflowState.message}</Text>
                {setupGithubWorkflowState.stdout.trim() ? (
                  <Code block>{setupGithubWorkflowState.stdout}</Code>
                ) : null}
              </Stack>
            </Alert>
            <Group justify="flex-end">
              <Button onClick={() => setSetupGithubWorkflowState(null)}>
                Close
              </Button>
            </Group>
          </Stack>
        ) : null}

        {setupGithubWorkflowState?.phase === "failed" ? (
          <Stack>
            <Alert color="red" variant="light" title="Setup failed">
              <Stack gap="xs">
                <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                  {setupGithubWorkflowState.reason}
                </Text>
                {setupGithubWorkflowState.stdout.trim() ? (
                  <Code block>{setupGithubWorkflowState.stdout}</Code>
                ) : null}
                {setupGithubWorkflowState.stderr.trim() ? (
                  <Code block>{setupGithubWorkflowState.stderr}</Code>
                ) : null}
              </Stack>
            </Alert>
            <Group justify="flex-end">
              <Button
                variant="subtle"
                onClick={() => setSetupGithubWorkflowState(null)}
              >
                Close
              </Button>
              <Button
                onClick={() =>
                  setSetupGithubWorkflowState({
                    phase: "prompting",
                    netlifyAuthToken: ""
                  })
                }
              >
                Try Again
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>

      {/* Story 46.10 — Deploy workflow modal. Preview (preflight) →
          dispatch confirmation → tracking. The tracking pane stays open
          while the GHA run is in flight; the user can close it and
          continue working — the history list below the action bar keeps
          rendering live status via the same poll loop. */}
      <Modal
        opened={deployWorkflowOpen}
        onClose={() => {
          if (
            deployWorkflowState?.phase === "preview" &&
            deployWorkflowState.loading
          )
            return;
          if (deployWorkflowState?.phase === "dispatching") return;
          setDeployWorkflowState(null);
        }}
        title="Deploy via GitHub Actions"
        centered
        size="lg"
        closeOnClickOutside={
          deployWorkflowState?.phase !== "dispatching" &&
          !(
            deployWorkflowState?.phase === "preview" &&
            deployWorkflowState.loading
          )
        }
        closeOnEscape={
          deployWorkflowState?.phase !== "dispatching" &&
          !(
            deployWorkflowState?.phase === "preview" &&
            deployWorkflowState.loading
          )
        }
        withCloseButton={
          deployWorkflowState?.phase !== "dispatching" &&
          !(
            deployWorkflowState?.phase === "preview" &&
            deployWorkflowState.loading
          )
        }
      >
        {deployWorkflowState?.phase === "preview" &&
        deployWorkflowState.loading ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm">Running pre-flight checks...</Text>
          </Group>
        ) : null}

        {deployWorkflowState?.phase === "preview" &&
        !deployWorkflowState.loading ? (
          <Stack>
            <Text size="sm">
              Deploy will auto-commit and push any pending changes in BOTH
              the game repo and the sugarmagic engine, then dispatch{" "}
              <Code>sugardeploy-deploy.yml</Code> against the resulting
              shas. Untracked files are skipped (add them manually if
              they should ship).
            </Text>
            {deployWorkflowState.plan?.upstreamWarnings.length ? (
              <Alert color="orange" variant="light" title="Upstream missing">
                <Stack gap={4}>
                  {deployWorkflowState.plan.upstreamWarnings.map((warning) => (
                    <Text key={warning} size="sm">
                      {warning}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            ) : null}
            {deployWorkflowState.plan ? (
              <Stack gap="xs">
                {(
                  [
                    {
                      title: "Game repo",
                      subtitle: deploymentSettings?.githubRepo ?? "(no GitHub repo set)",
                      repo: deployWorkflowState.plan.game
                    },
                    {
                      title: "Sugarmagic engine",
                      subtitle: "nikkileaps/sugarmagic",
                      repo: deployWorkflowState.plan.engine
                    }
                  ] as const
                ).map(({ title, subtitle, repo }) => {
                  const willCommit = repo.trackedDirtyFiles.length > 0;
                  const willPush = willCommit || repo.aheadCount > 0;
                  const cleanAndUpToDate = !willCommit && !willPush;
                  return (
                    <Box
                      key={title}
                      p="sm"
                      style={{
                        border: "1px solid var(--sm-color-surface3)",
                        borderRadius: 8,
                        background: "var(--sm-color-surface1)"
                      }}
                    >
                      <Stack gap="xs">
                        <Group justify="space-between" wrap="nowrap">
                          <Text fw={600}>{title}</Text>
                          <Code>{subtitle}</Code>
                        </Group>
                        <Group gap="xs" wrap="nowrap">
                          <Text size="sm" c="var(--sm-color-subtext)" w={140}>
                            Branch / HEAD:
                          </Text>
                          <Code>
                            {repo.branch} @ {repo.headSha.slice(0, 12)}
                          </Code>
                        </Group>
                        {cleanAndUpToDate ? (
                          <Text size="sm" c="var(--sm-color-subtext)">
                            Clean and up to date with remote.
                          </Text>
                        ) : null}
                        {willCommit ? (
                          <Stack gap={2}>
                            <Text size="sm">
                              Will auto-commit {repo.trackedDirtyFiles.length} tracked
                              file{repo.trackedDirtyFiles.length === 1 ? "" : "s"}:
                            </Text>
                            <Box
                              p="xs"
                              style={{
                                background: "var(--sm-color-surface2)",
                                borderRadius: 6,
                                fontFamily: "var(--mantine-font-family-monospace)",
                                fontSize: 12
                              }}
                            >
                              {repo.trackedDirtyFiles.slice(0, 12).map((path) => (
                                <div key={path}>{path}</div>
                              ))}
                              {repo.trackedDirtyFiles.length > 12 ? (
                                <div>
                                  ...and {repo.trackedDirtyFiles.length - 12} more
                                </div>
                              ) : null}
                            </Box>
                          </Stack>
                        ) : null}
                        {willPush ? (
                          <Text size="sm">
                            Will push to <Code>origin/{repo.branch}</Code>
                            {repo.aheadCount > 0 && !willCommit
                              ? ` (${repo.aheadCount} commit${repo.aheadCount === 1 ? "" : "s"} ahead)`
                              : ""}
                            .
                          </Text>
                        ) : null}
                        {repo.untrackedFiles.length > 0 ? (
                          <Stack gap={2}>
                            <Text size="sm" c="var(--sm-color-subtext)">
                              Untracked (skipped — add with{" "}
                              <Code>git add</Code> if you want them shipped):
                            </Text>
                            <Box
                              p="xs"
                              style={{
                                background: "var(--sm-color-surface2)",
                                borderRadius: 6,
                                fontFamily: "var(--mantine-font-family-monospace)",
                                fontSize: 12
                              }}
                            >
                              {repo.untrackedFiles.slice(0, 8).map((path) => (
                                <div key={path}>{path}</div>
                              ))}
                              {repo.untrackedFiles.length > 8 ? (
                                <div>
                                  ...and {repo.untrackedFiles.length - 8} more
                                </div>
                              ) : null}
                            </Box>
                          </Stack>
                        ) : null}
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            ) : (
              <Box
                p="sm"
                style={{
                  border: "1px solid var(--sm-color-surface3)",
                  borderRadius: 8,
                  background: "var(--sm-color-surface1)"
                }}
              >
                <Stack gap="xs">
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" c="var(--sm-color-subtext)" w={120}>
                      Ref:
                    </Text>
                    <Code>{deployWorkflowState.ref ?? "(unknown)"}</Code>
                  </Group>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" c="var(--sm-color-subtext)" w={120}>
                      HEAD sha:
                    </Text>
                    <Code>
                      {deployWorkflowState.headSha
                        ? deployWorkflowState.headSha.slice(0, 12)
                        : "(unknown)"}
                    </Code>
                  </Group>
                </Stack>
              </Box>
            )}
            <Group justify="flex-end">
              <Button
                variant="subtle"
                onClick={() => setDeployWorkflowState(null)}
              >
                Cancel
              </Button>
              <Button onClick={() => void dispatchDeployWorkflow()}>
                Deploy
              </Button>
            </Group>
          </Stack>
        ) : null}

        {deployWorkflowState?.phase === "preview-failed" ? (
          <Stack>
            <Alert color="red" variant="light" title="Pre-flight failed">
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {deployWorkflowState.reason}
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button onClick={() => setDeployWorkflowState(null)}>Close</Button>
            </Group>
          </Stack>
        ) : null}

        {deployWorkflowState?.phase === "dispatching" ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm">Dispatching workflow...</Text>
          </Group>
        ) : null}

        {deployWorkflowState?.phase === "dispatch-failed" ? (
          <Stack>
            <Alert color="red" variant="light" title="Dispatch failed">
              <Stack gap="xs">
                <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                  {deployWorkflowState.reason}
                </Text>
                {deployWorkflowState.stdout.trim() ? (
                  <Code block>{deployWorkflowState.stdout}</Code>
                ) : null}
                {deployWorkflowState.stderr.trim() ? (
                  <Code block>{deployWorkflowState.stderr}</Code>
                ) : null}
              </Stack>
            </Alert>
            <Group justify="flex-end">
              <Button
                variant="subtle"
                onClick={() => setDeployWorkflowState(null)}
              >
                Close
              </Button>
              <Button onClick={() => void openDeployWorkflowModal()}>
                Try Again
              </Button>
            </Group>
          </Stack>
        ) : null}

        {deployWorkflowState?.phase === "tracking" ? (
          <Stack>
            <Alert
              color={
                deployWorkflowState.conclusion === "success"
                  ? "green"
                  : deployWorkflowState.conclusion === null
                    ? "blue"
                    : "red"
              }
              variant="light"
              title={
                deployWorkflowState.conclusion === "success"
                  ? "Deploy succeeded"
                  : deployWorkflowState.conclusion === null
                    ? `In progress (${deployWorkflowState.status})`
                    : `Deploy ${deployWorkflowState.conclusion}`
              }
            >
              <Stack gap="xs">
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" c="var(--sm-color-subtext)" w={80}>
                    Ref:
                  </Text>
                  <Code>{deployWorkflowState.ref}</Code>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" c="var(--sm-color-subtext)" w={80}>
                    Sha:
                  </Text>
                  <Code>{deployWorkflowState.headSha.slice(0, 12)}</Code>
                </Group>
                <Group gap="xs">
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() =>
                      window.open(
                        deployWorkflowState.runUrl,
                        "_blank",
                        "noopener,noreferrer"
                      )
                    }
                  >
                    View on GitHub
                  </Button>
                </Group>
              </Stack>
            </Alert>
            <Stack gap={4}>
              <Text size="xs" fw={600} tt="uppercase" c="var(--sm-color-subtext)">
                Jobs
              </Text>
              {deployWorkflowState.jobs.length === 0 ? (
                <Text size="sm" c="var(--sm-color-overlay0)">
                  Waiting for GitHub Actions to schedule the jobs...
                </Text>
              ) : (
                deployWorkflowState.jobs.map((job) => (
                  <Group
                    key={job.url}
                    justify="space-between"
                    wrap="nowrap"
                    align="center"
                  >
                    <Group gap="xs" wrap="nowrap">
                      <Badge
                        size="sm"
                        variant="light"
                        color={
                          job.conclusion === "success"
                            ? "green"
                            : job.conclusion === null
                              ? "blue"
                              : "red"
                        }
                      >
                        {job.conclusion ?? job.status}
                      </Badge>
                      <Text size="sm">{job.name}</Text>
                    </Group>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() =>
                        window.open(job.url, "_blank", "noopener,noreferrer")
                      }
                    >
                      Logs
                    </Button>
                  </Group>
                ))
              )}
            </Stack>
            {deployWorkflowState.conclusion &&
            deployWorkflowState.conclusion !== "success" ? (
              <Group justify="flex-end">
                <Button
                  variant="filled"
                  color="grape"
                  onClick={() =>
                    void rerunFailedJobs(deployWorkflowState.runId)
                  }
                >
                  Re-run failed jobs
                </Button>
              </Group>
            ) : null}
            <Group justify="flex-end">
              <Button
                variant="subtle"
                onClick={() => setDeployWorkflowState(null)}
              >
                Close
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Modal>

      {isProvision && plan?.warnings.length ? (
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

      {isProvision && plan?.conflicts.length ? (
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

      {isProvision ? (
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
      ) : null}

    </Stack>
  );
}

// Story 46.5 — SugarDeploy now contributes three Publish-productmode
// workspaces (Provision / Release / Deploy). Each shares the same
// SugarDeployCenterPanel underlying renderer but passes a different
// `view` prop so the panel knows which slice of UI to show. The
// PluginShellContributionDefinition above (catalog/sugardeploy/index.ts)
// declares the matching PluginPublishWorkspaceContribution metadata
// (label + icon + order); the App.tsx wiring zips that metadata with
// the createWorkspaceView output from these definitions.
export const pluginWorkspaceDefinitions: StudioPluginWorkspaceDefinition[] = [
  {
    pluginId: SUGARDEPLOY_PLUGIN_ID,
    workspaceKind: "sugardeploy-provision",
    productMode: "publish",
    createWorkspaceView(props) {
      return {
        leftPanel: null,
        rightPanel: null,
        centerPanel: <SugarDeployCenterPanel {...props} view="provision" />,
        viewportOverlay: null
      };
    }
  },
  {
    pluginId: SUGARDEPLOY_PLUGIN_ID,
    workspaceKind: "sugardeploy-release",
    productMode: "publish",
    createWorkspaceView(props) {
      return {
        leftPanel: null,
        rightPanel: null,
        centerPanel: <SugarDeployCenterPanel {...props} view="release" />,
        viewportOverlay: null
      };
    }
  },
  {
    pluginId: SUGARDEPLOY_PLUGIN_ID,
    workspaceKind: "sugardeploy-deploy",
    productMode: "publish",
    createWorkspaceView(props) {
      return {
        leftPanel: null,
        rightPanel: null,
        centerPanel: <SugarDeployCenterPanel {...props} view="deploy" />,
        viewportOverlay: null
      };
    }
  }
];
