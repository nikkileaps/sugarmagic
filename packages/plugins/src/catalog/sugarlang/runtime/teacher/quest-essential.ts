/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/quest-essential.ts
 *
 * Purpose: Derives quest-essential lemma refs from the SITUATION, replacing
 *   the `activeQuestEssentialLemmas` TeacherContext field.
 *
 * QUEST-ESSENTIAL STOPPED BEING A CHANNEL (090.4)
 *   It used to be both a TeacherContext field and a `prescribe()` input, fed
 *   from `sceneLexicon.questEssentialLemmas` -- a compile-time scan of
 *   authored text against the active quest objective. Under this model it is
 *   a `mustComprehend` flag on a Situation concept (090.1), resolved to a
 *   lemma the same way every other teachable is (090.2). There is no separate
 *   arrow into the Teacher; ENFORCEMENT of the obligation (forced glossing)
 *   stays exactly where it already was, in schema-parser.ts.
 *
 * Exports:
 *   - resolveQuestEssentialLemmaRefs
 *
 * Relationships:
 *   - Thin wrapper over ../inventory/scene-teachable-resolver, filtered to
 *     vocabulary teachables whose demand is quest-essential.
 *
 * Implements: Plan 090 story 090.4
 *
 * Status: active
 */

import { isAvailable } from "../situation/runtime-fact";
import type { Situation } from "../situation/situation";
import type { LexicalAtlasProvider } from "../contracts/providers";
import type { LemmaRef } from "../contracts/lexical-prescription";
import type { TeacherLanguageContext } from "../contracts/providers";
import { resolveSceneTeachables } from "../inventory/scene-teachable-resolver";

export function resolveQuestEssentialLemmaRefs(
  situation: Situation | undefined,
  atlas: LexicalAtlasProvider,
  lang: TeacherLanguageContext
): LemmaRef[] {
  if (!situation || !isAvailable(situation.sceneContext)) {
    return [];
  }

  const { teachables } = resolveSceneTeachables({
    concepts: situation.sceneContext.value.concepts,
    atlas,
    targetLanguage: lang.targetLanguage,
    supportLanguage: lang.supportLanguage
  });

  return teachables
    .filter((teachable) => teachable.kind === "vocabulary" && teachable.mustComprehend)
    .map((teachable) => ({ lemmaId: teachable.id, lang: lang.targetLanguage }));
}
