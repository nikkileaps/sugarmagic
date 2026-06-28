/**
 * packages/ui/src/components/IdChip.tsx
 *
 * Purpose: Compact display for opaque identifiers (UUIDs, game
 * project ids, region ids, etc.). Renders a small monospace pill
 * showing the first dash-separated segment of the id and exposes
 * the full id via a Mantine `Tooltip` on hover. Optionally
 * copy-to-clipboard on click.
 *
 * Use anywhere a long id would otherwise overflow its container or
 * waste UI real estate — the first segment is identifiable enough
 * for the author to recognize, and the full id is one hover away.
 *
 * Truncation strategy:
 *   - If the id contains a `-` within the first 12 chars, take
 *     everything before the first `-`. Covers UUIDs (8-char first
 *     group), game ids (`wordlark-v1-...`), version slugs, etc.
 *   - Otherwise, take the first 8 chars + ellipsis.
 *   - If the id is shorter than 8 chars, show it whole.
 *
 * Implements: Plan 047 §Story 47.5.5 (initial consumer is the
 * Session debug HUD card's User row).
 *
 * Status: active
 */

import { Tooltip, UnstyledButton } from "@mantine/core";
import { useState } from "react";

export interface IdChipProps {
  /** The full identifier. Shown on hover, copied on click. */
  id: string;
  /** Override the auto-truncated label. Defaults to
   *  `truncateIdForChip(id)`. */
  display?: string;
  /** Click handler. When omitted, defaults to copying `id` to
   *  clipboard + flashing "Copied!" in the tooltip for 1.5s. Pass
   *  `null` to disable click handling entirely (no copy, default
   *  cursor). */
  onClick?: (() => void) | null;
}

/**
 * Pure helper that computes the chip label from a full id. Exposed
 * for callers (e.g. the runtime HUD card, which is non-React) that
 * want the same truncation logic without the React component.
 */
export function truncateIdForChip(id: string): string {
  const dashIndex = id.indexOf("-");
  if (dashIndex > 0 && dashIndex <= 12) {
    return id.slice(0, dashIndex);
  }
  if (id.length <= 8) return id;
  return `${id.slice(0, 8)}...`;
}

export function IdChip(props: IdChipProps) {
  const { id, display, onClick: onClickProp } = props;
  const [copied, setCopied] = useState(false);

  const label = display ?? truncateIdForChip(id);
  const handlesCopy = onClickProp === undefined;
  const clickable = onClickProp !== null;

  async function handleClick() {
    if (onClickProp === null) return;
    if (onClickProp) {
      onClickProp();
      return;
    }
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write can fail in non-https or sandboxed iframes
      // (cross-origin permission). Silently no-op; the tooltip
      // still shows the full id so the author can copy manually.
    }
  }

  const tooltipLabel = copied && handlesCopy ? "Copied!" : id;

  return (
    <Tooltip label={tooltipLabel} withArrow openDelay={250} position="top">
      <UnstyledButton
        component="span"
        onClick={clickable ? () => void handleClick() : undefined}
        style={{
          display: "inline-flex",
          alignItems: "center",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: "0.85em",
          padding: "1px 8px",
          borderRadius: 999,
          background: "var(--sm-color-surface3, rgba(127, 127, 127, 0.15))",
          border:
            "1px solid var(--sm-color-surface2, rgba(127, 127, 127, 0.25))",
          color: "inherit",
          cursor: clickable ? "pointer" : "default",
          lineHeight: 1.4
        }}
      >
        {label}
      </UnstyledButton>
    </Tooltip>
  );
}
