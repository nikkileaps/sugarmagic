/**
 * InlineAssetField
 *
 * Inspector control for entity-owned content fields backed by an asset
 * (character models, item meshes, etc.). Renders as a single read-only text
 * input. Shows the bound asset's filename when set, an error state when the
 * bound id can't be resolved.
 *
 * Clicking does one of two things:
 *   - `onBrowse` given  -> hand off to a picker over already-imported assets
 *   - otherwise         -> open the OS file picker and import (`onImport`)
 *
 * The split is deliberate rather than a blanket upgrade. Item models are
 * ordinary library assets and browsing across them is the point. Character
 * models are 1:1 with their character, so a library of them has no meaning --
 * see the note on `CharacterModelDefinition` in the content library. Those
 * fields pass no `onBrowse` and keep the import-only behaviour.
 */

import { TextInput } from "@mantine/core";
import type { JSX } from "react";

export interface InlineAssetFieldProps {
  label: string;
  value: string | null;
  hasBoundId: boolean;
  onImport: () => Promise<string | null>;
  onChange: (definitionId: string | null) => void;
  /** When set, clicking opens this instead of the OS file dialog. */
  onBrowse?: () => void;
  placeholder?: string;
}

export function InlineAssetField(props: InlineAssetFieldProps): JSX.Element {
  const missing = props.hasBoundId && props.value === null;

  const handleClick = async () => {
    if (props.onBrowse) {
      props.onBrowse();
      return;
    }
    const next = await props.onImport();
    if (next) props.onChange(next);
  };

  return (
    <TextInput
      label={props.label}
      size="xs"
      readOnly
      value={props.value ?? ""}
      placeholder={
        missing
          ? "Missing — click to re-pick"
          : props.placeholder ??
            (props.onBrowse ? "Click to choose an asset…" : "Click to pick a file…")
      }
      error={missing}
      onClick={handleClick}
      styles={{ input: { cursor: "pointer" } }}
    />
  );
}
