# Plan 077 -- Quest-Aware Agentified NPCs (child epic G of Strategy 001)

Status: Draft (strategy tier spawned this; passes /epic-review before any story is built)
Owner: nikki + claude
Date: 2026-07-22

> Note: this epic was drafted first as a "Narrative Director" with authored beats + a runtime director, then deliberately simplified in the 2026-07-22 design conversation. There is NO director component -- see D1 and "Rejected (on merit)". The strategy still lists child epic G as "Narrative Director"; the realized shape is quest-aware NPCs + shared world-narrative state, which is the same goal (NPCs serve the story in character) by simpler means.

Related:
- Strategy 001 -- child epic G. Realizes the "director-mediated quest-context" principle, simplified: quest state reaches NPCs as world-framed context + shared blackboard facts, never the player's private objective, and per-NPC judgment (the LLM + persona) decides relevance -- no central director.
- Depends on: B/072 (persona in the prompt -- shipped), C/073 (memory; NPCs can be memory-aware -- shipped), the quest system (Plan 012/019), the blackboard (Plan 023), region-conditions/presence (Plan 069/057), the dialogue graph (Plan 013). Composes with D/074 (world/time facts) and E/075 (a judge can later verify a hint was delivered in character).
- Driving scenario: the canonical "Find the Luggage" quest (below). This epic exists to make that gameplay possible.

## Ground truth (verified 2026-07-22 against producing lines)

Code, not memory:

- **Quest domain** (`packages/domain/src/quest-definition/index.ts`): `QuestDefinition -> QuestStageDefinition -> QuestNodeDefinition` (behaviors objective/narrative/condition/branch). Nodes carry `displayName`, `description`, `targetId`, `dialogueDefinitionId`, `voiceoverText`, `eventName`, `onEnterActions`/`onCompleteActions: QuestActionDefinition[]`. `QuestActionType` (L28-45) = `setFlag | ... | emitEvent | unlockScene | advanceToNextScene | custom` (no "player learns" / "set time"). `QuestStageState = "active" | "completed"`.
- **QuestManager** (`packages/runtime-core/src/quest/QuestManager.ts`): `getTrackedQuest()` -> `{ questDefinitionId, displayName, stageId, stageDisplayName, objectives[] }`; objectives are `{ nodeId, displayName, description, showInHud, optional }`. Observer hooks for world events: `setEventHandler` / `setStateChangeHandler` / `setActionHandler` / `setNarrativeHandler` (L145-159). A conversation can drive world state via live action proposals `set-conversation-flag` (-> `setFlag`) and `notify-quest-event` (-> `notifyEvent`); a dialogue node fires `onEnterEventId` (`domain/dialogue-definition/index.ts:78`).
- **Quest state already reaches conversations**: `runtimeBlackboardConversationMiddleware` (`coordination/gameplay-session.ts`, CONTEXT stage) writes `runtimeContext.{ trackedQuest, activeQuestStage, activeQuestObjectives }` from blackboard facts synced each frame from `getTrackedQuest()`. Sugaragent's RetrieveStage ALREADY folds `trackedQuest.displayName` + `activeQuestStage.stageDisplayName` into the search query ("Active quest: ..."); it does NOT yet use the active OBJECTIVE (nodeId/displayName/description/targetId). Sugarlang reads `activeQuestObjectives` for vocab (`sugar-lang-context-middleware.ts:357`).
- **The firewall violation ships TODAY** (`.../generate/prompt/builder.ts:119-120`): every agent NPC's prompt gets `"The player is currently on a quest: \"{name}\" (stage: {stage}). This is the PLAYER's goal, not yours..."`. Replacing this is a concrete deliverable (D2).
- **The blackboard (Plan 023)** (`runtime-core/src/state/blackboard.ts`): `setFact` / `getFact` / `subscribe`; scopes `global | region | entity | quest | conversation`; lifecycles `persistent | session | frame | ephemeral`; plugins register fact definitions (sugarlang has `SUGARLANG_BLACKBOARD_FACT_DEFINITIONS`). This is the shared world-narrative-state substrate (D4).
- **Quest-gated presence already exists**: `region-conditions/index.ts` `evaluateRegionQuestBinding({ questDefinitionId, stageId, worldFlagEquals })`, consumed by behavior-task activation and collision/containment volumes. Stage-level. This is the seam for quest-gated world events (D5) -- no new engine needed.

## The driving scenario -- "Find the Luggage"

The system must make THIS possible:

1. Mim arrives; quest "Find the Luggage" begins.
2. She goes to the cargo dock; her suitcase isn't there; a SCRIPTED NPC tells her to check baggage claim. From here she can go straight there OR wander.
3. If she wanders to Finnick (agentified cheese-shop NPC), it'd be great if he -- WITHOUT knowing a priori that Mim lost a suitcase -- nudged her toward baggage claim in his own voice, if it fits, and again if she returns. Every NPC does the same in character; if it makes no sense for a character to engage, they just talk.
4. Background events "happen": the suitcase has gone sentient and wanders eating socks; a passenger at the cargo dock, upset about missing socks, appears -- but ONLY after arrival AND after Mim has talked to the scripted NPC.
5. She reaches baggage claim -> stage advances -> nudges retire. Episode's quest over with no next quest -> every NPC is simply themselves again.

## What this is (and the thing it is NOT)

There is **no Narrative Director component.** The "writer brain watching the board" is realized by three things that already exist, working together:

1. **The agent's own pipeline** gathers facts and responds (Interpret -> Retrieve -> Plan -> Generate). We make it QUEST-AWARE (D3): while a quest is active, the NPC's Retrieve pulls quest-relevant world lore and the objective's target is available -- so Finnick has "lost luggage -> baggage claim" even if Mim never says "baggage". Loaded once at conversation start, memoized (persona/memory mold), so it's not heavy per turn.
2. **The blackboard** holds shared WORLD-NARRATIVE STATE (D4): where the sentient suitcase is, how many times the baggage-claim goal has been surfaced, which flags have flipped. NPCs READ it (it rides in their prompt) and WRITE it (a turn's outcome). Cross-NPC coordination is implicit through this shared state -- NPC A hints, the counter bumps, NPC B sees it and eases off. No central mind; the field's "town-wide awareness" pattern is shared memory + per-agent reasoning (Generative Agents).
3. **The quest + world-event system** makes the WORLD change (D5): spawns the upset passenger, moves the suitcase, advances the stage. This is the only genuinely central "director," it is DETERMINISTIC and AUTHORED (quest actions + region-conditions + presence), and it already exists.

Per-NPC JUDGMENT ("should Finnick mention it now, in character?") is delegated to Finnick's own generate call, informed by the shared state in his prompt + his persona. That is both cheaper and more in-character than any central brain deciding for him.

## Non-goals / Rejected (on merit)

- **A central LLM narrative director is REJECTED, not deferred.** A brain dictating each NPC's quest line (a) fights the agent architecture (a foreign intelligence makes NPCs LESS in-character), (b) is a coherence RISK not a win (runtime LLM global-narrative decisions are where coherence dies -- AI Dungeon / drama-manager demos), and (c) costs an extra call for a worse result. Coherence comes from authored structure + shared state. We say no because it won't do the job right. (The ONLY "central director" that belongs is the quest/world-event system -- deterministic, authored -- which we already have and use here.)
- **Watchlist, not a plan: global pacing.** A Left-4-Dead-style pacing controller ("ease off, NPCs are piling on / escalate, the player's stuck") is the one place a director-like layer has real merit -- but it's rhythm, not dialogue, and a cozy author-paced episodic game paces via its quest/episode structure. The one distributed pacing worry (too many NPCs piling on) is a shared counter (D4), not a brain. Revisit only if Wordlark ever becomes a tense, systemic game it currently is not; it would be a thin layer ON TOP of the distributed NPCs.
- **Authored per-NPC beat/hint content is NOT in v1.** Controlled, must-happen narrative moments are already AUTHORED as scripted content (quest narrative nodes, scripted dialogue). The agentified layer is the SOFT, emergent one -- persona + facts + prompt. If emergence proves too loose in play, light authored gating is the deferred escape hatch (below), not the starting point.
- Emergent social simulation (the Versu pole). Moderation / secrets-at-the-model-layer (epic E/075). Barks/audio (epic F/076). In-game-time authoring (epic D/074).

## Design decisions (epic-review ratifies)

- **D1 -- No director; the "writer brain" is authored quests + shared blackboard state + per-NPC agents.** See "What this is" above. This is the architecturally correct decomposition and the one that scales (add NPCs/quests without a central bottleneck).
- **D2 -- The firewall is about SECRETS, not the quest goal (nudge != secret).** A secret (must never be revealed) stays out of the prompt entirely (empirically, a system-prompt "never reveal" leaks ~10% under injection -- ProvSec 2025). A quest NUDGE is the opposite: we WANT it (optionally, naturally) said, so it may be in the prompt -- what matters is FRAMING. So: DELETE `builder.ts:119`'s "the player's goal, not yours" line; replace with WORLD-framed context + instruction ("here is what would be helpful in the world right now; offer help you'd plausibly know if it fits your character; do NOT act as though you know the player's private business; do not repeat yourself"). The model never sees "the player is looking for their suitcase"; it sees "travelers with lost luggage are directed to baggage claim."
- **D3 -- Quest-relevant facts made reachable while a quest is active (the real substance).** Today Retrieve is driven by player text, so if Mim never says "baggage" the fact may not surface. Fix: while a quest is active, fold the active OBJECTIVE (displayName/description/targetId) into the retrieval query, and/or surface the objective's target as a directly-available fact, so the NPC HAS the relevant world knowledge without the player naming it. Load once at conversation start, memoize in `execution.state` (persona/memory mold), refresh only on quest-state change. Pattern: extend the existing Retrieve stage; no new subsystem.
- **D4 -- Shared world-narrative state on the blackboard; NPCs read and write it.** Facts like `world.suitcase-location` (world-entity state) and `world.goal-surfaced-count` (how many times the current objective has been raised to the player) live on the blackboard (scope quest/global). They ride into the prompt (the NPC reads them) and are updated by a turn's outcome (the NPC writes them). Coordination across NPCs is implicit through this shared state. HONEST WRINKLE: knowing "did the NPC actually say it?" is hard (LLM output is prose) -- v1 uses a COARSE proxy (mark surfaced when we prompted for it on a grounded turn, or count conversations while the objective was active); PRECISE "was the beat delivered, in character?" is deferred to epic E/075's judge. Pattern: Blackboard.
- **D5 -- Quest-gated world events COMPOSE existing machinery (Observer + condition-action).** The sentient suitcase / upset passenger are presence + behavior gated on quest state: quest node `onEnter`/`onComplete` actions (`setFlag`/`emitEvent`), QuestManager observer hooks, region-condition bindings (`questStageId` AND `worldFlagEquals`), presence/behavior gates. "After arrival AND after the NPC-1 conversation" = `stage=find-suitcase AND worldFlag(talkedToDockWorker)`, the flag set by that conversation (`set-conversation-flag` / a scripted dialogue node). Close only the smallest gaps (a clean flag-set path from an agent turn; Studio authoring for compound stage-AND-flag triggers). No new gating engine.
- **D6 -- Plugin separation holds (Blackboard + annotation seam).** All the above is SUGARAGENT + runtime-core; it works with no sugarlang. Sugarlang independently reads the SAME neutral quest facts for vocab. No cross-plugin import (catalog-linter enforced). One source of truth: quest/world state = runtime-core.
- **D7 -- Cost + caching, free here.** Zero extra LLM calls: the quest context + shared state are voiced by the single existing generate call, spliced into the UNCACHED user half (Plan 072.4) so the cached persona/system prefix is never busted (cache reads 0.1x). Quest-relevant facts load ONCE per conversation, memoized. Per-turn cost delta vs today: zero.

## Stories (EXECUTION ORDER)

### 077.1 Quest context into agentified dialogue (frame it right; delete the breach)

Replace `builder.ts:119`'s omniscient quest line with WORLD-framed quest context + an instruction block per D2, in the uncached user half: the current objective phrased as "what would be helpful in the world right now", plus "offer help you'd plausibly know if it fits your character; don't act as though you know the player's private business; don't repeat what's already been said." PlanStage: a turn where quest context is relevant is grounded (routes to the LLM to voice it), like 073.3's `memoryGrounds`; otherwise the NPC responds normally. Exit: integration test (mock gateway) -- an NPC offers the baggage-claim steer in character while the raw objective/title is ABSENT from the prompt; an NPC with no active quest (and the quest-over case) responds normally; `builder.ts:119` is gone.

### 077.2 Quest-relevant facts reachable while a quest is active (the substance)

Extend the sugaragent Retrieve/context path (D3): while a quest is active, fold the active objective (displayName/description/targetId) into retrieval and/or surface the target as a directly-available fact, loaded once at conversation start and memoized. So Finnick has "lost luggage -> baggage claim" even if Mim never says "baggage". Exit: integration test -- with the Find-the-Luggage quest active and a lore page about baggage claim, an NPC's evidence/context contains the baggage-claim fact WITHOUT the player mentioning it; with no quest active, it does not.

### 077.3 Shared world-narrative state (blackboard) NPCs read + write

Register the world-narrative facts (D4): a `goal-surfaced-count` (per active objective) and any world-entity flavor facts (e.g. `suitcase-location`), on the blackboard. NPCs read them (into the prompt) and a turn's outcome writes them (the coarse proxy per D4). This gives "mention once, again on return, and other NPCs ease off" without a central brain. Exit: unit + integration -- after an NPC surfaces the goal, the count bumps; a second NPC's prompt reflects it (eases off); no persistence beyond session in v1.

### 077.4 Quest-gated world events (compose existing + close small gaps)

Wire the Find-the-Luggage background events on existing machinery (D5): the scripted dock-NPC conversation sets `talkedToDockWorker`; the upset passenger is presence/behavior gated on `stage=find-suitcase AND worldFlag(talkedToDockWorker)`. Close the two smallest gaps: a clean documented path for an agent turn to set a quest/world flag; Studio authoring for the compound stage-AND-flag binding. No new gating engine. Exit: in preview the passenger spawns ONLY after arrival AND the dock conversation, retires at stage advance; a unit test on the compound binding.

### 077.5 Config, dev inspection, cost guard, wrap

Config: `questAwareNpcsEnabled` flag (off -> NPCs behave as pre-G). Dev handle `window.__sugaragentQuestContext`: dump what quest context/facts this conversation surfaced and the current world-narrative facts. Cost guard: a test asserting zero extra LLM calls. Epic wrap: `docs/api` (quest-context framing contract, the world-narrative facts, the firewall = secrets-not-nudges principle, world-events = compose-existing); deferred-seam sweep. Exit: settings render; dev handle documented; cost test green.

## Verification recipe (nikki)

1. `pnpm test` green.
2. Author: "Find the Luggage" quest; a lore page giving Finnick (and the station) the "lost luggage -> baggage claim" world fact; the upset-passenger presence gated on `stage=find-suitcase AND flag=talkedToDockWorker`.
3. Preview: arrive; talk to the scripted dock NPC -> passenger appears at the cargo dock. Wander to Finnick; mention you're lost / just arrived -> he points you to baggage claim IN HIS OWN VOICE. Confirm via `window.__sugaragentPrompts` his prompt NEVER contains "Find the Luggage" or the objective text -- only the world-framed steer + the baggage-claim fact.
4. Talk to a second NPC -> they don't re-push it as hard (the surfaced-count eased them off).
5. Reach baggage claim -> stage advances -> Finnick no longer steers.
6. Talk to an NPC with the quest inactive / episode over -> a normal in-character reply, zero quest awareness.
7. Confirm (dev handle) the feature added no LLM call this session.

## Epic wrap

`docs/api`: quest-context framing contract; the world-narrative blackboard facts; firewall = secrets-vs-nudges; world-events = compose-existing; the explicit "no central director, and why". Backlog sweep of DEFERRED SEAM comments.

## Deferred (with revisit triggers)

- **Light authored gating of specific NPCs** (if emergent persona-judgment makes NPCs over-eager quest-signposts in real play): a small per-NPC/per-objective hint override, layered on top -- NOT a beat subsystem. Revisit only if play shows over-eagerness the framing can't fix.
- **Precise "was the hint delivered, in character?" tracking**: epic E/075's judge, post-turn. Until then the coarse surfaced-count proxy (D4) stands.
- **Cross-session world-narrative persistence** (v1 holds surfaced-counts in session state only): promote to a SaveParticipant slice if it matters in play; the fact shape is the seam.
- **Global pacing layer**: watchlist only (see Rejected) -- a cozy episodic game paces via its quests; revisit only if the game becomes something it currently isn't.
