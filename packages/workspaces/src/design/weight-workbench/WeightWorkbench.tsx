/**
 * packages/workspaces/src/design/weight-workbench/WeightWorkbench.tsx
 *
 * Purpose: Plan 064 — the weight workbench: ALL weight tooling
 * (heatmap paint, box select, piece/region isolation, shrinkwrap,
 * region re-solve, fresh solve, mirror, T-pose) living in the
 * WORKSPACE center where there is room, instead of crammed into a
 * wizard step. The preview HUD's rig button TOGGLES this view for
 * rigged characters; "Adjust markers" hands off to the (now lean)
 * Character Wizard for skeleton-level changes.
 *
 * Loads the rigged character exactly like wizard edit mode
 * (recipe + decoded painted weights); Save reassembles the model
 * GLB and commits weights-only (bindings and clips untouched).
 *
 * Status: active
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Loader,
  MultiSelect,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip
} from "@mantine/core";
import {
  PanelSection,
  ToolOptionSlider,
  ToolOptionsBar,
  ToolRail
} from "@sugarmagic/ui";
import type { CharacterModelDefinition } from "@sugarmagic/domain";
import {
  BODY_REGION_LABELS,
  GeodesicVoxelWeightSolver,
  applyBrushStroke,
  assignVerticesToBone,
  buildVertexAdjacency,
  computeBodyRegions,
  computeBoneSegments,
  fillVerticesWithBone,
  mirrorWeights,
  resolveRegionWeights,
  shrinkwrapWeights,
  type BodyRegionId,
  type BrushMode
} from "@sugarmagic/character-rig";
import {
  WeightPaintViewport
} from "../character-wizard/WeightPaintViewport";
import type {
  CharacterWizardServices,
  WizardGenerated,
  WizardLandmarks
} from "../character-wizard/CharacterWizard";

/** "DEF-upper_arm.L" -> "Left Upper Arm" for the bone picker. */
function friendlyBoneName(boneName: string): string {
  let name = boneName.replace(/^DEF-/, "");
  let side = "";
  if (name.endsWith(".L")) {
    side = "Left ";
    name = name.slice(0, -2);
  } else if (name.endsWith(".R")) {
    side = "Right ";
    name = name.slice(0, -2);
  }
  name = name.replace(/[._]/g, " ").trim();
  return (
    side +
    name
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

export interface WeightWorkbenchProps {
  /** The rigged (wizard-made) character model. */
  model: CharacterModelDefinition;
  /** Safe character name (asset paths derive from it). */
  characterName: string;
  assetSources: Record<string, string>;
  services: CharacterWizardServices;
  /** Launch the wizard in edit mode for marker-level changes. */
  onEditMarkers: () => void;
  /** Leave the workbench (toggle back to the animation view). */
  onClose: () => void;
  /** Switch to the animation panel (the ✨ tab while in rig mode). */
  onOpenAnimations: () => void;
}

export function WeightWorkbench(props: WeightWorkbenchProps) {
  const {
    model,
    characterName,
    assetSources,
    services,
    onEditMarkers,
    onClose,
    onOpenAnimations
  } = props;
  const [boneSearch, setBoneSearch] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>("Loading character...");
  const [session, setSession] = useState<{
    sourceBytes: ArrayBuffer;
    landmarks: WizardLandmarks;
    generated: WizardGenerated;
  } | null>(null);
  const loadedRef = useRef(false);
  const paintDirtyRef = useRef(false);
  const adjacencyRef = useRef<Array<Set<number>> | null>(null);
  const pristineWeightsRef = useRef<{
    joints: Uint16Array;
    weights: Float32Array;
  } | null>(null);

  // Blob URLs, revoked on unmount.
  const blobUrlsRef = useRef<string[]>([]);
  const trackBlobUrl = useCallback((bytes: ArrayBuffer): string => {
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "model/gltf-binary" })
    );
    blobUrlsRef.current.push(url);
    return url;
  }, []);
  useEffect(
    () => () => {
      for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
    },
    []
  );

  // Bootstrap: identical to wizard edit mode.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void (async () => {
      try {
        const modelUrl = assetSources[model.source.relativeAssetPath];
        if (!modelUrl) throw new Error("Character model asset not loaded.");
        const riggedBytes = await (await fetch(modelUrl)).arrayBuffer();
        const loaded = await services.prepareEdit(riggedBytes);
        pristineWeightsRef.current = {
          joints: loaded.generated.weights.joints.slice(),
          weights: loaded.generated.weights.weights.slice()
        };
        adjacencyRef.current = buildVertexAdjacency(loaded.generated.mesh);
        paintDirtyRef.current = false;
        setBrushRadius(loaded.generated.characterHeight * 0.06);
        setSession(loaded);
        setBusyLabel(null);
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : String(loadError)
        );
        setBusyLabel(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generated = session?.generated ?? null;

  // ---- Tool state ---------------------------------------------
  const [activeTool, setActiveTool] = useState<"brush" | "select" | "shrinkwrap">(
    "brush"
  );
  const [tPose, setTPose] = useState(false);
  const [paintBoneColumn, setPaintBoneColumn] = useState(0);
  const [brushRadius, setBrushRadius] = useState(0.08);
  const [brushStrength, setBrushStrength] = useState(0.5);
  const [brushMode, setBrushMode] = useState<BrushMode>("add");
  const [paintClip, setPaintClip] = useState<string | null>(null);
  const [paintPlaying, setPaintPlaying] = useState(true);
  const [weightsVersion, setWeightsVersion] = useState(0);
  const [paintScope, setPaintScope] = useState("-1");
  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
  const [xray, setXray] = useState(true);
  const [shrinkSources, setShrinkSources] = useState<string[]>([]);
  const [shrinkInfo, setShrinkInfo] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);

  const bodyRegions = useMemo(() => {
    if (!generated || !pristineWeightsRef.current) return null;
    return computeBodyRegions(
      pristineWeightsRef.current,
      generated.weights.boneOrder,
      generated.mesh.positions
    );
    // weightsVersion re-derives after fresh solves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generated, weightsVersion]);
  const paintPiece = paintScope.startsWith("piece:")
    ? Number(paintScope.slice(6))
    : -1;
  const regionSet = useMemo(() => {
    if (!paintScope.startsWith("region:") || !bodyRegions) return null;
    return bodyRegions.get(paintScope.slice(7) as BodyRegionId) ?? null;
  }, [paintScope, bodyRegions]);
  const paintWindow = useMemo(() => {
    if (!generated || paintPiece < 0) return null;
    const range = generated.ranges[paintPiece];
    if (!range) return null;
    return {
      start: range.vertexStart,
      end: range.vertexStart + range.vertexCount
    };
  }, [generated, paintPiece]);

  const boneOptions = useMemo(
    () =>
      generated
        ? generated.weights.boneOrder.map((boneName, column) => ({
            value: String(column),
            label: friendlyBoneName(boneName)
          }))
        : [],
    [generated]
  );
  const pieceOptions = useMemo(() => {
    if (!generated) return [];
    const options: Array<
      | { value: string; label: string }
      | { group: string; items: Array<{ value: string; label: string }> }
    > = [
      { value: "-1", label: "Everything" },
      {
        group: "Pieces",
        items: generated.ranges.map((range, index) => ({
          value: `piece:${index}`,
          label: range.materialName ?? `Piece ${index + 1}`
        }))
      }
    ];
    if (bodyRegions) {
      options.push({
        group: "Body regions",
        items: [...bodyRegions.keys()].map((region) => ({
          value: `region:${region}`,
          label: BODY_REGION_LABELS[region]
        }))
      });
    }
    return options;
  }, [generated, bodyRegions]);
  const columnToJointSlot = useMemo(() => {
    if (!generated) return [];
    return generated.weights.boneOrder.map((boneName) =>
      generated.skeleton.bones.findIndex((bone) => bone.name === boneName)
    );
  }, [generated]);
  const paintModelUrl = useMemo(
    () => (generated ? trackBlobUrl(generated.modelGlb) : null),
    [generated, trackBlobUrl]
  );
  const paintClipUrls = useMemo(() => {
    if (!generated) return [];
    return generated.clips.map((clip) => ({
      slot: clip.slot,
      url: trackBlobUrl(clip.bytes)
    }));
  }, [generated, trackBlobUrl]);

  // ---- Handlers (the proven set) ------------------------------
  const markDirty = useCallback(() => {
    paintDirtyRef.current = true;
    setWeightsVersion((version) => version + 1);
  }, []);

  const handlePaint = useCallback(
    (faceVertices: [number, number, number]): number[] => {
      if (!generated) return [];
      const positions = generated.mesh.positions;
      const center: [number, number, number] = [0, 0, 0];
      for (const vertex of faceVertices) {
        center[0] += positions[vertex * 3]! / 3;
        center[1] += positions[vertex * 3 + 1]! / 3;
        center[2] += positions[vertex * 3 + 2]! / 3;
      }
      const affected = applyBrushStroke(
        generated.mesh,
        generated.weights,
        {
          center,
          radius: brushRadius,
          boneColumn: paintBoneColumn,
          strength: brushStrength * 0.25,
          mode: brushMode,
          vertexWindow: paintWindow ?? undefined,
          vertexSet: regionSet ?? undefined
        },
        adjacencyRef.current ?? undefined
      );
      if (affected.length > 0) paintDirtyRef.current = true;
      return affected;
    },
    [generated, brushRadius, paintBoneColumn, brushStrength, brushMode, paintWindow, regionSet]
  );

  const handleSelect = useCallback((vertices: number[], additive: boolean) => {
    setSelection((current) => {
      if (!additive) return new Set(vertices);
      const next = new Set(current);
      for (const vertex of vertices) next.add(vertex);
      return next;
    });
  }, []);

  const handleAssignSelection = useCallback(() => {
    if (!generated || selection.size === 0) return;
    assignVerticesToBone(generated.weights, [...selection], paintBoneColumn);
    markDirty();
  }, [generated, selection, paintBoneColumn, markDirty]);

  const handleMirror = useCallback(
    (direction: "leftToRight" | "rightToLeft") => {
      if (!generated) return;
      const result = mirrorWeights(generated.mesh, generated.weights, {
        direction,
        vertexWindow: paintWindow ?? undefined
      });
      const total = result.affected.length + result.unmatched;
      setShrinkInfo(
        `mirrored ${result.affected.length} of ${total}` +
          (result.unmatched > 0
            ? ` — ${result.unmatched} had NO mirror twin (asymmetric mesh); use Shrinkwrap for those`
            : "")
      );
      if (result.affected.length > 0) markDirty();
    },
    [generated, paintWindow, markDirty]
  );

  const handleFillScope = useCallback(() => {
    if (!generated) return;
    if (regionSet) {
      assignVerticesToBone(generated.weights, [...regionSet], paintBoneColumn);
    } else if (paintWindow) {
      fillVerticesWithBone(generated.weights, paintWindow, paintBoneColumn);
    } else {
      return;
    }
    markDirty();
  }, [generated, paintWindow, regionSet, paintBoneColumn, markDirty]);

  const handleResolveRegion = useCallback(() => {
    if (!generated || !regionSet || !paintScope.startsWith("region:")) return;
    setResolving(true);
    setTimeout(() => {
      try {
        const segments = computeBoneSegments(generated.skeleton);
        const targetSet = selection.size > 0 ? selection : regionSet;
        const affected = resolveRegionWeights(
          generated.mesh,
          generated.weights,
          segments,
          targetSet,
          paintScope.slice(7) as BodyRegionId
        );
        if (affected.length > 0) markDirty();
      } catch (solveError) {
        setError(
          solveError instanceof Error ? solveError.message : String(solveError)
        );
      } finally {
        setResolving(false);
      }
    }, 30);
  }, [generated, regionSet, paintScope, selection, markDirty]);

  const handleShrinkwrap = useCallback(() => {
    if (!generated || shrinkSources.length === 0) return;
    const sourceWindows = shrinkSources
      .map((value) => generated.ranges[Number(value)])
      .filter((range): range is NonNullable<typeof range> => Boolean(range))
      .map((range) => ({
        start: range.vertexStart,
        end: range.vertexStart + range.vertexCount
      }));
    const targetScope =
      selection.size > 0 ? selection : regionSet ?? paintWindow ?? null;
    if (!targetScope || sourceWindows.length === 0) return;
    setResolving(true);
    setShrinkInfo(null);
    setTimeout(() => {
      try {
        const result = shrinkwrapWeights(
          generated.mesh,
          generated.weights,
          targetScope,
          sourceWindows
        );
        setShrinkInfo(
          `matched ${result.matched}, inpainted ${result.inpainted}` +
            (result.untouched > 0 ? `, untouched ${result.untouched}` : "")
        );
        if (result.affected.length > 0) markDirty();
      } catch (wrapError) {
        setError(
          wrapError instanceof Error ? wrapError.message : String(wrapError)
        );
      } finally {
        setResolving(false);
      }
    }, 30);
  }, [generated, shrinkSources, selection, regionSet, paintWindow, markDirty]);

  const handleFreshSolve = useCallback(() => {
    if (!generated) return;
    setResolving(true);
    setShrinkInfo(null);
    setTimeout(() => {
      try {
        let meshTopY = -Infinity;
        for (let i = 1; i < generated.mesh.positions.length; i += 3) {
          if (generated.mesh.positions[i]! > meshTopY) {
            meshTopY = generated.mesh.positions[i]!;
          }
        }
        const segments = computeBoneSegments(generated.skeleton, { meshTopY });
        const solved = new GeodesicVoxelWeightSolver().solve(
          generated.mesh,
          segments
        );
        generated.weights.joints.set(solved.joints);
        generated.weights.weights.set(solved.weights);
        pristineWeightsRef.current = {
          joints: solved.joints.slice(),
          weights: solved.weights.slice()
        };
        setSelection(new Set());
        setShrinkInfo("fresh solver weights for all pieces");
        markDirty();
      } catch (solveError) {
        setError(
          solveError instanceof Error ? solveError.message : String(solveError)
        );
      } finally {
        setResolving(false);
      }
    }, 30);
  }, [generated, markDirty]);

  const handleResetScope = useCallback(() => {
    const pristine = pristineWeightsRef.current;
    if (!generated || !pristine) return;
    let vertices: Iterable<number>;
    if (selection.size > 0) vertices = selection;
    else if (regionSet) vertices = regionSet;
    else if (paintWindow) {
      vertices = Array.from(
        { length: paintWindow.end - paintWindow.start },
        (_, i) => paintWindow.start + i
      );
    } else return;
    for (const vertex of vertices) {
      for (let slot = 0; slot < 4; slot += 1) {
        generated.weights.joints[vertex * 4 + slot] =
          pristine.joints[vertex * 4 + slot]!;
        generated.weights.weights[vertex * 4 + slot] =
          pristine.weights[vertex * 4 + slot]!;
      }
    }
    markDirty();
  }, [generated, selection, regionSet, paintWindow, markDirty]);

  async function handleSave() {
    if (!session || !generated) return;
    setSaving(true);
    setError(null);
    try {
      const modelGlb = await services.reassemble(session.sourceBytes, generated);
      await services.commitEdit({
        characterName,
        sourceBytes: session.sourceBytes,
        landmarks: session.landmarks,
        generated: { ...generated, modelGlb },
        skipAnimations: true
      });
      paintDirtyRef.current = false;
      setShrinkInfo("saved");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : String(saveError)
      );
    } finally {
      setSaving(false);
    }
  }

  if (busyLabel) {
    return (
      <Group justify="center" p="xl" h="100%">
        <Loader size="sm" />
        <Text size="sm">{busyLabel}</Text>
      </Group>
    );
  }
  if (!generated || !paintModelUrl) {
    return (
      <Stack p="md">
        {error ? (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        ) : null}
        <Button variant="subtle" onClick={onClose}>
          Back to animation view
        </Button>
      </Stack>
    );
  }

  const modeTabs = (
    <Group
      gap={4}
      style={{
        padding: 6,
        borderRadius: 8,
        border: "1px solid var(--sm-panel-border)",
        background: "color-mix(in srgb, var(--sm-viewport-bg) 88%, black 12%)"
      }}
    >
      <Tooltip label="Weights + rig (active)">
        <ActionIcon variant="filled" color="grape" onClick={onClose} aria-label="Exit rig mode">
          🦴
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Animations — generate + tune idle/walk/run">
        <ActionIcon
          variant="subtle"
          color="cyan"
          onClick={onOpenAnimations}
          aria-label="Open the animation panel"
        >
          ✨
        </ActionIcon>
      </Tooltip>
    </Group>
  );

  return (
    <Stack gap="xs" h="100%" p="xs" style={{ minHeight: 0 }}>
      {error ? (
        <Alert color="red" variant="light" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      <Group gap="sm" align="center" wrap="nowrap">
        {modeTabs}
        {shrinkInfo ? (
          <Text size="xs" c="var(--sm-color-subtext)">
            {shrinkInfo}
          </Text>
        ) : null}
        <Box style={{ flex: 1 }} />
        <Button size="compact-sm" onClick={() => void handleSave()} loading={saving}>
          Save weights
        </Button>
      </Group>
      <Group gap="xs" align="stretch" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
        {/* Blender-style properties column. */}
        <ScrollArea w={250} style={{ flexShrink: 0 }}>
          <Stack gap="xs" pr={6}>
            <PanelSection title="Bones" icon="🦴" defaultOpen>
              <Stack gap={4}>
                <TextInput
                  size="xs"
                  placeholder="filter bones"
                  value={boneSearch}
                  onChange={(event) => setBoneSearch(event.currentTarget.value)}
                />
                <ScrollArea.Autosize mah={220}>
                  <Stack gap={2}>
                    {boneOptions
                      .filter((option) =>
                        option.label
                          .toLowerCase()
                          .includes(boneSearch.toLowerCase())
                      )
                      .map((option) => (
                        <Button
                          key={option.value}
                          size="compact-xs"
                          fullWidth
                          justify="flex-start"
                          variant={
                            String(paintBoneColumn) === option.value
                              ? "light"
                              : "subtle"
                          }
                          color={
                            String(paintBoneColumn) === option.value
                              ? "blue"
                              : "gray"
                          }
                          onClick={() =>
                            setPaintBoneColumn(Number(option.value))
                          }
                        >
                          {option.label}
                        </Button>
                      ))}
                  </Stack>
                </ScrollArea.Autosize>
              </Stack>
            </PanelSection>
            <PanelSection title="Pieces" icon="🧩" defaultOpen>
              <Stack gap={2}>
                {pieceOptions.flatMap((entry) =>
                  "group" in entry
                    ? [
                        <Text
                          key={`h-${entry.group}`}
                          size="xs"
                          fw={600}
                          c="var(--sm-color-subtext)"
                          mt={4}
                        >
                          {entry.group}
                        </Text>,
                        ...entry.items.map((item) => (
                          <Button
                            key={item.value}
                            size="compact-xs"
                            fullWidth
                            justify="flex-start"
                            variant={paintScope === item.value ? "light" : "subtle"}
                            color={paintScope === item.value ? "blue" : "gray"}
                            onClick={() => setPaintScope(item.value)}
                          >
                            {item.label}
                          </Button>
                        ))
                      ]
                    : [
                        <Button
                          key={entry.value}
                          size="compact-xs"
                          fullWidth
                          justify="flex-start"
                          variant={paintScope === entry.value ? "light" : "subtle"}
                          color={paintScope === entry.value ? "blue" : "gray"}
                          onClick={() => setPaintScope(entry.value)}
                        >
                          {entry.label}
                        </Button>
                      ]
                )}
              </Stack>
            </PanelSection>
            <PanelSection title="Actions" icon="⚙" defaultOpen={false}>
              <Stack gap={4}>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  justify="flex-start"
                  onClick={handleFillScope}
                  disabled={paintPiece < 0 && !regionSet}
                >
                  Fill piece/region with bone
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  justify="flex-start"
                  onClick={handleResolveRegion}
                  disabled={!regionSet || resolving}
                >
                  {resolving ? "Re-solving..." : "Re-solve region (auto)"}
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  justify="flex-start"
                  onClick={() => handleMirror("leftToRight")}
                >
                  {"Mirror weights L > R"}
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  justify="flex-start"
                  onClick={() => handleMirror("rightToLeft")}
                >
                  {"Mirror weights R > L"}
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  justify="flex-start"
                  onClick={handleResetScope}
                  disabled={paintPiece < 0 && !regionSet && selection.size === 0}
                >
                  Reset scope to session start
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  justify="flex-start"
                  onClick={handleFreshSolve}
                  disabled={resolving}
                >
                  {resolving ? "Solving..." : "Fresh auto-solve (ALL)"}
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  justify="flex-start"
                  onClick={onEditMarkers}
                >
                  Adjust markers (wizard)
                </Button>
              </Stack>
            </PanelSection>
          </Stack>
        </ScrollArea>
        <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <WeightPaintViewport
            modelUrl={paintModelUrl}
            clips={paintClipUrls}
            activeClip={paintClip}
            playing={paintPlaying}
            weights={generated.weights}
            ranges={generated.ranges}
            selectedBoneColumn={paintBoneColumn}
            columnToJointSlot={columnToJointSlot}
            brushRadius={brushRadius}
            isolatedPiece={paintPiece}
            regionSet={regionSet}
            weightsVersion={weightsVersion}
            selectMode={activeTool !== "brush"}
            xray={xray}
            selection={selection}
            tPose={tPose}
            onSelect={handleSelect}
            onPaint={handlePaint}
          />
          <ToolRail
            tools={[
              { id: "brush", icon: "🖌", label: "Paint brush" },
              { id: "select", icon: "⬚", label: "Box select", color: "yellow" },
              {
                id: "shrinkwrap",
                icon: "🧲",
                label: "Shrinkwrap weights (copy from source pieces)",
                color: "teal"
              }
            ]}
            activeToolId={activeTool}
            onSelect={(toolId) =>
              setActiveTool(toolId as "brush" | "select" | "shrinkwrap")
            }
          />
          <ToolOptionsBar>
            {activeTool === "brush" ? (
              <>
                <SegmentedControl
                  size="xs"
                  data={[
                    { value: "add", label: "Add" },
                    { value: "subtract", label: "Sub" },
                    { value: "smooth", label: "Smooth" },
                    { value: "fill", label: "Fill" }
                  ]}
                  value={brushMode}
                  onChange={(value) => setBrushMode(value as BrushMode)}
                />
                <ToolOptionSlider
                  label="Radius"
                  min={0.01}
                  max={0.4}
                  step={0.005}
                  value={brushRadius}
                  onChange={setBrushRadius}
                />
                <ToolOptionSlider
                  label="Strength"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={brushStrength}
                  onChange={setBrushStrength}
                />
              </>
            ) : activeTool === "select" ? (
              <>
                <Switch
                  size="xs"
                  label="X-ray"
                  checked={xray}
                  onChange={(event) => setXray(event.currentTarget.checked)}
                />
                <Button
                  size="compact-xs"
                  variant="light"
                  disabled={selection.size === 0}
                  onClick={handleAssignSelection}
                >
                  {selection.size > 0
                    ? `Assign ${selection.size} to bone`
                    : "Assign to bone"}
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  disabled={selection.size === 0}
                  onClick={() => setSelection(new Set())}
                >
                  Clear
                </Button>
                <Text size="xs" c="var(--sm-color-subtext)">
                  Drag a box; shift adds.
                </Text>
              </>
            ) : (
              <>
                <MultiSelect
                  size="xs"
                  w={220}
                  placeholder="source piece(s)"
                  data={generated.ranges
                    .map((range, index) => ({
                      value: String(index),
                      label: range.materialName ?? `Piece ${index + 1}`
                    }))
                    .filter((option) => Number(option.value) !== paintPiece)}
                  value={shrinkSources}
                  onChange={setShrinkSources}
                />
                <Button
                  size="compact-xs"
                  variant="light"
                  loading={resolving}
                  disabled={
                    shrinkSources.length === 0 ||
                    (paintPiece < 0 && !regionSet && selection.size === 0)
                  }
                  onClick={handleShrinkwrap}
                >
                  {selection.size > 0
                    ? `Shrinkwrap ${selection.size} selected`
                    : regionSet
                      ? "Shrinkwrap region"
                      : "Shrinkwrap piece"}
                </Button>
              </>
            )}
          </ToolOptionsBar>
          <Tooltip
            label={tPose ? "Back to bind pose" : "T-pose (lift limbs clear)"}
            position="left"
          >
            <ActionIcon
              variant={tPose ? "filled" : "default"}
              color="teal"
              style={{ position: "absolute", top: 10, right: 10, zIndex: 5 }}
              onClick={() => setTPose((current) => !current)}
              aria-label="Toggle T-pose"
            >
              T
            </ActionIcon>
          </Tooltip>
          {/* Playback: bottom-center, matching the main workspace. */}
          <Group
            gap="xs"
            wrap="nowrap"
            style={{
              position: "absolute",
              bottom: 14,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 5,
              padding: 8,
              borderRadius: 8,
              border: "1px solid var(--sm-panel-border)",
              background:
                "color-mix(in srgb, var(--sm-viewport-bg) 88%, black 12%)"
            }}
          >
            <Select
              size="xs"
              w={140}
              data={[
                { value: "__static__", label: "Static" },
                ...paintClipUrls.map((clip) => ({
                  value: clip.slot,
                  label: clip.slot
                }))
              ]}
              value={paintClip ?? "__static__"}
              onChange={(value) =>
                setPaintClip(value && value !== "__static__" ? value : null)
              }
            />
            <Tooltip label={paintPlaying ? "Pause" : "Play"}>
              <ActionIcon
                variant="subtle"
                color="blue"
                onClick={() => setPaintPlaying((current) => !current)}
                aria-label={paintPlaying ? "Pause preview" : "Play preview"}
              >
                {paintPlaying ? "❚❚" : "▶"}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Box>
      </Group>
    </Stack>
  );
}
