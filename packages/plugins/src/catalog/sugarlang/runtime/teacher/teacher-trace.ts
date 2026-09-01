/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/teacher-trace.ts
 *
 * Purpose: Dumps what the Teacher was handed and what it decided, to the BROWSER
 *   CONSOLE. Not the debug HUD -- plain `console` output you can expand, copy,
 *   and paste.
 *
 * THREE THINGS, EVERY TEACHER CALL:
 *   1. the SITUATION it was given
 *   2. the FULL prompt sent to the model, system and user
 *   3. the DIRECTIVE it returned
 *
 * WHY THIS IS NOT `logger.debug`
 *   Two reasons, both learned the hard way on this epic. The shared logger goes
 *   completely SILENT unless `config.debugLogging` is on, so a trace can look
 *   wired and print nothing. And `console.debug` is Chrome's "Verbose" level,
 *   hidden by default -- so even when it does fire you see an empty console and
 *   conclude the code never ran.
 *
 *   This uses `console.info` (visible at default level) and is gated on its own
 *   switch that defaults ON in a Studio preview, so the failure mode is noise
 *   rather than silence.
 *
 * TURNING IT OFF
 *   In the console: `window.__sugarlangTraceTeacher = false`
 *   Back on:        `window.__sugarlangTraceTeacher = true`
 *
 * Exports:
 *   - traceTeacherCall
 *
 * Relationships:
 *   - Called from the LLM teacher policy, which is the one place holding all
 *     three objects at once.
 *
 * Implements: Plan 090 debugging support
 *
 * Status: active
 */

import type { PedagogicalDirective, TeacherContext } from "../types";
import { EMPTY_NPC_CONTEXT } from "../situation";

const TRACE_FLAG = "__sugarlangTraceTeacher";

interface TraceGlobal {
  [TRACE_FLAG]?: boolean;
  console?: Console;
}

/**
 * Default ON. An explicit `false` turns it off; anything else leaves it on.
 *
 * Deliberately opt-OUT rather than opt-in: a trace you have to remember to
 * enable is one you will not have running at the moment something interesting
 * happens, which is exactly when you need it.
 */
function traceEnabled(): boolean {
  // Browser only. This is a console tool for watching a live conversation; in
  // node it just floods test output with prompts, which is how it announced
  // itself the first time the suite ran.
  if (typeof window === "undefined") return false;
  return (window as unknown as TraceGlobal)[TRACE_FLAG] !== false;
}

/**
 * COMPETENCIES ON ONE LINE, because the question they answer is a yes/no and
 * the raw slate cannot answer it at a glance.
 *
 * A competency is a `{kind: "competency", competencyId}` object sitting inside
 * a collapsed array of mostly-vocabulary refs, so "are competencies still
 * reaching the directive" meant expanding three arrays and reading every entry.
 * That is precisely the question 090.10 needs watched while the prescriber is
 * deleted: `prescription.introduce` is the road competencies currently travel,
 * so if the slate stops carrying them, competency teaching stops SILENTLY --
 * no test fails and nothing else in this trace changes.
 *
 * Prints `(none)` rather than an empty array: "the Teacher named no
 * competencies this turn" and "competencies stopped arriving" look identical
 * as `[]`, and only one of them is a bug.
 */
function competencyLine(directive: PedagogicalDirective): string {
  const ids = [
    ...directive.targetVocab.introduce,
    ...directive.targetVocab.reinforce
  ]
    .filter((ref) => ref.kind === "competency")
    .map((ref) => (ref as { competencyId: string }).competencyId);

  return ids.length > 0 ? ids.join(", ") : "(none)";
}

function group(label: string, body: () => void): void {
  /* eslint-disable no-console */
  const canGroup = typeof console.groupCollapsed === "function";
  if (canGroup) console.groupCollapsed(label);
  else console.info(label);
  try {
    body();
  } finally {
    if (canGroup && typeof console.groupEnd === "function") console.groupEnd();
  }
  /* eslint-enable no-console */
}

/**
 * Prints the situation, the prompt and the directive for one Teacher call.
 *
 * `directive` is undefined when the call failed -- the trace still prints, so a
 * failed call is visible rather than absent. An absent trace looks identical to
 * "the Teacher never ran", which is the ambiguity this exists to remove.
 */
/**
 * For directives that never went through the model: a cache hit, or the
 * deterministic fallback.
 *
 * Without this, those turns print nothing at all and the console looks like the
 * Teacher stopped running -- when in fact it ran once and is being reused, or
 * the gateway failed and the fallback answered. Both are things you want to see
 * rather than infer from silence.
 */
export function traceTeacherDirective(args: {
  context: TeacherContext;
  directive: PedagogicalDirective;
  source: "cache" | "fallback";
}): void {
  if (!traceEnabled()) return;
  /* eslint-disable no-console */
  const { context, directive, source } = args;
  const contextNpc = context.situation?.npc ?? EMPTY_NPC_CONTEXT;
  const npc = contextNpc.displayName ?? contextNpc.npcDefinitionId ?? "(unknown npc)";
  const label =
    source === "cache"
      ? "served from CACHE (no model call, no prompt)"
      : "from the FALLBACK policy (no model call -- deterministic)";

  group(`[sugarlang] TEACHER DIRECTIVE -- ${npc} -- ${label}`, () => {
    console.info("situationKey:", context.situationKey ?? "(none)");
    console.info("directive:", directive);
    console.info("competencies on the slate:", competencyLine(directive));
    console.info("slate:", {
      introduce: directive.targetVocab.introduce,
      reinforce: directive.targetVocab.reinforce,
      avoid: directive.targetVocab.avoid,
      posture: directive.supportPosture,
      isFallback: directive.isFallbackDirective
    });
  });
  /* eslint-enable no-console */
}

export function traceTeacherCall(args: {
  context: TeacherContext;
  systemPrompt: string;
  userPrompt: string;
  directive?: PedagogicalDirective;
  errorText?: string;
}): void {
  if (!traceEnabled()) return;
  /* eslint-disable no-console */

  const { context, systemPrompt, userPrompt, directive, errorText } = args;
  const contextNpc = context.situation?.npc ?? EMPTY_NPC_CONTEXT;
  const npc = contextNpc.displayName ?? contextNpc.npcDefinitionId ?? "(unknown npc)";

  group(`[sugarlang] TEACHER CALL -- ${npc} -- ${context.situation?.regionId ?? "unknown-scene"}`, () => {
    group("1. SITUATION handed to the Teacher", () => {
      if (!context.situation) {
        console.info(
          "(no situation on the context -- the middleware did not compose one)"
        );
      } else {
        // Logged as an object so it is expandable and copyable, plus a flat
        // summary because the interesting question is usually "is anything
        // actually in here".
        console.info("situation:", context.situation);
        console.info("summary:", {
          regionId: context.situation.regionId,
          sceneContextAvailable: context.situation.sceneContext.available,
          conceptCount: context.situation.sceneContext.available
            ? context.situation.sceneContext.value.concepts.length
            : "(scene never built)",
          concepts: context.situation.sceneContext.available
            ? context.situation.sceneContext.value.concepts.map((c) => c.label)
            : [],
          runtimeFactsAvailable: Object.fromEntries(
            Object.entries(context.situation.runtime).map(([key, fact]) => [
              key,
              fact.available
            ])
          )
        });
      }
      console.info("situationKey:", context.situationKey ?? "(none)");
    });

    group("2. PROMPT sent to the model", () => {
      // Printed as raw strings rather than objects: this is text meant to be
      // READ, and an object viewer escapes the newlines that make a prompt
      // legible.
      console.info("--- SYSTEM ---\n" + systemPrompt);
      console.info("--- USER ---\n" + userPrompt);
    });

    group("3. DIRECTIVE returned", () => {
      if (errorText) {
        console.info("(call failed)", errorText);
      }
      if (!directive) {
        console.info("(no directive -- see the error above, or the fallback path)");
        return;
      }
      console.info("directive:", directive);
      console.info("competencies on the slate:", competencyLine(directive));
      console.info("slate:", {
        introduce: directive.targetVocab.introduce,
        reinforce: directive.targetVocab.reinforce,
        avoid: directive.targetVocab.avoid,
        posture: directive.supportPosture,
        ratio: directive.targetLanguageRatio,
        isFallback: directive.isFallbackDirective,
        rationale: directive.rationale
      });
    });
  });
  /* eslint-enable no-console */
}

/**
 * 090.7: WHAT THE SLATE ASKED FOR vs WHAT THE TEXT ACTUALLY DID.
 *
 * The trace above shows the DECISION. This shows the REALIZATION, and the whole
 * point is telling apart two failures that look identical from the outside:
 *
 *   "the slate was right and nothing in this text matched it"
 *   "the slate was wrong"
 *
 * Distinguishing those by hand is what cost hours on 2026-07-28. So DISJOINT is
 * called out explicitly rather than left to be inferred by comparing two lists
 * -- an empty intersection is the single most diagnostic thing here and it is
 * invisible if you only print both sides.
 */
/**
 * Which slated things actually reached the text.
 *
 * Pure and UNGATED -- extracted from traceRealization (en3) because the
 * baseline reads these counts, and the trace early-returns when tracing is
 * disabled. A quality measure that silently stops recording when a debug flag
 * flips is the empty-dataset trap this epic keeps writing down.
 */
export function realizationOutcome<T extends { asked: string; forms: string[] }>(
  text: string,
  slate: T[]
): { asked: number; landed: number; landedEntries: T[] } {
  const lowered = text.toLocaleLowerCase();
  const isPresent = (form: string) => lowered.includes(form.toLocaleLowerCase());
  const landedEntries = slate.filter((entry) =>
    [entry.asked, ...entry.forms].some(isPresent)
  );
  return { asked: slate.length, landed: landedEntries.length, landedEntries };
}

export function traceRealization(args: {
  npcDisplayName: string | null;
  text: string;
  /**
   * WHAT THE TEACHER ASKED FOR, one entry per slated thing.
   *
   * `asked` is the citation form -- the thing the Teacher actually chose.
   * `forms` is every surface it may legitimately appear as, because realization
   * writes whatever the sentence needs.
   *
   * The two are separate on purpose. Handing this a flat list of surfaces made
   * the trace claim the Teacher had asked for `estaciones` and `problemas`,
   * which it never did -- it asked for `estación` and `problema`. A diagnostic
   * that misreports the decision it exists to explain is worse than none.
   */
  slate: Array<{ asked: string; forms: string[] }>;
  ambientSurfaces: string[];
}): void {
  if (!traceEnabled()) return;
  /* eslint-disable no-console */
  const { npcDisplayName, text, slate, ambientSurfaces } = args;
  const lowered = text.toLocaleLowerCase();
  const isPresent = (form: string) => lowered.includes(form.toLocaleLowerCase());
  // A slated word LANDED if any of its forms is on the page -- `estación`
  // counts whether the line said `estación` or `estaciones`. ONE implementation
  // of that judgment: realizationOutcome, which the en3 baseline also reads.
  const { landedEntries } = realizationOutcome(text, slate);
  const landed = landedEntries.map((entry) => {
    const surface = [entry.asked, ...entry.forms].find(isPresent);
    return surface && surface !== entry.asked
      ? `${entry.asked} (as ${surface})`
      : entry.asked;
  });
  const missed = slate
    .filter((entry) => !landedEntries.includes(entry))
    .map((entry) => entry.asked);
  const slateTerms = slate.map((entry) => entry.asked);
  const disjoint = slateTerms.length > 0 && landed.length === 0;

  group(
    `[sugarlang] REALIZATION -- ${npcDisplayName ?? "(unknown npc)"}${
      disjoint ? " -- DISJOINT: nothing the slate asked for is in this line" : ""
    }`,
    () => {
      console.info("slate asked for:", slateTerms.length > 0 ? slateTerms.join(", ") : "(none)");
      console.info("landed in the text:", landed.length > 0 ? landed.join(", ") : "(none)");
      console.info("asked for but absent:", missed.length > 0 ? missed.join(", ") : "(none)");
      // Ambient is the other half of the picture: target language the line
      // contains that nobody asked for. A line can be disjoint AND full of
      // Spanish, which says the generator ignored the slate rather than failing
      // to find room for it.
      console.info(
        "target language nobody asked for:",
        ambientSurfaces.length > 0 ? ambientSurfaces.join(", ") : "(none)"
      );
      console.info("text:", text);
    }
  );
  /* eslint-enable no-console */
}

/**
 * Prints what sugarlang tells the Judge about language, for one turn.
 *
 * WHY THIS EXISTS
 *   The judge prompt is assembled in the GATEWAY, so it never reaches the
 *   browser console -- there was no way to see what the Judge was actually
 *   told, only what it decided. This prints the sugarlang half: the criteria
 *   that go into `externalDirectives`.
 *
 *   The other half, the assembled prompt, is deterministic given these
 *   directives and is pinned by judge-prompts.test.ts. Directives here plus
 *   the `judge=` / `judgeLanguageFit=` turn facts give send and receive
 *   without needing gateway logs.
 *
 * NOT PRINTED WHEN THERE ARE NO DIRECTIVES, which is itself the signal: it
 * means the Judge got the plain rubric, with no language section at all.
 */
export function traceJudgeDirectives(directives: string[] | undefined): void {
  if (!directives || directives.length === 0) {
    return;
  }
  /* eslint-disable no-console */
  console.info("[sugarlang] JUDGE gets these language criteria:");
  for (const directive of directives) {
    console.info("  " + directive);
  }
  /* eslint-enable no-console */
}
