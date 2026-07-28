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
  type AuthoringSession
} from "@sugarmagic/domain";
import type { RuntimePluginEnvironment } from "../../runtime";
import { resolveSugarLangTargetLanguage } from "./config";
import { MorphologyLoader } from "./runtime/classifier/morphology-loader";
import { IndexedDBCompileCache } from "./runtime/compile/cache-indexeddb";
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

export async function buildSugarlangPreviewBootPayloadForSession(
  session: AuthoringSession,
  workspaceId: string,
  environment: RuntimePluginEnvironment | undefined
): Promise<SugarlangPreviewBootPayload | null> {
  // Always include studioWorkspaceId regardless of targetLanguage so the
  // preview runtime can open the variant IDB even when no env-var language is set.
  const studioWorkspaceId = `sugarlang-studio:${session.gameProject.identity.id}`;
  const targetLanguage = resolveSugarLangTargetLanguage(environment);
  if (!targetLanguage) {
    return { compiledScenes: [], studioWorkspaceId };
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
      questDefinitions: session.gameProject.questDefinitions,
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
    if (!(await cache.has(lexicon.sceneId, lexicon.contentHash, lexicon.profile))) {
      await cache.set(lexicon);
    }
  }

  const payload = await buildSugarlangPreviewBootPayload(scenes, cache, atlas, morphology);
  return { ...payload, studioWorkspaceId };
}
