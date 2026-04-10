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
  getAllRegions,
  type AuthoringSession
} from "@sugarmagic/domain";
import type { RuntimePluginEnvironment } from "../../runtime";
import { resolveSugarLangTargetLanguage } from "./config";
import { MorphologyLoader } from "./runtime/classifier/morphology-loader";
import { IndexedDBCompileCache } from "./runtime/compile/cache-indexeddb";
import { compileSugarlangScene } from "./runtime/compile/compile-sugarlang-scene";
import {
  buildSugarlangPreviewBootPayload,
  type SugarlangPreviewBootPayload
} from "./runtime/compile/preview-boot";
import { createSceneAuthoringContext } from "./runtime/compile/scene-traversal";
import { CefrLexAtlasProvider } from "./runtime/providers/impls/cefr-lex-atlas-provider";

export async function buildSugarlangPreviewBootPayloadForSession(
  session: AuthoringSession,
  workspaceId: string,
  environment: RuntimePluginEnvironment | undefined
): Promise<SugarlangPreviewBootPayload | null> {
  const targetLanguage = resolveSugarLangTargetLanguage(environment);
  if (!targetLanguage) {
    return null;
  }

  const atlas = new CefrLexAtlasProvider();
  const morphology = new MorphologyLoader();
  const cache = new IndexedDBCompileCache({ workspaceId });
  const scenes = getAllRegions(session).map((region) =>
    createSceneAuthoringContext({
      region,
      targetLanguage,
      npcDefinitions: session.gameProject.npcDefinitions,
      dialogueDefinitions: session.gameProject.dialogueDefinitions,
      questDefinitions: session.gameProject.questDefinitions,
      itemDefinitions: session.gameProject.itemDefinitions,
      documentDefinitions: session.gameProject.documentDefinitions
    })
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

  return buildSugarlangPreviewBootPayload(scenes, cache, atlas, morphology);
}
