/**
 * packages/plugins/src/catalog/sugarlang/ui/shell/language-config-section.tsx
 *
 * Purpose: Design section for setting the target and support languages in the Sugarlang workspace.
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

import type { ReactElement } from "react";

export interface LanguageConfigSectionProps {
  targetLanguage: string;
  supportLanguage: string;
  debugLogging: boolean;
  onChangeTargetLanguage: (lang: string) => void;
  onChangeDebugLogging: (enabled: boolean) => void;
}

export function LanguageConfigSection(
  props: LanguageConfigSectionProps
): ReactElement {
  const { targetLanguage, supportLanguage, debugLogging, onChangeTargetLanguage, onChangeDebugLogging } = props;

  return (
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
          Target language not set — Sugarlang cannot function without one.
        </div>
      )}

      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          Target Language
        </span>
        <span style={{ fontSize: "0.7rem", color: "var(--sm-color-subtext)" }}>
          The language the player is learning. Required.
        </span>
        <select
          aria-label="Target language"
          value={targetLanguage}
          onChange={(event) => onChangeTargetLanguage(event.target.value)}
          style={{
            padding: "0.4rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--sm-color-surface1, #444)",
            background: "var(--sm-color-base, #1e1e2e)",
            color: "var(--sm-color-text, #cdd6f4)",
            fontSize: "0.85rem"
          }}
        >
          <option value="">Select a language...</option>
          <option value="es">Spanish (Español)</option>
          <option value="it">Italian (Italiano)</option>
        </select>
      </label>

      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          Support Language
        </span>
        <span style={{ fontSize: "0.7rem", color: "var(--sm-color-subtext)" }}>
          The player's native language. Used for glosses and placement form.
        </span>
        <select
          aria-label="Support language"
          value={supportLanguage}
          disabled
          style={{
            padding: "0.4rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--sm-color-surface1, #444)",
            background: "var(--sm-color-surface0, #313244)",
            color: "var(--sm-color-overlay0, #6c7086)",
            fontSize: "0.85rem"
          }}
        >
          <option value="en">English</option>
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
          — logs middleware pipeline, classifier, director, and observer traces to console
        </span>
      </label>
    </div>
  );
}
