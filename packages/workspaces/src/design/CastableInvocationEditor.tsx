/**
 * Reusable castable invocation editor for Design workspaces.
 *
 * Spells and trigger-castable items both author the same domain concept:
 * a CastableInvocation. Keeping the selector and argument controls here
 * prevents each workspace from inventing its own mechanics UI.
 */

import {
  Checkbox,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea
} from "@mantine/core";
import type {
  CastableDefinition,
  CastableInput,
  CastableInvocation,
  JsonValue,
  MechanicsDefinition
} from "@sugarmagic/domain";

export interface CastableInvocationEditorProps {
  label?: string;
  mechanics: MechanicsDefinition;
  invocation: CastableInvocation;
  onChange: (invocation: CastableInvocation) => void;
}

function defaultCastableArg(input: CastableInput): JsonValue {
  if (input.default !== undefined) return input.default;
  if (input.type === "number") return 0;
  if (input.type === "boolean") return false;
  if (input.type === "object") return {};
  return "";
}

function createDefaultCastableArgs(
  castable: CastableDefinition | null | undefined
): Record<string, JsonValue> {
  if (!castable) return {};
  return Object.fromEntries(
    castable.inputs.map((input) => [input.id, defaultCastableArg(input)])
  );
}

function formatInputLabel(input: CastableInput): string {
  return input.id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function createDefaultInvocationForCastable(
  castable: CastableDefinition | null | undefined
): CastableInvocation {
  return {
    id: castable?.id ?? "",
    args: createDefaultCastableArgs(castable)
  };
}

export function CastableInvocationEditor(
  props: CastableInvocationEditorProps
) {
  const { label = "Castable", mechanics, invocation, onChange } = props;
  const castable =
    mechanics.castables.find((definition) => definition.id === invocation.id) ??
    null;
  const castableOptions = mechanics.castables.map((definition) => ({
    value: definition.id,
    label: definition.displayName
  }));

  function updateArg(input: CastableInput, value: JsonValue) {
    onChange({
      ...invocation,
      args: {
        ...invocation.args,
        [input.id]: value
      }
    });
  }

  function renderArgEditor(input: CastableInput) {
    const inputLabel = formatInputLabel(input);
    const value = invocation.args[input.id];

    if (input.type === "number") {
      return (
        <NumberInput
          key={input.id}
          label={inputLabel}
          description={input.description}
          size="xs"
          value={typeof value === "number" ? value : 0}
          onChange={(nextValue) => {
            if (typeof nextValue !== "number") return;
            updateArg(input, nextValue);
          }}
        />
      );
    }

    if (input.type === "boolean") {
      return (
        <Checkbox
          key={input.id}
          label={inputLabel}
          description={input.description}
          checked={value === true}
          onChange={(event) => updateArg(input, event.currentTarget.checked)}
        />
      );
    }

    if (input.type === "object") {
      return (
        <Textarea
          key={input.id}
          label={inputLabel}
          description={input.description ?? "JSON object"}
          size="xs"
          minRows={3}
          value={JSON.stringify(
            value && typeof value === "object" ? value : {},
            null,
            2
          )}
          onChange={(event) => {
            try {
              updateArg(input, JSON.parse(event.currentTarget.value) as JsonValue);
            } catch {
              // Keep invalid JSON local until the author fixes the field.
            }
          }}
        />
      );
    }

    return (
      <TextInput
        key={input.id}
        label={inputLabel}
        description={input.description}
        size="xs"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => updateArg(input, event.currentTarget.value)}
      />
    );
  }

  return (
    <Stack gap="xs">
      <Select
        label={label}
        size="xs"
        searchable
        data={castableOptions}
        value={invocation.id}
        onChange={(value) => {
          const nextCastable =
            mechanics.castables.find((definition) => definition.id === value) ??
            null;
          onChange(createDefaultInvocationForCastable(nextCastable));
        }}
      />
      {castable ? (
        castable.inputs.length === 0 ? (
          <Text size="xs" c="var(--sm-color-overlay0)">
            This castable does not require arguments.
          </Text>
        ) : (
          castable.inputs.map(renderArgEditor)
        )
      ) : (
        <Text size="xs" c="var(--sm-color-red)">
          Select a valid castable before saving or previewing.
        </Text>
      )}
    </Stack>
  );
}
