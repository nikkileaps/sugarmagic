/**
 * packages/ui/src/components/ScopeChip.tsx
 *
 * A compact chip for switching an edit SCOPE / tier (e.g. Base vs
 * Scene). Shows the current tier as a pill; when more than one tier is
 * available it's clickable and opens a menu to switch. When switching
 * isn't available it greys out and is non-interactive, with a tooltip
 * explaining why.
 *
 * Reusable anywhere a Base/Scene (or similar tiered) choice is offered.
 *
 * Status: active
 */

import { Badge, Menu, Tooltip } from "@mantine/core";

export interface ScopeChipOption {
  value: string;
  label: string;
}

export interface ScopeChipProps {
  /** The currently selected tier value. */
  value: string;
  /** Selectable tiers, in display order. */
  options: ScopeChipOption[];
  onChange: (value: string) => void;
  /** When true the chip is greyed and non-interactive (locked tier). */
  disabled?: boolean;
  /** Tooltip shown while disabled, explaining why it can't be changed. */
  disabledReason?: string;
  /** Highlight color when interactive. Defaults to blue. */
  color?: string;
}

export function ScopeChip({
  value,
  options,
  onChange,
  disabled = false,
  disabledReason,
  color = "blue"
}: ScopeChipProps) {
  const current = options.find((option) => option.value === value);
  const label = current?.label ?? value;

  const chip = (
    <Badge
      variant="light"
      color={disabled ? "gray" : color}
      size="sm"
      style={{
        cursor: disabled ? "default" : "pointer",
        textTransform: "none",
        userSelect: "none"
      }}
    >
      {label}
    </Badge>
  );

  if (disabled) {
    return disabledReason ? (
      <Tooltip label={disabledReason} withArrow multiline w={240} position="bottom">
        <span style={{ display: "inline-flex" }}>{chip}</span>
      </Tooltip>
    ) : (
      chip
    );
  }

  return (
    <Menu shadow="md" withinPortal position="bottom-start">
      <Menu.Target>{chip}</Menu.Target>
      <Menu.Dropdown>
        {options.map((option) => (
          <Menu.Item
            key={option.value}
            fw={option.value === value ? 700 : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
