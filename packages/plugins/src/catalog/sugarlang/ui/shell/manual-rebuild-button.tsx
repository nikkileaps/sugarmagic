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
import type { GameProject, RegionDocument } from "@sugarmagic/domain";
import { PanelSection } from "@sugarmagic/ui";
import type { ReactElement } from "react";
import {
  readSugarlangCompileStatus,
  rebuildSugarlangCompileCache,
  resolveStudioCompileWorkspaceId,
  type SugarlangCompileStatusSummary
} from "./editor-support";

export interface ManualRebuildButtonProps {
  gameProjectId: string | null;
  gameProject: GameProject | null;
  regions: RegionDocument[];
  targetLanguage: string;
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

  useEffect(() => {
    let cancelled = false;

    void readSugarlangCompileStatus(
      props.gameProject,
      props.regions,
      props.targetLanguage,
      workspaceId
    ).then((nextStatus) => {
      if (!cancelled) {
        setStatus(nextStatus);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [props.gameProject, props.regions, props.targetLanguage, workspaceId]);

  async function handleRebuild(): Promise<void> {
    setIsRunning(true);
    setMessage(null);
    try {
      const nextStatus = await rebuildSugarlangCompileCache(
        props.gameProject,
        props.regions,
        props.targetLanguage,
        workspaceId,
        setProgress
      );
      setStatus(nextStatus);
      setLastRebuildAt(Date.now());
      setMessage("Sugarlang lexicons rebuilt successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRunning(false);
    }
  }

  const progressPercent =
    progress.totalScenes > 0
      ? (progress.completedScenes / progress.totalScenes) * 100
      : 0;

  return (
    <PanelSection title="Sugarlang Compile Status" icon="🛠️">
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
          Rebuild Sugarlang Lexicon
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
              border: `1px solid ${
                message.includes("successfully")
                  ? "rgba(166, 227, 161, 0.35)"
                  : "rgba(243, 139, 168, 0.35)"
              }`,
              background: message.includes("successfully")
                ? "rgba(166, 227, 161, 0.08)"
                : "rgba(243, 139, 168, 0.08)",
              padding: "0.75rem",
              fontSize: "0.85rem"
            }}
          >
            {message}
          </div>
        ) : null}
      </div>
    </PanelSection>
  );
}
