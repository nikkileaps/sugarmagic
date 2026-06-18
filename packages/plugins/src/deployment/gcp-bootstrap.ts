// Helpers that back the SugarDeploy "Create GCP Project" lifecycle (story
// 45.4.5). These are pure functions so the testing package can exercise
// the parsing / validation logic without a real gcloud binary. The actual
// command sequencing (gcloud billing accounts list, projects create,
// billing projects link, services enable) lives in the studio middleware
// at apps/studio/vite.config.ts.

const BILLING_ACCOUNT_NAME_PREFIX = "billingAccounts/";

export interface BillingAccountSummary {
  /** Bare id, e.g. `0139AB-705A0F-FCBB0F` — pass directly to `--billing-account`. */
  id: string;
  displayName: string;
  currencyCode?: string;
  /** Master account id (bare form) when this is a sub-account; null otherwise. */
  masterBillingAccountId: string | null;
}

/**
 * Strip the `billingAccounts/` prefix that `gcloud billing accounts list`
 * returns on `name` and `masterBillingAccount` fields. Defensive: tolerates
 * already-bare ids and non-string input.
 */
export function stripBillingAccountPrefix(rawName: unknown): string {
  if (typeof rawName !== "string") return "";
  return rawName.startsWith(BILLING_ACCOUNT_NAME_PREFIX)
    ? rawName.slice(BILLING_ACCOUNT_NAME_PREFIX.length)
    : rawName;
}

/**
 * Parse the JSON output of `gcloud billing accounts list --format=json`,
 * filter to entries where `open: true`, and project to the minimal shape
 * the SugarDeploy "Create GCP Project" button consumes. Accepts either
 * the parsed array or the raw stdout string. Malformed input returns
 * an empty array rather than throwing — the middleware turns that into
 * a "no open billing accounts" UX, not a crash.
 */
export function parseBillingAccountList(raw: unknown): BillingAccountSummary[] {
  let arr: unknown;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr)) return [];

  const accounts: BillingAccountSummary[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.open !== true) continue;

    const id = stripBillingAccountPrefix(record.name);
    if (!id) continue;

    const displayName =
      typeof record.displayName === "string" && record.displayName.length > 0
        ? record.displayName
        : id;
    const currencyCode =
      typeof record.currencyCode === "string" && record.currencyCode.length > 0
        ? record.currencyCode
        : undefined;
    const masterRaw =
      typeof record.masterBillingAccount === "string"
        ? record.masterBillingAccount
        : "";
    const masterBillingAccountId =
      masterRaw.length > 0 ? stripBillingAccountPrefix(masterRaw) : null;

    accounts.push({ id, displayName, currencyCode, masterBillingAccountId });
  }
  return accounts;
}

/**
 * GCP project ids are globally unique and must match:
 *   - lowercase letter start
 *   - lowercase letters, digits, hyphens
 *   - end with letter or digit
 *   - 6–30 characters total
 * Pre-flighted before issuing `gcloud projects create` so we surface the
 * rule at the form-field level instead of as a confusing gcloud failure.
 */
export const GCP_PROJECT_ID_REGEX = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export function isValidGcpProjectId(candidate: unknown): candidate is string {
  return typeof candidate === "string" && GCP_PROJECT_ID_REGEX.test(candidate);
}

/**
 * GCP service account account_id rules (the part before `@` in the SA email):
 *   - 6–30 characters
 *   - lowercase letter start
 *   - lowercase letters, digits, hyphens
 *   - end with letter or digit
 * Same shape as GCP_PROJECT_ID_REGEX but documented separately so the
 * intent is clear at the call site and so the two rules can diverge later
 * if Google changes one. Validated client-side in the SugarDeploy form to
 * surface the rule before a gcloud failure rather than after.
 */
export const GCP_SERVICE_ACCOUNT_ID_REGEX = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export const GCP_SERVICE_ACCOUNT_ID_MAX_LENGTH = 30;

export function isValidGcpServiceAccountId(candidate: unknown): candidate is string {
  return (
    typeof candidate === "string" &&
    GCP_SERVICE_ACCOUNT_ID_REGEX.test(candidate)
  );
}

/**
 * APIs that `gcloud services enable` must turn on for a freshly-created
 * GCP project before Setup Infra's terraform apply can succeed. Source of
 * truth — duplicated nowhere; both the create-gcp-project host action and
 * the README generator read this list. Ordering matters for the test that
 * locks down the contract, not for the gcloud call itself.
 */
export const REQUIRED_GCP_APIS = [
  "run.googleapis.com",
  "artifactregistry.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "secretmanager.googleapis.com",
  "sts.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "serviceusage.googleapis.com"
] as const;

/**
 * Build the human-facing project name that `gcloud projects create --name`
 * persists alongside the id. Convention: `${displayName} v${majorVersion}`,
 * matching the version-namespaced project-id derivation. Free-form text;
 * GCP allows letters/numbers/spaces/hyphens/quotes within 4–30 chars.
 */
export function buildGcpProjectName(
  displayName: string,
  majorVersion: number
): string {
  return `${displayName} v${majorVersion}`;
}

/**
 * Classify the result of an ownership probe — "do I own this GCP project id?"
 *
 * - "owned": this user's account owns the project (we can administer it).
 * - "not-owned": this user doesn't own the project. This is the case for both
 *   "the project doesn't exist anywhere" AND "the project is owned by
 *   someone else globally." GCP's auth APIs intentionally do not distinguish
 *   these two cases (it would leak existence info), so we can't either. The
 *   create-gcp-project endpoint resolves the ambiguity when it actually
 *   attempts to create: success means "didn't exist," ALREADY_EXISTS error
 *   means "someone else has the global id, change the override and retry."
 * - "unknown": the probe itself failed (network, auth, gcloud crash).
 *
 * The corresponding gcloud command is `gcloud projects list --filter="projectId:<id>"
 * --format=json`. We deliberately do NOT use `gcloud projects describe` here
 * because it returns PERMISSION_DENIED for both "doesn't exist" and "no
 * access" — there's no signal to classify on.
 */
export type GcpProjectProbeStatus = "owned" | "not-owned" | "unknown";

export function classifyProjectListResult(
  exitCode: number | null,
  stdout: string
): GcpProjectProbeStatus {
  if (exitCode !== 0) {
    return "unknown";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return "unknown";
  }
  if (!Array.isArray(parsed)) {
    return "unknown";
  }
  return parsed.length > 0 ? "owned" : "not-owned";
}
