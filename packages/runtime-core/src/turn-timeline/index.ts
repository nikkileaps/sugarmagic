/**
 * packages/runtime-core/src/turn-timeline/index.ts
 *
 * Purpose: One wall-clock timeline per conversation turn, printed as a single
 *   block, so where a turn's seconds go is readable instead of inferred.
 *
 * WHY IT LIVES IN RUNTIME-CORE
 *   A turn is not owned by one plugin. Sugarlang decides what to teach BEFORE
 *   the turn runs and verifies it after; sugaragent runs the stages in between.
 *   Neither can see the other's clock, so the largest single cost -- the Teacher
 *   call -- appears in no stage diagnostic at all, and a turn that takes nine
 *   seconds is only explainable by hand-reading interleaved console lines.
 *
 *   Both plugins already depend on runtime-core, so this is the one place both
 *   ends can reach.
 *
 * WHY IT PRINTS RATHER THAN EMITS
 *   Deliberate, for a measuring spike. Sugarlang's telemetry sink 404'd for nine
 *   days while everything believed it was recording, and the metrics that
 *   depended on it turned out to hold nothing. A console block cannot pretend to
 *   work: it is either on the screen or it is not.
 *
 * Exports:
 *   - beginTurnTimeline
 *   - markTurnPhase
 *   - noteTurnFact
 *   - endTurnTimeline
 *
 * Status: active
 */

interface TurnPhase {
  label: string;
  ms: number;
}

interface TurnTimeline {
  label: string;
  startedAt: number;
  phases: TurnPhase[];
  /** Counts and flags worth seeing beside the timings. */
  facts: Record<string, string | number | boolean>;
}

let current: TurnTimeline | null = null;

/**
 * Starts a timeline. A turn that never ends one -- an early return, a throw --
 * is simply replaced by the next, which is the right failure for a diagnostic:
 * it must never be the reason a turn breaks.
 */
export function beginTurnTimeline(label: string, now = Date.now()): void {
  current = { label, startedAt: now, phases: [], facts: {} };
}

/**
 * Records a phase that has already happened, by duration.
 *
 * Duration rather than start/stop because most of these are measured by code
 * that already knows how long it took -- stage diagnostics carry `durationMs`,
 * the Teacher's telemetry carries `latencyMs` -- and re-timing them here would
 * be a second answer to a question already answered.
 */
export function markTurnPhase(label: string, ms: number): void {
  if (!current) return;
  current.phases.push({ label, ms: Math.max(0, Math.round(ms)) });
}

/** Records something that is not a duration: a count, a cache hit, a model. */
export function noteTurnFact(key: string, value: string | number | boolean): void {
  if (!current) return;
  current.facts[key] = value;
}

/**
 * Prints the timeline and clears it.
 *
 * `unaccounted` is the gap between the wall clock and the phases that reported.
 * It is the most useful number here: it is where the time nobody instrumented
 * went, and a spike whose job is finding that cannot afford to hide it.
 */
export function endTurnTimeline(now = Date.now()): void {
  const timeline = current;
  current = null;
  if (!timeline) return;

  const total = Math.max(0, Math.round(now - timeline.startedAt));
  const accounted = timeline.phases.reduce((sum, phase) => sum + phase.ms, 0);
  const rows = [...timeline.phases].sort((left, right) => right.ms - left.ms);

  const lines = rows.map((phase) => {
    const share = total > 0 ? ((phase.ms / total) * 100).toFixed(1) : "0.0";
    return `  ${phase.label.padEnd(16)} ${String(phase.ms).padStart(6)}ms  ${share.padStart(5)}%`;
  });

  const unaccounted = Math.max(0, total - accounted);
  const unaccountedShare = total > 0 ? ((unaccounted / total) * 100).toFixed(1) : "0.0";

  const facts = Object.entries(timeline.facts)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("  ");

  console.info(
    [
      `[turn-timeline] ${timeline.label} -- ${total}ms total`,
      ...lines,
      `  ${"(unaccounted)".padEnd(16)} ${String(unaccounted).padStart(6)}ms  ${unaccountedShare.padStart(5)}%`,
      facts ? `  ${facts}` : null
    ]
      .filter(Boolean)
      .join("\n")
  );
}
