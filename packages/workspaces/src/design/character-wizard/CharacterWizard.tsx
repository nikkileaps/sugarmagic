/**
 * packages/workspaces/src/design/character-wizard/CharacterWizard.tsx
 *
 * Purpose: Plan 062 §062.6 — the Character Wizard modal: import a
 * static A/T-pose humanoid GLB, confirm/adjust the 16 detected
 * joint markers, generate (rig + bind + attach clips), preview
 * idle/walk/run, and commit — all inside the reusable
 * WizardDialog frame (ui, §062.5).
 *
 * Architecture: this component owns ONLY wizard-local View state.
 * Every algorithm and every byte of I/O comes through the
 * `CharacterWizardServices` prop (implemented Studio-side, where
 * io + the solver worker + the vendored clip assets live) — the
 * workspaces package gains no new dependencies. Nothing persists
 * until Finish; Cancel discards everything.
 *
 * Implements: Plan 062 §062.6
 *
 * Status: active
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput
} from "@mantine/core";
import { LabeledSlider, WizardDialog } from "@sugarmagic/ui";
import type {
  CharacterAnimationDefinition,
  CharacterModelDefinition,
  MotionRecipe
} from "@sugarmagic/domain";
import {
  applyBrushStroke,
  assignVerticesToBone,
  buildVertexAdjacency,
  fillVerticesWithBone,
  mirrorWeights,
  type BrushMode,
  type GeneratedSkeleton,
  type MeshData,
  type SkinWeights
} from "@sugarmagic/character-rig";
import { CharacterPreview } from "../CharacterPreview";
import { MarkerViewport } from "./MarkerViewport";
import {
  WeightPaintViewport,
  type WeightPaintRange
} from "./WeightPaintViewport";

/** The wizard's 16 landmarks: name -> world position. */
export type WizardLandmarks = Record<string, [number, number, number]>;

export interface WizardGenerated {
  /** The skinned model GLB (source + rig + weights). */
  modelGlb: ArrayBuffer;
  /** Per-slot clip bytes, hips-scaled for this character. */
  clips: Array<{ slot: "idle" | "walk" | "run"; clipName: string; bytes: ArrayBuffer }>;
  /** Mesh height in meters — the preview's scale reference. */
  characterHeight: number;
  /** Solver artifacts (Plan 062 §062.8): the weight-paint step
   *  edits `weights` in place and `reassemble` rebuilds the GLB. */
  skeleton: GeneratedSkeleton;
  weights: SkinWeights;
  ranges: Array<
    WeightPaintRange & { nodeWorldMatrix: number[]; materialName: string | null }
  >;
  mesh: MeshData;
}

export interface CharacterWizardServices {
  /** Flatten the GLB's mesh + detect landmark estimates. */
  analyzeModel(bytes: ArrayBuffer): Promise<{ landmarks: WizardLandmarks }>;
  /**
   * The heavy step, off-thread Studio-side: skeleton from the
   * confirmed landmarks, geodesic weight solve, skinned-GLB
   * assembly, per-slot clip preparation.
   */
  generate(
    bytes: ArrayBuffer,
    landmarks: WizardLandmarks,
    onProgress: (fraction: number) => void
  ): Promise<WizardGenerated>;
  /** Rebuild the skinned GLB after weight painting (§062.8). */
  reassemble(
    sourceBytes: ArrayBuffer,
    generated: WizardGenerated
  ): Promise<ArrayBuffer>;
  /** Reopen a wizard-generated character for editing (§062.9). */
  prepareEdit(riggedBytes: ArrayBuffer): Promise<{
    sourceBytes: ArrayBuffer;
    landmarks: WizardLandmarks;
    generated: WizardGenerated;
  }>;
  /** Overwrite an existing character's assets in place (§062.9).
   *  Returns the (upserted) definitions — a renamed clip needs
   *  rebinding just like a fresh commit. With `skipAnimations`
   *  (weights-only edits: markers untouched, so hip scale and
   *  clips are unchanged) ONLY the model is written — animation
   *  files, definitions, and bindings stay exactly as configured,
   *  including Plan 063 generated slots. */
  commitEdit(request: {
    characterName: string;
    sourceBytes: ArrayBuffer;
    landmarks: WizardLandmarks;
    generated: WizardGenerated;
    skipAnimations: boolean;
    /** Currently bound clip bytes per slot — recipe-carrying
     *  (generated) slots regenerate at the new skeleton instead
     *  of being stomped back to library clips. */
    boundClips?: Partial<Record<"idle" | "walk" | "run", ArrayBuffer>>;
  }): Promise<{
    characterModelDefinition: CharacterModelDefinition;
    characterAnimationDefinitions: Array<{
      slot: "idle" | "walk" | "run";
      definition: CharacterAnimationDefinition;
    }>;
  }>;
  // ---- Plan 063: animation panel services (same DI object; the
  // panel is character tooling like the wizard) ----------------
  /** Hip scale for clip copies (from the model's recipe) + the
   *  relaxed base pose the pose-adjust viewport starts from. */
  prepareAnimationPanel(riggedBytes: ArrayBuffer): Promise<{
    hipScale: number;
    relaxedPose: Readonly<Record<string, readonly number[]>>;
    /** Plan 064 — whether this character's skeleton has the tail
     *  chain (gates tail tracks in generated clips). */
    hasTail: boolean;
  }>;
  /** Generate a clip from a recipe, hips-scaled for the character. */
  generateClip(
    recipe: MotionRecipe,
    hipScale: number,
    hasTail: boolean
  ): { clipName: string; bytes: ArrayBuffer };
  /** The vendored library clip for a slot, hips-scaled; tailed
   *  characters get the wag baked into the copy (Plan 064). */
  getLibraryClip(
    slot: "idle" | "walk" | "run",
    hipScale: number,
    tail?: {
      personality: MotionRecipe["personality"];
      seed: number;
    } | null
  ): Promise<{ clipName: string; bytes: ArrayBuffer }>;
  /** Recipe stamped in a generated clip, or null. */
  readSlotRecipe(clipBytes: ArrayBuffer): MotionRecipe | null;
  /** §063.6 — sample a generator channel's current signal (the
   *  curve editor's starting shape when no override exists). */
  sampleChannel(
    recipe: MotionRecipe,
    channel: string,
    count: number
  ): Array<{ x: number; y: number }>;
  /** Write + register slot clips; returns slot-mapped definitions. */
  commitAnimationSlots(request: {
    characterName: string;
    clips: Array<{
      slot: "idle" | "walk" | "run";
      clipName: string;
      bytes: ArrayBuffer;
    }>;
  }): Promise<
    Array<{
      slot: "idle" | "walk" | "run";
      definition: CharacterAnimationDefinition;
    }>
  >;
  /** Write assets + return definitions (io commit, §062.4). */
  commit(request: {
    characterName: string;
    sourceBytes: ArrayBuffer;
    landmarks: WizardLandmarks;
    generated: WizardGenerated;
  }): Promise<{
    characterModelDefinition: CharacterModelDefinition;
    characterAnimationDefinitions: Array<{
      slot: "idle" | "walk" | "run";
      definition: CharacterAnimationDefinition;
    }>;
  }>;
}

export interface CharacterWizardProps {
  opened: boolean;
  defaultCharacterName: string;
  services: CharacterWizardServices;
  /** Plan 062 §062.9 — when set, the wizard reopens an existing
   *  wizard-generated character: markers + painted weights load
   *  from the stamped recipe, the name is locked, and Finish
   *  overwrites the same asset files (bindings untouched). */
  editSession?: {
    characterName: string;
    riggedBytes: ArrayBuffer;
    /** Bound animation clip bytes per slot (for recipe-preserving
     *  regeneration on marker-level edits). */
    boundClips?: Partial<Record<"idle" | "walk" | "run", ArrayBuffer>>;
  } | null;
  /** Fired after commit; the workspace binds model + slots. */
  onCommitted: (result: {
    characterModelDefinition: CharacterModelDefinition;
    characterAnimationDefinitions: Array<{
      slot: "idle" | "walk" | "run";
      definition: CharacterAnimationDefinition;
    }>;
  }) => void;
  onClose: () => void;
}

type WizardStep = "import" | "joints" | "weights" | "preview";

const STEPS = [
  { id: "import", label: "Import", description: "Pick a GLB" },
  { id: "joints", label: "Joints", description: "Confirm markers" },
  { id: "weights", label: "Weights", description: "Touch up (optional)" },
  { id: "preview", label: "Preview", description: "Watch it move" }
];

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

export function CharacterWizard(props: CharacterWizardProps) {
  const {
    opened,
    defaultCharacterName,
    services,
    editSession,
    onCommitted,
    onClose
  } = props;
  const isEditMode = Boolean(editSession);
  const [step, setStep] = useState<WizardStep>("import");
  const [characterName, setCharacterName] = useState(defaultCharacterName);
  const [sourceBytes, setSourceBytes] = useState<ArrayBuffer | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [landmarks, setLandmarks] = useState<WizardLandmarks | null>(null);
  const [generated, setGenerated] = useState<WizardGenerated | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [busyProgress, setBusyProgress] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [previewSlot, setPreviewSlot] = useState<string | null>("idle");
  const [previewPlaying, setPreviewPlaying] = useState(true);
  // Mirroring defaults ON — symmetric characters are the design
  // center, so one drag places both sides (nikki, 2026-07-06).
  const [mirroring, setMirroring] = useState(true);
  // Plan 064 — optional tail: three extra sagittal markers.
  const hasTail = Boolean(landmarks?.tailBase);
  const toggleTail = useCallback(
    (enabled: boolean) => {
      landmarksDirtyRef.current = true;
      setLandmarks((current) => {
        if (!current) return current;
        if (!enabled) {
          const next = { ...current };
          delete next.tailBase;
          delete next.tailMid;
          delete next.tailTip;
          return next;
        }
        // Seed the chain behind the pelvis, scaled by hip height —
        // rough on purpose; the markers are the correction loop.
        const pelvis = current.pelvis;
        const scale = pelvis[1];
        return {
          ...current,
          tailBase: [pelvis[0], pelvis[1] - 0.08 * scale, pelvis[2] - 0.15 * scale],
          tailMid: [pelvis[0], pelvis[1] + 0.05 * scale, pelvis[2] - 0.32 * scale],
          tailTip: [pelvis[0], pelvis[1] + 0.3 * scale, pelvis[2] - 0.42 * scale]
        };
      });
    },
    []
  );
  // Weight-paint step state (§062.8).
  const [paintBoneColumn, setPaintBoneColumn] = useState(0);
  const [brushRadius, setBrushRadius] = useState(0.08);
  const [brushStrength, setBrushStrength] = useState(0.5);
  const [brushMode, setBrushMode] = useState<BrushMode>("add");
  const [paintAnimating, setPaintAnimating] = useState(false);
  // Piece isolation: -1 = all pieces; otherwise index into ranges.
  const [paintPiece, setPaintPiece] = useState(-1);
  // Bumped on out-of-band weight edits (Fill piece / Reset) so the
  // viewport fully resyncs heatmap + live skin.
  const [weightsVersion, setWeightsVersion] = useState(0);
  // Box selection (Plan 064): select precisely, then operate.
  const [selectMode, setSelectMode] = useState(false);
  const [xray, setXray] = useState(true);
  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
  const handleSelect = useCallback(
    (vertices: number[], additive: boolean) => {
      setSelection((current) => {
        if (!additive) return new Set(vertices);
        const next = new Set(current);
        for (const vertex of vertices) next.add(vertex);
        return next;
      });
    },
    []
  );
  const handleAssignSelection = useCallback(() => {
    if (!generated || selection.size === 0) return;
    assignVerticesToBone(generated.weights, [...selection], paintBoneColumn);
    paintDirtyRef.current = true;
    setWeightsVersion((version) => version + 1);
  }, [generated, selection, paintBoneColumn]);
  const paintDirtyRef = useRef(false);
  const adjacencyRef = useRef<Array<Set<number>> | null>(null);
  const pristineWeightsRef = useRef<{
    joints: Uint16Array;
    weights: Float32Array;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Blob URLs created for preview; revoked on teardown.
  const blobUrlsRef = useRef<string[]>([]);

  const trackBlobUrl = useCallback((bytes: ArrayBuffer): string => {
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "model/gltf-binary" })
    );
    blobUrlsRef.current.push(url);
    return url;
  }, []);

  const reset = useCallback(() => {
    for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
    blobUrlsRef.current = [];
    setStep("import");
    setSourceBytes(null);
    setSourceUrl(null);
    setLandmarks(null);
    setGenerated(null);
    setBusy(false);
    setError(null);
    setPreviewSlot("idle");
  }, []);

  const handleCancel = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const landmarksDirtyRef = useRef(false);
  const editLoadedRef = useRef(false);
  // §062.9 — edit bootstrap: load recipe + painted weights, land
  // on the joints step with everything prefilled.
  useEffect(() => {
    if (!opened) {
      editLoadedRef.current = false;
      return;
    }
    if (!editSession || editLoadedRef.current) return;
    editLoadedRef.current = true;
    setBusy(true);
    setBusyLabel("Loading character...");
    void services
      .prepareEdit(editSession.riggedBytes)
      .then((loaded) => {
        setCharacterName(editSession.characterName);
        setSourceBytes(loaded.sourceBytes);
        setSourceUrl(trackBlobUrl(loaded.sourceBytes));
        setLandmarks(loaded.landmarks);
        pristineWeightsRef.current = {
          joints: loaded.generated.weights.joints.slice(),
          weights: loaded.generated.weights.weights.slice()
        };
        adjacencyRef.current = buildVertexAdjacency(loaded.generated.mesh);
        paintDirtyRef.current = false;
        landmarksDirtyRef.current = false;
        setBrushRadius(loaded.generated.characterHeight * 0.06);
        setGenerated(loaded.generated);
        setStep("joints");
      })
      .catch((editError) => {
        setError(
          editError instanceof Error ? editError.message : String(editError)
        );
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editSession]);

  async function handleFilePicked(file: File) {
    setError(null);
    setBusy(true);
    setBusyLabel("Analyzing model...");
    setBusyProgress(undefined);
    try {
      const bytes = await file.arrayBuffer();
      const analysis = await services.analyzeModel(bytes);
      setSourceBytes(bytes);
      setSourceUrl(trackBlobUrl(bytes));
      setLandmarks(analysis.landmarks);
      if (characterName === defaultCharacterName || characterName.length === 0) {
        setCharacterName(file.name.replace(/\.glb$/i, ""));
      }
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : String(analysisError)
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleNext() {
    setError(null);
    if (step === "import") {
      setStep("joints");
      return;
    }
    if (step === "weights") {
      if (!generated || !sourceBytes) return;
      if (!paintDirtyRef.current) {
        setStep("preview");
        return;
      }
      setBusy(true);
      setBusyLabel("Rebuilding model with painted weights...");
      setBusyProgress(undefined);
      try {
        const modelGlb = await services.reassemble(sourceBytes, generated);
        setGenerated({ ...generated, modelGlb });
        paintDirtyRef.current = false;
        setStep("preview");
      } catch (reassembleError) {
        setError(
          reassembleError instanceof Error
            ? reassembleError.message
            : String(reassembleError)
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === "joints") {
      if (!sourceBytes || !landmarks) return;
      if (isEditMode && !landmarksDirtyRef.current && generated) {
        // Markers untouched: keep the loaded (possibly painted)
        // weights instead of re-solving over them.
        setStep("weights");
        return;
      }
      setBusy(true);
      setBusyLabel("Generating rig + binding weights...");
      setBusyProgress(0);
      try {
        const result = await services.generate(sourceBytes, landmarks, (f) =>
          setBusyProgress(f)
        );
        pristineWeightsRef.current = {
          joints: result.weights.joints.slice(),
          weights: result.weights.weights.slice()
        };
        adjacencyRef.current = buildVertexAdjacency(result.mesh);
        paintDirtyRef.current = false;
        setBrushRadius(result.characterHeight * 0.06);
        setGenerated(result);
        setStep("weights");
      } catch (generateError) {
        setError(
          generateError instanceof Error
            ? generateError.message
            : String(generateError)
        );
      } finally {
        setBusy(false);
        setBusyProgress(undefined);
      }
    }
  }

  async function handleFinish() {
    if (!generated || !sourceBytes || !landmarks) return;
    setBusy(true);
    setBusyLabel("Writing character assets...");
    setBusyProgress(undefined);
    try {
      if (isEditMode) {
        const result = await services.commitEdit({
          characterName,
          sourceBytes,
          landmarks,
          generated,
          // Markers untouched = skeleton unchanged = clips still
          // valid; leave animation bindings (incl. generated
          // slots) alone.
          skipAnimations: !landmarksDirtyRef.current,
          boundClips: editSession?.boundClips
        });
        onCommitted(result);
      } else {
        const result = await services.commit({
          characterName,
          sourceBytes,
          landmarks,
          generated
        });
        onCommitted(result);
      }
      reset();
      onClose();
    } catch (commitError) {
      setError(
        commitError instanceof Error ? commitError.message : String(commitError)
      );
      setBusy(false);
    }
  }

  // Preview step feeds CharacterPreview via stub definitions +
  // blob-URL asset sources — the same component the workspace
  // renders, so what you approve is what you get.
  const preview = useMemo(() => {
    if (!generated) return null;
    const assetSources: Record<string, string> = {
      "__wizard__/model.glb": trackBlobUrl(generated.modelGlb)
    };
    const model: CharacterModelDefinition = {
      definitionId: "__wizard__:model",
      definitionKind: "character-model",
      displayName: characterName,
      source: {
        relativeAssetPath: "__wizard__/model.glb",
        fileName: "model.glb",
        mimeType: "model/gltf-binary"
      }
    };
    const slots = generated.clips.map((clip) => {
      const path = `__wizard__/${clip.slot}.glb`;
      assetSources[path] = trackBlobUrl(clip.bytes);
      return {
        value: clip.slot,
        label: clip.slot,
        animation: {
          definitionId: `__wizard__:${clip.slot}`,
          definitionKind: "character-animation" as const,
          displayName: clip.clipName,
          source: {
            relativeAssetPath: path,
            fileName: `${clip.slot}.glb`,
            mimeType: "model/gltf-binary"
          },
          clipNames: [clip.clipName]
        }
      };
    });
    return { model, slots, assetSources };
  }, [generated, characterName, trackBlobUrl]);

  const canAdvance =
    !busy &&
    (step === "import"
      ? sourceBytes !== null && characterName.trim().length > 0
      : step === "joints"
        ? landmarks !== null
        : generated !== null);

  // Paint-step derived data.
  const paintModelUrl = useMemo(
    () => (step === "weights" && generated ? trackBlobUrl(generated.modelGlb) : null),
    [step, generated, trackBlobUrl]
  );
  const paintIdleUrl = useMemo(() => {
    if (step !== "weights" || !generated) return null;
    const idle = generated.clips.find((clip) => clip.slot === "idle");
    return idle ? trackBlobUrl(idle.bytes) : null;
  }, [step, generated, trackBlobUrl]);
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
  const columnToJointSlot = useMemo(() => {
    if (!generated) return [];
    return generated.weights.boneOrder.map((boneName) =>
      generated.skeleton.bones.findIndex((bone) => bone.name === boneName)
    );
  }, [generated]);
  const pieceOptions = useMemo(() => {
    if (!generated) return [];
    return [
      { value: "-1", label: "All pieces" },
      ...generated.ranges.map((range, index) => ({
        value: String(index),
        label: range.materialName ?? `Piece ${index + 1}`
      }))
    ];
  }, [generated]);
  const paintWindow = useMemo(() => {
    if (!generated || paintPiece < 0) return undefined;
    const range = generated.ranges[paintPiece];
    if (!range) return undefined;
    return {
      start: range.vertexStart,
      end: range.vertexStart + range.vertexCount
    };
  }, [generated, paintPiece]);

  const handlePaint = useCallback(
    (faceVertices: [number, number, number]): number[] => {
      if (!generated) return [];
      // Brush center = the clicked face's REST-space centroid, so
      // strokes land correctly even while the preview animates.
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
          vertexWindow: paintWindow
        },
        adjacencyRef.current ?? undefined
      );
      if (affected.length > 0) paintDirtyRef.current = true;
      return affected;
    },
    [generated, brushRadius, paintBoneColumn, brushStrength, brushMode, paintWindow]
  );

  // One-click rigid assignment of the isolated piece to the
  // selected bone — the intended fix for boneless shells (tail,
  // eyes) where brushwork is the wrong tool.
  // Mirror painted weights across the sagittal plane — respects
  // piece isolation (mirrors within the selected piece only).
  const handleMirror = useCallback(
    (direction: "leftToRight" | "rightToLeft") => {
      if (!generated) return;
      const affected = mirrorWeights(generated.mesh, generated.weights, {
        direction,
        vertexWindow: paintWindow
      });
      if (affected.length > 0) {
        paintDirtyRef.current = true;
        setWeightsVersion((version) => version + 1);
      }
    },
    [generated, paintWindow]
  );

  const handleFillPiece = useCallback(() => {
    if (!generated || !paintWindow) return;
    fillVerticesWithBone(generated.weights, paintWindow, paintBoneColumn);
    paintDirtyRef.current = true;
    setWeightsVersion((version) => version + 1);
  }, [generated, paintWindow, paintBoneColumn]);

  return (
    <WizardDialog
      opened={opened}
      title="Character Wizard"
      steps={STEPS}
      activeStepId={step}
      canAdvance={canAdvance}
      canGoBack={!busy && step !== "import" && !(isEditMode && step === "joints")}
      busy={busy}
      busyLabel={busyLabel}
      busyProgress={busyProgress}
      finishLabel={isEditMode ? "Save changes" : "Add to project"}
      onBack={() => {
        setError(null);
        setStep(
          step === "preview"
            ? "weights"
            : step === "weights"
              ? "joints"
              : "import"
        );
      }}
      onNext={() => void handleNext()}
      onFinish={() => void handleFinish()}
      onCancel={handleCancel}
      cancelNeedsConfirm={sourceBytes !== null}
    >
      <Stack gap="md" mih={380}>
        {step === "import" ? (
          <Stack gap="md">
            <Text size="sm" c="var(--sm-color-subtext)">
              Pick a static humanoid character GLB — upright, facing
              forward, A-pose or T-pose. The wizard rigs it, binds the
              mesh, and attaches idle / walk / run so it is game-ready
              in one pass.
            </Text>
            <TextInput
              label="Character name"
              size="xs"
              value={characterName}
              disabled={isEditMode}
              onChange={(event) => setCharacterName(event.currentTarget.value)}
            />
            <Group>
              <input
                ref={fileInputRef}
                type="file"
                accept=".glb"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void handleFilePicked(file);
                  event.currentTarget.value = "";
                }}
              />
              <Text
                size="sm"
                fw={600}
                style={{ cursor: "pointer", color: "var(--sm-color-accent, #7aa2f7)" }}
                onClick={() => fileInputRef.current?.click()}
              >
                {sourceBytes ? "Pick a different GLB..." : "Pick a GLB..."}
              </Text>
              {sourceBytes ? (
                <Text size="xs" c="var(--sm-color-subtext)">
                  Model loaded — joints detected.
                </Text>
              ) : null}
            </Group>
          </Stack>
        ) : null}

        {step === "joints" && sourceUrl && landmarks ? (
          <Stack gap="xs" style={{ flex: 1 }}>
            <Group justify="space-between" align="center">
              <Text size="xs" c="var(--sm-color-subtext)">
                Drag any marker that missed its joint — hover names
                it. Right-drag to orbit, scroll to zoom.
              </Text>
              <Group gap="sm">
                <Switch
                  size="xs"
                  label="Has tail"
                  checked={hasTail}
                  onChange={(event) =>
                    toggleTail(event.currentTarget.checked)
                  }
                />
                <Switch
                  size="xs"
                  label="Mirror left/right"
                  checked={mirroring}
                  onChange={(event) =>
                    setMirroring(event.currentTarget.checked)
                  }
                />
              </Group>
            </Group>
            <Box style={{ height: 380 }}>
              <MarkerViewport
                key={hasTail ? "with-tail" : "no-tail"}
                modelUrl={sourceUrl}
                landmarks={landmarks}
                onChange={(next) => {
                  landmarksDirtyRef.current = true;
                  setLandmarks(next);
                }}
                mirroring={mirroring}
              />
            </Box>
          </Stack>
        ) : null}

        {step === "weights" && generated && paintModelUrl ? (
          <Stack gap="xs" style={{ flex: 1 }}>
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
              <SegmentedControl
                size="xs"
                data={[
                  { value: "add", label: "Add" },
                  { value: "subtract", label: "Subtract" },
                  { value: "smooth", label: "Smooth" },
                  { value: "fill", label: "Fill" }
                ]}
                value={brushMode}
                onChange={(value) => setBrushMode(value as BrushMode)}
              />
              <Box w={140}>
                <LabeledSlider
                  label="Radius"
                  min={0.01}
                  max={0.4}
                  step={0.005}
                  value={brushRadius}
                  onChange={setBrushRadius}
                />
              </Box>
              <Box w={140}>
                <LabeledSlider
                  label="Strength"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={brushStrength}
                  onChange={setBrushStrength}
                />
              </Box>
              <Select
                label="Piece"
                size="xs"
                w={150}
                data={pieceOptions}
                value={String(paintPiece)}
                onChange={(value) => {
                  if (value !== null) setPaintPiece(Number(value));
                }}
              />
              <Button
                size="compact-xs"
                variant="light"
                disabled={paintPiece < 0}
                onClick={handleFillPiece}
              >
                Fill piece with bone
              </Button>
              <Switch
                size="xs"
                label="Box select"
                checked={selectMode}
                onChange={(event) =>
                  setSelectMode(event.currentTarget.checked)
                }
              />
              {selectMode ? (
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
                    {`Assign ${selection.size || ""} to bone`}
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
                </>
              ) : null}
              <Switch
                size="xs"
                label="Animate"
                checked={paintAnimating}
                onChange={(event) =>
                  setPaintAnimating(event.currentTarget.checked)
                }
              />
              <Button
                size="compact-xs"
                variant="light"
                onClick={() => handleMirror("leftToRight")}
              >
                {"Mirror L > R"}
              </Button>
              <Button
                size="compact-xs"
                variant="light"
                onClick={() => handleMirror("rightToLeft")}
              >
                {"Mirror R > L"}
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() => {
                  const pristine = pristineWeightsRef.current;
                  if (!pristine || !generated) return;
                  generated.weights.joints.set(pristine.joints);
                  generated.weights.weights.set(pristine.weights);
                  paintDirtyRef.current = true;
                  setWeightsVersion((version) => version + 1);
                }}
              >
                Reset to auto
              </Button>
            </Group>
            <Text size="xs" c="var(--sm-color-subtext)">
              Heatmap shows the selected bone's influence. Left-drag
              paints, right-drag orbits, scroll zooms. Skip with Next
              if the automatic result is good enough.
            </Text>
            <Box style={{ height: 360 }}>
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
                weightsVersion={weightsVersion}
                selectMode={selectMode}
                xray={xray}
                selection={selection}
                onSelect={handleSelect}
                onPaint={handlePaint}
              />
            </Box>
          </Stack>
        ) : null}

        {step === "preview" && preview ? (
          <Box style={{ height: 400 }}>
            <CharacterPreview
              model={preview.model}
              targetHeight={generated?.characterHeight ?? 1.6}
              slots={preview.slots}
              activeSlot={previewSlot}
              onChangeActiveSlot={setPreviewSlot}
              isPlaying={previewPlaying}
              onChangePlaying={setPreviewPlaying}
              assetSources={preview.assetSources}
            />
          </Box>
        ) : null}

        {error ? (
          <Text size="xs" c="var(--sm-color-danger, #f7768e)">
            {error}
          </Text>
        ) : null}
      </Stack>
    </WizardDialog>
  );
}
