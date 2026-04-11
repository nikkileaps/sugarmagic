/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/compile-sugarlang-scene.ts
 *
 * Purpose: Compiles authored scene content into a deterministic per-scene lexicon artifact.
 *
 * Exports:
 *   - compileSugarlangScene
 *
 * Relationships:
 *   - Depends on scene traversal, content hashing, tokenization, lemmatization, and atlas lookup.
 *   - Is the single compile entry point used by authoring-preview, runtime-preview, and published-target.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import type { RuntimeCompileProfile } from "@sugarmagic/runtime-core/materials";
import type {
  AtlasLemmaEntry,
  CEFRBand,
  CompiledSceneLexicon,
  LexicalAtlasProvider,
  QuestEssentialLemma,
  SceneAuthorWarning,
  SceneLemmaInfo,
  SourceLocation
} from "../types";
import { compareCefrBands, isBandAbove } from "../classifier/cefr-band-utils";
import { lemmatize } from "../classifier/lemmatize";
import { MorphologyLoader } from "../classifier/morphology-loader";
import { tokenize } from "../classifier/tokenize";
import {
  computeSceneContentHash,
  SUGARLANG_COMPILE_PIPELINE_VERSION
} from "./content-hash";
import {
  collectSceneText,
  type SceneAuthoringContext,
  type TextBlob,
  type TextBlobSourceKind
} from "./scene-traversal";

const QUEST_ESSENTIAL_STOPWORDS: Record<string, Set<string>> = {
  en: new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with", "by", "from", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall", "it", "its", "this", "that", "these", "those", "i", "you", "he", "she", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "our", "their", "not", "no", "but", "if", "so", "as", "up"]),
  es: new Set(["el", "la", "los", "las", "un", "una", "y", "o", "de", "del", "a", "al", "en", "con", "por", "para", "que"]),
  it: new Set(["il", "lo", "la", "gli", "le", "un", "una", "e", "o", "di", "a", "al", "nel", "con", "per", "che"])
};

const FUNCTIONAL_PARTS_OF_SPEECH = new Set([
  "article",
  "determiner",
  "preposition",
  "pronoun",
  "conjunction",
  "auxiliary",
  "particle",
  "interjection"
]);

const ANCHOR_SOURCE_KINDS = new Set<TextBlobSourceKind>([
  "region-label",
  "quest-objective",
  "quest-objective-display-name"
]);

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function normalizeKey(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase();
}

function isCapitalizedWord(word: string): boolean {
  return /^\p{Lu}[\p{L}\p{M}'’-]*$/u.test(word);
}

function extractProperNouns(
  text: string,
  lang: string,
  morphology: MorphologyLoader
): string[] {
  const matches = text.normalize("NFC").match(/\b\p{Lu}[\p{L}\p{M}'’-]*(?:\s+\p{Lu}[\p{L}\p{M}'’-]*)*/gu) ?? [];
  const nouns = new Set<string>();

  for (const match of matches) {
    const words = match.split(/\s+/u).filter(Boolean);
    const unknownWords = words.filter((word) =>
      isCapitalizedWord(word) && morphology.lemmatize(word, lang) === null
    );
    if (unknownWords.length === 0) {
      continue;
    }

    nouns.add(match);
    if (words.length > 1) {
      for (let length = 2; length <= words.length; length += 1) {
        for (let start = 0; start <= words.length - length; start += 1) {
          nouns.add(words.slice(start, start + length).join(" "));
        }
      }
    }
    for (const word of unknownWords) {
      nouns.add(word);
    }
  }

  return [...nouns].sort(compareStrings);
}

function isQuestEssentialContentLemma(
  lemmaId: string,
  atlasEntry: AtlasLemmaEntry | undefined,
  lang: string
): boolean {
  if ((QUEST_ESSENTIAL_STOPWORDS[lang] ?? new Set()).has(lemmaId)) {
    return false;
  }

  if (atlasEntry?.partsOfSpeech.some((part) => FUNCTIONAL_PARTS_OF_SPEECH.has(part.toLowerCase()))) {
    return false;
  }

  return true;
}

function createSceneLemmaInfo(entry: AtlasLemmaEntry): SceneLemmaInfo {
  return {
    lemmaId: entry.lemmaId,
    cefrPriorBand: entry.cefrPriorBand,
    frequencyRank: entry.frequencyRank ?? null,
    partsOfSpeech: [...entry.partsOfSpeech].sort(compareStrings),
    isQuestCritical: false,
    sceneWeight: 0
  };
}

function createQuestEssentialLemma(
  lemmaId: string,
  atlasEntry: AtlasLemmaEntry,
  blob: TextBlob
): QuestEssentialLemma {
  return {
    lemmaId,
    lang: atlasEntry.lang,
    cefrBand: atlasEntry.cefrPriorBand,
    sourceQuestId: blob.questDefinitionId!,
    sourceObjectiveNodeId: blob.objectiveNodeId!,
    sourceObjectiveDisplayName: blob.objectiveDisplayName ?? blob.text
  };
}

function makeDiagnostic(
  severity: SceneAuthorWarning["severity"],
  sceneId: string,
  message: string,
  lemmaId?: string,
  suggestion?: string
): SceneAuthorWarning {
  return {
    severity,
    sceneId,
    message,
    lemmaId,
    suggestion
  };
}

function summarizeLocations(
  existing: SourceLocation[] | undefined,
  location: SourceLocation
): SourceLocation[] {
  const next = [...(existing ?? []), location];
  return next.sort((left, right) =>
    left.file === right.file
      ? left.snippet.localeCompare(right.snippet)
      : left.file.localeCompare(right.file)
  );
}

export function compileSugarlangScene(
  scene: SceneAuthoringContext,
  atlas: LexicalAtlasProvider,
  morphology: MorphologyLoader,
  profile: RuntimeCompileProfile
): CompiledSceneLexicon {
  const textBlobs = collectSceneText(scene);
  const atlasVersion = atlas.getAtlasVersion(scene.targetLanguage);
  const contentHash = computeSceneContentHash(
    textBlobs,
    atlasVersion,
    SUGARLANG_COMPILE_PIPELINE_VERSION
  );
  const lemmaMap = new Map<string, SceneLemmaInfo>();
  const sourceMap = new Map<string, SourceLocation[]>();
  const anchorLemmaIds = new Set<string>();
  const questEssentialMap = new Map<string, QuestEssentialLemma>();
  const properNouns = new Set<string>();
  const diagnostics: SceneAuthorWarning[] = [];

  let totalWordTokens = 0;
  let unclassifiedWordTokens = 0;

  for (const blob of textBlobs) {
    for (const properNoun of extractProperNouns(
      blob.text,
      scene.targetLanguage,
      morphology
    )) {
      properNouns.add(properNoun);
    }

    for (const token of tokenize(blob.text, scene.targetLanguage)) {
      if (token.kind !== "word") {
        continue;
      }

      totalWordTokens += 1;

      // Strategy 1: Direct target-language lemmatization (works when the
      // authored text is already in the target language, e.g. inline Spanish).
      let resolvedEntries: AtlasLemmaEntry[] = [];
      const lemma = lemmatize(token, scene.targetLanguage, morphology);
      if (lemma) {
        const atlasEntry = atlas.getLemma(lemma.lemmaId, lemma.lang);
        if (atlasEntry) {
          resolvedEntries = [atlasEntry];
        }
      }

      // Strategy 2: Gloss reverse lookup. Authored text is in the support
      // language (e.g. English); resolve to target-language lemmas via the
      // atlas glosses. A single English word like "job" may resolve to
      // multiple target lemmas ("trabajo", "empleo").
      if (resolvedEntries.length === 0) {
        resolvedEntries = atlas.resolveFromGloss(
          token.surface,
          scene.targetLanguage,
          scene.supportLanguage
        );
      }

      if (resolvedEntries.length === 0) {
        unclassifiedWordTokens += 1;
        continue;
      }

      for (const atlasEntry of resolvedEntries) {
        if (!lemmaMap.has(atlasEntry.lemmaId)) {
          lemmaMap.set(atlasEntry.lemmaId, createSceneLemmaInfo(atlasEntry));
        }
        // Accumulate scene relevance: each occurrence in a text blob adds
        // the blob's source-kind weight. Words mentioned many times in
        // high-weight sources (dialogue, NPC lore, quest text) score higher.
        lemmaMap.get(atlasEntry.lemmaId)!.sceneWeight += blob.weight;

        if (profile === "authoring-preview") {
          sourceMap.set(
            atlasEntry.lemmaId,
            summarizeLocations(sourceMap.get(atlasEntry.lemmaId), blob.sourceLocation)
          );
        }

        if (ANCHOR_SOURCE_KINDS.has(blob.sourceKind)) {
          anchorLemmaIds.add(atlasEntry.lemmaId);
        }

        if (
          (blob.sourceKind === "quest-objective" ||
            blob.sourceKind === "quest-objective-display-name") &&
          blob.objectiveNodeId &&
          blob.questDefinitionId &&
          isQuestEssentialContentLemma(atlasEntry.lemmaId, atlasEntry, scene.targetLanguage)
        ) {
          const key = `${blob.objectiveNodeId}:${atlasEntry.lemmaId}`;
          if (!questEssentialMap.has(key)) {
            questEssentialMap.set(
              key,
              createQuestEssentialLemma(atlasEntry.lemmaId, atlasEntry, blob)
            );
          }
          const existingLemma = lemmaMap.get(atlasEntry.lemmaId);
          if (existingLemma) {
            existingLemma.isQuestCritical = true;
          }
        }
      }
    }
  }

  const semanticLemmas = [...lemmaMap.values()].sort((left, right) =>
    compareStrings(left.lemmaId, right.lemmaId)
  );
  const questEssentialLemmas = [...questEssentialMap.values()].sort((left, right) =>
    left.sourceObjectiveNodeId === right.sourceObjectiveNodeId
      ? compareStrings(left.lemmaId, right.lemmaId)
      : compareStrings(left.sourceObjectiveNodeId, right.sourceObjectiveNodeId)
  );

  if (profile === "authoring-preview") {
    if (totalWordTokens > 0 && unclassifiedWordTokens / totalWordTokens > 0.03) {
      diagnostics.push(
        makeDiagnostic(
          "warning",
          scene.sceneId,
          "Scene has more than 3% unclassified tokens; review morphology coverage.",
          undefined,
          "Add morphology coverage or revise unusual surface forms."
        )
      );
    }

    const highBandLemmas = semanticLemmas.filter((lemma) =>
      isBandAbove(lemma.cefrPriorBand, "B2")
    );
    if (
      semanticLemmas.length > 0 &&
      highBandLemmas.length / semanticLemmas.length > 0.3
    ) {
      diagnostics.push(
        makeDiagnostic(
          "warning",
          scene.sceneId,
          "Scene has more than 30% high-band lemmas; consider simplifying authored content.",
          undefined,
          "Reduce C1/C2 vocabulary density in core scene text."
        )
      );
    }

    for (const lemmaId of [...anchorLemmaIds].sort(compareStrings)) {
      const atlasEntry = atlas.getLemma(lemmaId, scene.targetLanguage);
      if (atlasEntry?.cefrPriorSource === "frequency-derived") {
        diagnostics.push(
          makeDiagnostic(
            "warning",
            scene.sceneId,
            "Narrative-critical lemma relies on frequency-derived CEFR prior.",
            lemmaId,
            "Review this lemma for a human CEFR override if it matters narratively."
          )
        );
      }
    }

    const deadlockByObjective = new Map<
      string,
      { displayName: string; lemmas: string[] }
    >();
    for (const lemma of questEssentialLemmas) {
      if (compareCefrBands(lemma.cefrBand, "B2") <= 0) {
        continue;
      }

      const bucket =
        deadlockByObjective.get(lemma.sourceObjectiveNodeId) ?? {
          displayName: lemma.sourceObjectiveDisplayName,
          lemmas: []
        };
      bucket.lemmas.push(lemma.lemmaId);
      deadlockByObjective.set(lemma.sourceObjectiveNodeId, bucket);
    }

    for (const [objectiveNodeId, bucket] of [...deadlockByObjective.entries()].sort(
      (left, right) => compareStrings(left[0], right[0])
    )) {
      const uniqueHighBandLemmas = [...new Set(bucket.lemmas)].sort(compareStrings);
      if (uniqueHighBandLemmas.length < 5) {
        continue;
      }

      diagnostics.push(
        makeDiagnostic(
          "warning",
          scene.sceneId,
          `Objective "${bucket.displayName}" is deadlock-prone: ${uniqueHighBandLemmas.join(", ")} are above B2.`,
          undefined,
          `Revise objective ${objectiveNodeId} to reduce high-band vocabulary density.`
        )
      );
    }
  }

  const lexicon: CompiledSceneLexicon = {
    sceneId: scene.sceneId,
    contentHash,
    pipelineVersion: SUGARLANG_COMPILE_PIPELINE_VERSION,
    atlasVersion,
    profile,
    lemmas: Object.fromEntries(
      semanticLemmas.map((lemma) => [lemma.lemmaId, lemma])
    ),
    properNouns: [...properNouns].sort(compareStrings),
    anchors: [...anchorLemmaIds].sort(compareStrings),
    questEssentialLemmas
  };

  if (profile === "authoring-preview") {
    lexicon.sources = Object.fromEntries(
      [...sourceMap.entries()].sort((left, right) =>
        compareStrings(left[0], right[0])
      )
    );
    lexicon.diagnostics = diagnostics.sort((left, right) =>
      left.message === right.message
        ? compareStrings(left.sceneId, right.sceneId)
        : compareStrings(left.message, right.message)
    );
  }

  return lexicon;
}
