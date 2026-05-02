/**
 * InlineAssetField
 *
 * Inspector control for entity-owned content fields backed by an asset
 * (character models, item meshes, etc.). Renders as a single read-only text
 * input — click to open the OS file picker. Shows the bound asset's filename
 * when set, an error state when the bound id can't be resolved.
 */

import { TextInput } from "@mantine/core";
import type { JSX } from "react";

export interface InlineAssetFieldProps {
  label: string;
  value: string | null;
  hasBoundId: boolean;
  onImport: () => Promise<string | null>;
  onChange: (definitionId: string | null) => void;
  placeholder?: string;
}

export function InlineAssetField(props: InlineAssetFieldProps): JSX.Element {
  const missing = props.hasBoundId && props.value === null;

  const runImport = async () => {
    const next = await props.onImport();
    if (next) props.onChange(next);
  };

  return (
    <TextInput
      label={props.label}
      size="xs"
      readOnly
      value={props.value ?? ""}
      placeholder={missing ? "Missing — click to re-pick" : props.placeholder ?? "Click to pick a file…"}
      error={missing}
      onClick={runImport}
      styles={{ input: { cursor: "pointer" } }}
    />
  );
}
