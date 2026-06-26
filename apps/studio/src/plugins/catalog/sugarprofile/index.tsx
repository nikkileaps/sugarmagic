/**
 * apps/studio/src/plugins/catalog/sugarprofile/index.tsx
 *
 * Purpose: Hand-written Studio workspace for SugarProfile. The
 * existence of this file overrides Plan 046's schema-auto-mount
 * for the `sugarprofile` workspaceKind — the manual catalog wins,
 * which is the documented escape hatch when a plugin needs custom
 * UI alongside its schema-rendered config.
 *
 * Renders two halves stacked:
 *   1. Schema-rendered Supabase config panel (Supabase URL, anon
 *      key, allow-anonymous) via `<PluginSchemaSettingsPanel>`.
 *   2. Session Inspector dev panel (Plan 047 §47.5.5 Surface B):
 *      Current User view, Current Save view, Dev Actions (Seed
 *      Save / Clear Save / Regenerate Anonymous User).
 *
 * The Session Inspector constructs the same default identity +
 * save providers App.tsx and preview.ts construct, so the panel
 * sees the same persisted record the runtime sees. Once 47.7+
 * lands a Supabase-backed identity/save, this panel will see the
 * Supabase user instead of the anonymous-local default through the
 * same resolver mechanism.
 *
 * Implements: Plan 047 §Story 47.6 (scaffold + Session Inspector
 * dev panel).
 *
 * Status: active
 */

import {
  Alert,
  Box,
  Button,
  Code,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput
} from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import {
  createAnonymousLocalIdentityProvider,
  createIndexedDBGameSaveStore,
  GAME_SAVE_SCHEMA_VERSION,
  type GameSave,
  type GameSaveStore,
  type User,
  type UserIdentityProvider
} from "@sugarmagic/runtime-core";
import {
  getDeploymentSettings,
  SUGARPROFILE_PLUGIN_ID
} from "@sugarmagic/plugins";
import { IdChip } from "@sugarmagic/ui";
import type {
  PluginWorkspaceViewProps,
  StudioPluginWorkspaceDefinition
} from "../../sdk";
import { PluginSchemaSettingsPanel } from "../../PluginSchemaSettingsPanel";

// Mirror of anonymous-local.ts's internal STORAGE_KEY constant.
// Duplicated rather than exported because the constant is an
// implementation detail of the default provider; the dev panel is
// the only sanctioned caller that pokes localStorage directly.
const ANONYMOUS_LOCAL_STORAGE_KEY = "sugarmagic.anonymous-user-id";

function formatPosition(
  position: { x: number; y: number; z: number } | null
): string {
  if (!position) return "(none)";
  return `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`;
}

function SugarProfileWorkspaceContent(props: PluginWorkspaceViewProps) {
  const { gameProject, gameProjectId, pluginConfigurations, onCommand } = props;

  // Anonymous-local + IndexedDB defaults — same instances the
  // published-web bundle and Studio preview construct. SugarProfile's
  // own runtime contributions (47.7+) will override at the runtime
  // contribution layer; the Studio dev panel still uses the defaults
  // for direct read/write of the persisted record.
  const [providers, setProviders] = useState<{
    identityProvider: UserIdentityProvider;
    saveStore: GameSaveStore;
  } | null>(() => {
    try {
      return {
        identityProvider: createAnonymousLocalIdentityProvider(),
        saveStore: createIndexedDBGameSaveStore()
      };
    } catch (error) {
      console.warn("[sugarprofile] default providers failed", error);
      return null;
    }
  });

  const [user, setUser] = useState<User | null>(() =>
    providers ? (providers.identityProvider.currentUser() ?? null) : null
  );
  const [save, setSave] = useState<GameSave | null>(null);
  const [saveLoadError, setSaveLoadError] = useState<string | null>(null);

  function refreshUser() {
    if (!providers) return;
    try {
      setUser(providers.identityProvider.currentUser());
    } catch (error) {
      console.warn("[sugarprofile] currentUser failed", error);
      setUser(null);
    }
  }

  const refreshSave = useMemo(() => {
    return async function refreshSave() {
      if (!providers || !user) {
        setSave(null);
        return;
      }
      try {
        const next = await providers.saveStore.load(user.userId);
        setSave(next);
        setSaveLoadError(null);
      } catch (error) {
        setSaveLoadError(error instanceof Error ? error.message : String(error));
        setSave(null);
      }
    };
  }, [providers, user]);

  useEffect(() => {
    void refreshSave();
  }, [refreshSave]);

  // Seed Save modal state.
  const [seedModalOpen, setSeedModalOpen] = useState(false);
  const [seedRegionId, setSeedRegionId] = useState<string | null>(null);
  const [seedQuestId, setSeedQuestId] = useState("");
  const [seedX, setSeedX] = useState<string | number>(0);
  const [seedY, setSeedY] = useState<string | number>(0);
  const [seedZ, setSeedZ] = useState<string | number>(0);
  const [seedError, setSeedError] = useState<string | null>(null);

  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);

  // Story 47.8 — Apply Migration state. Runs supabase db push via
  // the host endpoint; surfaces stdout/stderr inline.
  type MigrationPhase =
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "success"; stdout: string }
    | { kind: "failed"; reason: string; stdout?: string; stderr?: string };
  const [migrationPhase, setMigrationPhase] = useState<MigrationPhase>({
    kind: "idle"
  });

  // SugarProfile config — used to decide whether Apply Migration
  // should be enabled (need enableLogin + supabaseUrl set).
  const sugarProfileConfig = useMemo(() => {
    const configuration = pluginConfigurations.find(
      (entry) => entry.pluginId === SUGARPROFILE_PLUGIN_ID
    );
    const config = (configuration?.config ?? {}) as Record<string, unknown>;
    return {
      enableLogin: config.enableLogin === true,
      supabaseUrl:
        typeof config.supabaseUrl === "string"
          ? config.supabaseUrl.trim()
          : ""
    };
  }, [pluginConfigurations]);

  const deploymentSettings = useMemo(() => {
    return gameProject ? getDeploymentSettings(gameProject) : null;
  }, [gameProject]);
  const workingDirectory = deploymentSettings?.workingDirectory ?? "";

  // Story 47.8 — Supabase database password. Per-project credential
  // the user sets at project creation time (Project Settings →
  // Database → Database password). The migration runner connects
  // to Postgres directly via `supabase db push --db-url`, which
  // needs this password embedded in the connection string. Stored
  // in browser localStorage — never committed to git, never enters
  // the project's plugin config. Re-paste only when the user nukes
  // browser data or switches machines.
  const DB_PASSWORD_STORAGE_KEY = "sugarmagic.supabase-database-password";
  const [databasePassword, setDatabasePassword] = useState<string>(() => {
    try {
      return window.localStorage.getItem(DB_PASSWORD_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  function persistDatabasePassword(next: string) {
    setDatabasePassword(next);
    try {
      if (next) {
        window.localStorage.setItem(DB_PASSWORD_STORAGE_KEY, next);
      } else {
        window.localStorage.removeItem(DB_PASSWORD_STORAGE_KEY);
      }
    } catch (error) {
      console.warn("[sugarprofile] failed to persist database password", error);
    }
  }

  async function runApplyMigration() {
    if (!workingDirectory) {
      setMigrationPhase({
        kind: "failed",
        reason:
          "SugarDeploy's Working Directory must be set in the Provision workspace before applying migrations."
      });
      return;
    }
    if (!databasePassword) {
      setMigrationPhase({
        kind: "failed",
        reason:
          "Paste your Supabase database password into the field above before applying migrations. Find it at Project Settings → Database → Database password (you can reset it if forgotten)."
      });
      return;
    }
    setMigrationPhase({ kind: "running" });
    try {
      const response = await fetch("/__sugarprofile/run-migration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workingDirectory,
          supabaseUrl: sugarProfileConfig.supabaseUrl,
          databasePassword
        })
      });
      const payload = (await response.json()) as {
        ok: boolean;
        reason?: string;
        stdout?: string;
        stderr?: string;
      };
      if (payload.ok) {
        setMigrationPhase({
          kind: "success",
          stdout: payload.stdout ?? ""
        });
      } else {
        setMigrationPhase({
          kind: "failed",
          reason: payload.reason ?? "Migration failed.",
          stdout: payload.stdout,
          stderr: payload.stderr
        });
      }
    } catch (error) {
      setMigrationPhase({
        kind: "failed",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const regions = gameProject?.regionRegistry ?? [];

  async function handleSeedSubmit() {
    if (!providers || !user || !seedRegionId) return;
    const x = typeof seedX === "number" && Number.isFinite(seedX) ? seedX : 0;
    const y = typeof seedY === "number" && Number.isFinite(seedY) ? seedY : 0;
    const z = typeof seedZ === "number" && Number.isFinite(seedZ) ? seedZ : 0;
    const next: GameSave = {
      userId: user.userId,
      lastPlayed: new Date().toISOString(),
      schemaVersion: GAME_SAVE_SCHEMA_VERSION,
      payload: {
        currentRegionId: seedRegionId,
        currentQuestId: seedQuestId.trim() || null,
        playerPosition: { x, y, z }
      }
    };
    try {
      await providers.saveStore.save(user.userId, next);
      setSeedModalOpen(false);
      setSeedError(null);
      await refreshSave();
    } catch (error) {
      setSeedError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleClearConfirm() {
    if (!providers || !user) return;
    try {
      await providers.saveStore.clear(user.userId);
      setClearConfirmOpen(false);
      await refreshSave();
    } catch (error) {
      console.error("[sugarprofile] clear save failed", error);
    }
  }

  function handleRegenerateConfirm() {
    try {
      window.localStorage.removeItem(ANONYMOUS_LOCAL_STORAGE_KEY);
    } catch (error) {
      console.warn("[sugarprofile] localStorage clear failed", error);
    }
    // Rebuild the provider so the cached uuid in the previous
    // instance doesn't leak into the next render. The new provider
    // sees the cleared localStorage and generates a fresh uuid.
    try {
      const nextIdentity = createAnonymousLocalIdentityProvider();
      const nextSaveStore = providers?.saveStore ?? createIndexedDBGameSaveStore();
      setProviders({
        identityProvider: nextIdentity,
        saveStore: nextSaveStore
      });
      setUser(nextIdentity.currentUser());
    } catch (error) {
      console.error("[sugarprofile] regenerate failed", error);
    }
    setRegenerateConfirmOpen(false);
  }

  return (
    <Stack gap="lg" p="xl" h="100%" style={{ minHeight: 0, overflowY: "auto" }}>
      <PluginSchemaSettingsPanel
        pluginId={SUGARPROFILE_PLUGIN_ID}
        gameProjectId={gameProjectId}
        pluginConfigurations={pluginConfigurations}
        onCommand={onCommand}
      />

      <Box
        style={{
          borderTop: "1px solid var(--sm-color-surface3)",
          paddingTop: "var(--mantine-spacing-md)"
        }}
      >
        <Stack gap="md">
          <Stack gap={4}>
            <Text size="md" fw={700}>
              Session Inspector
            </Text>
            <Text size="sm" c="var(--sm-color-subtext)">
              Live view of the runtime's user-management state. Read + edit the persisted record without browser devtools.
            </Text>
          </Stack>

          <Box
            p="sm"
            style={{
              border: "1px solid var(--sm-color-surface3)",
              borderRadius: 8,
              background: "var(--sm-color-surface1)"
            }}
          >
            <Group justify="space-between" align="center" mb="xs">
              <Text size="sm" fw={600}>
                Current User
              </Text>
              <Button size="xs" variant="subtle" onClick={refreshUser}>
                Refresh
              </Button>
            </Group>
            {user ? (
              <Stack gap={4}>
                <Group gap="xs" wrap="nowrap" align="center">
                  <Text size="xs" c="var(--sm-color-subtext)" w={120}>
                    User ID
                  </Text>
                  <IdChip id={user.userId} />
                </Group>
                <Group gap="xs" wrap="nowrap" align="center">
                  <Text size="xs" c="var(--sm-color-subtext)" w={120}>
                    Anonymous
                  </Text>
                  <Code>{user.isAnonymous ? "yes" : "no"}</Code>
                </Group>
                <Group gap="xs" wrap="nowrap" align="center">
                  <Text size="xs" c="var(--sm-color-subtext)" w={120}>
                    Display Name
                  </Text>
                  <Code>{user.displayName ?? "(none)"}</Code>
                </Group>
                <Group gap="xs" wrap="nowrap" align="center">
                  <Text size="xs" c="var(--sm-color-subtext)" w={120}>
                    Email
                  </Text>
                  <Code>{user.email ?? "(none)"}</Code>
                </Group>
                <Group gap="xs" wrap="nowrap" align="center">
                  <Text size="xs" c="var(--sm-color-subtext)" w={120}>
                    Created
                  </Text>
                  <Code>{user.createdAt}</Code>
                </Group>
              </Stack>
            ) : (
              <Text size="sm" c="var(--sm-color-subtext)">
                No current user (the anonymous-local provider failed to construct).
              </Text>
            )}
          </Box>

          <Box
            p="sm"
            style={{
              border: "1px solid var(--sm-color-surface3)",
              borderRadius: 8,
              background: "var(--sm-color-surface1)"
            }}
          >
            <Group justify="space-between" align="center" mb="xs">
              <Text size="sm" fw={600}>
                Current Save
              </Text>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => void refreshSave()}
              >
                Refresh
              </Button>
            </Group>
            {saveLoadError ? (
              <Alert color="red" variant="light" title="Load failed">
                <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                  {saveLoadError}
                </Text>
              </Alert>
            ) : save ? (
              <Stack gap={4}>
                <Group gap="xs" wrap="nowrap" align="center">
                  <Text size="xs" c="var(--sm-color-subtext)" w={120}>
                    Last Played
                  </Text>
                  <Code>{save.lastPlayed}</Code>
                </Group>
                <Group gap="xs" wrap="nowrap" align="center">
                  <Text size="xs" c="var(--sm-color-subtext)" w={120}>
                    Region
                  </Text>
                  <Code>{save.payload.currentRegionId ?? "(none)"}</Code>
                </Group>
                <Group gap="xs" wrap="nowrap" align="center">
                  <Text size="xs" c="var(--sm-color-subtext)" w={120}>
                    Quest
                  </Text>
                  <Code>{save.payload.currentQuestId ?? "(none)"}</Code>
                </Group>
                <Group gap="xs" wrap="nowrap" align="center">
                  <Text size="xs" c="var(--sm-color-subtext)" w={120}>
                    Position
                  </Text>
                  <Code>{formatPosition(save.payload.playerPosition)}</Code>
                </Group>
                <Group gap="xs" wrap="nowrap" align="center">
                  <Text size="xs" c="var(--sm-color-subtext)" w={120}>
                    Schema Ver
                  </Text>
                  <Code>{save.schemaVersion}</Code>
                </Group>
              </Stack>
            ) : (
              <Text size="sm" c="var(--sm-color-subtext)">
                No save yet for this user.
              </Text>
            )}
          </Box>

          <Box
            p="sm"
            style={{
              border: "1px solid var(--sm-color-surface3)",
              borderRadius: 8,
              background: "var(--sm-color-surface1)"
            }}
          >
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Dev Actions
              </Text>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="filled"
                  disabled={!user || regions.length === 0}
                  onClick={() => {
                    setSeedRegionId(regions[0]?.regionId ?? null);
                    setSeedError(null);
                    setSeedModalOpen(true);
                  }}
                >
                  Seed Save
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  disabled={!user || !save}
                  onClick={() => setClearConfirmOpen(true)}
                >
                  Clear Save
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  disabled={!user?.isAnonymous}
                  onClick={() => setRegenerateConfirmOpen(true)}
                >
                  Regenerate Anonymous User
                </Button>
              </Group>
              {regions.length === 0 ? (
                <Text size="xs" c="var(--sm-color-subtext)">
                  Seed Save needs at least one region in the project's regionRegistry.
                </Text>
              ) : null}
              {user && !user.isAnonymous ? (
                <Text size="xs" c="var(--sm-color-subtext)">
                  Regenerate Anonymous User only applies to the anonymous-local provider — sign out via SugarProfile to switch users when credentialed.
                </Text>
              ) : null}
            </Stack>
          </Box>

          <Box
            p="sm"
            style={{
              border: "1px solid var(--sm-color-surface3)",
              borderRadius: 8,
              background: "var(--sm-color-surface1)"
            }}
          >
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Database Schema
              </Text>
              <Text size="xs" c="var(--sm-color-subtext)">
                Applies <Code>deployment/supabase/migrations/</Code> to the configured Supabase project. Uses the workspace-pinned Supabase CLI (no global install needed) authenticated via the Personal Access Token below.
              </Text>
              <PasswordInput
                label="Supabase Database Password"
                description={
                  <Text size="xs" c="var(--sm-color-subtext)">
                    Project Settings → Database → Database password in the Supabase dashboard. (You can reset it there if forgotten — won't break anything.) Stored in this browser only (localStorage); never committed to git, never sent anywhere except the local migration endpoint.
                  </Text>
                }
                placeholder="password..."
                value={databasePassword}
                onChange={(event) =>
                  persistDatabasePassword(event.currentTarget.value)
                }
                autoComplete="off"
              />
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="filled"
                  loading={migrationPhase.kind === "running"}
                  disabled={
                    !sugarProfileConfig.enableLogin ||
                    !sugarProfileConfig.supabaseUrl ||
                    !workingDirectory ||
                    !databasePassword ||
                    migrationPhase.kind === "running"
                  }
                  onClick={() => void runApplyMigration()}
                >
                  Apply SugarProfile Migration
                </Button>
              </Group>
              {!sugarProfileConfig.enableLogin ? (
                <Text size="xs" c="var(--sm-color-subtext)">
                  Enable Login at the top of this workspace first; migrations only apply when SugarProfile is contributing identity / save / profile stores.
                </Text>
              ) : !sugarProfileConfig.supabaseUrl ? (
                <Text size="xs" c="var(--sm-color-subtext)">
                  Supabase URL must be configured before the migration knows which project to target.
                </Text>
              ) : !workingDirectory ? (
                <Text size="xs" c="var(--sm-color-subtext)">
                  Set SugarDeploy's Working Directory (Provision workspace) before applying migrations.
                </Text>
              ) : !databasePassword ? (
                <Text size="xs" c="var(--sm-color-subtext)">
                  Paste your Supabase database password above before applying migrations.
                </Text>
              ) : null}
              {migrationPhase.kind === "success" ? (
                <Alert color="green" variant="light" title="Migration applied">
                  <Stack gap={4}>
                    <Text size="sm">
                      <Code>supabase db push</Code> succeeded. New auth signups will get a profile row auto-created; save loads + writes now hit <Code>public.game_save</Code>.
                    </Text>
                    {migrationPhase.stdout.trim() ? (
                      <Code block>{migrationPhase.stdout.trim()}</Code>
                    ) : null}
                  </Stack>
                </Alert>
              ) : null}
              {migrationPhase.kind === "failed" ? (
                <Alert color="red" variant="light" title="Migration failed">
                  <Stack gap={4}>
                    <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                      {migrationPhase.reason}
                    </Text>
                    {migrationPhase.stdout?.trim() ? (
                      <Stack gap={2}>
                        <Text size="xs" c="var(--sm-color-subtext)">
                          stdout
                        </Text>
                        <Code block>{migrationPhase.stdout.trim()}</Code>
                      </Stack>
                    ) : null}
                    {migrationPhase.stderr?.trim() ? (
                      <Stack gap={2}>
                        <Text size="xs" c="var(--sm-color-subtext)">
                          stderr
                        </Text>
                        <Code block>{migrationPhase.stderr.trim()}</Code>
                      </Stack>
                    ) : null}
                  </Stack>
                </Alert>
              ) : null}
            </Stack>
          </Box>
        </Stack>
      </Box>

      <Modal
        opened={seedModalOpen}
        onClose={() => setSeedModalOpen(false)}
        title="Seed Save"
        centered
      >
        <Stack>
          <Text size="sm">
            Writes a fresh <Code>GameSave</Code> for the current user. The next runtime boot will hydrate from these values instead of the authored defaults from <Code>boot.json</Code>.
          </Text>
          <Select
            label="Region"
            placeholder="Pick a region"
            required
            data={regions.map((entry) => ({
              value: entry.regionId,
              label: entry.regionId
            }))}
            value={seedRegionId}
            onChange={setSeedRegionId}
          />
          <Group grow>
            <NumberInput
              label="X"
              value={seedX}
              onChange={setSeedX}
              decimalScale={2}
              fixedDecimalScale
            />
            <NumberInput
              label="Y"
              value={seedY}
              onChange={setSeedY}
              decimalScale={2}
              fixedDecimalScale
            />
            <NumberInput
              label="Z"
              value={seedZ}
              onChange={setSeedZ}
              decimalScale={2}
              fixedDecimalScale
            />
          </Group>
          <TextInput
            label="Current Quest ID"
            description="Optional. Blank persists as null in the save record."
            value={seedQuestId}
            onChange={(event) => setSeedQuestId(event.currentTarget.value)}
          />
          {seedError ? (
            <Alert color="red" variant="light">
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {seedError}
              </Text>
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setSeedModalOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!seedRegionId}
              onClick={() => void handleSeedSubmit()}
            >
              Seed
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        title="Clear Save"
        centered
      >
        <Stack>
          <Text size="sm">
            Permanently delete the persisted save for this user. Next playtest open will spawn at the region's authored defaults.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setClearConfirmOpen(false)}>
              Cancel
            </Button>
            <Button color="red" onClick={() => void handleClearConfirm()}>
              Clear
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={regenerateConfirmOpen}
        onClose={() => setRegenerateConfirmOpen(false)}
        title="Regenerate Anonymous User"
        centered
      >
        <Stack>
          <Text size="sm">
            Clears the locally-stored anonymous user id. The next access generates a fresh UUID, and the runtime treats this browser as a brand-new player.
          </Text>
          <Text size="sm" c="var(--sm-color-subtext)">
            The previous user's IndexedDB save record remains on disk (orphaned by the new uuid). Use <b>Clear Save</b> first if you want a fully fresh start.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="subtle"
              onClick={() => setRegenerateConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button color="red" onClick={handleRegenerateConfirm}>
              Regenerate
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export const pluginWorkspaceDefinition: StudioPluginWorkspaceDefinition = {
  pluginId: SUGARPROFILE_PLUGIN_ID,
  workspaceKind: SUGARPROFILE_PLUGIN_ID,
  createWorkspaceView(props) {
    return {
      // The schema panel + Session Inspector both need horizontal
      // breathing room (URL/anon-key text inputs, position x/y/z
      // grid inputs). The center panel gives that; the left panel
      // is sidebar-width and clipped the content during 47.6 dev.
      // The left panel will eventually carry saved-profiles UI —
      // named bundles of "Supabase URL + anon key + allow-anon
      // flag" the author can switch between (dev vs. staging vs.
      // prod projects). Future story.
      leftPanel: null,
      rightPanel: null,
      centerPanel: <SugarProfileWorkspaceContent {...props} />,
      viewportOverlay: null
    };
  }
};
