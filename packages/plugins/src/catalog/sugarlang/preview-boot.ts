/**
 * packages/plugins/src/catalog/sugarlang/preview-boot.ts
 *
 * Purpose: Builds the sugarlang-specific Preview boot payload from authored project state.
 *
 * Exports:
 *   - buildSugarlangPreviewBootPayloadForSession
 *
 * Relationships:
 *   - Depends on the authored session as the source of truth for scene content.
 *   - Bridges Studio preview handoff to the runtime-side compile cache seeding path.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import {
  getActiveScene,
  getAllRegions,
  type AuthoringSession,
  getAllQuestDefinitionsInEpisodes,
  getAllEpisodes
} from "@sugarmagic/domain";
import type { RuntimePluginEnvironment } from "../../runtime";
import { resolveSugarLangTargetLanguage } from "./config";
import { MorphologyLoader } from "./runtime/classifier/morphology-loader";
import { IndexedDBCompileCache } from "./runtime/compile/cache-indexeddb";
import { IndexedDBSceneContextCache } from "./runtime/compile/scene-context-cache";
import { compileSugarlangScene } from "./runtime/compile/compile-sugarlang-scene";
import {
  resolveSceneAuthoringContexts,
  resolveSugarlangGatewayBaseUrl,
  SugarlangGatewayLoreClient
} from "./runtime/compile/lore-resolution";
import {
  buildSugarlangPreviewBootPayload,
  type SugarlangPreviewBootPayload
} from "./runtime/compile/preview-boot";
import { CefrLexAtlasProvider } from "./runtime/providers/impls/cefr-lex-atlas-provider";

/**
 * The project's authored target language -- the config rung of the single
 * resolver, read from the same place Studio's Language panel writes it.
 */
function readSugarlangConfiguredTargetLanguage(
  session: AuthoringSession
): string | null {
  const entry = session.gameProject.pluginConfigurations.find(
    (configuration) => configuration.pluginId === "sugarlang"
  );
  const value = (entry?.config as { targetLanguage?: unknown } | undefined)
    ?.targetLanguage;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export async function buildSugarlangPreviewBootPayloadForSession(
  session: AuthoringSession,
  workspaceId: string,
  environment: RuntimePluginEnvironment | undefined
): Promise<SugarlangPreviewBootPayload | null> {
  const studioWorkspaceId = `sugarlang-studio:${session.gameProject.identity.id}`;
  // NULL MEANS "NO PAYLOAD", NOT "EMPTY PAYLOAD", AND THE CALLER DECIDES.
  //
  // This used to throw, which put the runtime's opinion inside a builder Studio
  // calls -- and because the call sits inside `postMessage`'s argument list, the
  // throw meant PREVIEW_BOOT was never sent at all: a blank preview and no error.
  // Before that it returned an EMPTY payload, which is how a misconfigured
  // preview booted "successfully" with nothing to teach for months.
  //
  // Neither. It returns null, and `postPreviewBootMessage` refuses to launch the
  // preview with a visible error -- the only place that knows whether sugarlang
  // is even enabled for this project.
  const targetLanguage = resolveSugarLangTargetLanguage({
    config: readSugarlangConfiguredTargetLanguage(session)
  });
  if (!targetLanguage) {
    return null;
  }

  const atlas = new CefrLexAtlasProvider();
  const morphology = new MorphologyLoader();
  const cache = new IndexedDBCompileCache({ workspaceId });
  const proxyBaseUrl = resolveSugarlangGatewayBaseUrl(environment);
  const loreClient = proxyBaseUrl
    ? new SugarlangGatewayLoreClient(proxyBaseUrl)
    : null;
  // Compose Base + the active Scene's overlay per region. NPC presences are
  // OVERLAY-ONLY in the composed view (migrate.ts composeRegionContents), so
  // omitting activeScene here excluded every NPC (bio, lore page, bound
  // dialogues) from lexicon compilation -- the queso/Finnick bug (2026-07-27).
  const activeScene = getActiveScene(session);
  const scenes = await resolveSceneAuthoringContexts(
    getAllRegions(session).map((region) => ({
      region,
      activeScene,
      targetLanguage,
      npcDefinitions: session.gameProject.npcDefinitions,
      dialogueDefinitions: session.gameProject.dialogueDefinitions,
      questDefinitions: getAllQuestDefinitionsInEpisodes(
        getAllEpisodes(session.gameProject.seasons)
      ),
      itemDefinitions: session.gameProject.itemDefinitions,
      documentDefinitions: session.gameProject.documentDefinitions
    })),
    loreClient
  );

  for (const scene of scenes) {
    const lexicon = compileSugarlangScene(
      scene,
      atlas,
      morphology,
      "runtime-preview"
    );
    if (!(await cache.has(lexicon.regionId, lexicon.contentHash, lexicon.profile))) {
      await cache.set(lexicon);
    }
  }

  // Scene context rides along when the author has built it. Reading the same
  // IndexedDB the build wrote to is safe HERE and only here: this runs in
  // Studio. The runtime it hands the payload to has no IndexedDB of its own.
  //
  // NOTE the id: `studioWorkspaceId`, NOT the `workspaceId` parameter. Those are
  // different things -- `workspaceId` here is Studio's NAVIGATION workspace
  // ("layout", "quests", ...), while the Rebuild button writes under
  // `sugarlang-studio:{gameProjectId}` (resolveStudioCompileWorkspaceId). The
  // compile cache above survives the mismatch for LEMMAS only: those it can
  // recompute on the fly and repopulate into whatever cache it is handed.
  // Authored CHUNKS it cannot -- extracting them is a Studio-only pass, so the
  // wrong id yields a chunk-less lexicon that looks identical to a scene with
  // no chunks (`sugarmagic-scene-vocab-o8f`). Scene context cannot survive it
  // either: building that is a gateway call, so reading the wrong id means
  // silently shipping no situations, ever.
  const payload = await buildSugarlangPreviewBootPayload(
    scenes,
    cache,
    atlas,
    morphology,
    new IndexedDBSceneContextCache({ workspaceId: studioWorkspaceId })
  );
  return { ...payload, studioWorkspaceId };
}
