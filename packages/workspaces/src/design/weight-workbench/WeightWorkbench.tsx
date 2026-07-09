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
  Menu,
  MultiSelect,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Tooltip
} from "@mantine/core";
import { LabeledSlider } from "@sugarmagic/ui";
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
}

export function WeightWorkbench(props: WeightWorkbenchProps) {
  const { model, characterName, assetSources, services, onEditMarkers, onClose } =
    props;

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
  const [activeTool, setActiveTool] = useState<"brush" | "select">("brush");
  const [tPose, setTPose] = useState(false);
  const [paintBoneColumn, setPaintBoneColumn] = useState(0);
  const [brushRadius, setBrushRadius] = useState(0.08);
  const [brushStrength, setBrushStrength] = useState(0.5);
  const [brushMode, setBrushMode] = useState<BrushMode>("add");
  const [paintAnimating, setPaintAnimating] = useState(false);
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
  const paintIdleUrl = useMemo(() => {
    if (!generated) return null;
    const idle = generated.clips.find((clip) => clip.slot === "idle");
    return idle ? trackBlobUrl(idle.bytes) : null;
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

  return (
    <Stack gap="xs" h="100%" p="xs" style={{ minHeight: 0 }}>
      {error ? (
        <Alert color="red" variant="light" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select
          label="Bone"
          size="xs"
          w={180}
          searchable
          data={boneOptions}
          value={String(paintBoneColumn)}
          onChange={(value) => {
            if (value !== null) setPaintBoneColumn(Number(value));
          }}
        />
        <Select
          label="Piece"
          size="xs"
          w={170}
          data={pieceOptions}
          value={paintScope}
          onChange={(value) => {
            if (value !== null) setPaintScope(value);
          }}
        />
        <MultiSelect
          label="Shrinkwrap from"
          size="xs"
          w={210}
          placeholder="source piece(s)"
          disabled={paintPiece < 0 && !regionSet && selection.size === 0}
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
        <Switch
          size="xs"
          label="Animate"
          checked={paintAnimating}
          onChange={(event) => setPaintAnimating(event.currentTarget.checked)}
        />
        <Menu position="bottom-start" withinPortal>
          <Menu.Target>
            <Button size="compact-xs" variant="light">
              Actions
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              onClick={handleFillScope}
              disabled={paintPiece < 0 && !regionSet}
            >
              Fill piece/region with bone
            </Menu.Item>
            <Menu.Item
              onClick={handleResolveRegion}
              disabled={!regionSet || resolving}
            >
              {resolving
                ? "Re-solving..."
                : selection.size > 0
                  ? `Re-solve ${selection.size} selected (auto)`
                  : "Re-solve region weights (auto)"}
            </Menu.Item>
            <Menu.Item onClick={() => handleMirror("leftToRight")}>
              {"Mirror weights L > R"}
            </Menu.Item>
            <Menu.Item onClick={() => handleMirror("rightToLeft")}>
              {"Mirror weights R > L"}
            </Menu.Item>
            <Menu.Item
              onClick={handleResetScope}
              disabled={paintPiece < 0 && !regionSet && selection.size === 0}
            >
              Reset scope to session start
            </Menu.Item>
            <Menu.Item onClick={handleFreshSolve} disabled={resolving}>
              {resolving ? "Solving..." : "Fresh auto-solve (ALL pieces)"}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item onClick={onEditMarkers}>
              Adjust markers (Character Wizard)
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        {shrinkInfo ? (
          <Text size="xs" c="var(--sm-color-subtext)">
            {shrinkInfo}
          </Text>
        ) : null}
        <Box style={{ flex: 1 }} />
        <Button
          size="compact-sm"
          onClick={() => void handleSave()}
          loading={saving}
        >
          Save weights
        </Button>
        <Button size="compact-sm" variant="subtle" color="gray" onClick={onClose}>
          Done
        </Button>
      </Group>
      <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <WeightPaintViewport
          modelUrl={paintModelUrl}
          idleClipUrl={paintIdleUrl}
          weights={generated.weights}
          ranges={generated.ranges}
          selectedBoneColumn={paintBoneColumn}
          columnToJointSlot={columnToJointSlot}
          brushRadius={brushRadius}
          animating={paintAnimating}
          isolatedPiece={paintPiece}
          regionSet={regionSet}
          weightsVersion={weightsVersion}
          selectMode={activeTool === "select"}
          xray={xray}
          selection={selection}
          tPose={tPose}
          onSelect={handleSelect}
          onPaint={handlePaint}
        />
        <Stack
          gap={6}
          style={{ position: "absolute", top: 10, left: 10, zIndex: 5 }}
        >
          <Group gap={4}>
            <Tooltip label="Paint brush" position="right">
              <ActionIcon
                variant={activeTool === "brush" ? "filled" : "default"}
                color="blue"
                onClick={() => setActiveTool("brush")}
                aria-label="Paint brush tool"
              >
                🖌
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Box select" position="right">
              <ActionIcon
                variant={activeTool === "select" ? "filled" : "default"}
                color="yellow"
                onClick={() => setActiveTool("select")}
                aria-label="Box select tool"
              >
                ⬚
              </ActionIcon>
            </Tooltip>
          </Group>
          <Paper p="xs" radius="sm" withBorder style={{ width: 170, opacity: 0.95 }}>
            {activeTool === "brush" ? (
              <Stack gap={6}>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  data={[
                    { value: "add", label: "Add" },
                    { value: "subtract", label: "Sub" },
                    { value: "smooth", label: "Smooth" },
                    { value: "fill", label: "Fill" }
                  ]}
                  value={brushMode}
                  onChange={(value) => setBrushMode(value as BrushMode)}
                />
                <LabeledSlider
                  label="Radius"
                  min={0.01}
                  max={0.4}
                  step={0.005}
                  value={brushRadius}
                  onChange={setBrushRadius}
                />
                <LabeledSlider
                  label="Strength"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={brushStrength}
                  onChange={setBrushStrength}
                />
              </Stack>
            ) : (
              <Stack gap={6}>
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
                  Clear selection
                </Button>
                <Text size="xs" c="var(--sm-color-subtext)">
                  Drag a box; shift adds.
                </Text>
              </Stack>
            )}
          </Paper>
        </Stack>
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
      </Box>
    </Stack>
  );
}
