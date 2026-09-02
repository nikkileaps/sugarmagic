/**
 * apps/studio/src/SceneComposerPanel.tsx
 *
 * Purpose: the Story mode composer's side panel -- pick the Scene being
 * staged, see what its region already owns, and hide any of it for the
 * duration of this Scene.
 *
 * The 3D surface is the SAME shared viewport Build uses: selecting a
 * Scene here points it at that Scene's region and composes the Scene's
 * overlay on top, exactly as the game will. What differs is what may be
 * edited -- region-owned content draws but does not select, so an author
 * dressing a Scene cannot move the station by accident (the lock lives
 * in the layout overlay's `isSelectable`).
 *
 * Status: active
 */

import { Checkbox, Select, Stack, Text } from "@mantine/core";
import type { RegionDocument, Scene } from "@sugarmagic/domain";

export interface SceneComposerPanelProps {
  scenes: Scene[];
  selectedScene: Scene | null;
  /** The region the selected Scene happens in, or null if it names one
   *  that no longer exists -- which validation reports on save. */
  region: RegionDocument | null;
  onSelectScene: (sceneId: string) => void;
  onSetSuppressed: (regionOwnedId: string, suppressed: boolean) => void;
}

interface SuppressibleRow {
  id: string;
  label: string;
}

/** Everything the region owns that a Scene may hide, in the order an
 *  author scans for it: who is here, then what is here. */
function suppressibleRows(region: RegionDocument): SuppressibleRow[] {
  return [
    ...region.npcPresences.map((presence) => ({
      id: presence.presenceId,
      label: presence.placementLabel ?? presence.npcDefinitionId
    })),
    ...region.itemPresences.map((presence) => ({
      id: presence.presenceId,
      label: presence.itemDefinitionId
    })),
    ...region.placedAssets.map((asset) => ({
      id: asset.instanceId,
      label: asset.displayName
    }))
  ];
}

export function SceneComposerPanel({
  scenes,
  selectedScene,
  region,
  onSelectScene,
  onSetSuppressed
}: SceneComposerPanelProps) {
  const suppressed = new Set(selectedScene?.overlay.suppressedRegionIds ?? []);
  const rows = region ? suppressibleRows(region) : [];

  return (
    <Stack gap="sm" p="sm">
      <Select
        size="xs"
        label="Scene"
        description="The Scene being staged"
        data={scenes.map((scene) => ({
          value: scene.sceneId,
          label: scene.displayName
        }))}
        value={selectedScene?.sceneId ?? null}
        allowDeselect={false}
        onChange={(value) => {
          if (value) onSelectScene(value);
        }}
      />

      {!selectedScene ? (
        <Text size="xs" c="var(--sm-color-overlay0)">
          Add a Scene to stage one.
        </Text>
      ) : !region ? (
        <Text size="xs" c="var(--sm-color-overlay0)">
          This Scene names a region that does not exist. Pick one in
          Structure.
        </Text>
      ) : (
        <>
          <Text size="xs" fw={600}>
            In {region.displayName}
          </Text>
          <Text size="xs" c="var(--sm-color-overlay0)">
            The region owns these. They show here but are not editable --
            untick one to hide it for this Scene only.
          </Text>
          {rows.length === 0 ? (
            <Text size="xs" c="var(--sm-color-overlay0)">
              This region is empty. Place its residents and dressing in
              Build.
            </Text>
          ) : (
            <Stack gap={4}>
              {rows.map((row) => (
                <Checkbox
                  key={row.id}
                  size="xs"
                  label={row.label}
                  checked={!suppressed.has(row.id)}
                  onChange={(event) =>
                    onSetSuppressed(row.id, !event.currentTarget.checked)
                  }
                />
              ))}
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
