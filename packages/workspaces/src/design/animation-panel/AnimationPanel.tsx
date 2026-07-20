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
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Loader,
  Menu,
  ScrollArea,
  Stack,
  Switch,
  Text,
  Tooltip
} from "@mantine/core";
import {
  CurveEditor,
  LabeledSlider,
  PanelSection,
  ToolOptionsBar,
  ToolRail
} from "@sugarmagic/ui";
import {
  createDefaultMotionRecipe,
  type AnimationLibraryDefinition,
  type CharacterAnimationDefinition,
  type CharacterModelDefinition,
  type MotionRecipe
} from "@sugarmagic/domain";
import { evaluateOverrideCurve } from "@sugarmagic/character-rig";
import { Select } from "@mantine/core";
import { CharacterPreview, type CharacterPreviewSlot } from "../CharacterPreview";
import { AnimationLibraryBrowser } from "./AnimationLibraryBrowser";
import { PoseViewport } from "./PoseViewport";
import type { CharacterWizardServices } from "../character-wizard/CharacterWizard";

export type Slot = "idle" | "walk" | "run";
const SLOTS: Slot[] = ["idle", "walk", "run"];

interface SlotState {
  source: "library" | "generated";
  recipe: MotionRecipe;
  /** Freshly generated (or library) clip pending save. */
  pending: { clipName: string; bytes: ArrayBuffer } | null;
  dirty: boolean;
}

export interface AnimationPanelProps {
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
  /** Library entries available for direct slot assignment. */
  animationLibraryDefinitions: AnimationLibraryDefinition[];
  onCommitted: (
    bindings: Array<{ slot: Slot; definition: CharacterAnimationDefinition }>
  ) => void;
  /** Called immediately when the user picks a library clip (bypasses the save flow). */
  onAssignFromLibrary: (slot: Slot, definitionId: string) => void;
  /** Called immediately when the user clears a slot binding. */
  onClearSlot: (slot: Slot) => void;
  onClose: () => void;
  /** Switch to the weight workbench (the bone tab). */
  onSwitchToRig: () => void;
}

/** §063.6 — editable semantic curves per generator. L/R-paired
 *  locomotion channels are deliberately absent (editing one side
 *  breaks gait symmetry; that is DCC territory). */
const EDITABLE_CHANNELS: Record<string, Array<{ value: string; label: string }>> = {
  idle: [
    { value: "breathing", label: "Breathing" },
    { value: "weightShift", label: "Weight Shift" },
    { value: "headTurn", label: "Head Motion" },
    { value: "armDrift", label: "Arm Drift" },
    { value: "bounce", label: "Bounce" }
  ],
  walk: [
    { value: "weightShift", label: "Weight Shift" },
    { value: "hipTwist", label: "Hip Twist" },
    { value: "torsoLean", label: "Torso Lean" },
    { value: "bounce", label: "Bounce" }
  ],
  run: [
    { value: "weightShift", label: "Weight Shift" },
    { value: "hipTwist", label: "Hip Twist" },
    { value: "torsoLean", label: "Torso Lean" },
    { value: "bounce", label: "Bounce" }
  ]
};

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
    characterName,
    model,
    boundAnimations,
    assetSources,
    targetHeight,
    services,
    animationLibraryDefinitions,
    onCommitted,
    onAssignFromLibrary,
    onClearSlot,
    onClose,
    onSwitchToRig
  } = props;
  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [libBrowserSlot, setLibBrowserSlot] = useState<Slot | null>(null);
  // §063.5 pose adjust mode.
  const [poseMode, setPoseMode] = useState(false);
  // §063.6 curve editing.
  const [curveMode, setCurveMode] = useState(false);
  const [curveChannel, setCurveChannel] = useState("breathing");
  const [poseMirroring, setPoseMirroring] = useState(true);
  const [relaxedPose, setRelaxedPose] = useState<Readonly<
    Record<string, readonly number[]>
  > | null>(null);
  const [modelBlobUrl, setModelBlobUrl] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<Slot>("idle");
  const [hipScale, setHipScale] = useState(1);
  const [hasTail, setHasTail] = useState(false);
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
  useEffect(
    () => () => {
      for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
    },
    []
  );

  // Bootstrap: hip scale from the model recipe + per-slot state
  // from each bound clip's stamped recipe (generated) or absence
  // of one (library).
  useEffect(() => {
    if (loadedRef.current) return;
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
        setHasTail(prepared.hasTail);
        setRelaxedPose(prepared.relaxedPose);
        setModelBlobUrl(trackBlobUrl(riggedBytes));
        const next = {} as Record<Slot, SlotState>;
        for (const slot of SLOTS) {
          let recipe = createDefaultMotionRecipe(slot);
          let source: SlotState["source"] = "library";
          const bound = boundAnimations[slot];
          const boundUrl = bound
            ? assetSources[bound.source.relativeAssetPath]
            : undefined;
          let pending: SlotState["pending"] = null;
          let dirty = false;
          if (boundUrl) {
            const clipBytes = await (await fetch(boundUrl)).arrayBuffer();
            const stamped = services.readSlotRecipe(clipBytes);
            if (stamped) {
              recipe = stamped;
              source = "generated";
              // Regenerate through the CURRENT engine and compare:
              // generator/base-pose improvements land automatically
              // as a dirty slot instead of being trapped in stale
              // files (the six-hour-old-idle bug, 2026-07-08).
              const fresh = services.generateClip(
                recipe,
                prepared.hipScale,
                prepared.hasTail
              );
              const freshBytes = new Uint8Array(fresh.bytes);
              const boundBytes = new Uint8Array(clipBytes);
              let differs = freshBytes.length !== boundBytes.length;
              if (!differs) {
                for (let i = 0; i < freshBytes.length; i += 1) {
                  if (freshBytes[i] !== boundBytes[i]) {
                    differs = true;
                    break;
                  }
                }
              }
              if (differs) {
                pending = fresh;
                dirty = true;
              }
            }
          }
          next[slot] = { source, recipe, pending, dirty };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = slots?.[activeSlot] ?? null;

  // Regenerate the active slot's clip (debounced for slider drags).
  const regenerateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regenerate = useCallback(
    (slot: Slot, state: SlotState, immediate: boolean) => {
      if (regenerateTimer.current) clearTimeout(regenerateTimer.current);
      const run = () => {
        try {
          const pending = services.generateClip(state.recipe, hipScale, hasTail);
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
    [services, hipScale, hasTail]
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

  // §063.5 — a pose edit applies to every slot's recipe (the pose
  // is a property of the character's stance, not of one clip) and
  // regenerates whatever is currently generated.
  const handlePoseChange = useCallback(
    (overrides: Record<string, [number, number, number, number]>) => {
      setSlots((current) => {
        if (!current) return current;
        const next = { ...current };
        for (const slot of SLOTS) {
          const state = next[slot];
          const recipe: MotionRecipe = {
            ...state.recipe,
            basePoseOverrides: overrides
          };
          next[slot] = { ...state, recipe };
          if (state.source === "generated") {
            regenerate(slot, next[slot], true);
          }
        }
        return next;
      });
    },
    [regenerate]
  );

  const editableChannels = useMemo(() => {
    if (!active) return EDITABLE_CHANNELS.idle!;
    const base =
      EDITABLE_CHANNELS[active.recipe.generatorId] ?? EDITABLE_CHANNELS.idle!;
    return hasTail
      ? [...base, { value: "tailSway1", label: "Tail" }]
      : base;
  }, [active, hasTail]);

  // §063.6 — current points for the edited channel: the override
  // if present, else a sampled snapshot of the generated signal.
  const curvePoints = useMemo(() => {
    if (!active || active.source !== "generated") return null;
    const override = active.recipe.curveOverrides?.[curveChannel];
    if (override && override.length >= 2) return override;
    return services.sampleChannel(active.recipe, curveChannel, 8);
  }, [active, curveChannel, services]);
  const curveRange = useMemo(() => {
    if (!curvePoints) return { min: -0.1, max: 0.1 };
    let magnitude = 0.02;
    for (const point of curvePoints) {
      magnitude = Math.max(magnitude, Math.abs(point.y) * 1.6);
    }
    return { min: -magnitude, max: magnitude };
  }, [curvePoints]);

  const handleCurveChange = useCallback(
    (points: Array<{ x: number; y: number }>) => {
      setSlots((current) => {
        if (!current) return current;
        const state = current[activeSlot];
        const recipe: MotionRecipe = {
          ...state.recipe,
          curveOverrides: {
            ...state.recipe.curveOverrides,
            [curveChannel]: points
          }
        };
        const next = { ...current, [activeSlot]: { ...state, recipe } };
        regenerate(activeSlot, next[activeSlot], false);
        return next;
      });
    },
    [activeSlot, curveChannel, regenerate]
  );
  const handleCurveReset = useCallback(() => {
    setSlots((current) => {
      if (!current) return current;
      const state = current[activeSlot];
      const overrides = { ...state.recipe.curveOverrides };
      delete overrides[curveChannel];
      const recipe: MotionRecipe = { ...state.recipe, curveOverrides: overrides };
      const next = { ...current, [activeSlot]: { ...state, recipe } };
      regenerate(activeSlot, next[activeSlot], true);
      return next;
    });
  }, [activeSlot, curveChannel, regenerate]);

  const chooseSource = useCallback(
    (slot: Slot, source: SlotState["source"]) => {
      setSlots((current) => {
        if (!current) return current;
        const state = current[slot];
        if (source === state.source && state.pending) return current;
        if (source === "generated") {
          const next = {
            ...current,
            [slot]: { ...state, source, dirty: true }
          };
          regenerate(slot, next[slot], true);
          return next;
        }
        // Library: fetch async, mark dirty.
        void services
          .getLibraryClip(
            slot,
            hipScale,
            hasTail
              ? {
                  personality: state.recipe.personality,
                  seed: state.recipe.seed
                }
              : null
          )
          .then((pending) =>
            setSlots((latest) =>
              latest
                ? {
                    ...latest,
                    [slot]: {
                      ...latest[slot],
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
        return { ...current, [slot]: { ...state, source } };
      });
    },
    [services, hipScale, hasTail, regenerate]
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
      <Tooltip label="Weights + rig">
        <ActionIcon
          variant="subtle"
          color="grape"
          onClick={onSwitchToRig}
          aria-label="Switch to the weight workbench"
        >
          🦴
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Animations (active)">
        <ActionIcon variant="filled" color="cyan" onClick={onClose} aria-label="Exit animation mode">
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
      {!slots ? (
        <Group justify="center" p="xl">
          <Loader size="sm" />
          <Text size="sm">{busyLabel || "Loading..."}</Text>
        </Group>
      ) : (
        <>
          <Group gap="sm" align="center" wrap="nowrap">
            {modeTabs}
            <Box style={{ flex: 1 }} />
            <Button
              onClick={() => void handleSave()}
              loading={busy}
              disabled={dirtyCount === 0}
              size="compact-sm"
            >
              {dirtyCount > 0
                ? `Save ${dirtyCount} slot${dirtyCount === 1 ? "" : "s"}`
                : "Save"}
            </Button>
          </Group>
          <Group gap="xs" align="stretch" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
            {/* Properties column (Blender-style). */}
            <ScrollArea w={250} style={{ flexShrink: 0 }}>
              <Stack gap="xs" pr={6}>
                <PanelSection title="Animations" icon="✨" defaultOpen>
                  <Stack gap={2}>
                    {SLOTS.map((slot) => (
                      <Group key={slot} gap={4} wrap="nowrap">
                        <Button
                          size="compact-xs"
                          fullWidth
                          justify="flex-start"
                          style={{ flex: 1 }}
                          styles={{
                            root: { height: "auto", paddingTop: 2, paddingBottom: 2 },
                            label: { flexDirection: "column", alignItems: "flex-start" }
                          }}
                          variant={activeSlot === slot ? "light" : "subtle"}
                          color={activeSlot === slot ? "blue" : "gray"}
                          onClick={() => setActiveSlot(slot)}
                        >
                          <span>
                            {slot}
                            {slots[slot].dirty && slots[slot].pending ? " *" : ""}
                          </span>
                          <Text
                            size="xs"
                            c="var(--sm-color-subtext)"
                            style={{ fontSize: 10, lineHeight: 1.2 }}
                          >
                            {slots[slot].dirty && slots[slot].pending
                              ? `${slots[slot].pending.clipName} (unsaved)`
                              : (boundAnimations[slot]?.clipNames?.[0] ??
                                "none bound")}
                          </Text>
                        </Button>
                        <Menu shadow="md" width={180} position="bottom-end">
                          <Menu.Target>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="gray"
                              aria-label={`${slot} slot options`}
                            >
                              ...
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item
                              onClick={() => {
                                setActiveSlot(slot);
                                setLibBrowserSlot(slot);
                              }}
                            >
                              Replace from Library...
                            </Menu.Item>
                            <Menu.Item
                              color="red"
                              onClick={() => onClearSlot(slot)}
                            >
                              Clear
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    ))}
                  </Stack>
                </PanelSection>
                {active?.source === "generated" ? (
                  <PanelSection title="Personality" icon="🎭" defaultOpen>
                    <Stack gap={6}>
                      {PERSONALITY_LABELS.map((entry) => (
                        <Box key={entry.key}>
                          <LabeledSlider
                            label={entry.label}
                            min={0}
                            max={1}
                            step={0.05}
                            value={active.recipe.personality[entry.key]}
                            onChange={(value) =>
                              updateRecipe({ [entry.key]: value })
                            }
                          />
                          <Text size="xs" c="var(--sm-color-subtext)">
                            {entry.hint}
                          </Text>
                        </Box>
                      ))}
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        onClick={() =>
                          updateRecipe({ seed: (active.recipe.seed % 9973) + 1 })
                        }
                      >
                        Reroll variation
                      </Button>
                    </Stack>
                  </PanelSection>
                ) : null}
                {active?.source === "generated" ? (
                  <PanelSection title="Curves" icon="📈" defaultOpen={false}>
                    <Stack gap={6}>
                      <Switch
                        size="xs"
                        label="Edit curves"
                        checked={curveMode}
                        onChange={(event) =>
                          setCurveMode(event.currentTarget.checked)
                        }
                      />
                      {curveMode ? (
                        <>
                          <Select
                            size="xs"
                            data={editableChannels}
                            value={curveChannel}
                            onChange={(value) => {
                              if (value) setCurveChannel(value);
                            }}
                          />
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            color="gray"
                            onClick={handleCurveReset}
                          >
                            Reset curve
                          </Button>
                          <Text size="xs" c="var(--sm-color-subtext)">
                            Drag points; double-click adds or removes.
                            Ends wrap.
                          </Text>
                        </>
                      ) : null}
                    </Stack>
                  </PanelSection>
                ) : null}
              </Stack>
            </ScrollArea>
            {/* Center: preview / pose viewport + optional curve strip. */}
            <Stack gap="xs" style={{ flex: 1, minHeight: 0 }}>
              <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
                <ToolRail
                  tools={[
                    { id: "orbit", icon: "🎥", label: "Orbit / watch" },
                    {
                      id: "pose",
                      icon: "🤸",
                      label: "Adjust pose (puppet handles)",
                      color: "grape"
                    }
                  ]}
                  activeToolId={poseMode ? "pose" : "orbit"}
                  onSelect={(toolId) => setPoseMode(toolId === "pose")}
                />
                {poseMode ? (
                  <ToolOptionsBar>
                    <Switch
                      size="xs"
                      label="Mirror"
                      checked={poseMirroring}
                      onChange={(event) =>
                        setPoseMirroring(event.currentTarget.checked)
                      }
                    />
                    <Text size="xs" c="var(--sm-color-subtext)">
                      Drag a handle (wrists, head, chest, tail);
                      applies to all generated slots.
                    </Text>
                  </ToolOptionsBar>
                ) : null}
                {poseMode && modelBlobUrl && relaxedPose ? (
                  <PoseViewport
                    modelUrl={modelBlobUrl}
                    relaxedPose={relaxedPose}
                    overrides={
                      (slots[activeSlot].recipe.basePoseOverrides ?? {}) as Record<
                        string,
                        [number, number, number, number]
                      >
                    }
                    mirroring={poseMirroring}
                    onChange={handlePoseChange}
                  />
                ) : preview ? (
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
                ) : null}
              </Box>
              {curveMode && !poseMode && active?.source === "generated" && curvePoints ? (
                <Box>
                  <CurveEditor
                    points={[...curvePoints]}
                    yMin={curveRange.min}
                    yMax={curveRange.max}
                    onChange={handleCurveChange}
                    evaluate={(pts, phase) => evaluateOverrideCurve(pts, phase)}
                  />
                </Box>
              ) : null}
            </Stack>
          </Group>
          <AnimationLibraryBrowser
            opened={libBrowserSlot !== null}
            animationLibraryDefinitions={animationLibraryDefinitions}
            onSelect={(definitionId) => {
              if (libBrowserSlot) onAssignFromLibrary(libBrowserSlot, definitionId);
              setLibBrowserSlot(null);
            }}
            onClose={() => setLibBrowserSlot(null)}
          />
        </>
      )}
    </Stack>
  );
}
