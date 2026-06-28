# `packages/plugins`

Plugin capability model and plugin-host integration.

Owns:

- plugin SDK contracts
- plugin lifecycle hooks
- runtime and shell capability seams
- built-in plugin homes

Does not own:

- hidden mutation paths
- core domain ownership

References:

- [API 002: `/packages/plugins` API](/Users/nikki/projects/sugarmagic/docs/api/system-and-package-api.md)
- [Proposal 005: Plugin Capability System](/Users/nikki/projects/sugarmagic/docs/proposals/005-sugarmagic-system-architecture.md)

## Browser-side plugins always proxy through a gateway (story 46.14)

If your plugin's runtime needs to call a third-party API
(Anthropic, OpenAI, an embeddings provider, a vector store, etc.),
ALWAYS route through a server-side proxy. Browser-side plugin code
NEVER reads raw third-party API keys — they would be extractable
from the deployed JS bundle by anyone hitting "view source."

The pattern, made concrete for new plugins:

1. **Declare a proxy URL runtime env key** named
   `SUGARMAGIC_<PLUGIN_KEY>_PROXY_BASE_URL`. Your plugin's
   `normalize<Plugin>PluginConfig` reads it from
   `RuntimePluginEnvironment` and stores it on the runtime config.
2. **Throw at plugin init when it's missing.** Don't fall back to
   a direct-API path. SugarAgent's `createRuntimePlugin` has the
   reference shape:

   ```ts
   if (!config.proxyBaseUrl.trim()) {
     throw new Error(
       "[<plugin>] SUGARMAGIC_<PLUGIN>_PROXY_BASE_URL is not set..."
     );
   }
   ```

3. **Always construct gateway-routed providers/clients** in your
   runtime that hit `${proxyBaseUrl}/api/<plugin>/<route>`. No
   direct `fetch("https://api.anthropic.com/...")` calls anywhere
   in the plugin's browser-side code.
4. **In Studio dev mode**, the "proxy" is the Studio vite-dev-
   server middleware — it terminates the request, reads the local
   `.env` keys, and forwards to the third-party API. Studio's
   `.env` populates `VITE_SUGARMAGIC_<PLUGIN>_PROXY_BASE_URL`
   (typically defaulted to a `/__plugin-proxy/<plugin>` path).
5. **In published-web mode**, the "proxy" is the deployed Cloud
   Run gateway. The GHA `deploy-frontend` job (Plan 053.2) resolves
   the gateway URL via `gcloud run services describe` and injects
   it as `VITE_SUGARMAGIC_GATEWAY_URL` on the engine build step;
   targets/web's `buildConfig.ts` maps that into
   `SUGARMAGIC_<PLUGIN>_PROXY_BASE_URL` for any plugin that hasn't
   set its own override. No plugin work needed for this — your
   plugin only sees the resolved runtime env key.
6. **Model identifiers, vector store ids, and any other
   third-party-API-specific config also live server-side.** Pass
   empty strings from the browser; the gateway defaults them from
   its own configuration (Cloud Run env vars in production, the
   Studio dev `.env` in development).

The reference implementations are SugarAgent (`catalog/sugaragent/`)
and Sugarlang (`catalog/sugarlang/`). Both went through this
refactor as part of story 46.14.
