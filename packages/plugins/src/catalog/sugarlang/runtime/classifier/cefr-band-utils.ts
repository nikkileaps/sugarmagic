/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/cefr-band-utils.ts
 *
 * Purpose: Re-exports the canonical CEFR band ordering for classifier callers.
 *
 * 090.9 EMPTIED THIS FILE. Its header used to claim it was "the classifier's
 * single CEFR band ordering helper" while five other modules declared the same
 * array under different names -- and `lexical-budgeter.ts` imported the order
 * from `learner/cefr-posterior` rather than from here. The declaration now lives
 * beside the `CEFRBand` type in `contracts/learner-profile.ts`, which is the one
 * module every caller (classifier, compile, runtime, and the Studio editor) can
 * legally reach.
 *
 * This file survives only so the classifier's existing imports keep working. It
 * is a re-export and must never grow a declaration of its own.
 *
 * Exports:
 *   - CEFR_BAND_ORDER, compareCefrBands, isBandAbove (all re-exported)
 *
 * Relationships:
 *   - Is consumed by coverage, envelope-rule, envelope-classifier, and auto-simplify.
 *
 * Implements: Proposal 001 §2. Envelope Classifier + Plan 090 story 090.9
 *
 * Status: active
 */

export {
  CEFR_BAND_ORDER,
  compareCefrBands,
  isBandAbove
} from "../contracts/learner-profile";
