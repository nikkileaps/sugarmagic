/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner-debug-hud-card.ts
 *
 * Purpose: A debug HUD card showing what the teaching system knows about the
 *   learner: their band, the last observation applied, the curriculum facts the
 *   Teacher is being shown, and the cards themselves.
 *
 * None of this was visible while playing. Checking whether a hover graded a
 * card meant reading code and inferring, which is how a bug where every band
 * reached the Teacher as cold-start survived an entire epic -- one row showing
 * band and confidence would have made it obvious on sight.
 *
 * Exports:
 *   - createLearnerDebugHudCard
 *
 * Relationships:
 *   - Contributed by the sugarlang plugin, so it does not exist when sugarlang
 *     is absent or disabled. The HUD card context carries no plugin state; all
 *     sugarlang state arrives through the injected getters below, which is what
 *     keeps runtime-core unaware of any of this.
 *   - Reads getDebugState (learner + cards) and readTurnDebugState (the turn
 *     that just happened).
 *
 * Status: active
 */

import type {
  DebugHudCardContext,
  DebugHudCardContribution
} from "@sugarmagic/runtime-core";
import type { LemmaCard } from "./learner";
import type { LearnerCurriculumState } from "./scheduler/learner-curriculum-state";
import type { ObservationRecord } from "./debug/turn-debug-state";
import { cardDisplayName } from "./inventory/card-display-name";
import { DUE_RETRIEVABILITY_FLOOR } from "./learner";

const CARD_ID = "sugarlang.learner";

/** Rows past this are reachable by scrolling; the card must not grow forever. */
const MAX_CARD_ROWS = 12;

/** What the card needs, and the only way sugarlang state reaches it. */
export interface LearnerDebugSnapshot {
  estimatedCefrBand: string;
  assessmentStatus: string;
  cefrConfidence: number;
  lemmaCards: LemmaCard[];
  chunkCards: LemmaCard[];
  teachRecordCount: number;
}

export interface CreateLearnerDebugHudCardArgs {
  pluginId: string;
  /**
   * Async because the learner store is. The card renders synchronously, so it
   * draws the last snapshot it was given and asks for a new one on each tick.
   * Returns null when no learner is bound -- before a conversation, or when the
   * plugin is installed but not running in this host.
   */
  getSnapshot: () => Promise<LearnerDebugSnapshot | null>;
  /** The turn that just happened. Empty until one has. */
  getTurnState: () => TurnDebugView;
  getTargetLanguage: () => string | null;
}

function appendMetric(container: HTMLElement, label: string, value: string): void {
  const documentRef = container.ownerDocument ?? document;
  const row = documentRef.createElement("div");
  row.className = "sm-debug-hud__metric";
  const labelElement = documentRef.createElement("span");
  labelElement.textContent = label;
  const valueElement = documentRef.createElement("span");
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  container.appendChild(row);
}

function appendHeading(container: HTMLElement, text: string): void {
  const documentRef = container.ownerDocument ?? document;
  const heading = documentRef.createElement("div");
  heading.className = "sm-debug-hud__metric";
  heading.style.opacity = "0.6";
  heading.style.marginTop = "6px";
  heading.textContent = text;
  container.appendChild(heading);
}

/**
 * The one row that answers "did that hover do anything".
 *
 * A null grade is printed rather than blanked. Passive exposure genuinely does
 * not grade, so "no grade" is the answer; showing nothing would read as "the
 * hover never arrived", which is the other possibility and the one you would
 * debug differently.
 */
function appendLastObservation(
  container: HTMLElement,
  observation: ObservationRecord | null,
  lang: string | null,
  nowMs: number
): void {
  appendHeading(container, "LAST OBSERVATION");
  if (!observation) {
    appendMetric(container, "(none yet)", "");
    return;
  }
  const name = lang ? cardDisplayName(observation.cardKey, lang) : observation.cardKey;
  appendMetric(container, observation.kind, name);
  appendMetric(container, "grade", observation.grade ?? "none (no review)");
  // Recomputed on every draw, so this is also how the card reports that it is
  // still alive: a number that climbs means the HUD is redrawing and the state
  // simply has not changed. A frozen one means the card stopped updating, and
  // those two are indistinguishable without it.
  appendMetric(
    container,
    "age",
    `${Math.max(0, Math.round((nowMs - observation.observedAtMs) / 1000))}s ago`
  );
}

/**
 * What the Teacher was handed for the turn now being spoken.
 *
 * This lags the LEARNER section above by one turn, and that is correct rather
 * than stale: it is recorded when the turn is prepared, before the turn\'s own
 * observations land. So "taught 2" up there beside "met 1" down here means a
 * teach record was written by the turn the Teacher had already planned.
 *
 * The heading says so, because two counts of the same thing disagreeing on one
 * screen otherwise reads as a bug.
 */
function appendCurriculumState(
  container: HTMLElement,
  state: LearnerCurriculumState | null
): void {
  appendHeading(container, "TOLD TO TEACHER (as of turn start)");
  if (!state) {
    appendMetric(container, "(no turn yet)", "");
    return;
  }
  appendMetric(container, "competencies met", String(state.met.length));
  appendMetric(container, "not yet met", String(state.unmetCompetencyIds.length));
  appendMetric(container, "due now", String(state.dueItemIds.length));
  appendMetric(container, "cold start", state.isColdStart ? "yes" : "no");
  // Named, not just counted: which competency has recurred is the thing you
  // are usually trying to see, and a bare number does not tell you.
  const recurring = state.met
    .filter((entry) => entry.encounterCount > 0)
    .sort((left, right) => right.encounterCount - left.encounterCount)
    .slice(0, 3)
    .map((entry) => `${entry.competencyId} x${entry.encounterCount}`);
  if (recurring.length > 0) {
    appendMetric(container, "most recurred", recurring.join(", "));
  }
}

/**
 * Cards, most recently touched first, so whatever you just did is at the top.
 *
 * `lastReviewedAt` is null until a card is graded, and those sort last -- which
 * is correct: an ungraded card is one nothing has happened to yet.
 */
function renderCardList(
  documentRef: Document,
  cards: LemmaCard[],
  lang: string | null
): HTMLElement {
  const list = documentRef.createElement("div");
  list.className = "sm-debug-hud__world-card";
  list.style.maxHeight = "180px";
  list.style.overflowY = "auto";
  list.style.gap = "2px";

  const ordered = [...cards]
    .sort((left, right) => (right.lastReviewedAt ?? 0) - (left.lastReviewedAt ?? 0))
    .slice(0, MAX_CARD_ROWS);

  for (const card of ordered) {
    const row = documentRef.createElement("div");
    row.className = "sm-debug-hud__metric";

    const label = documentRef.createElement("span");
    // No "(competency)" suffix: `Greet: hola` already reads as one, and the
    // suffix pushed the row past its width so the value wrapped onto a second
    // line -- which is worse than the ambiguity it was there to remove.
    label.textContent = lang ? cardDisplayName(card.lemmaId, lang) : card.lemmaId;
    label.style.whiteSpace = "nowrap";
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";

    const value = documentRef.createElement("span");
    const due = card.retrievability < DUE_RETRIEVABILITY_FLOOR ? " DUE" : "";
    value.textContent = `r ${card.retrievability.toFixed(2)} rev ${card.reviewCount} lapse ${card.lapseCount}${due}`;

    row.append(label, value);
    list.appendChild(row);
  }
  return list;
}

/** The turn that just happened, as the card needs it. */
interface TurnDebugView {
  lastObservation: ObservationRecord | null;
  curriculumState: LearnerCurriculumState | null;
}

function renderInto(
  container: HTMLElement,
  snapshot: LearnerDebugSnapshot | null,
  turnState: TurnDebugView,
  lang: string | null,
  nowMs: number
): void {
  const documentRef = container.ownerDocument ?? document;
  container.replaceChildren();

  const card = documentRef.createElement("div");
  card.className = "sm-debug-hud__world-card";

  if (!snapshot) {
    // No learner bound yet. Distinct from "a learner with nothing in it", and
    // saying so avoids reading an empty card list as a broken observer.
    appendMetric(card, "no learner bound", "start a conversation");
    container.appendChild(card);
    return;
  }

  const allCards = [...snapshot.lemmaCards, ...snapshot.chunkCards];
  const dueCount = allCards.filter(
    (entry) => entry.retrievability < DUE_RETRIEVABILITY_FLOOR
  ).length;

  appendHeading(card, "LEARNER");
  appendMetric(card, "band", snapshot.estimatedCefrBand);
  appendMetric(
    card,
    "assessment",
    `${snapshot.assessmentStatus} (conf ${snapshot.cefrConfidence.toFixed(2)})`
  );
  appendMetric(
    card,
    "cards",
    `${snapshot.lemmaCards.length} word / ${snapshot.chunkCards.length} competency`
  );
  appendMetric(card, "due now", String(dueCount));
  appendMetric(card, "taught", String(snapshot.teachRecordCount));

  appendLastObservation(card, turnState.lastObservation, lang, nowMs);
  appendCurriculumState(card, turnState.curriculumState);

  container.appendChild(card);

  if (allCards.length > 0) {
    appendHeading(container, "CARDS");
    container.appendChild(renderCardList(documentRef, allCards, lang));
  }
}

export function createLearnerDebugHudCard(
  args: CreateLearnerDebugHudCardArgs
): DebugHudCardContribution {
  let mount: HTMLElement | null = null;
  let snapshot: LearnerDebugSnapshot | null = null;
  let refreshing = false;

  /**
   * Fetch, then redraw. One request in flight at a time: the HUD ticks faster
   * than IndexedDB answers, and queueing them would make the card lag further
   * behind the longer it stayed open.
   */
  function refresh(): void {
    if (refreshing) return;
    refreshing = true;
    void args
      .getSnapshot()
      .then((next) => {
        snapshot = next;
        if (mount) {
          renderInto(mount, snapshot, args.getTurnState(), args.getTargetLanguage(), Date.now());
        }
      })
      .catch(() => {
        // A debug card must never break the frame it draws in.
      })
      .finally(() => {
        refreshing = false;
      });
  }

  return {
    pluginId: args.pluginId,
    contributionId: "sugarlang.debug.learner-card",
    kind: "debug.hudCard",
    displayName: "Learner",
    priority: 41,
    hostKinds: ["studio"],
    payload: {
      cardId: CARD_ID,
      renderCard(container: HTMLElement, _context: DebugHudCardContext) {
        mount = container;
        renderInto(container, snapshot, args.getTurnState(), args.getTargetLanguage(), Date.now());
        refresh();
      },
      updateCard(_context: DebugHudCardContext) {
        if (!mount) return;
        // Redraw from what is already in hand so the observation row keeps up
        // with hovering, and ask for fresh cards behind it.
        renderInto(mount, snapshot, args.getTurnState(), args.getTargetLanguage(), Date.now());
        refresh();
      },
      disposeCard() {
        mount = null;
        snapshot = null;
      }
    }
  };
}
