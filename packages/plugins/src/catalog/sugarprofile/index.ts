/**
 * packages/plugins/src/catalog/sugarprofile/index.ts
 *
 * Purpose: Bundled plugin definition for SugarProfile — the
 * Supabase-backed user identity + game-save plugin (Plan 047).
 *
 * This story (47.6) lands the scaffold only: the plugin appears in
 * the Studio catalog, contributes a Design workspace, and exposes
 * its Supabase config fields through the Plan 046 schema-rendered
 * settings panel. No runtime identity / save behavior wires up
 * yet — that's 47.7 (SupabaseIdentityProvider), 47.8
 * (SupabaseGameSaveStore + Postgres migration), and 47.9 (gateway-
 * side JWT validation). Until those land, an enabled SugarProfile
 * is functionally equivalent to "no plugin" — the runtime falls
 * through to the anonymous-local + IndexedDB defaults baked into
 * runtime-core.
 *
 * Implements: Plan 047 §Story 47.6
 *
 * Status: active
 */

import {
  createDeploymentRequirementId,
  type DeploymentRequirement
} from "@sugarmagic/domain";
import type { DiscoveredPluginDefinition } from "../../sdk";
import { createSupabaseIdentityProvider } from "./runtime/identity";

export const SUGARPROFILE_PLUGIN_ID = "sugarprofile";

export interface SugarProfilePluginConfig {
  /** Master toggle for the entire SugarProfile contribution. When
   *  false (the default), SugarProfile contributes NOTHING at
   *  runtime — anonymous-local stays active and the published-web
   *  bundle renders no login UI. Daily Studio authoring runs with
   *  this off so the game author doesn't have to sign in on every
   *  Playtest. Flip on to test login flows or before deploying to
   *  an environment that wants real accounts. */
  enableLogin: boolean;
  /** Supabase project URL — e.g. `https://abcde.supabase.co`.
   *  Required when `enableLogin` is true. */
  supabaseUrl: string;
  /** Supabase anon key. Non-secret per Supabase's auth model: the
   *  anon key permits row-level-security-gated reads only. The
   *  service role key is separate and lives in Secret Manager.
   *  Required when `enableLogin` is true. */
  supabaseAnonKey: string;
  /** When true (default), new players are signed in anonymously on
   *  first page load; "Sign In" is an upgrade affordance, not a
   *  gate. When false, the runtime refuses to construct a Supabase
   *  session without explicit sign-in. Only consulted when
   *  `enableLogin` is true. */
  allowAnonymous: boolean;
}

export function normalizeSugarProfilePluginConfig(
  config: Record<string, unknown> | null | undefined
): SugarProfilePluginConfig {
  return {
    enableLogin: config?.enableLogin === true,
    supabaseUrl:
      typeof config?.supabaseUrl === "string"
        ? config.supabaseUrl.trim()
        : "",
    supabaseAnonKey:
      typeof config?.supabaseAnonKey === "string"
        ? config.supabaseAnonKey.trim()
        : "",
    allowAnonymous: config?.allowAnonymous !== false
  };
}

// Story 47.6 — server-only secrets the gateway side needs once
// 47.8 / 47.9 land. The migration runner needs the service-role key
// (RLS-bypass for `supabase db push`); the gateway JWT verifier
// needs the project's JWT secret to validate Bearer tokens. Both
// stay private + server-only — they never enter the browser bundle
// or Studio React state.
//
// mappingHints don't carry the SUGARMAGIC_<PLUGIN>_ prefix because
// they describe Supabase-level concerns, not SugarProfile internals.
// validateGatewayRuntimeConfigKey enforces the plugin-prefixed
// pattern only on `gatewayRuntimeConfigKeys`, not on secrets — so
// the simpler `SUGARMAGIC_SUPABASE_*` shape is fine here.
const deploymentRequirements: DeploymentRequirement[] = [
  {
    requirementId: createDeploymentRequirementId({
      ownerId: SUGARPROFILE_PLUGIN_ID,
      kind: "secret",
      key: "supabase-service-role-key"
    }),
    ownerId: SUGARPROFILE_PLUGIN_ID,
    ownerKind: "plugin",
    kind: "secret",
    required: true,
    secretKey: "supabase-service-role-key",
    consumption: "server-only",
    exposure: "private",
    mappingHint: "SUGARMAGIC_SUPABASE_SERVICE_ROLE_KEY",
    description:
      "Supabase service-role key — RLS-bypass admin credential used by the migration runner and the gateway for trusted server-side reads. Never bundled to the browser.",
    tags: ["supabase", "auth", "server"]
  },
  {
    requirementId: createDeploymentRequirementId({
      ownerId: SUGARPROFILE_PLUGIN_ID,
      kind: "secret",
      key: "supabase-jwt-secret"
    }),
    ownerId: SUGARPROFILE_PLUGIN_ID,
    ownerKind: "plugin",
    kind: "secret",
    required: true,
    secretKey: "supabase-jwt-secret",
    consumption: "server-only",
    exposure: "private",
    mappingHint: "SUGARMAGIC_SUPABASE_JWT_SECRET",
    description:
      "Supabase JWT secret — used by the gateway-side JWT verification middleware (Plan 047 §47.9) to validate Bearer tokens against the project's signing key.",
    tags: ["supabase", "auth", "server", "jwt"]
  }
];

export const pluginDefinition: DiscoveredPluginDefinition = {
  manifest: {
    pluginId: SUGARPROFILE_PLUGIN_ID,
    displayName: "SugarProfile",
    summary:
      "User identity + game saves via Supabase. Anonymous players auto sign-in on first boot; email/password upgrades the anonymous account in place.",
    capabilityIds: ["identity.provider", "save.store", "design.workspace"]
  },
  defaultConfig: {
    enableLogin: false,
    supabaseUrl: "",
    supabaseAnonKey: "",
    allowAnonymous: true
  },
  deploymentRequirements,
  // Story 47.6 — schema-rendered settings panel via the Plan 046
  // auto-mount. The Studio-side hand-written workspace
  // (apps/studio/src/plugins/catalog/sugarprofile/index.tsx) embeds
  // this same schema via <PluginSchemaSettingsPanel> alongside the
  // Session Inspector dev panel.
  pluginSettingsSchema: [
    {
      configKey: "enableLogin",
      label: "Enable Login",
      type: "boolean",
      group: "User Accounts",
      default: false
    },
    {
      configKey: "supabaseUrl",
      label: "Supabase URL",
      type: "text",
      group: "Supabase Project",
      description:
        "Project URL from your Supabase dashboard. Example: https://abcde.supabase.co",
      placeholder: "https://your-project.supabase.co",
      showWhen: { configKey: "enableLogin", equals: true }
    },
    {
      configKey: "supabaseAnonKey",
      label: "Supabase Anon Key",
      type: "text",
      group: "Supabase Project",
      description:
        "The `anon` key from the Supabase project's API settings. Public — RLS protects the underlying tables. The service role key lives in Secret Manager.",
      placeholder: "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
      showWhen: { configKey: "enableLogin", equals: true }
    },
    {
      configKey: "allowAnonymous",
      label: "Allow Anonymous Sign-In",
      type: "boolean",
      group: "Supabase Project",
      description:
        "When on, new players are signed in anonymously on first boot. Their progress can be migrated up to a credentialed account later via the Sign In affordance.",
      default: true,
      showWhen: { configKey: "enableLogin", equals: true }
    }
  ],
  // Story 47.6 — non-secret per-game runtime config the gateway
  // reads at request time. Plumbed through SugarDeploy's existing
  // gateway runtime config collection (Plan 046 story 46.15) into
  // deploy.sh's --set-env-vars block + the GHA workflow's
  // deploy-backend env block.
  gatewayRuntimeConfigKeys: [
    {
      configKey: "supabaseUrl",
      envVarName: "SUGARMAGIC_SUGARPROFILE_SUPABASE_URL",
      description:
        "The Supabase project URL the gateway uses for server-side admin reads + JWT verification context.",
      nonSecretAttestation: "safe-to-expose-publicly"
    },
    {
      configKey: "supabaseAnonKey",
      envVarName: "SUGARMAGIC_SUGARPROFILE_SUPABASE_ANON_KEY",
      description:
        "The Supabase anon key. Non-secret per Supabase's auth model: RLS gates every row-level read; this key only authorizes the schema introspection the gateway needs to render server-side admin views.",
      nonSecretAttestation: "safe-to-expose-publicly"
    }
  ],
  // Story 47.7 — runtime contribution. The SugarProfile plugin's
  // runtime is what flips identity from anonymous-local (the
  // runtime-core default) over to Supabase. The factory only
  // contributes the identity.provider when the config carries a
  // non-empty URL + anon key — empty config means "scaffold only,
  // no Supabase wiring yet", and the runtime contribution resolver
  // (`resolveActiveIdentityProvider` from 47.2) falls through to
  // the anonymous-local default.
  //
  // 47.8 will add a `save.store` contribution here too, pointing at
  // the Supabase Postgres-backed store. 47.9's gateway JWT
  // middleware is gateway-side, not browser-side, so it doesn't
  // surface here.
  runtime: {
    createRuntimePlugin: ({ configuration }) => {
      const config = normalizeSugarProfilePluginConfig(configuration.config);
      if (!config.enableLogin) {
        console.debug(
          "[sugarprofile] runtime: enableLogin is off; skipping identity.provider contribution. Runtime falls through to anonymous-local default."
        );
        return {
          pluginId: configuration.pluginId,
          displayName: "SugarProfile",
          contributions: []
        };
      }
      const hasSupabaseConfig =
        config.supabaseUrl.length > 0 && config.supabaseAnonKey.length > 0;
      if (!hasSupabaseConfig) {
        console.warn(
          "[sugarprofile] runtime: enableLogin is on but Supabase URL/anon-key are empty; skipping identity.provider contribution. Fill in the SugarProfile settings or toggle enableLogin off."
        );
        return {
          pluginId: configuration.pluginId,
          displayName: "SugarProfile",
          contributions: []
        };
      }
      const provider = createSupabaseIdentityProvider({
        supabaseUrl: config.supabaseUrl,
        supabaseAnonKey: config.supabaseAnonKey,
        allowAnonymous: config.allowAnonymous
      });
      return {
        pluginId: configuration.pluginId,
        displayName: "SugarProfile",
        contributions: [
          {
            pluginId: configuration.pluginId,
            contributionId: "sugarprofile.identity-provider",
            kind: "identity.provider",
            displayName: "Supabase Identity Provider",
            priority: 100,
            payload: {
              providerId: "sugarprofile.supabase-identity",
              summary:
                "Supabase Auth backing. Anonymous sign-in on first boot when allowed; email/password upgrades the anonymous account in place via updateUser.",
              status: "ready",
              provider
            }
          }
        ]
      };
    }
  },
  shell: {
    designWorkspaces: [
      {
        pluginId: SUGARPROFILE_PLUGIN_ID,
        workspaceKind: SUGARPROFILE_PLUGIN_ID,
        label: "SugarProfile",
        icon: "🪪",
        summary:
          "User identity + game saves via Supabase. Configure project credentials and inspect the current player's session."
      }
    ]
  }
};
