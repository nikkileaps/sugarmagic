/**
 * Pins the item bake policy from story #200: item text is a FULL translation
 * at every band, never an interwoven graded line. The item is a touchstone -
 * a familiar, stable text the player re-reads to feel their own progress - so
 * it renders entirely in the target language, leveled by the band alone.
 *
 * The bake consumes buildItemViewAdaptRequest directly, so pinning the
 * function pins the behavior. Dialogue is the contrast case: its bake keeps
 * the band-dependent posture split.
 */
import { describe, expect, it } from "vitest";
import { buildItemViewAdaptRequest } from "../../runtime/grading/sources/item-view-source";
import { ITEM_VARIANT_BANDS } from "../../runtime/contracts/baked-variant";
import {
  postureForBand,
  TARGET_LANGUAGE_RATIO_BY_POSTURE
} from "../../runtime/teacher/band-envelope";

describe("item view adapt request", () => {
  it("pins target-only posture at full ratio for every item variant band", () => {
    for (const band of ITEM_VARIANT_BANDS) {
      const request = buildItemViewAdaptRequest({
        text: "A worn brass key.",
        targetLang: "es",
        band,
        field: "body"
      });
      expect(request.posture).toBe("target-only");
      expect(request.directedRatio).toBe(1);
      expect(request.band).toBe(band);
    }
  });

  it("keeps the title and body registers distinct", () => {
    const title = buildItemViewAdaptRequest({
      text: "Brass Key",
      targetLang: "es",
      band: "A1",
      field: "title"
    });
    const body = buildItemViewAdaptRequest({
      text: "A worn brass key.",
      targetLang: "es",
      band: "A1",
      field: "body"
    });
    expect(title.guidance?.register).toBe("item name");
    expect(body.guidance?.register).toBe("item description");
  });

  it("guides the writing at a reader who has mastered the band", () => {
    const request = buildItemViewAdaptRequest({
      text: "A worn brass key.",
      targetLang: "es",
      band: "A2",
      field: "body"
    });
    const notes = request.guidance?.notes?.join(" ") ?? "";
    expect(notes).toContain("A2");
    expect(notes).toContain("mastered");
  });

  it("contrast: the dialogue posture split still exists and differs for beginners", () => {
    // Items pin target-only at every band; dialogue still weaves for
    // beginners. If this fails because postureForBand changed, the item
    // policy is unaffected - but the split this suite documents is gone,
    // so re-read story #200 before deleting it.
    expect(postureForBand("A1")).not.toBe("target-only");
    expect(
      TARGET_LANGUAGE_RATIO_BY_POSTURE[postureForBand("A1")]
    ).toBeLessThan(1);
  });
});
