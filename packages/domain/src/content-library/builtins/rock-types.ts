/**
 * Built-in RockTypeDefinition starter content.
 *
 * Seeds fresh projects with a small field-stones scatter profile so Stage 2
 * rock layers have immediate starter content alongside grass and flowers.
 */

import type { RockTypeDefinition } from "../../surface";
import { createDefaultRockTypeDefinition } from "../../surface";

export function createBuiltInRockTypeDefinitions(
  projectId: string
): RockTypeDefinition[] {
  return [
    createDefaultRockTypeDefinition(projectId, {
      definitionId: `${projectId}:rock-type:small-field-stones`,
      displayName: "Small Field Stones",
      density: 0.65,
      color: 0x8e8674
    })
  ];
}
