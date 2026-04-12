/**
 * packages/runtime-core/src/debug-hud/DebugHud.ts
 *
 * Purpose: Renders the Preview-only runtime debug HUD and owns the single debug billboard controller.
 *
 * Exports:
 *   - RuntimeDebugHud
 *   - createRuntimeDebugHud
 *
 * Relationships:
 *   - Depends on runtime-core plugin debug contracts as the single card/billboard extension surface.
 *   - Reads runtime snapshots from gameplay-session but does not own gameplay truth.
 *
 * Status: active
 */

import type { RuntimeBootModel } from "../index";
import type { World } from "../ecs";
import type { RuntimeBlackboard } from "../state";
import type {
  DebugHudCardContext,
  DebugHudCardContribution,
  DebugHudGameplaySessionSnapshot,
  DebugHudRendererStats
} from "../plugins";

const FPS_SAMPLE_SIZE = 60;
const ACTIVE_CARD_REFRESH_INTERVAL_SECONDS = 1;

interface RuntimeDebugHudOptions {
  parent: HTMLElement;
  ownerWindow?: Window;
  boot: RuntimeBootModel;
  world: World;
  blackboard: RuntimeBlackboard;
  pluginCards?: DebugHudCardContribution[];
  getRendererStats: () => Omit<DebugHudRendererStats, "fps" | "frameTimeMs">;
  getGameplaySessionSnapshot: () => DebugHudGameplaySessionSnapshot;
  setDebugBillboardsEnabled: (enabled: boolean) => void;
  refreshDebugBillboards: () => void;
}

export interface RuntimeDebugHud {
  update: (deltaSeconds: number) => void;
  dispose: () => void;
}

interface HudCardRuntime {
  readonly cardId: string;
  readonly displayName: string;
  readonly tabButton: HTMLButtonElement;
  readonly panel: HTMLDivElement;
  readonly renderCard: (container: HTMLElement, context: DebugHudCardContext) => void;
  readonly updateCard?: (context: DebugHudCardContext) => void;
  readonly disposeCard?: () => void;
  rendered: boolean;
}

export function createRuntimeDebugHud(
  options: RuntimeDebugHudOptions
): RuntimeDebugHud {
  injectStyles(options.ownerWindow?.document ?? document);

  const ownerWindow = options.ownerWindow ?? window;
  const root = ownerWindow.document.createElement("div");
  root.className = "sm-debug-hud";

  const toggleButton = ownerWindow.document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "sm-debug-hud__toggle";
  toggleButton.setAttribute("aria-label", "Toggle debug HUD");
  toggleButton.textContent = "\uD83D\uDC1B";

  const panel = ownerWindow.document.createElement("div");
  panel.className = "sm-debug-hud__panel";

  const header = ownerWindow.document.createElement("div");
  header.className = "sm-debug-hud__header";

  const title = ownerWindow.document.createElement("div");
  title.className = "sm-debug-hud__title";
  title.textContent = "Debug HUD";

  const controls = ownerWindow.document.createElement("div");
  controls.className = "sm-debug-hud__controls";

  const billboardsButton = ownerWindow.document.createElement("button");
  billboardsButton.type = "button";
  billboardsButton.className = "sm-debug-hud__pill";
  billboardsButton.textContent = "Labels On";

  controls.appendChild(billboardsButton);
  header.append(title, controls);

  const tabs = ownerWindow.document.createElement("div");
  tabs.className = "sm-debug-hud__tabs";

  const body = ownerWindow.document.createElement("div");
  body.className = "sm-debug-hud__body";

  panel.append(header, tabs, body);
  root.append(toggleButton, panel);
  options.parent.appendChild(root);

  const frameTimeSamples: number[] = [];
  let hudOpen = false;
  let debugBillboardsEnabled = true;
  let selectedCardIndex = 0;
  let dialogueActive = false;
  let activeCardRefreshElapsed = ACTIVE_CARD_REFRESH_INTERVAL_SECONDS;
  let lastDeltaSeconds = 1 / 60;

  const rendererCard = createRendererCard(ownerWindow.document);
  const worldCard = createWorldCard(ownerWindow.document);
  const cardRuntimes: HudCardRuntime[] = [
    {
      cardId: "renderer",
      displayName: "Renderer",
      tabButton: ownerWindow.document.createElement("button"),
      panel: rendererCard.panel,
      renderCard(container) {
        container.appendChild(rendererCard.content);
      },
      updateCard(context) {
        rendererCard.update(context);
      },
      rendered: false
    },
    {
      cardId: "world",
      displayName: "World",
      tabButton: ownerWindow.document.createElement("button"),
      panel: worldCard.panel,
      renderCard(container) {
        container.appendChild(worldCard.content);
      },
      updateCard(context) {
        worldCard.update(context);
      },
      rendered: false
    },
    ...((options.pluginCards ?? []).map((contribution) => ({
      cardId: contribution.payload.cardId,
      displayName: contribution.displayName,
      tabButton: ownerWindow.document.createElement("button"),
      panel: ownerWindow.document.createElement("div"),
      renderCard: contribution.payload.renderCard,
      updateCard: contribution.payload.updateCard,
      disposeCard: contribution.payload.disposeCard,
      rendered: false
    } satisfies HudCardRuntime)))
  ];

  for (const [index, card] of cardRuntimes.entries()) {
    card.tabButton.type = "button";
    card.tabButton.className = "sm-debug-hud__tab";
    card.tabButton.textContent = card.displayName;
    card.tabButton.addEventListener("click", () => {
      setSelectedCard(index, true);
    });

    card.panel.classList.add("sm-debug-hud__card");
    tabs.appendChild(card.tabButton);
    body.appendChild(card.panel);
  }

  toggleButton.addEventListener("click", () => {
    if (dialogueActive) {
      return;
    }
    setHudOpen(!hudOpen);
  });
  billboardsButton.addEventListener("click", () => {
    debugBillboardsEnabled = !debugBillboardsEnabled;
    billboardsButton.textContent = debugBillboardsEnabled ? "Labels On" : "Labels Off";
    syncDebugBillboardVisibility();
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (dialogueActive) {
      return;
    }
    if (event.code !== "F3" && event.code !== "Backquote") {
      return;
    }
    event.preventDefault();
    setHudOpen(!hudOpen);
  };
  ownerWindow.addEventListener("keydown", handleKeyDown);

  function buildContext(deltaSeconds: number): DebugHudCardContext {
    lastDeltaSeconds = deltaSeconds;
    if (frameTimeSamples.length >= FPS_SAMPLE_SIZE) {
      frameTimeSamples.shift();
    }
    frameTimeSamples.push(deltaSeconds * 1000);
    const averageFrameTimeMs =
      frameTimeSamples.reduce((sum, sample) => sum + sample, 0) /
      Math.max(frameTimeSamples.length, 1);
    const baseRendererStats = options.getRendererStats();
    return {
      world: options.world,
      boot: options.boot,
      blackboard: options.blackboard,
      rendererStats: {
        fps: averageFrameTimeMs > 0 ? 1000 / averageFrameTimeMs : 0,
        frameTimeMs: averageFrameTimeMs,
        ...baseRendererStats
      },
      gameplaySession: options.getGameplaySessionSnapshot()
    };
  }

  function ensureCardRendered(card: HudCardRuntime, context: DebugHudCardContext) {
    if (card.rendered) {
      return;
    }
    card.renderCard(card.panel, context);
    card.rendered = true;
  }

  function refreshActiveCard(context: DebugHudCardContext, force = false) {
    const card = cardRuntimes[selectedCardIndex] ?? null;
    if (!card) {
      return;
    }
    ensureCardRendered(card, context);
    if (force || card.updateCard) {
      card.updateCard?.(context);
    }
  }

  function setSelectedCard(index: number, forceRefresh = false) {
    selectedCardIndex = Math.max(0, Math.min(index, cardRuntimes.length - 1));
    const context = buildContext(lastDeltaSeconds);
    for (const [cardIndex, card] of cardRuntimes.entries()) {
      const active = cardIndex === selectedCardIndex;
      card.tabButton.classList.toggle("is-active", active);
      card.panel.classList.toggle("is-active", active);
      if (active) {
        ensureCardRendered(card, context);
      }
    }
    if (hudOpen) {
      refreshActiveCard(context, forceRefresh);
    }
  }

  function syncDebugBillboardVisibility() {
    options.setDebugBillboardsEnabled(hudOpen && debugBillboardsEnabled);
  }

  function setHudOpen(nextOpen: boolean) {
    hudOpen = nextOpen;
    root.classList.toggle("is-open", hudOpen);
    syncDebugBillboardVisibility();
    if (hudOpen) {
      setSelectedCard(selectedCardIndex, true);
      options.refreshDebugBillboards();
    }
  }

  function syncDialogueState(active: boolean) {
    dialogueActive = active;
    root.classList.toggle("sm-debug-hud--dialogue-active", dialogueActive);
  }

  setSelectedCard(0);
  syncDebugBillboardVisibility();

  return {
    update(deltaSeconds) {
      lastDeltaSeconds = deltaSeconds;
      const gameplaySessionSnapshot = options.getGameplaySessionSnapshot();
      syncDialogueState(gameplaySessionSnapshot.dialogueActive);

      if (!hudOpen) {
        return;
      }

      const context = buildContext(deltaSeconds);
      const activeCard = cardRuntimes[selectedCardIndex] ?? null;
      if (!activeCard) {
        return;
      }

      if (activeCard.cardId === "renderer") {
        refreshActiveCard(context, true);
      }

      activeCardRefreshElapsed += deltaSeconds;
      if (activeCardRefreshElapsed < ACTIVE_CARD_REFRESH_INTERVAL_SECONDS) {
        return;
      }

      activeCardRefreshElapsed = 0;
      if (activeCard.cardId !== "renderer") {
        refreshActiveCard(context, true);
      }
      if (debugBillboardsEnabled) {
        options.refreshDebugBillboards();
      }
    },
    dispose() {
      ownerWindow.removeEventListener("keydown", handleKeyDown);
      for (const card of cardRuntimes) {
        card.disposeCard?.();
      }
      if (root.parentElement === options.parent) {
        options.parent.removeChild(root);
      }
    }
  };
}

function createRendererCard(documentRef: Document): {
  panel: HTMLDivElement;
  content: HTMLDivElement;
  update: (context: DebugHudCardContext) => void;
} {
  const panel = documentRef.createElement("div");
  const content = documentRef.createElement("div");
  content.className = "sm-debug-hud__renderer-card";

  const fps = documentRef.createElement("div");
  fps.className = "sm-debug-hud__renderer-fps";
  const frameTime = documentRef.createElement("div");
  frameTime.className = "sm-debug-hud__renderer-frame-time";

  const grid = documentRef.createElement("div");
  grid.className = "sm-debug-hud__grid";

  const metricValues = new Map<string, HTMLSpanElement>();
  for (const label of ["Draws", "Triangles", "Textures", "Geometry"]) {
    const row = documentRef.createElement("div");
    row.className = "sm-debug-hud__metric";
    const labelElement = documentRef.createElement("span");
    labelElement.textContent = label;
    const valueElement = documentRef.createElement("span");
    valueElement.textContent = "0";
    metricValues.set(label, valueElement);
    row.append(labelElement, valueElement);
    grid.appendChild(row);
  }

  content.append(fps, frameTime, grid);

  return {
    panel,
    content,
    update(context) {
      fps.textContent = `${Math.round(context.rendererStats.fps)}`;
      frameTime.textContent = `${context.rendererStats.frameTimeMs.toFixed(1)} ms`;
      metricValues.get("Draws")!.textContent = `${context.rendererStats.drawCalls}`;
      metricValues.get("Triangles")!.textContent = `${context.rendererStats.triangles}`;
      metricValues.get("Textures")!.textContent = `${context.rendererStats.textures}`;
      metricValues.get("Geometry")!.textContent = `${context.rendererStats.geometries}`;
    }
  };
}

function createWorldCard(documentRef: Document): {
  panel: HTMLDivElement;
  content: HTMLDivElement;
  update: (context: DebugHudCardContext) => void;
} {
  const panel = documentRef.createElement("div");
  const content = documentRef.createElement("div");
  content.className = "sm-debug-hud__world-card";
  const rows = new Map<string, HTMLSpanElement>();

  for (const label of [
    "Entities",
    "Systems",
    "NPCs",
    "Quests",
    "Scene",
    "Area",
    "Player"
  ]) {
    const row = documentRef.createElement("div");
    row.className = "sm-debug-hud__metric";
    const labelElement = documentRef.createElement("span");
    labelElement.textContent = label;
    const valueElement = documentRef.createElement("span");
    valueElement.textContent = "—";
    rows.set(label, valueElement);
    row.append(labelElement, valueElement);
    content.appendChild(row);
  }

  return {
    panel,
    content,
    update(context) {
      rows.get("Entities")!.textContent = `${context.gameplaySession.activeEntityCount}`;
      rows.get("Systems")!.textContent = `${context.gameplaySession.activeSystemCount}`;
      rows.get("NPCs")!.textContent = `${context.gameplaySession.activeNpcCount}`;
      rows.get("Quests")!.textContent = `${context.gameplaySession.activeQuestCount}`;
      rows.get("Scene")!.textContent = context.gameplaySession.currentSceneId ?? "—";
      rows.get("Area")!.textContent =
        context.gameplaySession.currentAreaDisplayName ?? "—";
      rows.get("Player")!.textContent = context.gameplaySession.playerPosition
        ? `${context.gameplaySession.playerPosition.x.toFixed(1)}, ${context.gameplaySession.playerPosition.y.toFixed(1)}, ${context.gameplaySession.playerPosition.z.toFixed(1)}`
        : "—";
    }
  };
}

function injectStyles(documentRef: Document) {
  if (documentRef.getElementById("sm-debug-hud-styles")) {
    return;
  }

  const style = documentRef.createElement("style");
  style.id = "sm-debug-hud-styles";
  style.textContent = `
    .sm-debug-hud {
      position: absolute;
      left: 16px;
      bottom: 16px;
      z-index: 16;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      pointer-events: none;
    }

    .sm-debug-hud__toggle,
    .sm-debug-hud__panel,
    .sm-debug-hud__tab,
    .sm-debug-hud__pill {
      pointer-events: auto;
    }

    .sm-debug-hud--dialogue-active .sm-debug-hud__toggle,
    .sm-debug-hud--dialogue-active .sm-debug-hud__panel {
      pointer-events: none;
    }

    .sm-debug-hud__toggle {
      width: 38px;
      height: 38px;
      border: none;
      border-radius: 999px;
      background: rgba(236, 72, 153, 0.85);
      color: rgba(15, 10, 36, 0.95);
      font-size: 18px;
      box-shadow: 0 0 16px rgba(236, 72, 153, 0.25), 0 10px 24px rgba(0,0,0,0.3);
      backdrop-filter: blur(10px);
      cursor: pointer;
      transition: background 0.15s, box-shadow 0.15s;
    }

    .sm-debug-hud__toggle:hover {
      background: rgba(236, 72, 153, 1);
      box-shadow: 0 0 24px rgba(236, 72, 153, 0.4), 0 10px 24px rgba(0,0,0,0.3);
    }

    .sm-debug-hud__panel {
      width: 260px;
      min-height: 160px;
      padding: 10px;
      border-radius: 16px;
      border: 1px solid rgba(236, 72, 153, 0.2);
      background: linear-gradient(180deg, rgba(15, 10, 36, 0.95), rgba(10, 6, 28, 0.97));
      box-shadow: 0 0 24px rgba(139, 92, 246, 0.08), 0 18px 40px rgba(0,0,0,0.35);
      backdrop-filter: blur(16px);
      opacity: 0;
      transform: translateY(8px);
      visibility: hidden;
      transition:
        opacity 160ms ease-out,
        transform 160ms ease-out,
        visibility 160ms step-end;
    }

    .sm-debug-hud.is-open .sm-debug-hud__panel {
      opacity: 1;
      transform: translateY(0);
      visibility: visible;
      transition:
        opacity 160ms ease-out,
        transform 160ms ease-out,
        visibility 0s;
    }

    .sm-debug-hud__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }

    .sm-debug-hud__title {
      color: rgba(236, 72, 153, 0.9);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .sm-debug-hud__controls {
      display: flex;
      gap: 6px;
    }

    .sm-debug-hud__pill,
    .sm-debug-hud__tab {
      border: 1px solid rgba(139, 92, 246, 0.25);
      background: rgba(139, 92, 246, 0.08);
      color: rgba(220, 210, 240, 0.85);
      cursor: pointer;
      transition: border-color 0.12s, background 0.12s;
    }

    .sm-debug-hud__pill {
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 11px;
    }

    .sm-debug-hud__tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }

    .sm-debug-hud__tab {
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 11px;
    }

    .sm-debug-hud__tab.is-active {
      background: rgba(236, 72, 153, 0.18);
      border-color: rgba(236, 72, 153, 0.45);
      color: rgba(255, 255, 255, 0.96);
    }

    .sm-debug-hud__body {
      position: relative;
      min-height: 104px;
    }

    .sm-debug-hud__card {
      display: none;
      color: rgba(220, 210, 240, 0.9);
      font-size: 12px;
    }

    .sm-debug-hud__card.is-active {
      display: block;
    }

    .sm-debug-hud__renderer-fps {
      font-size: 30px;
      font-weight: 700;
      line-height: 1;
      color: rgba(236, 72, 153, 1);
      text-shadow: 0 0 12px rgba(236, 72, 153, 0.3);
    }

    .sm-debug-hud__renderer-frame-time {
      margin-top: 4px;
      margin-bottom: 10px;
      color: rgba(139, 92, 246, 0.7);
      font-size: 12px;
    }

    .sm-debug-hud__grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 10px;
    }

    .sm-debug-hud__world-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .sm-debug-hud__metric {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      color: rgba(238, 246, 255, 0.84);
    }

    .sm-debug-hud__metric span:first-child {
      color: rgba(238, 246, 255, 0.62);
    }
  `;
  documentRef.head.appendChild(style);
}
