import type { SpellDefinition } from "@sugarmagic/domain";
import type { CasterManager } from "./CasterManager";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export interface RuntimeSpellMenuUI {
  update: () => void;
  isOpen: () => boolean;
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
      background: rgba(8, 9, 14, 0.86);
      z-index: 340;
    }
    .sm-spell-menu-overlay.visible { display: flex; }
    .sm-spell-menu-panel {
      width: min(780px, calc(100vw - 48px));
      max-height: calc(100vh - 56px);
      overflow: auto;
      border-radius: 18px;
      border: 1px solid rgba(137, 180, 250, 0.18);
      background: linear-gradient(180deg, rgba(30, 30, 46, 0.98), rgba(17, 17, 27, 0.98));
      box-shadow: 0 24px 72px rgba(0, 0, 0, 0.45);
      color: #f5e0dc;
      padding: 24px;
      font-family: Inter, system-ui, sans-serif;
    }
    .sm-spell-menu-header {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(137, 180, 250, 0.12);
    }
    .sm-spell-menu-title { font-size: 22px; font-weight: 700; }
    .sm-spell-menu-subtitle { font-size: 12px; color: rgba(205, 214, 244, 0.72); text-transform: uppercase; letter-spacing: 0.08em; }
    .sm-spell-menu-meters { min-width: 220px; display: flex; flex-direction: column; gap: 10px; }
    .sm-spell-menu-meter { display: grid; grid-template-columns: 84px 1fr 48px; gap: 8px; align-items: center; }
    .sm-spell-menu-meter-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(205, 214, 244, 0.68); }
    .sm-spell-menu-meter-bar { height: 10px; border-radius: 999px; background: rgba(0,0,0,0.35); overflow: hidden; }
    .sm-spell-menu-meter-fill { height: 100%; }
    .sm-spell-menu-meter-fill.battery { background: linear-gradient(90deg, #89dceb, #74c7ec); }
    .sm-spell-menu-meter-fill.resonance { background: linear-gradient(90deg, #cba6f7, #f5c2e7); }
    .sm-spell-menu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .sm-spell-menu-card {
      text-align: left;
      border-radius: 14px;
      border: 1px solid rgba(137, 180, 250, 0.12);
      background: rgba(255,255,255,0.025);
      padding: 14px;
      color: inherit;
      cursor: pointer;
    }
    .sm-spell-menu-card.selected {
      border-color: rgba(137, 180, 250, 0.5);
      background: rgba(137, 180, 250, 0.1);
      box-shadow: 0 0 0 1px rgba(137, 180, 250, 0.16) inset;
    }
    .sm-spell-menu-card[disabled] {
      cursor: not-allowed;
      opacity: 0.48;
    }
    .sm-spell-menu-card-title { font-weight: 700; font-size: 14px; margin-bottom: 6px; }
    .sm-spell-menu-card-meta { font-size: 11px; color: rgba(205,214,244,0.68); }
    .sm-spell-menu-description {
      border-radius: 12px;
      border: 1px solid rgba(137, 180, 250, 0.08);
      background: rgba(255,255,255,0.025);
      padding: 16px;
    }
    .sm-spell-menu-description-title { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
    .sm-spell-menu-description-copy { font-size: 14px; line-height: 1.6; color: rgba(239,241,245,0.82); white-space: pre-wrap; }
    .sm-spell-menu-description-error { margin-top: 10px; color: #f38ba8; font-size: 13px; }
    .sm-spell-menu-footer {
      margin-top: 14px;
      font-size: 12px;
      color: rgba(205,214,244,0.7);
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .sm-spell-menu-key {
      display: inline-block;
      min-width: 22px;
      padding: 2px 6px;
      border-radius: 6px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.1);
      text-align: center;
    }
  `;
  document.head.appendChild(style);
}

export function createRuntimeSpellMenuUI(
  parentContainer: HTMLElement,
  casterManager: CasterManager
): RuntimeSpellMenuUI {
  injectStyles();

  const container = document.createElement("div");
  container.className = "sm-spell-menu-overlay";
  parentContainer.appendChild(container);

  const panel = document.createElement("div");
  panel.className = "sm-spell-menu-panel";
  container.appendChild(panel);

  const header = document.createElement("div");
  header.className = "sm-spell-menu-header";
  panel.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "sm-spell-menu-grid";
  panel.appendChild(grid);

  const description = document.createElement("div");
  description.className = "sm-spell-menu-description";
  panel.appendChild(description);

  const footer = document.createElement("div");
  footer.className = "sm-spell-menu-footer";
  footer.innerHTML = `
    <span><span class="sm-spell-menu-key">C</span> Close</span>
    <span><span class="sm-spell-menu-key">Esc</span> Cancel</span>
    <span><span class="sm-spell-menu-key">Enter</span> Cast</span>
    <span><span class="sm-spell-menu-key">←↑↓→</span> Navigate</span>
  `;
  panel.appendChild(footer);

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
      selectedIndex = Math.min(selectedIndex, Math.max(0, currentSpells.length - 1));
      render();
    }
    onOpenChange?.(open);
  }

  function getSelectedSpell(): SpellDefinition | null {
    return currentSpells[selectedIndex] ?? null;
  }

  function moveSelection(delta: number) {
    if (currentSpells.length === 0) return;
    selectedIndex = (selectedIndex + delta + currentSpells.length) % currentSpells.length;
    render();
  }

  function renderHeader() {
    const battery = casterManager.getBattery();
    const maxBattery = Math.max(casterManager.getMaxBattery(), 1);
    const resonance = casterManager.getResonance();
    const batteryPercent = Math.max(0, Math.min(100, (battery / maxBattery) * 100));
    const resonancePercent = Math.max(0, Math.min(100, resonance));
    header.innerHTML = `
      <div>
        <div class="sm-spell-menu-subtitle">Caster</div>
        <div class="sm-spell-menu-title">Spells</div>
      </div>
      <div class="sm-spell-menu-meters">
        <div class="sm-spell-menu-meter">
          <div class="sm-spell-menu-meter-label">Battery</div>
          <div class="sm-spell-menu-meter-bar"><div class="sm-spell-menu-meter-fill battery" style="width:${batteryPercent}%"></div></div>
          <div class="sm-spell-menu-meter-label">${Math.round(battery)}%</div>
        </div>
        <div class="sm-spell-menu-meter">
          <div class="sm-spell-menu-meter-label">Resonance</div>
          <div class="sm-spell-menu-meter-bar"><div class="sm-spell-menu-meter-fill resonance" style="width:${resonancePercent}%"></div></div>
          <div class="sm-spell-menu-meter-label">${Math.round(resonancePercent)}%</div>
        </div>
      </div>
    `;
  }

  function renderGrid() {
    grid.innerHTML = "";
    currentSpells = casterManager.getAvailableSpells();
    if (selectedIndex >= currentSpells.length) {
      selectedIndex = Math.max(0, currentSpells.length - 1);
    }

    for (const [index, spell] of currentSpells.entries()) {
      const availability = casterManager.canCastSpell(spell.definitionId);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sm-spell-menu-card${index === selectedIndex ? " selected" : ""}`;
      button.disabled = !availability.canCast;
      button.innerHTML = `
        <div class="sm-spell-menu-card-title">${escapeHtml(spell.displayName)}</div>
        <div class="sm-spell-menu-card-meta">Cost ${spell.batteryCost} · ${escapeHtml(spell.tags.join(", ") || "No tags")}</div>
      `;
      button.addEventListener("click", () => {
        castSpellAtIndex(index);
      });
      grid.appendChild(button);
    }

    if (currentSpells.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sm-spell-menu-card";
      empty.setAttribute("disabled", "true");
      empty.innerHTML = `<div class="sm-spell-menu-card-title">No spells available</div><div class="sm-spell-menu-card-meta">Bind some spells in Design > Spells and allow them on the player caster.</div>`;
      grid.appendChild(empty);
    }
  }

  function renderDescription() {
    const spell = getSelectedSpell();
    if (!spell) {
      description.innerHTML = `
        <div class="sm-spell-menu-description-title">No spell selected</div>
        <div class="sm-spell-menu-description-copy">No castable spells are currently available.</div>
      `;
      return;
    }

    const availability = casterManager.canCastSpell(spell.definitionId);
    description.innerHTML = `
      <div class="sm-spell-menu-description-title">${escapeHtml(spell.displayName)}</div>
      <div class="sm-spell-menu-description-copy">${escapeHtml(spell.description || "No description yet.")}</div>
      ${
        availability.canCast
          ? ""
          : `<div class="sm-spell-menu-description-error">${escapeHtml(
              availability.reason ?? "Cannot cast right now."
            )}</div>`
      }
    `;
  }

  function render() {
    renderHeader();
    renderGrid();
    renderDescription();
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

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key.toLowerCase() === "c") {
      event.preventDefault();
      if (!open && !canOpenProvider()) {
        return;
      }
      setOpen(!open);
      return;
    }

    if (!open) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      castSelectedSpell();
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    }
  }

  window.addEventListener("keydown", handleKeyDown);

  return {
    update() {
      if (!open) return;
      render();
    },
    isOpen() {
      return open;
    },
    setCanOpenProvider(provider) {
      canOpenProvider = provider;
    },
    setOnOpenChange(handler) {
      onOpenChange = handler;
    },
    dispose() {
      window.removeEventListener("keydown", handleKeyDown);
      parentContainer.removeChild(container);
    }
  };
}
