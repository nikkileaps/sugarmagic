/**
 * packages/workspaces/src/design/character-wizard/CharacterWizard.tsx
 *
 * Purpose: Plan 062 §062.6 — the Character Wizard modal: import a
 * static A/T-pose humanoid GLB, confirm/adjust the 16 detected
 * joint markers, then Finish generates (rig + bind + clips) and
 * commits in one motion — weight tooling lives in the workspace's
 * WeightWorkbench (Plan 064 UX rework), not here. Old flow:
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
  Stack,
  Switch,
  Text,
  TextInput
} from "@mantine/core";
import { WizardDialog } from "@sugarmagic/ui";
import type {
  CharacterAnimationDefinition,
  CharacterModelDefinition,
  MotionRecipe
} from "@sugarmagic/domain";
import type {
  GeneratedSkeleton,
  MeshData,
  SkinWeights
} from "@sugarmagic/character-rig";
import { MarkerViewport } from "./MarkerViewport";
import type { WeightPaintRange } from "./WeightPaintViewport";

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

type WizardStep = "import" | "joints";

const STEPS = [
  { id: "import", label: "Import", description: "Pick a GLB" },
  { id: "joints", label: "Joints", description: "Confirm markers" }
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
        landmarksDirtyRef.current = false;
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
    if (step === "import") setStep("joints");
  }

  // Joints is the LAST step (Plan 064 UX rework): Finish runs the
  // solve and commits in one motion — the user lands back in the
  // workspace with a fully rigged character, and all weight
  // tooling lives in the WeightWorkbench there.
  async function handleFinish() {
    if (!sourceBytes || !landmarks) return;
    if (isEditMode && !landmarksDirtyRef.current) {
      // Markers untouched: nothing to save.
      reset();
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setBusyLabel("Generating rig + binding weights...");
      setBusyProgress(0);
      const result = await services.generate(sourceBytes, landmarks, (f) =>
        setBusyProgress(f)
      );
      setBusyLabel("Writing character assets...");
      setBusyProgress(undefined);
      if (isEditMode) {
        const committed = await services.commitEdit({
          characterName,
          sourceBytes,
          landmarks,
          generated: result,
          skipAnimations: false,
          boundClips: editSession?.boundClips
        });
        onCommitted(committed);
      } else {
        const committed = await services.commit({
          characterName,
          sourceBytes,
          landmarks,
          generated: result
        });
        onCommitted(committed);
      }
      reset();
      onClose();
    } catch (finishError) {
      setError(
        finishError instanceof Error ? finishError.message : String(finishError)
      );
      setBusy(false);
      setBusyProgress(undefined);
    }
  }

  const canAdvance =
    !busy &&
    (step === "import"
      ? sourceBytes !== null && characterName.trim().length > 0
      : landmarks !== null);

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
        setStep("import");
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


      </Stack>
    </WizardDialog>
  );
}
