/**
 * packages/workspaces/src/design/animation-panel/AnimationPanel.tsx
 *
 * Purpose: Plan 063 §063.4 — the animation panel: per-slot
 * (idle/walk/run) source choice between a Studio GENERATOR
 * (personality sliders, live regenerate-and-preview) and the
 * vendored LIBRARY clip. Save commits clip GLBs through the io
 * clip path (deterministic ids — re-saves upsert) and rebinds the
 * slots via the caller. Reopening a generated slot restores its
 * sliders from the recipe stamped in the bound clip's GLB
 * (Memento, same pattern as the wizard's rig recipe).
 *
 * Preview reuses CharacterPreview with stub definitions + blob
 * asset sources for edited slots — what you approve is what you
 * get.
 *
 * Status: active
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Text
} from "@mantine/core";
import { LabeledSlider } from "@sugarmagic/ui";
import {
  createDefaultMotionRecipe,
  type CharacterAnimationDefinition,
  type CharacterModelDefinition,
  type MotionRecipe
} from "@sugarmagic/domain";
import { CharacterPreview, type CharacterPreviewSlot } from "../CharacterPreview";
import type { CharacterWizardServices } from "../character-wizard/CharacterWizard";

type Slot = "idle" | "walk" | "run";
const SLOTS: Slot[] = ["idle", "walk", "run"];

interface SlotState {
  source: "library" | "generated";
  recipe: MotionRecipe;
  /** Freshly generated (or library) clip pending save. */
  pending: { clipName: string; bytes: ArrayBuffer } | null;
  dirty: boolean;
}

export interface AnimationPanelProps {
  opened: boolean;
  /** Safe character name (asset paths derive from it). */
  characterName: string;
  model: CharacterModelDefinition;
  /** Currently bound animation definition per slot (if any). */
  boundAnimations: Partial<Record<Slot, CharacterAnimationDefinition>>;
  /** path -> blob URL map for the project's real assets. */
  assetSources: Record<string, string>;
  /** Preview scale — the player/NPC modelHeight. */
  targetHeight: number;
  services: CharacterWizardServices;
  onCommitted: (
    bindings: Array<{ slot: Slot; definition: CharacterAnimationDefinition }>
  ) => void;
  onClose: () => void;
}

const PERSONALITY_LABELS: Array<{
  key: keyof MotionRecipe["personality"];
  label: string;
  hint: string;
}> = [
  { key: "energy", label: "Energy", hint: "speed, arm swing" },
  { key: "bounce", label: "Bounce", hint: "vertical bob, hips" },
  { key: "curiosity", label: "Curiosity", hint: "head + torso motion" },
  { key: "fidgetiness", label: "Fidgetiness", hint: "variation, weight shifts" }
];

export function AnimationPanel(props: AnimationPanelProps) {
  const {
    opened,
    characterName,
    model,
    boundAnimations,
    assetSources,
    targetHeight,
    services,
    onCommitted,
    onClose
  } = props;
  const [previewPlaying, setPreviewPlaying] = useState(true);

  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<Slot>("idle");
  const [hipScale, setHipScale] = useState(1);
  const [slots, setSlots] = useState<Record<Slot, SlotState> | null>(null);
  const loadedRef = useRef(false);

  // Blob URL lifecycle — revoked when the panel closes.
  const blobUrlsRef = useRef<string[]>([]);
  const trackBlobUrl = useCallback((bytes: ArrayBuffer): string => {
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "model/gltf-binary" })
    );
    blobUrlsRef.current.push(url);
    return url;
  }, []);
  useEffect(() => {
    if (opened) return;
    for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
    blobUrlsRef.current = [];
    loadedRef.current = false;
    setSlots(null);
    setError(null);
  }, [opened]);

  // Bootstrap: hip scale from the model recipe + per-slot state
  // from each bound clip's stamped recipe (generated) or absence
  // of one (library).
  useEffect(() => {
    if (!opened || loadedRef.current) return;
    loadedRef.current = true;
    setBusy(true);
    setBusyLabel("Reading character...");
    void (async () => {
      try {
        const modelUrl = assetSources[model.source.relativeAssetPath];
        if (!modelUrl) throw new Error("Character model asset not loaded.");
        const riggedBytes = await (await fetch(modelUrl)).arrayBuffer();
        const prepared = await services.prepareAnimationPanel(riggedBytes);
        setHipScale(prepared.hipScale);
        const next = {} as Record<Slot, SlotState>;
        for (const slot of SLOTS) {
          let recipe = createDefaultMotionRecipe(slot);
          let source: SlotState["source"] = "library";
          const bound = boundAnimations[slot];
          const boundUrl = bound
            ? assetSources[bound.source.relativeAssetPath]
            : undefined;
          if (boundUrl) {
            const clipBytes = await (await fetch(boundUrl)).arrayBuffer();
            const stamped = services.readSlotRecipe(clipBytes);
            if (stamped) {
              recipe = stamped;
              source = "generated";
            }
          }
          next[slot] = { source, recipe, pending: null, dirty: false };
        }
        setSlots(next);
      } catch (bootError) {
        setError(
          bootError instanceof Error ? bootError.message : String(bootError)
        );
      } finally {
        setBusy(false);
      }
    })();
  }, [opened, assetSources, boundAnimations, model, services]);

  const active = slots?.[activeSlot] ?? null;

  // Regenerate the active slot's clip (debounced for slider drags).
  const regenerateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regenerate = useCallback(
    (slot: Slot, state: SlotState, immediate: boolean) => {
      if (regenerateTimer.current) clearTimeout(regenerateTimer.current);
      const run = () => {
        try {
          const pending = services.generateClip(state.recipe, hipScale);
          setSlots((current) =>
            current
              ? {
                  ...current,
                  [slot]: { ...current[slot], pending, dirty: true }
                }
              : current
          );
        } catch (generateError) {
          setError(
            generateError instanceof Error
              ? generateError.message
              : String(generateError)
          );
        }
      };
      if (immediate) run();
      else regenerateTimer.current = setTimeout(run, 180);
    },
    [services, hipScale]
  );

  const updateRecipe = useCallback(
    (patch: Partial<MotionRecipe["personality"]> | { seed: number }) => {
      setSlots((current) => {
        if (!current) return current;
        const state = current[activeSlot];
        const recipe: MotionRecipe =
          "seed" in patch
            ? { ...state.recipe, seed: patch.seed }
            : {
                ...state.recipe,
                personality: { ...state.recipe.personality, ...patch }
              };
        const next = {
          ...current,
          [activeSlot]: { ...state, recipe, source: "generated" as const }
        };
        regenerate(activeSlot, next[activeSlot], false);
        return next;
      });
    },
    [activeSlot, regenerate]
  );

  const chooseSource = useCallback(
    (source: SlotState["source"]) => {
      setSlots((current) => {
        if (!current) return current;
        const state = current[activeSlot];
        if (source === state.source && state.pending) return current;
        if (source === "generated") {
          const next = {
            ...current,
            [activeSlot]: { ...state, source, dirty: true }
          };
          regenerate(activeSlot, next[activeSlot], true);
          return next;
        }
        // Library: fetch async, mark dirty.
        void services
          .getLibraryClip(activeSlot, hipScale)
          .then((pending) =>
            setSlots((latest) =>
              latest
                ? {
                    ...latest,
                    [activeSlot]: {
                      ...latest[activeSlot],
                      source: "library",
                      pending,
                      dirty: true
                    }
                  }
                : latest
            )
          )
          .catch((libraryError) =>
            setError(
              libraryError instanceof Error
                ? libraryError.message
                : String(libraryError)
            )
          );
        return { ...current, [activeSlot]: { ...state, source } };
      });
    },
    [activeSlot, services, hipScale, regenerate]
  );

  // Preview: real definitions everywhere, blob stubs for slots
  // with pending clips.
  const preview = useMemo(() => {
    if (!slots) return null;
    const previewSources: Record<string, string> = { ...assetSources };
    const previewSlots: CharacterPreviewSlot[] = SLOTS.map((slot) => {
      const state = slots[slot];
      if (state.pending) {
        const path = `__animation-panel__/${slot}.glb`;
        previewSources[path] = trackBlobUrl(state.pending.bytes);
        return {
          value: slot,
          label: slot,
          animation: {
            definitionId: `__animation-panel__:${slot}`,
            definitionKind: "character-animation" as const,
            displayName: state.pending.clipName,
            source: {
              relativeAssetPath: path,
              fileName: `${slot}.glb`,
              mimeType: "model/gltf-binary"
            },
            clipNames: [state.pending.clipName]
          }
        };
      }
      return {
        value: slot,
        label: slot,
        animation: boundAnimations[slot] ?? null
      };
    });
    return { previewSlots, previewSources };
    // trackBlobUrl is stable; slots identity changes drive this.
  }, [slots, assetSources, boundAnimations, trackBlobUrl]);

  async function handleSave() {
    if (!slots) return;
    const changed = SLOTS.filter((slot) => slots[slot].dirty && slots[slot].pending);
    if (changed.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setBusyLabel("Writing animation clips...");
    try {
      const bindings = await services.commitAnimationSlots({
        characterName,
        clips: changed.map((slot) => ({
          slot,
          clipName: slots[slot].pending!.clipName,
          bytes: slots[slot].pending!.bytes
        }))
      });
      onCommitted(bindings);
      onClose();
    } catch (commitError) {
      setError(
        commitError instanceof Error ? commitError.message : String(commitError)
      );
      setBusy(false);
    }
  }

  const dirtyCount = slots
    ? SLOTS.filter((slot) => slots[slot].dirty && slots[slot].pending).length
    : 0;

  return (
    <Modal
      opened={opened}
      onClose={busy ? () => {} : onClose}
      title="Animations"
      size="xl"
      centered
    >
      <Stack gap="sm">
        {error ? (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        ) : null}
        {!slots ? (
          <Group justify="center" p="xl">
            <Loader size="sm" />
            <Text size="sm">{busyLabel || "Loading..."}</Text>
          </Group>
        ) : (
          <>
            <Group gap="sm" align="flex-end" wrap="wrap">
              <SegmentedControl
                size="xs"
                data={SLOTS.map((slot) => ({
                  value: slot,
                  label:
                    slot + (slots[slot].dirty && slots[slot].pending ? " *" : "")
                }))}
                value={activeSlot}
                onChange={(value) => setActiveSlot(value as Slot)}
              />
              <SegmentedControl
                size="xs"
                data={[
                  { value: "generated", label: "Generated" },
                  { value: "library", label: "Library clip" }
                ]}
                value={active?.source ?? "library"}
                onChange={(value) =>
                  chooseSource(value as SlotState["source"])
                }
              />
              {active?.source === "generated" ? (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() =>
                    updateRecipe({ seed: (active.recipe.seed % 9973) + 1 })
                  }
                >
                  Reroll variation
                </Button>
              ) : null}
            </Group>

            {active?.source === "generated" ? (
              <Group gap="md" wrap="wrap">
                {PERSONALITY_LABELS.map((entry) => (
                  <Box key={entry.key} w={170}>
                    <LabeledSlider
                      label={`${entry.label}`}
                      min={0}
                      max={1}
                      step={0.05}
                      value={active.recipe.personality[entry.key]}
                      onChange={(value) => updateRecipe({ [entry.key]: value })}
                    />
                    <Text size="xs" c="var(--sm-color-subtext)">
                      {entry.hint}
                    </Text>
                  </Box>
                ))}
              </Group>
            ) : (
              <Text size="xs" c="var(--sm-color-subtext)">
                The vendored library clip for this slot. Switch to
                Generated for personality sliders.
              </Text>
            )}

            {preview ? (
              <Box style={{ height: 380 }}>
                <CharacterPreview
                  model={model}
                  targetHeight={targetHeight}
                  slots={preview.previewSlots}
                  activeSlot={activeSlot}
                  onChangeActiveSlot={(slot) => {
                    if (slot) setActiveSlot(slot as Slot);
                  }}
                  isPlaying={previewPlaying}
                  onChangePlaying={setPreviewPlaying}
                  assetSources={preview.previewSources}
                />
              </Box>
            ) : null}

            <Group justify="flex-end">
              <Button variant="subtle" color="gray" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} loading={busy} disabled={dirtyCount === 0}>
                {dirtyCount > 0 ? `Save ${dirtyCount} slot${dirtyCount === 1 ? "" : "s"}` : "Save"}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
