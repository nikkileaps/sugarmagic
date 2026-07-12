/**
 * Text input that edits a LOCAL draft and commits on blur or
 * Enter (Escape reverts). Use for fields whose onCommit lands in
 * the authoring session — per-keystroke commits create a session
 * update (and an undo entry) per letter typed.
 */

import { useState } from "react";
import { TextInput, type TextInputProps } from "@mantine/core";

export interface DraftTextInputProps
  extends Omit<TextInputProps, "value" | "onChange"> {
  value: string;
  onCommit: (next: string) => void;
}

export function DraftTextInput({
  value,
  onCommit,
  ...rest
}: DraftTextInputProps) {
  // null = not editing; the field mirrors the canonical value.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <TextInput
      {...rest}
      value={draft ?? value}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) {
          onCommit(draft);
        }
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(null);
        }
      }}
    />
  );
}
