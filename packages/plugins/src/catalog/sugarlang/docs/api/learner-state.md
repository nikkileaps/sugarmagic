# Learner State API

Status: Updated in Epic 3; expanded further in Epic 7

This document records the public learner-state contract owned by sugarlang.

## Core Types

- `CEFRBand`
- `LearnerId`
- `CefrPosteriorBandWeight`
- `CefrPosterior`
- `LemmaCard`
- `CurrentSessionSignals`
- `SessionRecord`
- `LearnerAssessment`
- `LearnerProfile`

## Receptive vs. Productive

`LemmaCard` deliberately separates:

- `stability`: receptive FSRS memory strength
- `productiveStrength`: productive ability to actively produce the lemma

It also carries provisional skim-past evidence via:

- `provisionalEvidence`
- `provisionalEvidenceFirstSeenTurn`

Those fields exist so rapid-advance observations do not silently inflate FSRS
stability before a comprehension probe confirms them. See Proposal 001 § Receptive vs. Productive Knowledge and § Observer Latency Bias.

## Exported Constants

- `INITIAL_PRODUCTIVE_STRENGTH`
- `INITIAL_PROVISIONAL_EVIDENCE`
- `PROVISIONAL_EVIDENCE_MAX`
- `PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD`
