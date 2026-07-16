/**
 * Asset definition inspector.
 *
 * The Assets library modal's right-hand panel (Game > Libraries >
 * Assets): rename and source info for one imported asset definition.
 *
 * History: this used to be a whole Build workspace ("Assets" tab)
 * because assets predate the library pattern. The workspace is gone
 * (2026-07-09) — assets are ordinary library content now; only this
 * inspector survived the move.
 *
 * Plan 068.6: surface + deform/effect editing moved OUT of here. Styling
 * a placed asset lives in the Layout inspector (per-instance / per-Scene,
 * plus the Surface Brush and Surface Studio) — one place to style, one
 * place to manage. Definition defaults still resolve at render; only the
 * duplicate editing UI was removed.
 */

import { useState } from "react";
import { Stack, Text, Button, TextInput } from "@mantine/core";
import type { AssetDefinition } from "@sugarmagic/domain";

function getAssetKindLabel(assetDefinition: AssetDefinition): string {
  return assetDefinition.assetKind === "foliage" ? "Foliage" : "Model";
}

export interface AssetDefinitionInspectorProps {
  assetDefinition: AssetDefinition;
  onUpdateAssetDefinition: (definitionId: string, displayName: string) => void;
  /** #358 -- re-pivot this asset's GLB to bottom-center so the move
   *  gizmo sits on it. For imports whose Blender object sat off world
   *  origin (baked node translation puts the gizmo meters away). */
  onCorrectOrigin: (definitionId: string) => void | Promise<void>;
}

export function AssetDefinitionInspector({
  assetDefinition,
  onUpdateAssetDefinition,
  onCorrectOrigin
}: AssetDefinitionInspectorProps) {
  const [draftDisplayName, setDraftDisplayName] = useState(
    assetDefinition.displayName
  );
  const [correctingOrigin, setCorrectingOrigin] = useState(false);

  return (
    <Stack gap="md">
      <TextInput
        label="Display Name"
        value={draftDisplayName}
        onChange={(event) => setDraftDisplayName(event.currentTarget.value)}
        size="xs"
        styles={{
          label: {
            color: "var(--sm-color-subtext)",
            fontSize: "var(--sm-font-size-sm)",
            marginBottom: 4
          },
          input: {
            background: "var(--sm-color-base)",
            borderColor: "var(--sm-panel-border)",
            color: "var(--sm-color-text)"
          }
        }}
      />
      <Button
        size="xs"
        variant="light"
        disabled={
          !draftDisplayName.trim() ||
          draftDisplayName === assetDefinition.displayName
        }
        onClick={() =>
          onUpdateAssetDefinition(
            assetDefinition.definitionId,
            draftDisplayName.trim()
          )
        }
      >
        Save Asset Definition
      </Button>
      <Stack gap={4}>
        <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
          Type
        </Text>
        <Text size="xs" c="var(--sm-color-text)">
          {getAssetKindLabel(assetDefinition)}
        </Text>
      </Stack>
      <Stack gap={4}>
        <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
          Source
        </Text>
        <Text size="xs" c="var(--sm-color-text)">
          {assetDefinition.source.fileName}
        </Text>
        <Text size="xs" c="var(--sm-color-overlay0)">
          {assetDefinition.source.relativeAssetPath}
        </Text>
      </Stack>
      <Stack gap={4}>
        <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
          Origin
        </Text>
        <Text size="xs" c="var(--sm-color-overlay0)">
          Re-pivots the asset to its bottom-center so the move gizmo sits on
          it. Use this if an imported model's gizmo lands off to the side
          (its Blender object was away from the world origin on export).
        </Text>
        <Button
          size="xs"
          variant="light"
          loading={correctingOrigin}
          onClick={async () => {
            setCorrectingOrigin(true);
            try {
              await onCorrectOrigin(assetDefinition.definitionId);
            } finally {
              setCorrectingOrigin(false);
            }
          }}
        >
          Auto Correct Origin
        </Button>
      </Stack>
      <Stack gap={4}>
        <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
          Surfaces
        </Text>
        <Text size="xs" c="var(--sm-color-overlay0)">
          Style placed instances in the Layout inspector — select an asset in
          the scene and use its Appearance section, the Surface Brush, or the
          Surface Studio. Deform / effect defaults resolve from the imported
          asset.
        </Text>
      </Stack>
    </Stack>
  );
}
