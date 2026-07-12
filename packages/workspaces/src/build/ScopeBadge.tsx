/**
 * Scope / provenance badges (Plan 068.3).
 *
 * One visual language for "which tier owns this value" everywhere
 * scope appears: the Layout inspector's Appearance section, and any
 * future scope chips. Tiers mirror the resolution precedence
 * (scene > base/instance > definition default).
 */

import { Badge } from "@mantine/core";

export type AppearanceProvenance = "definition" | "base" | "scene" | "broken";

const TIER_LABELS: Record<AppearanceProvenance, string> = {
  definition: "Default",
  base: "Base",
  scene: "Scene",
  broken: "Broken"
};

const TIER_COLORS: Record<AppearanceProvenance, string> = {
  definition: "gray",
  base: "blue",
  scene: "violet",
  broken: "red"
};

export function ScopeBadge({ tier }: { tier: AppearanceProvenance }) {
  const label = TIER_LABELS[tier];
  return (
    <Badge
      size="xs"
      variant="light"
      color={TIER_COLORS[tier]}
      style={{ flexShrink: 0, textTransform: "none" }}
    >
      {label}
    </Badge>
  );
}
