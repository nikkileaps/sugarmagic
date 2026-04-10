/**
 * packages/plugins/src/catalog/sugarlang/runtime/types.ts
 *
 * Purpose: Provides the single re-export surface for all public sugarlang runtime contract types.
 *
 * Exports:
 *   - all public types from runtime/contracts/*
 *
 * Relationships:
 *   - Depends on the contract files under ./contracts.
 *   - Is the intended import surface for downstream epics that need sugarlang types.
 *
 * Implements: Proposal 001 §File Structure
 *
 * Status: active
 */

export * from "./contracts/pedagogy";
export * from "./contracts/learner-profile";
export * from "./contracts/lexical-prescription";
export * from "./contracts/envelope";
export * from "./contracts/scene-lexicon";
export * from "./contracts/observation";
export * from "./contracts/providers";
export * from "./contracts/placement-questionnaire";
