/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/manual-rebuild-button.tsx
 *
 * Purpose: Renders the manual lexicon rebuild action and compile-status panel for Studio authoring workflows.
 *
 * Exports:
 *   - ManualRebuildButton
 *
 * Relationships:
 *   - Depends on the compile cache and authoring scheduler from Epic 6.
 *   - Is registered by contributions.ts as an Epic 12 design.section contribution.
 *
 * Implements: Proposal 001 §Scene Lexicon Compilation: One Compiler, Three Profiles, Preview-First
 *
 * Status: active
 */

import { useEffect, useMemo, useState } from "react";
import type { GameProject, RegionDocument, Scene } from "@sugarmagic/domain";
import { ErrorToast, PanelSection, ProgressToast } from "@sugarmagic/ui";
import type { ReactElement } from "react";
import {
  readCurrentSceneContentHashes,
  readSugarlangCompileStatus,
  rebuildSugarlangCompileCache,
  resolveStudioCompileWorkspaceId,
  type SugarlangCompileStatusSummary
} from "./editor-support";
import {
  hydrateTeachPlans,
  type SugarlangTeachPlanDocument
} from "../../runtime/compile/teach-plan-state";

export interface ManualRebuildButtonProps {
  gameProjectId: string | null;
  gameProject: GameProject | null;
  regions: RegionDocument[];
  /** Ambient Scene composed onto each region during compile -- without it
   *  the rebuilt lexicons contain zero NPC-sourced content. */
  activeScene?: Scene | null;
  targetLanguage: string;
  /** When false, chunk extraction is skipped during rebuild (no Claude calls
   *  for chunks). Cached chunks from prior runs are still used by the
   *  classifier. Default: true. */
  chunkExtractionEnabled?: boolean;
  /**
   * Persists the rebuilt teach plan into the project's sugarlang config slot.
   * Absent means the plan stays in memory for this session only -- valid, but
   * it will not survive a reload and will not deploy with the game.
   */
  onPersistTeachPlan?: (document: SugarlangTeachPlanDocument) => void;
  /**
   * The teach plan already stored on the project, hydrated into the in-memory
   * lookup on mount so a bake works before any rebuild this session.
   */
  storedTeachPlan?: unknown;
}

const EMPTY_STATUS: SugarlangCompileStatusSummary = {
  totalScenes: 0,
  cachedScenes: 0,
  staleScenes: 0,
  missingScenes: 0,
  chunkCachedScenes: 0
};

export function ManualRebuildButton(
  props: ManualRebuildButtonProps
): ReactElement {
  const workspaceId = useMemo(
    () => resolveStudioCompileWorkspaceId(props.gameProjectId),
    [props.gameProjectId]
  );
  const [status, setStatus] = useState<SugarlangCompileStatusSummary>(EMPTY_STATUS);
  const [isRunning, setIsRunning] = useState(false);
  const [lastRebuildAt, setLastRebuildAt] = useState<number | null>(null);
  const [progress, setProgress] = useState({
    completedScenes: 0,
    totalScenes: 0,
    currentSceneId: null as string | null
  });
  const [message, setMessage] = useState<string | null>(null);
  /** Non-null means the last rebuild did not fully succeed. Never inferred from
   *  message text -- that was how a failure could render green. */
  const [failure, setFailure] = useState<{
    message: string;
    detail?: string;
  } | null>(null);
  /** Scenes whose stored teach plan was dropped as stale. Rendered as a nudge,
   *  NOT an error toast -- an out-of-date plan is a normal consequence of
   *  editing, and the fix is simply to rebuild. */
  const [stalePlanScenes, setStalePlanScenes] = useState<string[]>([]);

  // Load the project's stored plan into the in-memory lookup. Without this a
  // bake right after opening Studio would be un-steered until someone pressed
  // Rebuild, which is exactly the silent gap persisting the plan exists to close.
  //
  // Hashes are passed so a plan belonging to a scene that has since been edited
  // is DROPPED rather than used. Stale steering is worse than none: a bake would
  // aim at what the scene used to be about and look entirely deliberate.
  useEffect(() => {
    let cancelled = false;

    void readCurrentSceneContentHashes(
      props.gameProject,
      props.regions,
      props.targetLanguage,
      props.activeScene ?? null
    )
      .then((currentHashes) => {
        if (cancelled) return;
        const { hydrated, staleScenes } = hydrateTeachPlans(
          props.storedTeachPlan,
          currentHashes
        );
        if (hydrated > 0 || staleScenes.length > 0) {
          console.info("[sugarlang build] teach-plan-hydrated", {
            entries: hydrated,
            staleScenes
          });
        }
        setStalePlanScenes(staleScenes);
      })
      .catch((error: unknown) => {
        // Hydration is best-effort. Failing to load a plan means bakes are
        // un-steered, which is the pre-090.11 behaviour -- not a broken Studio.
        if (!cancelled) {
          console.error("[sugarlang build] teach-plan hydration failed", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    props.storedTeachPlan,
    props.gameProject,
    props.regions,
    props.targetLanguage,
    props.activeScene
  ]);

  useEffect(() => {
    let cancelled = false;

    void readSugarlangCompileStatus(
      props.gameProject,
      props.regions,
      props.targetLanguage,
      props.activeScene ?? null,
      workspaceId
    )
      .then((nextStatus) => {
        if (!cancelled) {
          setStatus(nextStatus);
        }
      })
      // A status READ must never take Studio down. It was a bare `.then()`, so
      // anything thrown in here became an unhandled rejection just from opening
      // the panel. The status is an informational readout; failing to compute it
      // means showing zeros, not breaking the workspace.
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("[sugarlang build] status read failed", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.gameProject, props.regions, props.targetLanguage, props.activeScene, workspaceId]);

  async function handleRebuild(): Promise<void> {
    setIsRunning(true);
    setMessage(null);
    // Clear the previous run's failure too, or a stale red toast sits over a
    // rebuild that is currently succeeding.
    setFailure(null);
    try {
      const result = await rebuildSugarlangCompileCache(
        props.gameProject,
        props.regions,
        props.targetLanguage,
        props.activeScene ?? null,
        workspaceId,
        setProgress,
        {
          chunkExtractionEnabled: props.chunkExtractionEnabled ?? true,
          onTeachPlanDocument: props.onPersistTeachPlan
        }
      );
      setStatus(result.status);
      setLastRebuildAt(Date.now());

      // A rebuild that built nothing is not a successful rebuild. This used to
      // say "rebuilt successfully" unconditionally, and whether the panel
      // rendered green was decided by sniffing the message for the substring
      // "successfully" -- so a failure whose text happened to contain the word
      // rendered as a success.
      if (result.problems.length > 0) {
        setFailure({
          message: result.problems[0]!.message,
          detail:
            result.problems.length > 1
              ? `${result.problems[0]!.detail ?? ""} (+${result.problems.length - 1} more -- see the console)`.trim()
              : result.problems[0]!.detail
        });
        setMessage(null);
        for (const problem of result.problems) {
          console.error(`[sugarlang build] ${problem.pass}: ${problem.message}`, problem.detail ?? "");
        }
        return;
      }

      setFailure(null);
      // A successful rebuild is exactly what un-stales a plan.
      setStalePlanScenes([]);
      setMessage("Sugarlang artifacts rebuilt successfully.");
    } catch (error) {
      // A THROW is different from a reported problem: the rebuild did not
      // finish at all, so nothing downstream can be trusted.
      const text = error instanceof Error ? error.message : String(error);
      setMessage(null);
      setFailure({ message: "Rebuild failed.", detail: text });
      console.error("[sugarlang build] rebuild threw", error);
    } finally {
      setIsRunning(false);
    }
  }

  const progressPercent =
    progress.totalScenes > 0
      ? (progress.completedScenes / progress.totalScenes) * 100
      : 0;

  // A rebuild is long (a gateway call per changed scene) and the panel it
  // starts from is easy to navigate away from. The toast is fixed-position, so
  // progress stays visible wherever the author goes in Studio.
  const toastMessage = isRunning
    ? progress.totalScenes > 0
      ? `Building Sugarlang: ${progress.completedScenes} of ${progress.totalScenes} scenes`
      : "Building Sugarlang..."
    : null;

  return (
    <PanelSection title="Build" icon="🛠️">
      {toastMessage ? <ProgressToast message={toastMessage} /> : null}
      {/* Pinned and dismissible, because the Build panel can be scrolled away
          from -- an inline-only error is one you can be looking straight past
          while wondering why nothing is being taught. */}
      {failure ? (
        <ErrorToast
          message={failure.message}
          detail={failure.detail}
          onDismiss={() => setFailure(null)}
        />
      ) : null}
      <div style={{ display: "grid", gap: "1rem" }}>
        <p style={{ margin: 0, color: "var(--sm-color-subtext)" }}>
          Cached scenes: {status.cachedScenes} / {status.totalScenes}. Chunk-ready: {status.chunkCachedScenes}. Stale: {status.staleScenes}. Missing: {status.missingScenes}.
        </p>

        <button
          type="button"
          onClick={() => void handleRebuild()}
          disabled={isRunning}
          style={{
            minHeight: 36,
            borderRadius: 10,
            border: "1px solid var(--sm-panel-border)",
            background: isRunning ? "var(--sm-color-surface2)" : "var(--sm-accent-blue)",
            color: isRunning ? "var(--sm-color-overlay0)" : "white",
            cursor: isRunning ? "progress" : "pointer",
            fontWeight: 600
          }}
        >
          Rebuild
        </button>

        {isRunning ? (
          <div style={{ display: "grid", gap: "0.45rem" }}>
            <div
              style={{
                height: 8,
                borderRadius: 999,
                background: "rgba(137, 180, 250, 0.16)",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  background: "var(--sm-accent-blue)"
                }}
              />
            </div>
            <span style={{ fontSize: "0.75rem", color: "var(--sm-color-overlay0)" }}>
              {progress.completedScenes} / {progress.totalScenes} scenes rebuilt
              {progress.currentSceneId ? ` · ${progress.currentSceneId}` : ""}
            </span>
          </div>
        ) : null}

        {lastRebuildAt ? (
          <span style={{ fontSize: "0.75rem", color: "var(--sm-color-overlay0)" }}>
            Last rebuild: {new Date(lastRebuildAt).toLocaleString()}
          </span>
        ) : null}

        {message ? (
          <div
            style={{
              borderRadius: 10,
              border: "1px solid rgba(166, 227, 161, 0.35)",
              background: "rgba(166, 227, 161, 0.08)",
              padding: "0.75rem",
              fontSize: "0.85rem"
            }}
          >
            {message}
          </div>
        ) : null}

        {stalePlanScenes.length > 0 ? (
          <div
            style={{
              borderRadius: 10,
              border: "1px solid rgba(249, 226, 175, 0.4)",
              background: "rgba(249, 226, 175, 0.08)",
              padding: "0.75rem",
              fontSize: "0.85rem"
            }}
          >
            {stalePlanScenes.length} scene
            {stalePlanScenes.length === 1 ? " has" : "s have"} changed since the
            last build, so their teaching plans were discarded. Lines baked now
            will be graded for level but not steered toward any vocabulary.
            Rebuild to refresh them.
          </div>
        ) : null}

        {failure ? (
          <div
            style={{
              borderRadius: 10,
              border: "1px solid rgba(243, 139, 168, 0.55)",
              background: "rgba(243, 139, 168, 0.12)",
              padding: "0.75rem",
              fontSize: "0.85rem"
            }}
          >
            <strong>{failure.message}</strong>
            {failure.detail ? (
              <>
                <br />
                {failure.detail}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </PanelSection>
  );
}
