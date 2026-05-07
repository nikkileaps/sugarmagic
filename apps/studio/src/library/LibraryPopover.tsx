/**
 * Library popover.
 *
 * Single owner of the Game > Libraries > {kind} dialog. Renders the
 * library kinds (Materials / Textures / Shaders / Audio — Surfaces are NOT a
 * library kind per Plan 037; character models + animations are NOT
 * library kinds per Plan 038, they're entity-owned and authored via
 * the Player/NPC inspector file-pickers) with a list-on-left +
 * preview-on-right layout. Reads `activeLibrary` from the shell
 * store; the menu trigger lives in App.tsx's Game menu.
 */

import { useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput
} from "@mantine/core";
import type {
  AudioClipDefinition,
  MaterialDefinition,
  ParticleEmitterDefinition,
  PointLightDefinition,
  RibbonStreamerDefinition,
  ShaderBillboardDefinition,
  ShaderGraphDocument,
  TextureDefinition,
  VFXColor,
  VFXDefinition,
  VFXDefinitionPatch,
  VFXVector3
} from "@sugarmagic/domain";
import type { AuthoredAssetResolver } from "@sugarmagic/render-web";
import type { ShellStore } from "@sugarmagic/shell";
import { AudioTransport, ColorField } from "@sugarmagic/ui";
import {
  MaterialPreview,
  type MaterialPreviewGeometryKind
} from "./MaterialPreview";
import { TexturePreview } from "./TexturePreview";

export interface LibraryPopoverProps {
  shellStore: ShellStore;
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  audioClipDefinitions: AudioClipDefinition[];
  vfxDefinitions: VFXDefinition[];
  assetSources: Record<string, string>;
  /** For resolving texture refs in MaterialPreview. */
  assetResolver: AuthoredAssetResolver | null;
  isMaterialReferenced: (definitionId: string) => boolean;
  onCreateMaterialDefinition: () => MaterialDefinition | null;
  onImportPbrMaterial: () => Promise<MaterialDefinition | null>;
  onImportTextureDefinition: () => Promise<TextureDefinition | null>;
  onImportAudioClipDefinition: () => Promise<AudioClipDefinition | null>;
  onUpdateAudioClipDefinition: (
    definitionId: string,
    patch: Partial<AudioClipDefinition>
  ) => void;
  onRemoveMaterialDefinition: (definitionId: string) => void;
  onRemoveAudioClipDefinition: (definitionId: string) => void;
  onCreateVFXDefinition: () => VFXDefinition | null;
  onDuplicateVFXDefinition: (definitionId: string) => string | null;
  onUpdateVFXDefinition: (
    definitionId: string,
    patch: VFXDefinitionPatch
  ) => void;
  onRemoveVFXDefinition: (definitionId: string) => void;
  /**
   * Open a shader in the Render workspace's shader-graph editor.
   * Called when the user clicks "Edit in Shader Graph" on a shader
   * in the Shaders popover. Implementation closes the popover and
   * navigates the shell to render → shaders with the target loaded.
   */
  onEditShaderInGraph: (shaderDefinitionId: string) => void;
}

interface ListItem {
  id: string;
  displayName: string;
  isBuiltIn: boolean;
}

function getMaterialItems(definitions: MaterialDefinition[]): ListItem[] {
  return definitions.map((d) => ({
    id: d.definitionId,
    displayName: d.displayName,
    isBuiltIn: Boolean(d.metadata?.builtIn)
  }));
}

function getTextureItems(definitions: TextureDefinition[]): ListItem[] {
  return definitions.map((d) => ({
    id: d.definitionId,
    displayName: d.displayName,
    isBuiltIn: false
  }));
}

function getShaderItems(definitions: ShaderGraphDocument[]): ListItem[] {
  return definitions.map((d) => ({
    id: d.shaderDefinitionId,
    displayName: d.displayName,
    isBuiltIn: Boolean(d.metadata?.builtIn)
  }));
}

function getAudioItems(definitions: AudioClipDefinition[]): ListItem[] {
  return definitions.map((d) => ({
    id: d.definitionId,
    displayName: d.displayName,
    isBuiltIn: false
  }));
}

function getVFXItems(definitions: VFXDefinition[]): ListItem[] {
  return definitions.map((d) => ({
    id: d.definitionId,
    displayName: d.displayName,
    isBuiltIn: Boolean(d.metadata?.builtIn)
  }));
}

function colorToNumber(color: VFXColor): number {
  const r = Math.round(Math.max(0, Math.min(1, color.r)) * 255);
  const g = Math.round(Math.max(0, Math.min(1, color.g)) * 255);
  const b = Math.round(Math.max(0, Math.min(1, color.b)) * 255);
  return (r << 16) | (g << 8) | b;
}

function numberToColor(value: number, alpha: number): VFXColor {
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
    a: alpha
  };
}

function VectorInput({
  label,
  value,
  disabled,
  onChange
}: {
  label: string;
  value: VFXVector3;
  disabled: boolean;
  onChange: (value: VFXVector3) => void;
}) {
  return (
    <Stack gap={4}>
      <Text size="xs" fw={600}>
        {label}
      </Text>
      <Group gap="xs" grow>
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberInput
            key={axis}
            size="xs"
            label={axis.toUpperCase()}
            disabled={disabled}
            value={value[axis]}
            onChange={(nextValue) => {
              if (typeof nextValue !== "number") return;
              onChange({ ...value, [axis]: nextValue });
            }}
          />
        ))}
      </Group>
    </Stack>
  );
}

function VFXDefinitionForm({
  definition,
  readOnly,
  onUpdate
}: {
  definition: VFXDefinition;
  readOnly: boolean;
  onUpdate: (patch: VFXDefinitionPatch) => void;
}) {
  return (
    <Stack gap="sm">
      <TextInput
        label="Display Name"
        size="xs"
        disabled={readOnly}
        value={definition.displayName}
        onChange={(event) => onUpdate({ displayName: event.currentTarget.value })}
      />
      <TextInput
        label="Description"
        size="xs"
        disabled={readOnly}
        value={definition.description}
        onChange={(event) => onUpdate({ description: event.currentTarget.value })}
      />
      <Text size="xs" c="dimmed">
        Kind: {definition.kind}
      </Text>
      {definition.kind === "particle-emitter" ? (
        <ParticleEmitterFields
          definition={definition}
          readOnly={readOnly}
          onUpdate={onUpdate}
        />
      ) : definition.kind === "shader-billboard" ? (
        <ShaderBillboardFields
          definition={definition}
          readOnly={readOnly}
          onUpdate={onUpdate}
        />
      ) : definition.kind === "ribbon-streamer" ? (
        <RibbonStreamerFields
          definition={definition}
          readOnly={readOnly}
          onUpdate={onUpdate}
        />
      ) : (
        <PointLightFields
          definition={definition}
          readOnly={readOnly}
          onUpdate={onUpdate}
        />
      )}
    </Stack>
  );
}

function ParticleEmitterFields({
  definition,
  readOnly,
  onUpdate
}: {
  definition: ParticleEmitterDefinition;
  readOnly: boolean;
  onUpdate: (patch: VFXDefinitionPatch) => void;
}) {
  const params = definition.emitter;
  const patch = (sub: VFXDefinitionPatch["emitter"]) =>
    onUpdate({ emitter: sub });
  return (
    <Stack gap="sm">
      <Group gap="xs" grow>
        <NumberInput
          label="Emission / sec"
          size="xs"
          min={0}
          disabled={readOnly}
          value={params.emissionRatePerSecond}
          onChange={(value) =>
            typeof value === "number" &&
            patch({ emissionRatePerSecond: Math.max(0, value) })
          }
        />
        <NumberInput
          label="Max Particles"
          size="xs"
          min={1}
          disabled={readOnly}
          value={params.maxParticles}
          onChange={(value) =>
            typeof value === "number" &&
            patch({ maxParticles: Math.max(1, Math.floor(value)) })
          }
        />
      </Group>
      <Group gap="xs" grow>
        <NumberInput
          label="Lifetime Min"
          size="xs"
          min={0.01}
          disabled={readOnly}
          value={params.lifetimeMinSeconds}
          onChange={(value) =>
            typeof value === "number" && patch({ lifetimeMinSeconds: value })
          }
        />
        <NumberInput
          label="Lifetime Max"
          size="xs"
          min={0.01}
          disabled={readOnly}
          value={params.lifetimeMaxSeconds}
          onChange={(value) =>
            typeof value === "number" && patch({ lifetimeMaxSeconds: value })
          }
        />
      </Group>
      <Group gap="xs" grow>
        <ColorField
          label="Start Color"
          value={colorToNumber(params.colorStart)}
          disabled={readOnly}
          onChange={(value) =>
            patch({
              colorStart: numberToColor(value, params.colorStart.a)
            })
          }
        />
        <NumberInput
          label="Start Alpha"
          size="xs"
          min={0}
          max={1}
          step={0.05}
          disabled={readOnly}
          value={params.colorStart.a}
          onChange={(value) =>
            typeof value === "number" &&
            patch({
              colorStart: { ...params.colorStart, a: value }
            })
          }
        />
      </Group>
      <Group gap="xs" grow>
        <ColorField
          label="End Color"
          value={colorToNumber(params.colorEnd)}
          disabled={readOnly}
          onChange={(value) =>
            patch({
              colorEnd: numberToColor(value, params.colorEnd.a)
            })
          }
        />
        <NumberInput
          label="End Alpha"
          size="xs"
          min={0}
          max={1}
          step={0.05}
          disabled={readOnly}
          value={params.colorEnd.a}
          onChange={(value) =>
            typeof value === "number" &&
            patch({
              colorEnd: { ...params.colorEnd, a: value }
            })
          }
        />
      </Group>
      <Group gap="xs" grow>
        <NumberInput
          label="Size Start"
          size="xs"
          min={0}
          disabled={readOnly}
          value={params.sizeStart}
          onChange={(value) =>
            typeof value === "number" && patch({ sizeStart: Math.max(0, value) })
          }
        />
        <NumberInput
          label="Size End"
          size="xs"
          min={0}
          disabled={readOnly}
          value={params.sizeEnd}
          onChange={(value) =>
            typeof value === "number" && patch({ sizeEnd: Math.max(0, value) })
          }
        />
      </Group>
      <VectorInput
        label="Initial Velocity"
        value={params.initialVelocity}
        disabled={readOnly}
        onChange={(initialVelocity) => patch({ initialVelocity })}
      />
      <VectorInput
        label="Gravity"
        value={params.gravity}
        disabled={readOnly}
        onChange={(gravity) => patch({ gravity })}
      />
      <Group gap="xs" grow>
        <NumberInput
          label="Velocity Randomness"
          size="xs"
          min={0}
          max={1}
          step={0.05}
          disabled={readOnly}
          value={params.velocityRandomness}
          onChange={(value) =>
            typeof value === "number" && patch({ velocityRandomness: value })
          }
        />
        <NumberInput
          label="Spread Cone"
          size="xs"
          min={0}
          max={360}
          disabled={readOnly}
          value={params.spreadConeDegrees}
          onChange={(value) =>
            typeof value === "number" && patch({ spreadConeDegrees: value })
          }
        />
      </Group>
      <Group gap="xs" grow>
        <Select
          label="Blend Mode"
          size="xs"
          disabled={readOnly}
          data={[
            { value: "additive", label: "Additive" },
            { value: "normal", label: "Normal" }
          ]}
          value={params.blendMode}
          onChange={(value) =>
            value && patch({ blendMode: value as "additive" | "normal" })
          }
        />
        <Select
          label="Shape"
          size="xs"
          disabled={readOnly}
          data={[
            { value: "circle", label: "Circle" },
            { value: "square", label: "Square" }
          ]}
          value={params.shape}
          onChange={(value) =>
            value && patch({ shape: value as "circle" | "square" })
          }
        />
      </Group>
    </Stack>
  );
}

function ShaderBillboardFields({
  definition,
  readOnly,
  onUpdate
}: {
  definition: ShaderBillboardDefinition;
  readOnly: boolean;
  onUpdate: (patch: VFXDefinitionPatch) => void;
}) {
  const params = definition.billboard;
  const patch = (sub: VFXDefinitionPatch["billboard"]) =>
    onUpdate({ billboard: sub });
  return (
    <Stack gap="sm">
      <Group gap="xs" grow>
        <ColorField
          label="Core Color"
          value={colorToNumber(params.coreColor)}
          disabled={readOnly}
          onChange={(value) =>
            patch({ coreColor: numberToColor(value, params.coreColor.a) })
          }
        />
        <ColorField
          label="Halo Color"
          value={colorToNumber(params.haloColor)}
          disabled={readOnly}
          onChange={(value) =>
            patch({ haloColor: numberToColor(value, params.haloColor.a) })
          }
        />
      </Group>
      <Group gap="xs" grow>
        <NumberInput
          label="Core Radius"
          size="xs"
          min={0.001}
          max={1}
          step={0.01}
          disabled={readOnly}
          value={params.coreRadius}
          onChange={(value) =>
            typeof value === "number" && patch({ coreRadius: value })
          }
        />
        <NumberInput
          label="Halo Radius"
          size="xs"
          min={0.01}
          max={1}
          step={0.01}
          disabled={readOnly}
          value={params.haloRadius}
          onChange={(value) =>
            typeof value === "number" && patch({ haloRadius: value })
          }
        />
      </Group>
      <Group gap="xs" grow>
        <NumberInput
          label="Pulse Rate (Hz)"
          size="xs"
          min={0}
          step={0.1}
          disabled={readOnly}
          value={params.pulseRate}
          onChange={(value) =>
            typeof value === "number" && patch({ pulseRate: value })
          }
        />
        <NumberInput
          label="Rotation Rate (rad/s)"
          size="xs"
          step={0.05}
          disabled={readOnly}
          value={params.rotationRate}
          onChange={(value) =>
            typeof value === "number" && patch({ rotationRate: value })
          }
        />
      </Group>
      <NumberInput
        label="Size"
        size="xs"
        min={0.001}
        step={0.05}
        disabled={readOnly}
        value={params.size}
        onChange={(value) => typeof value === "number" && patch({ size: value })}
      />
      <Select
        label="Blend Mode"
        size="xs"
        disabled={readOnly}
        data={[
          { value: "additive", label: "Additive" },
          { value: "normal", label: "Normal" }
        ]}
        value={params.blendMode}
        onChange={(value) =>
          value && patch({ blendMode: value as "additive" | "normal" })
        }
      />
    </Stack>
  );
}

function RibbonStreamerFields({
  definition,
  readOnly,
  onUpdate
}: {
  definition: RibbonStreamerDefinition;
  readOnly: boolean;
  onUpdate: (patch: VFXDefinitionPatch) => void;
}) {
  const params = definition.streamer;
  const patch = (sub: VFXDefinitionPatch["streamer"]) =>
    onUpdate({ streamer: sub });
  return (
    <Stack gap="sm">
      <ColorField
        label="Color"
        value={colorToNumber(params.color)}
        disabled={readOnly}
        onChange={(value) =>
          patch({ color: numberToColor(value, params.color.a) })
        }
      />
      <Group gap="xs" grow>
        <NumberInput
          label="Count"
          size="xs"
          min={1}
          disabled={readOnly}
          value={params.count}
          onChange={(value) =>
            typeof value === "number" &&
            patch({ count: Math.max(1, Math.floor(value)) })
          }
        />
        <NumberInput
          label="Length"
          size="xs"
          min={0.01}
          step={0.05}
          disabled={readOnly}
          value={params.length}
          onChange={(value) =>
            typeof value === "number" && patch({ length: value })
          }
        />
      </Group>
      <Group gap="xs" grow>
        <NumberInput
          label="Width"
          size="xs"
          min={0.001}
          step={0.005}
          disabled={readOnly}
          value={params.width}
          onChange={(value) =>
            typeof value === "number" && patch({ width: value })
          }
        />
        <NumberInput
          label="Orbit Speed (rad/s)"
          size="xs"
          step={0.1}
          disabled={readOnly}
          value={params.orbitSpeed}
          onChange={(value) =>
            typeof value === "number" && patch({ orbitSpeed: value })
          }
        />
      </Group>
      <Group gap="xs" grow>
        <NumberInput
          label="Vertical Drift (m/s)"
          size="xs"
          step={0.01}
          disabled={readOnly}
          value={params.verticalDrift}
          onChange={(value) =>
            typeof value === "number" && patch({ verticalDrift: value })
          }
        />
        <Select
          label="Ease Shape"
          size="xs"
          disabled={readOnly}
          data={[
            { value: "linear", label: "Linear" },
            { value: "ease-out", label: "Ease Out" }
          ]}
          value={params.easeShape}
          onChange={(value) =>
            value && patch({ easeShape: value as "linear" | "ease-out" })
          }
        />
      </Group>
      <Select
        label="Blend Mode"
        size="xs"
        disabled={readOnly}
        data={[
          { value: "additive", label: "Additive" },
          { value: "normal", label: "Normal" }
        ]}
        value={params.blendMode}
        onChange={(value) =>
          value && patch({ blendMode: value as "additive" | "normal" })
        }
      />
    </Stack>
  );
}

function PointLightFields({
  definition,
  readOnly,
  onUpdate
}: {
  definition: PointLightDefinition;
  readOnly: boolean;
  onUpdate: (patch: VFXDefinitionPatch) => void;
}) {
  const params = definition.light;
  const patch = (sub: VFXDefinitionPatch["light"]) => onUpdate({ light: sub });
  return (
    <Stack gap="sm">
      <ColorField
        label="Color"
        value={colorToNumber(params.color)}
        disabled={readOnly}
        onChange={(value) => patch({ color: numberToColor(value, 1) })}
      />
      <Group gap="xs" grow>
        <NumberInput
          label="Intensity"
          size="xs"
          min={0}
          step={0.1}
          disabled={readOnly}
          value={params.intensity}
          onChange={(value) =>
            typeof value === "number" && patch({ intensity: value })
          }
        />
        <NumberInput
          label="Distance"
          size="xs"
          min={0}
          step={0.5}
          disabled={readOnly}
          value={params.distance}
          onChange={(value) =>
            typeof value === "number" && patch({ distance: value })
          }
        />
      </Group>
      <Group gap="xs" grow>
        <NumberInput
          label="Decay"
          size="xs"
          min={0}
          step={0.1}
          disabled={readOnly}
          value={params.decay}
          onChange={(value) =>
            typeof value === "number" && patch({ decay: value })
          }
        />
        <NumberInput
          label="Pulse Rate (Hz)"
          size="xs"
          min={0}
          step={0.1}
          disabled={readOnly}
          value={params.pulseRate ?? 0}
          onChange={(value) =>
            typeof value === "number" && patch({ pulseRate: value })
          }
        />
      </Group>
      <NumberInput
        label="Pulse Amount (0-1)"
        size="xs"
        min={0}
        max={1}
        step={0.05}
        disabled={readOnly}
        value={params.pulseAmount ?? 0}
        onChange={(value) =>
          typeof value === "number" && patch({ pulseAmount: value })
        }
      />
    </Stack>
  );
}

export function LibraryPopover({
  shellStore,
  materialDefinitions,
  textureDefinitions,
  shaderDefinitions,
  audioClipDefinitions,
  vfxDefinitions,
  assetSources,
  assetResolver,
  isMaterialReferenced,
  onCreateMaterialDefinition,
  onImportPbrMaterial,
  onImportTextureDefinition,
  onImportAudioClipDefinition,
  onUpdateAudioClipDefinition,
  onRemoveMaterialDefinition,
  onRemoveAudioClipDefinition,
  onCreateVFXDefinition,
  onDuplicateVFXDefinition,
  onUpdateVFXDefinition,
  onRemoveVFXDefinition,
  onEditShaderInGraph
}: LibraryPopoverProps) {
  const activeLibrary = useStore(shellStore, (s) => s.activeLibrary);
  const onClose = () => shellStore.getState().setActiveLibrary(null);

  const allItems: ListItem[] = useMemo(() => {
    if (activeLibrary === "materials")
      return getMaterialItems(materialDefinitions);
    if (activeLibrary === "textures")
      return getTextureItems(textureDefinitions);
    if (activeLibrary === "shaders") return getShaderItems(shaderDefinitions);
    if (activeLibrary === "audio") return getAudioItems(audioClipDefinitions);
    if (activeLibrary === "vfx") return getVFXItems(vfxDefinitions);
    return [];
  }, [
    activeLibrary,
    audioClipDefinitions,
    materialDefinitions,
    textureDefinitions,
    shaderDefinitions,
    vfxDefinitions
  ]);

  const [searchState, setSearchState] = useState<{
    library: typeof activeLibrary;
    query: string;
  }>({ library: null, query: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [geometryKind, setGeometryKind] =
    useState<MaterialPreviewGeometryKind>("cube");
  // Keep search scoped to the active library without an effect-driven reset.
  // React's hooks lint rejects synchronous setState in effects, so the query
  // carries its library key and naturally reads as empty after kind changes.
  const searchQuery =
    searchState.library === activeLibrary ? searchState.query : "";

  const items: ListItem[] = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return allItems;
    return allItems.filter((item) =>
      item.displayName.toLowerCase().includes(query)
    );
  }, [allItems, searchQuery]);

  // Derive fallback selection instead of mutating state when filters or library
  // kind changes. This preserves the old "first visible item is selected"
  // behavior while avoiding an auto-select effect.
  const effectiveSelectedId =
    activeLibrary !== null &&
    selectedId &&
    items.some((i) => i.id === selectedId)
      ? selectedId
      : (items[0]?.id ?? null);

  const selectedMaterial =
    activeLibrary === "materials"
      ? (materialDefinitions.find(
          (d) => d.definitionId === effectiveSelectedId
        ) ?? null)
      : null;
  const selectedTexture =
    activeLibrary === "textures"
      ? (textureDefinitions.find(
          (d) => d.definitionId === effectiveSelectedId
        ) ?? null)
      : null;
  const selectedShader =
    activeLibrary === "shaders"
      ? (shaderDefinitions.find(
          (d) => d.shaderDefinitionId === effectiveSelectedId
        ) ?? null)
      : null;
  const selectedAudioClip =
    activeLibrary === "audio"
      ? (audioClipDefinitions.find(
          (d) => d.definitionId === effectiveSelectedId
        ) ?? null)
      : null;
  const selectedVFX =
    activeLibrary === "vfx"
      ? (vfxDefinitions.find((d) => d.definitionId === effectiveSelectedId) ??
        null)
      : null;

  const titleText =
    activeLibrary === "materials"
      ? "Materials"
      : activeLibrary === "textures"
        ? "Textures"
        : activeLibrary === "shaders"
          ? "Shaders"
          : activeLibrary === "audio"
            ? "Audio"
            : activeLibrary === "vfx"
              ? "VFX"
            : "Library";

  return (
    <Modal
      opened={activeLibrary !== null}
      onClose={onClose}
      title={`${titleText} Library`}
      size="xl"
      styles={{
        // Modal.Content is a fixed-height flex column; Modal.Body
        // takes the remaining height and clips overflow so the
        // ScrollArea inside the LEFT list column owns scrolling
        // (instead of the whole popover scrolling as one giant page).
        content: {
          height: "min(720px, 90vh)",
          display: "flex",
          flexDirection: "column"
        },
        body: {
          padding: 0,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex"
        }
      }}
    >
      <Group
        gap={0}
        align="stretch"
        wrap="nowrap"
        style={{ flex: 1, minHeight: 0, width: "100%" }}
      >
        {/* LEFT: list */}
        <Stack
          gap={0}
          style={{
            flex: "0 0 280px",
            minHeight: 0,
            borderRight: "1px solid var(--sm-panel-border)",
            background: "var(--sm-color-surface0)"
          }}
        >
          <Group
            gap="xs"
            p="xs"
            style={{
              borderBottom: "1px solid var(--sm-panel-border)",
              flex: "0 0 auto"
            }}
          >
            {activeLibrary === "materials" ? (
              <>
                <Button size="xs" onClick={() => onCreateMaterialDefinition()}>
                  New
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => void onImportPbrMaterial()}
                >
                  Import PBR
                </Button>
              </>
            ) : activeLibrary === "textures" ? (
              <Button
                size="xs"
                onClick={() => void onImportTextureDefinition()}
              >
                Import Texture
              </Button>
            ) : activeLibrary === "audio" ? (
              <Button
                size="xs"
                onClick={() => void onImportAudioClipDefinition()}
              >
                Import Audio
              </Button>
            ) : activeLibrary === "vfx" ? (
              <>
                <Button
                  size="xs"
                  onClick={() => {
                    const next = onCreateVFXDefinition();
                    if (next) setSelectedId(next.definitionId);
                  }}
                >
                  New
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  disabled={!selectedVFX}
                  onClick={() => {
                    if (!selectedVFX) return;
                    const nextId = onDuplicateVFXDefinition(
                      selectedVFX.definitionId
                    );
                    if (nextId) setSelectedId(nextId);
                  }}
                >
                  Duplicate
                </Button>
              </>
            ) : null}
          </Group>
          <Box
            p="xs"
            style={{
              borderBottom: "1px solid var(--sm-panel-border)",
              flex: "0 0 auto"
            }}
          >
            <TextInput
              size="xs"
              placeholder={`Search ${titleText.toLowerCase()}...`}
              value={searchQuery}
              onChange={(event) =>
                setSearchState({
                  library: activeLibrary,
                  query: event.currentTarget.value
                })
              }
            />
          </Box>
          <ScrollArea style={{ flex: 1, minHeight: 0 }}>
            <Stack gap={2} p="xs">
              {items.map((item) => {
                const isSelected = item.id === effectiveSelectedId;
                return (
                  <Box
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    style={{
                      cursor: "pointer",
                      padding: "6px 10px",
                      borderRadius: 6,
                      background: isSelected
                        ? "var(--sm-active-bg)"
                        : "transparent",
                      border: `1px solid ${isSelected ? "var(--sm-accent-blue)" : "transparent"}`
                    }}
                  >
                    <Text size="sm" fw={isSelected ? 600 : 500}>
                      {item.displayName}
                    </Text>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      {item.isBuiltIn ? "built-in" : "project"}
                    </Text>
                  </Box>
                );
              })}
              {items.length === 0 ? (
                <Text
                  size="xs"
                  c="var(--sm-color-overlay0)"
                  ta="center"
                  mt="md"
                >
                  {searchQuery.trim()
                    ? `No ${titleText.toLowerCase()} match "${searchQuery}".`
                    : `No ${titleText.toLowerCase()} yet.`}
                </Text>
              ) : null}
            </Stack>
          </ScrollArea>
        </Stack>

        {/* RIGHT: preview + details */}
        <Stack gap="md" p="md" style={{ flex: 1, minWidth: 0 }}>
          {activeLibrary === "materials" ? (
            <>
              <MaterialPreview
                material={selectedMaterial}
                geometryKind={geometryKind}
                onChangeGeometryKind={setGeometryKind}
                textureDefinitions={textureDefinitions}
                assetResolver={assetResolver}
              />
              {selectedMaterial ? (
                <Stack gap={4}>
                  <Text size="md" fw={700}>
                    {selectedMaterial.displayName}
                  </Text>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    {selectedMaterial.metadata?.builtIn
                      ? "built-in"
                      : "project"}
                  </Text>
                  {!selectedMaterial.metadata?.builtIn ? (
                    <Group gap="xs" mt="xs">
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        disabled={isMaterialReferenced(
                          selectedMaterial.definitionId
                        )}
                        onClick={() =>
                          onRemoveMaterialDefinition(
                            selectedMaterial.definitionId
                          )
                        }
                      >
                        Delete
                      </Button>
                    </Group>
                  ) : null}
                </Stack>
              ) : null}
            </>
          ) : activeLibrary === "textures" ? (
            <>
              <TexturePreview
                texture={selectedTexture}
                assetResolver={assetResolver}
              />
              {selectedTexture ? (
                <Stack gap={4}>
                  <Text size="md" fw={700}>
                    {selectedTexture.displayName}
                  </Text>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    project
                  </Text>
                </Stack>
              ) : null}
            </>
          ) : activeLibrary === "shaders" ? (
            selectedShader ? (
              <Stack gap="md">
                <Stack gap={4}>
                  <Text size="md" fw={700}>
                    {selectedShader.displayName}
                  </Text>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    {selectedShader.metadata?.builtIn ? "built-in" : "project"}
                    {" · "}
                    target: {selectedShader.targetKind}
                    {" · "}
                    {selectedShader.nodes.length} nodes,{" "}
                    {selectedShader.edges.length} edges
                  </Text>
                </Stack>
                <Group gap="xs">
                  <Button
                    size="xs"
                    onClick={() =>
                      onEditShaderInGraph(selectedShader.shaderDefinitionId)
                    }
                  >
                    Edit in Shader Graph
                  </Button>
                </Group>
                <Text size="xs" c="var(--sm-color-overlay0)">
                  Shaders don't have a single canonical preview — the same graph
                  can render differently as a surface, deform, effect, or
                  post-process. Open the graph in the Render workspace to
                  inspect or edit.
                </Text>
              </Stack>
            ) : (
              <Stack h="100%" align="center" justify="center">
                <Text size="sm" c="var(--sm-color-overlay0)">
                  Select a shader to inspect.
                </Text>
              </Stack>
            )
          ) : activeLibrary === "audio" ? (
            <>
              <AudioTransport
                sourceUrl={
                  selectedAudioClip
                    ? (assetSources[
                        selectedAudioClip.source.relativeAssetPath
                      ] ?? null)
                    : null
                }
                label={selectedAudioClip?.displayName ?? "Audio Preview"}
                disabledReason="Select or import an audio clip to preview."
              />
              {selectedAudioClip ? (
                <Stack gap="sm">
                  <TextInput
                    label="Display Name"
                    value={selectedAudioClip.displayName}
                    onChange={(event) =>
                      onUpdateAudioClipDefinition(
                        selectedAudioClip.definitionId,
                        {
                          displayName: event.currentTarget.value
                        }
                      )
                    }
                  />
                  <Stack gap={2}>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      {selectedAudioClip.source.fileName}
                    </Text>
                    <Text size="xs" c="var(--sm-color-overlay0)">
                      {selectedAudioClip.source.relativeAssetPath}
                    </Text>
                  </Stack>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() =>
                        onRemoveAudioClipDefinition(
                          selectedAudioClip.definitionId
                        )
                      }
                    >
                      Delete
                    </Button>
                  </Group>
                </Stack>
              ) : null}
            </>
          ) : activeLibrary === "vfx" ? (
            selectedVFX ? (
              <Stack gap="sm">
                <Stack gap={2}>
                  <Text size="md" fw={700}>
                    {selectedVFX.displayName}
                  </Text>
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    {selectedVFX.metadata?.builtIn ? "built-in" : "project"}
                  </Text>
                </Stack>
                <VFXDefinitionForm
                  definition={selectedVFX}
                  readOnly={selectedVFX.metadata?.builtIn === true}
                  onUpdate={(patch) =>
                    onUpdateVFXDefinition(selectedVFX.definitionId, patch)
                  }
                />
                {selectedVFX.metadata?.builtIn ? (
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    Duplicate this built-in VFX to make an editable project copy.
                  </Text>
                ) : (
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() =>
                        onRemoveVFXDefinition(selectedVFX.definitionId)
                      }
                    >
                      Delete
                    </Button>
                  </Group>
                )}
              </Stack>
            ) : (
              <Stack h="100%" align="center" justify="center">
                <Text size="sm" c="var(--sm-color-overlay0)">
                  Select or create a VFX definition.
                </Text>
              </Stack>
            )
          ) : null}
        </Stack>
      </Group>
    </Modal>
  );
}
