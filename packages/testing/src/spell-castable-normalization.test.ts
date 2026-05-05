/**
 * Spell castable normalization tests.
 *
 * Guards that spell invocation data is the single source of truth. The domain
 * normalizer must not inject spell-specific args into unrelated castables.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultGameProject,
  createDefaultSpellDefinition,
  normalizeGameProject,
  normalizeSpellDefinition
} from "@sugarmagic/domain";

describe("spell castable normalization", () => {
  it("preserves explicit default spell castable args", () => {
    const project = createDefaultGameProject("Spells", "spell-test");
    const spell = createDefaultSpellDefinition({
      castable: {
        id: project.mechanics.castables[0]!.id,
        args: { batteryCost: 12, chaosBase: 0 }
      }
    });

    const normalized = normalizeGameProject({
      ...project,
      spellDefinitions: [spell]
    });

    expect(normalized.spellDefinitions[0]?.castable.id).toBe(
      normalized.mechanics.castables[0]?.id
    );
    expect(normalized.spellDefinitions[0]?.castable.args.batteryCost).toBe(12);
    expect(normalized.spellDefinitions[0]?.castable.args.chaosBase).toBe(0);
  });

  it("does not inject battery or chaos args into non-default castables", () => {
    const spell = normalizeSpellDefinition({
      definitionId: "spell:phonowave",
      displayName: "Phonowave",
      description: "",
      iconAssetDefinitionId: null,
      tags: [],
      castable: {
        id: "phonowave",
        args: { frequency: 440 }
      },
      effects: [],
      chaosEffects: []
    });

    expect(spell.castable).toEqual({
      id: "phonowave",
      args: { frequency: 440 }
    });
    expect(spell.castable.args).not.toHaveProperty("batteryCost");
    expect(spell.castable.args).not.toHaveProperty("chaosBase");
  });

  it("does not invent a castable for malformed spell data", () => {
    const spell = normalizeSpellDefinition({
      definitionId: "spell:broken",
      displayName: "Broken",
      description: "",
      iconAssetDefinitionId: null,
      tags: [],
      effects: [],
      chaosEffects: []
    });

    expect(spell.castable).toEqual({ id: "", args: {} });
  });
});
