/**
 * WorldFlagSelect
 *
 * The one control for pointing authored content at a flag. Every surface that
 * used to take a typed flag key uses this instead, so a flag reference can
 * only ever be a flag that exists.
 *
 * Picking is by display name; the flag's `name` -- its key in the runtime
 * store, and what shows up in the quest debug dump -- rides along under it, so
 * an author can match what they see here against what they see in play.
 *
 * A reference that names no flag renders as a visible error rather than as a
 * blank field, the same way InlineAssetField shows an unresolvable asset id.
 * Blank and broken look identical otherwise, and broken is the one that needs
 * an author's attention.
 */

import { useState } from "react";
import {
  CloseButton,
  Combobox,
  Group,
  Input,
  InputBase,
  Text,
  useCombobox
} from "@mantine/core";
import { useWorldFlagRegistry } from "./WorldFlagRegistryContext";

const CREATE_OPTION_VALUE = "__create__";

export interface WorldFlagSelectProps {
  label: string;
  /** The referenced flag's definitionId, or null when nothing is picked. */
  value: string | null;
  onChange: (worldFlagId: string | null) => void;
  description?: string;
  disabled?: boolean;
  error?: string;
}

export function WorldFlagSelect(props: WorldFlagSelectProps) {
  const { worldFlagDefinitions, createWorldFlag } = useWorldFlagRegistry();
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption()
  });
  const [search, setSearch] = useState("");

  const selected =
    worldFlagDefinitions.find(
      (definition) => definition.definitionId === props.value
    ) ?? null;
  const hasReference = props.value !== null && props.value !== "";
  const dangling = hasReference && !selected;

  const query = search.trim();
  const matches = worldFlagDefinitions.filter((definition) => {
    if (query.length === 0) return true;
    const needle = query.toLowerCase();
    return (
      definition.displayName.toLowerCase().includes(needle) ||
      definition.name.toLowerCase().includes(needle)
    );
  });
  // Only offer to create when the typed name is not already taken. Two flags
  // with one name would share a slot in the runtime store.
  const canCreate =
    query.length > 0 &&
    !worldFlagDefinitions.some((definition) => definition.name === query);

  function handleSubmit(optionValue: string) {
    if (optionValue === CREATE_OPTION_VALUE) {
      props.onChange(createWorldFlag(query));
    } else {
      props.onChange(optionValue);
    }
    setSearch("");
    combobox.closeDropdown();
  }

  return (
    <Combobox store={combobox} withinPortal onOptionSubmit={handleSubmit}>
      <Combobox.Target>
        <InputBase
          label={props.label}
          description={props.description}
          size="xs"
          component="button"
          type="button"
          pointer
          disabled={props.disabled}
          error={
            props.error ??
            (dangling ? "This flag is not in the registry. Pick another." : undefined)
          }
          rightSection={
            // Clearing is only offered once there is something to clear. A
            // dangling reference counts -- being able to drop a broken one
            // is the whole point of showing it.
            hasReference && !props.disabled ? (
              <CloseButton
                size="sm"
                variant="transparent"
                aria-label="Clear flag"
                // The dropdown opens on mousedown, so without this the click
                // both clears the field and reopens the list.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  props.onChange(null);
                  combobox.closeDropdown();
                }}
              />
            ) : (
              <Combobox.Chevron />
            )
          }
          rightSectionPointerEvents={
            hasReference && !props.disabled ? "all" : "none"
          }
          onClick={() => combobox.toggleDropdown()}
        >
          {selected ? (
            <Group gap={6} wrap="nowrap">
              <Text size="xs" truncate>
                {selected.displayName}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {selected.name}
              </Text>
            </Group>
          ) : (
            <Input.Placeholder>
              {dangling ? "Missing flag" : "Pick a flag"}
            </Input.Placeholder>
          )}
        </InputBase>
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Search
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search flags"
        />
        <Combobox.Options mah={220} style={{ overflowY: "auto" }}>
          {matches.map((definition) => (
            <Combobox.Option
              key={definition.definitionId}
              value={definition.definitionId}
            >
              <Group gap={6} wrap="nowrap" justify="space-between">
                <Text size="xs">{definition.displayName}</Text>
                <Text size="xs" c="dimmed">
                  {definition.name}
                </Text>
              </Group>
            </Combobox.Option>
          ))}
          {matches.length === 0 && !canCreate && (
            <Combobox.Empty>No flags</Combobox.Empty>
          )}
          {canCreate && (
            <Combobox.Option value={CREATE_OPTION_VALUE}>
              <Text size="xs">Create flag &quot;{query}&quot;</Text>
            </Combobox.Option>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
