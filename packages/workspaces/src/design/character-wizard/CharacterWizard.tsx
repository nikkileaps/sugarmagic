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

import { useCallback, useMemo, useRef, useState } from "react";
import { Box, Group, Stack, Text, TextInput } from "@mantine/core";
import { WizardDialog } from "@sugarmagic/ui";
import type {
  CharacterAnimationDefinition,
  CharacterModelDefinition
} from "@sugarmagic/domain";
import { CharacterPreview } from "../CharacterPreview";
import { MarkerViewport } from "./MarkerViewport";

/** The wizard's 16 landmarks: name -> world position. */
export type WizardLandmarks = Record<string, [number, number, number]>;

export interface WizardGenerated {
  /** The skinned model GLB (source + rig + weights). */
  modelGlb: ArrayBuffer;
  /** Per-slot clip bytes, hips-scaled for this character. */
  clips: Array<{ slot: "idle" | "walk" | "run"; clipName: string; bytes: ArrayBuffer }>;
  /** Mesh height in meters — the preview's scale reference. */
  characterHeight: number;
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
  /** Write assets + return definitions (io commit, §062.4). */
  commit(request: {
    characterName: string;
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

type WizardStep = "import" | "joints" | "preview";

const STEPS = [
  { id: "import", label: "Import", description: "Pick a GLB" },
  { id: "joints", label: "Joints", description: "Confirm markers" },
  { id: "preview", label: "Preview", description: "Watch it move" }
];

export function CharacterWizard(props: CharacterWizardProps) {
  const { opened, defaultCharacterName, services, onCommitted, onClose } = props;
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
    if (step === "joints") {
      if (!sourceBytes || !landmarks) return;
      setBusy(true);
      setBusyLabel("Generating rig + binding weights...");
      setBusyProgress(0);
      try {
        const result = await services.generate(sourceBytes, landmarks, (f) =>
          setBusyProgress(f)
        );
        setGenerated(result);
        setStep("preview");
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
    if (!generated) return;
    setBusy(true);
    setBusyLabel("Writing character assets...");
    setBusyProgress(undefined);
    try {
      const result = await services.commit({ characterName, generated });
      onCommitted(result);
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

  return (
    <WizardDialog
      opened={opened}
      title="Character Wizard"
      steps={STEPS}
      activeStepId={step}
      canAdvance={canAdvance}
      canGoBack={!busy && step !== "import"}
      busy={busy}
      busyLabel={busyLabel}
      busyProgress={busyProgress}
      finishLabel="Add to project"
      onBack={() => {
        setError(null);
        setStep(step === "preview" ? "joints" : "import");
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
            <Text size="xs" c="var(--sm-color-subtext)">
              Drag any marker that missed its joint. Right-drag to
              orbit, scroll to zoom.
            </Text>
            <Box style={{ height: 380 }}>
              <MarkerViewport
                modelUrl={sourceUrl}
                landmarks={landmarks}
                onChange={setLandmarks}
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
