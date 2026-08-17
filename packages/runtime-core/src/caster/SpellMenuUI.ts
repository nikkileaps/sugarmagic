import type { SpellDefinition } from "@sugarmagic/domain";
import type { CasterManager } from "./CasterManager";
import {
  createFramedPanel,
  type FramedPanel,
  type FramedPanelArt
} from "../framed-panel";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface RuntimeSpellMenuUI {
  update: () => void;
  isOpen: () => boolean;
  toggle: () => void;
  setCanOpenProvider: (provider: () => boolean) => void;
  setOnOpenChange: (handler: (isOpen: boolean) => void) => void;
  dispose: () => void;
}

function injectStyles() {
  if (document.getElementById("sm-spell-menu-styles")) return;

  const style = document.createElement("style");
  style.id = "sm-spell-menu-styles";
  style.textContent = `
    .sm-spell-menu-overlay {
      position: absolute;
      inset: 0;
      display: none;
      justify-content: center;
      align-items: center;
      background: rgba(8, 9, 14, 0.6);
      z-index: 340;
    }
    .sm-spell-menu-overlay.visible { display: flex; }
    .sm-spell-menu-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
      font-family: "Avenir Next", Nunito, system-ui, sans-serif;
      color: #4a3116;
      padding: 2px 6px;
    }
    .sm-spell-menu-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
      gap: 12px;
    }
    .sm-spell-menu-slot {
      aspect-ratio: 1;
      border-radius: 12px;
      border: 3px solid #b8892c;
      background: radial-gradient(circle at 50% 35%, #4a2a70 0%, #331a52 60%, #241040 100%);
      box-shadow: 0 2px 4px rgba(60, 30, 5, 0.35), inset 0 2px 3px rgba(255, 255, 255, 0.18);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      color: #e8b93f;
      font-family: Georgia, ui-serif, serif;
      font-size: 30px;
      font-weight: 700;
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
    }
    .sm-spell-menu-slot:hover { border-color: #e8b93f; }
    .sm-spell-menu-slot.selected {
      border-color: #f5d067;
      box-shadow: 0 0 0 3px rgba(232, 185, 63, 0.45), 0 2px 4px rgba(60, 30, 5, 0.35);
    }
    .sm-spell-menu-slot[disabled] {
      cursor: not-allowed;
      opacity: 0.45;
    }
    .sm-spell-menu-slot-icon {
      width: 100%;
      height: 100%;
      object-fit: contain;
      border-radius: 9px;
    }
    .sm-spell-menu-empty {
      font-size: 13px;
      line-height: 1.55;
      color: #4a3116;
    }
    .sm-spell-menu-footer {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      font-size: 11px;
      color: #6b4a26;
    }
    .sm-spell-menu-key {
      display: inline-block;
      min-width: 20px;
      padding: 1px 5px;
      border-radius: 5px;
      background: rgba(122, 90, 46, 0.18);
      border: 1px solid rgba(122, 90, 46, 0.4);
      text-align: center;
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);
}

export interface RuntimeSpellMenuUIOptions {
  /**
   * Story 50.4 — central keyboard action registry. The spell
   * menu registers `c` (toggle), `Escape` (close), `Enter`
   * (cast), and ArrowLeft/Up / ArrowRight/Down (selection nav)
   * against "in-game" mode. Replaces the previous per-handler
   * window listener.
   */
  actionRegistry?: import("../input-modes/registry").RuntimeActionRegistry;
  /**
   * Painted frame art, injected by the host target. Absent (unit
   * tests, legacy callers) the framed panel renders its CSS
   * fallback.
   */
  frameArt?: FramedPanelArt;
  /**
   * Resolves a spell's icon to a fetchable image URL, or undefined
   * when the spell has none. Slots without an image show the
   * spell's initial on the slot instead.
   */
  getSpellIconUrl?: (spell: SpellDefinition) => string | undefined;
}

export function createRuntimeSpellMenuUI(
  parentContainer: HTMLElement,
  casterManager: CasterManager,
  options: RuntimeSpellMenuUIOptions = {}
): RuntimeSpellMenuUI {
  injectStyles();

  const container = document.createElement("div");
  container.className = "sm-spell-menu-overlay";
  parentContainer.appendChild(container);

  const framedPanel: FramedPanel = createFramedPanel(container, {
    art: options.frameArt ?? null,
    showMeters: true
  });

  const body = document.createElement("div");
  body.className = "sm-spell-menu-body";
  framedPanel.content.appendChild(body);

  const grid = document.createElement("div");
  grid.className = "sm-spell-menu-grid";
  body.appendChild(grid);

  const footer = document.createElement("div");
  footer.className = "sm-spell-menu-footer";
  footer.innerHTML = `
    <span><span class="sm-spell-menu-key">C</span> Close</span>
    <span><span class="sm-spell-menu-key">Esc</span> Cancel</span>
    <span><span class="sm-spell-menu-key">Enter</span> Cast</span>
    <span><span class="sm-spell-menu-key">Arrows</span> Navigate</span>
  `;
  body.appendChild(footer);

  let open = false;
  let selectedIndex = 0;
  let currentSpells: SpellDefinition[] = [];
  let canOpenProvider: () => boolean = () => true;
  let onOpenChange: ((isOpen: boolean) => void) | null = null;

  function setOpen(next: boolean) {
    if (open === next) return;
    open = next;
    container.classList.toggle("visible", open);
    if (open) {
      currentSpells = casterManager.getAvailableSpells();
      selectedIndex = Math.min(
        selectedIndex,
        Math.max(0, currentSpells.length - 1)
      );
      render();
    }
    onOpenChange?.(open);
  }

  function getSelectedSpell(): SpellDefinition | null {
    return currentSpells[selectedIndex] ?? null;
  }

  function moveSelection(delta: number) {
    if (currentSpells.length === 0) return;
    selectedIndex =
      (selectedIndex + delta + currentSpells.length) % currentSpells.length;
    render();
  }

  function renderMeters() {
    const battery = casterManager.getBattery();
    const maxBattery = Math.max(casterManager.getMaxBattery(), 1);
    const resonance = Math.max(0, Math.min(100, casterManager.getResonance()));
    framedPanel.setMeters({
      batteryRatio: battery / maxBattery,
      resonanceRatio: resonance / 100,
      batteryLabel: `${Math.round(battery)}%`,
      resonanceLabel: `${Math.round(resonance)}%`
    });
  }

  function renderGrid() {
    grid.innerHTML = "";
    currentSpells = casterManager.getAvailableSpells();
    if (selectedIndex >= currentSpells.length) {
      selectedIndex = Math.max(0, currentSpells.length - 1);
    }

    for (const [index, spell] of currentSpells.entries()) {
      const availability = casterManager.canCastSpell(spell.definitionId);
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = `sm-spell-menu-slot${index === selectedIndex ? " selected" : ""}`;
      slot.disabled = !availability.canCast;
      // Icon-only grid; the name (and, when blocked, the reason) ride the
      // native tooltip until the badge/hover treatment lands.
      slot.title = availability.canCast
        ? spell.displayName
        : `${spell.displayName} - ${availability.reason ?? "Cannot cast right now."}`;
      const iconUrl = options.getSpellIconUrl?.(spell);
      if (iconUrl) {
        slot.innerHTML = `<img class="sm-spell-menu-slot-icon" src="${escapeHtml(iconUrl)}" alt="${escapeHtml(spell.displayName)}" />`;
      } else {
        slot.textContent = (spell.displayName.trim()[0] ?? "?").toUpperCase();
      }
      slot.addEventListener("click", () => {
        castSpellAtIndex(index);
      });
      grid.appendChild(slot);
    }

    if (currentSpells.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sm-spell-menu-empty";
      empty.textContent =
        "No spells available. Bind some spells in Design > Spells and allow them on the player caster.";
      grid.appendChild(empty);
    }
  }

  function render() {
    renderMeters();
    renderGrid();
    // Grow the frame to the content, capped to the viewport; past the cap
    // the parchment area scrolls.
    framedPanel.setContentHeight(
      body.scrollHeight,
      Math.max(320, window.innerHeight - 56)
    );
  }

  function castSpellAtIndex(index: number) {
    selectedIndex = index;
    castSelectedSpell();
  }

  function castSelectedSpell() {
    const spell = getSelectedSpell();
    if (!spell) return;
    const result = casterManager.castSpell(spell.definitionId);
    render();
    if (result.success) {
      setOpen(false);
    }
  }

  // Story 50.4 — spell menu keyboard actions route through the
  // central registry. Six discrete actions instead of one chunky
  // handler. Each non-toggle handler guards with
  // `if (!open) return` so they don't co-fire with other in-game
  // actions sharing the same key (e.g. inventory Escape).
  const unregisterActions: Array<() => void> = [];
  if (options.actionRegistry) {
    unregisterActions.push(
      options.actionRegistry.register({
        actionId: "runtime-spell-menu-toggle",
        modes: ["in-game"],
        key: "c",
        handler: (event) => {
          event.preventDefault();
          // Refuse to open when another gameplay UI holds the
          // input lock; closing is always allowed.
          if (!open && !canOpenProvider()) return;
          setOpen(!open);
        }
      })
    );
    unregisterActions.push(
      options.actionRegistry.register({
        actionId: "runtime-spell-menu-close",
        modes: ["in-game"],
        key: "Escape",
        handler: (event) => {
          if (!open) return;
          event.preventDefault();
          setOpen(false);
        }
      })
    );
    unregisterActions.push(
      options.actionRegistry.register({
        actionId: "runtime-spell-menu-cast",
        modes: ["in-game"],
        key: "Enter",
        handler: (event) => {
          if (!open) return;
          event.preventDefault();
          castSelectedSpell();
        }
      })
    );
    const moveSelectionPrev = (event: KeyboardEvent) => {
      if (!open) return;
      event.preventDefault();
      moveSelection(-1);
    };
    const moveSelectionNext = (event: KeyboardEvent) => {
      if (!open) return;
      event.preventDefault();
      moveSelection(1);
    };
    unregisterActions.push(
      options.actionRegistry.register({
        actionId: "runtime-spell-menu-select-prev-left",
        modes: ["in-game"],
        key: "ArrowLeft",
        handler: moveSelectionPrev
      })
    );
    unregisterActions.push(
      options.actionRegistry.register({
        actionId: "runtime-spell-menu-select-prev-up",
        modes: ["in-game"],
        key: "ArrowUp",
        handler: moveSelectionPrev
      })
    );
    unregisterActions.push(
      options.actionRegistry.register({
        actionId: "runtime-spell-menu-select-next-right",
        modes: ["in-game"],
        key: "ArrowRight",
        handler: moveSelectionNext
      })
    );
    unregisterActions.push(
      options.actionRegistry.register({
        actionId: "runtime-spell-menu-select-next-down",
        modes: ["in-game"],
        key: "ArrowDown",
        handler: moveSelectionNext
      })
    );
  }

  return {
    update() {
      if (!open) return;
      render();
    },
    isOpen() {
      return open;
    },
    toggle() {
      // Mirror the keyboard handler's gating: refuse to open when another
      // gameplay UI (inventory, dialogue, etc.) has the lock; closing is
      // always allowed.
      if (!open && !canOpenProvider()) return;
      setOpen(!open);
    },
    setCanOpenProvider(provider) {
      canOpenProvider = provider;
    },
    setOnOpenChange(handler) {
      onOpenChange = handler;
    },
    dispose() {
      for (const unregister of unregisterActions) unregister();
      framedPanel.dispose();
      parentContainer.removeChild(container);
    }
  };
}
