/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/language-config-section.tsx
 *
 * Purpose: Sugarlang's authoring controls that are not the project's language:
 *   the CEFR band override, debug logging, and resetting learner data.
 *
 * The language itself is edited in the project's Sugarlang settings, and only
 * there. This section used to carry a second Target Language select writing
 * the same config field, plus a Support Language select that was disabled and
 * always "en". It still READS the language, to warn when none is set and to
 * say which one the sections around it are scoped to.
 *
 * Exports:
 *   - LanguageConfigSection
 *
 * Relationships:
 *   - Registered as a design.section contribution in contributions.ts.
 *   - Reads and writes the plugin config via the onUpdatePluginConfig callback.
 *
 * Status: active
 */

import { useState, type ReactElement } from "react";
import { PanelSection } from "@sugarmagic/ui";

export interface LanguageConfigSectionProps {
  /** Read-only here. The project's Sugarlang settings own the edit. */
  targetLanguage: string;
  debugLogging: boolean;
  debugBandOverride: string;
  onChangeDebugLogging: (enabled: boolean) => void;
  onChangeDebugBandOverride: (band: string) => void;
  onResetLearner?: () => Promise<void>;
}

export function LanguageConfigSection(
  props: LanguageConfigSectionProps
): ReactElement {
  const { targetLanguage, debugLogging, debugBandOverride, onChangeDebugLogging, onChangeDebugBandOverride, onResetLearner } = props;
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  return (
    <PanelSection title="Learner Debug" icon="🌐">
    <div style={{ display: "grid", gap: "0.75rem" }}>
      {!targetLanguage && (
        <div
          style={{
            padding: "0.5rem 0.75rem",
            background: "var(--sm-color-red, #c0392b)",
            borderRadius: "0.25rem",
            color: "#fff",
            fontSize: "0.8rem",
            fontWeight: 600
          }}
        >
          Target language not set — Sugarlang cannot function without one. Set
          it in the project's Sugarlang settings.
        </div>
      )}

      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          Band Override
        </span>
        <span style={{ fontSize: "0.7rem", color: "var(--sm-color-subtext)" }}>
          Skip placement and boot at this CEFR band. Reload Preview to apply.
        </span>
        <select
          aria-label="Band override"
          value={debugBandOverride}
          onChange={(event) => onChangeDebugBandOverride(event.target.value)}
          style={{
            padding: "0.4rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--sm-color-surface1, #444)",
            background: "var(--sm-color-base, #1e1e2e)",
            color: "var(--sm-color-text, #cdd6f4)",
            fontSize: "0.85rem"
          }}
        >
          <option value="">(off -- use placement flow)</option>
          <option value="A1">A1</option>
          <option value="A2">A2</option>
          <option value="B1">B1</option>
          <option value="B2">B2</option>
          <option value="C1">C1</option>
          <option value="C2">C2</option>
        </select>
      </label>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          cursor: "pointer"
        }}
      >
        <input
          type="checkbox"
          checked={debugLogging}
          onChange={(event) => onChangeDebugLogging(event.target.checked)}
          style={{ accentColor: "var(--sm-color-blue, #89b4fa)" }}
        />
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          Debug Logging
        </span>
        <span style={{ fontSize: "0.7rem", color: "var(--sm-color-subtext)" }}>
          — logs middleware pipeline, classifier, teacher, and observer traces to console
        </span>
      </label>

      {onResetLearner ? (
        <div
          style={{
            borderTop: "1px solid var(--sm-color-surface1, #444)",
            paddingTop: "0.65rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem"
          }}
        >
          <button
            type="button"
            disabled={resetting}
            onClick={() => {
              setResetting(true);
              setResetDone(false);
              onResetLearner().then(() => {
                setResetting(false);
                setResetDone(true);
              });
            }}
            style={{
              padding: "0.35rem 0.75rem",
              borderRadius: "0.25rem",
              border: "1px solid var(--sm-color-red, #c0392b)",
              background: "transparent",
              color: "var(--sm-color-red, #c0392b)",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: resetting ? "wait" : "pointer",
              opacity: resetting ? 0.5 : 1
            }}
          >
            {resetting ? "Resetting..." : "Reset Learner"}
          </button>
          <span style={{ fontSize: "0.7rem", color: "var(--sm-color-subtext)" }}>
            {resetDone
              ? "Done — reload Preview to start fresh."
              : "Clears all FSRS cards, telemetry, and learner state."}
          </span>
        </div>
      ) : null}
    </div>
    </PanelSection>
  );
}
