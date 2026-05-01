import type { DocumentDefinition, ItemDefinition } from "@sugarmagic/domain";
import {
  createDocumentDefinitionFromItem,
  renderDocumentDefinitionHtml
} from "../document";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function textToHtml(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br />");
}

function renderItemViewContentHtml(
  definition: ItemDefinition,
  documentDefinitions: DocumentDefinition[]
): string {
  if (definition.interactionView.kind === "readable") {
    const documentDefinition = createDocumentDefinitionFromItem(
      definition,
      documentDefinitions
    );
    if (documentDefinition) {
      return renderDocumentDefinitionHtml(documentDefinition);
    }
  }

  const body = definition.interactionView.body || definition.description || "";
  return `<div class="sm-item-view-body-copy">${textToHtml(body)}</div>`;
}

export interface RuntimeInventoryEntry {
  itemDefinitionId: string;
  displayName: string;
  quantity: number;
  description?: string;
  viewKind: ItemDefinition["interactionView"]["kind"];
}

export class InventoryManager {
  private definitions = new Map<string, ItemDefinition>();
  private documentDefinitions = new Map<string, DocumentDefinition>();
  private quantities = new Map<string, number>();
  private onChange: (() => void) | null = null;

  registerDefinitions(definitions: ItemDefinition[]): void {
    this.definitions.clear();
    for (const definition of definitions) {
      this.definitions.set(definition.definitionId, definition);
    }
    this.emitChange();
  }

  registerDocumentDefinitions(definitions: DocumentDefinition[]): void {
    this.documentDefinitions.clear();
    for (const definition of definitions) {
      this.documentDefinitions.set(definition.definitionId, definition);
    }
  }

  setOnChange(handler: (() => void) | null): void {
    this.onChange = handler;
  }

  addItem(itemDefinitionId: string, count = 1): boolean {
    const definition = this.definitions.get(itemDefinitionId);
    if (!definition) {
      return false;
    }

    const nextCount = Math.max(1, Math.floor(count));
    const current = this.quantities.get(itemDefinitionId) ?? 0;
    const total = definition.inventory.stackable
      ? Math.min(current + nextCount, Math.max(1, definition.inventory.maxStack))
      : current + nextCount;
    this.quantities.set(itemDefinitionId, total);
    this.emitChange();
    return true;
  }

  removeItem(itemDefinitionId: string, count = 1): boolean {
    const current = this.quantities.get(itemDefinitionId) ?? 0;
    const nextCount = Math.max(1, Math.floor(count));
    if (current < nextCount) {
      return false;
    }

    const remaining = current - nextCount;
    if (remaining <= 0) {
      this.quantities.delete(itemDefinitionId);
    } else {
      this.quantities.set(itemDefinitionId, remaining);
    }
    this.emitChange();
    return true;
  }

  hasItem(itemDefinitionId: string, count = 1): boolean {
    return this.getQuantity(itemDefinitionId) >= Math.max(1, Math.floor(count));
  }

  getQuantity(itemDefinitionId: string): number {
    return this.quantities.get(itemDefinitionId) ?? 0;
  }

  getDefinition(itemDefinitionId: string): ItemDefinition | null {
    return this.definitions.get(itemDefinitionId) ?? null;
  }

  getDocumentDefinitions(): DocumentDefinition[] {
    return Array.from(this.documentDefinitions.values());
  }

  getEntries(): RuntimeInventoryEntry[] {
    const entries: RuntimeInventoryEntry[] = [];

    for (const [itemDefinitionId, quantity] of this.quantities.entries()) {
      const definition = this.definitions.get(itemDefinitionId);
      if (!definition) continue;

      entries.push({
        itemDefinitionId,
        displayName: definition.displayName,
        quantity,
        description: definition.description,
        viewKind: definition.interactionView.kind
      });
    }

    return entries.sort((left, right) =>
      left.displayName.localeCompare(right.displayName)
    );
  }

  private emitChange(): void {
    this.onChange?.();
  }
}

export interface RuntimeInventoryUI {
  update: (entries: RuntimeInventoryEntry[]) => void;
  isOpen: () => boolean;
  toggle: () => void;
  setOnOpenChange: (handler: (isOpen: boolean) => void) => void;
  setOnInspectItem: (handler: (itemDefinitionId: string) => void) => void;
  dispose: () => void;
}

export function createRuntimeInventoryUI(
  parentContainer: HTMLElement
): RuntimeInventoryUI {
  injectInventoryStyles();

  const container = document.createElement("div");
  container.className = "sm-inventory-ui";
  parentContainer.appendChild(container);

  const panel = document.createElement("div");
  panel.className = "sm-inventory-panel";
  container.appendChild(panel);

  const header = document.createElement("div");
  header.className = "sm-inventory-header";
  header.innerHTML = `<span>Inventory</span><span class="sm-inventory-header-key">I</span>`;
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "sm-inventory-body";
  panel.appendChild(body);

  let entries: RuntimeInventoryEntry[] = [];
  let open = false;
  let onOpenChange: ((isOpen: boolean) => void) | null = null;
  let onInspectItem: ((itemDefinitionId: string) => void) | null = null;

  function setOpen(next: boolean) {
    if (open === next) return;
    open = next;
    container.classList.toggle("visible", open);
    onOpenChange?.(open);
  }

  function render() {
    body.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sm-inventory-empty";
      empty.textContent = "No items collected yet.";
      body.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sm-inventory-entry";
      button.disabled = entry.viewKind === "none";
      button.innerHTML = `
        <div class="sm-inventory-entry-title-row">
          <span class="sm-inventory-entry-title">${escapeHtml(entry.displayName)}</span>
          <span class="sm-inventory-entry-qty">x${entry.quantity}</span>
        </div>
        <div class="sm-inventory-entry-description">${escapeHtml(entry.description ?? "")}</div>
      `;
      button.addEventListener("click", () => {
        if (entry.viewKind === "none") return;
        onInspectItem?.(entry.itemDefinitionId);
      });
      body.appendChild(button);
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    const target = event.target;
    if (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLInputElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    if (event.key.toLowerCase() === "i") {
      event.preventDefault();
      setOpen(!open);
      return;
    }

    if (open && event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  window.addEventListener("keydown", handleKeyDown);

  return {
    update(nextEntries) {
      entries = nextEntries;
      render();
    },
    isOpen() {
      return open;
    },
    toggle() {
      setOpen(!open);
    },
    setOnOpenChange(handler) {
      onOpenChange = handler;
    },
    setOnInspectItem(handler) {
      onInspectItem = handler;
    },
    dispose() {
      window.removeEventListener("keydown", handleKeyDown);
      parentContainer.removeChild(container);
    }
  };
}

export interface RuntimeItemViewUI {
  show: (definition: ItemDefinition, quantity: number) => void;
  hide: () => void;
  isOpen: () => boolean;
  setOnOpenChange: (handler: (isOpen: boolean) => void) => void;
  setOnConsume: (handler: (itemDefinitionId: string) => void) => void;
  dispose: () => void;
}

export function createRuntimeItemViewUI(
  parentContainer: HTMLElement,
  documentDefinitions: DocumentDefinition[] = []
): RuntimeItemViewUI {
  injectInventoryStyles();

  const container = document.createElement("div");
  container.className = "sm-item-view";
  parentContainer.appendChild(container);

  const panel = document.createElement("div");
  panel.className = "sm-item-view-panel";
  container.appendChild(panel);

  let open = false;
  let activeDefinition: ItemDefinition | null = null;
  let onOpenChange: ((isOpen: boolean) => void) | null = null;
  let onConsume: ((itemDefinitionId: string) => void) | null = null;

  function setOpen(next: boolean) {
    if (open === next) return;
    open = next;
    container.classList.toggle("visible", open);
    onOpenChange?.(open);
  }

  function render(quantity: number) {
    if (!activeDefinition) {
      panel.innerHTML = "";
      return;
    }

    const title = activeDefinition.interactionView.title || activeDefinition.displayName;
    const kicker =
      activeDefinition.interactionView.kind === "readable"
        ? "readable document"
        : activeDefinition.interactionView.kind;
    panel.innerHTML = `
      <div class="sm-item-view-header">
        <div>
          <div class="sm-item-view-kicker">${escapeHtml(kicker)}</div>
          <div class="sm-item-view-title">${escapeHtml(title)}</div>
          <div class="sm-item-view-quantity">Quantity: ${quantity}</div>
        </div>
        <button type="button" class="sm-item-view-close">Close</button>
      </div>
      <div class="sm-item-view-body">${renderItemViewContentHtml(
        activeDefinition,
        documentDefinitions
      )}</div>
      <div class="sm-item-view-actions"></div>
    `;

    const closeButton = panel.querySelector<HTMLButtonElement>(".sm-item-view-close");
    closeButton?.addEventListener("click", () => setOpen(false));

    const actions = panel.querySelector<HTMLDivElement>(".sm-item-view-actions");
    if (activeDefinition.interactionView.kind === "consumable" && actions) {
      const consumeButton = document.createElement("button");
      consumeButton.type = "button";
      consumeButton.className = "sm-item-view-consume";
      consumeButton.textContent = activeDefinition.interactionView.consumeLabel || "Use";
      consumeButton.addEventListener("click", () => {
        if (!activeDefinition) return;
        onConsume?.(activeDefinition.definitionId);
      });
      actions.appendChild(consumeButton);
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  window.addEventListener("keydown", handleKeyDown);

  return {
    show(definition, quantity) {
      activeDefinition = definition;
      render(quantity);
      setOpen(true);
    },
    hide() {
      activeDefinition = null;
      panel.innerHTML = "";
      setOpen(false);
    },
    isOpen() {
      return open;
    },
    setOnOpenChange(handler) {
      onOpenChange = handler;
    },
    setOnConsume(handler) {
      onConsume = handler;
    },
    dispose() {
      window.removeEventListener("keydown", handleKeyDown);
      parentContainer.removeChild(container);
    }
  };
}

export interface RuntimeItemPickupNotificationCenter {
  push: (label: string, quantity: number) => void;
  dispose: () => void;
}

export function createRuntimeItemPickupNotificationCenter(
  parentContainer: HTMLElement
): RuntimeItemPickupNotificationCenter {
  injectInventoryStyles();

  const container = document.createElement("div");
  container.className = "sm-item-pickup-toast-container";
  parentContainer.appendChild(container);

  return {
    push(label, quantity) {
      const toast = document.createElement("div");
      toast.className = "sm-item-pickup-toast";
      toast.textContent = `Picked up ${label}${quantity > 1 ? ` x${quantity}` : ""}`;
      container.appendChild(toast);
      window.setTimeout(() => {
        toast.classList.add("visible");
      }, 10);
      window.setTimeout(() => {
        toast.classList.remove("visible");
        window.setTimeout(() => toast.remove(), 180);
      }, 2200);
    },
    dispose() {
      parentContainer.removeChild(container);
    }
  };
}

function injectInventoryStyles() {
  if (document.getElementById("sm-inventory-styles")) return;

  const style = document.createElement("style");
  style.id = "sm-inventory-styles";
  style.textContent = `
    .sm-inventory-ui,
    .sm-item-view {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease-out;
      z-index: 18;
      background: rgba(10, 10, 15, 0.45);
    }

    .sm-inventory-ui.visible,
    .sm-item-view.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .sm-inventory-panel,
    .sm-item-view-panel {
      width: min(640px, calc(100vw - 48px));
      max-height: min(80vh, 760px);
      display: flex;
      flex-direction: column;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(24,24,37,0.97), rgba(17,17,27,0.98));
      box-shadow: 0 20px 72px rgba(0,0,0,0.4);
      overflow: hidden;
    }

    .sm-inventory-header,
    .sm-item-view-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 18px 22px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      color: #cdd6f4;
    }

    .sm-inventory-header-key {
      font-size: 12px;
      font-weight: 700;
      color: #f9e2af;
      padding: 6px 8px;
      border: 1px solid rgba(249, 226, 175, 0.35);
      border-radius: 8px;
      background: rgba(249, 226, 175, 0.14);
    }

    .sm-inventory-body {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      padding: 18px;
      overflow: auto;
    }

    .sm-inventory-empty {
      grid-column: 1 / -1;
      color: #9399b2;
      text-align: center;
      padding: 32px 16px;
    }

    .sm-inventory-entry {
      text-align: left;
      border: 1px solid rgba(255,255,255,0.08);
      background: #181825;
      border-radius: 14px;
      color: #cdd6f4;
      padding: 14px 16px;
      cursor: pointer;
    }

    .sm-inventory-entry:disabled {
      opacity: 0.75;
      cursor: default;
    }

    .sm-inventory-entry-title-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }

    .sm-inventory-entry-title {
      font-weight: 700;
    }

    .sm-inventory-entry-qty {
      color: #f9e2af;
      font-size: 12px;
      font-weight: 700;
    }

    .sm-inventory-entry-description,
    .sm-item-view-body,
    .sm-item-view-quantity {
      color: #bac2de;
      font-size: 14px;
      line-height: 1.5;
    }

    .sm-item-view-kicker {
      color: #89b4fa;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 6px;
    }

    .sm-item-view-title {
      font-size: 20px;
      font-weight: 700;
      color: #f5e0dc;
      margin-bottom: 6px;
    }

    .sm-item-view-body {
      padding: 20px 22px;
      overflow: auto;
    }

    .sm-item-view-body-copy {
      color: #bac2de;
      font-size: 14px;
      line-height: 1.7;
      white-space: normal;
    }

    .sm-readable {
      color: #dce0e8;
      line-height: 1.7;
    }

    .sm-readable-title {
      font-size: 28px;
      font-weight: 800;
      line-height: 1.1;
      color: #f5e0dc;
    }

    .sm-readable-subtitle {
      margin-top: 8px;
      color: #bac2de;
      font-size: 15px;
      line-height: 1.5;
    }

    .sm-readable-byline,
    .sm-readable-meta-line,
    .sm-readable-footer {
      color: #a6adc8;
      font-size: 13px;
      line-height: 1.5;
    }

    .sm-readable-book-cover,
    .sm-readable-letter-paper,
    .sm-readable-flyer,
    .sm-readable-postcard-face,
    .sm-readable-newspaper {
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 18px;
      background: rgba(30, 30, 46, 0.72);
      box-shadow: 0 14px 36px rgba(0,0,0,0.18);
    }

    .sm-readable-book {
      display: grid;
      gap: 18px;
    }

    .sm-readable-book-cover {
      padding: 26px 24px;
      background:
        radial-gradient(circle at top, rgba(249,226,175,0.14), transparent 48%),
        linear-gradient(180deg, rgba(69,71,90,0.92), rgba(30,30,46,0.92));
    }

    .sm-readable-cover-copy {
      margin-top: 18px;
      color: #cdd6f4;
      font-size: 14px;
    }

    .sm-readable-book-pages {
      display: grid;
      gap: 14px;
    }

    .sm-readable-book-page {
      padding: 20px 18px;
      border: 1px solid rgba(249,226,175,0.16);
      border-radius: 16px;
      background: linear-gradient(180deg, rgba(250,243,221,0.08), rgba(205,214,244,0.03));
    }

    .sm-readable-book-page-number {
      margin-bottom: 12px;
      color: #f9e2af;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .sm-readable-book-page-body,
    .sm-readable-letter-body,
    .sm-readable-postcard-body,
    .sm-readable-flyer-body,
    .sm-readable-section-body {
      color: #dce0e8;
      font-size: 15px;
      line-height: 1.8;
    }

    .sm-readable-newspaper {
      padding: 22px;
      background:
        linear-gradient(180deg, rgba(50, 51, 61, 0.96), rgba(30, 30, 46, 0.96));
    }

    .sm-readable-newspaper-masthead {
      padding-bottom: 16px;
      margin-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }

    .sm-readable-newspaper-meta {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 12px;
    }

    .sm-readable-newspaper-banner {
      margin-bottom: 18px;
      padding: 12px 14px;
      border-radius: 12px;
      background: rgba(137,180,250,0.08);
      color: #cdd6f4;
      font-weight: 600;
    }

    .sm-readable-newspaper-columns {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }

    .sm-readable-section {
      padding: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      background: rgba(17,17,27,0.34);
    }

    .sm-readable-section-heading {
      margin: 0 0 10px;
      color: #f2cdcd;
      font-size: 18px;
      line-height: 1.25;
    }

    .sm-readable-newspaper-footer {
      margin-top: 18px;
      text-align: right;
    }

    .sm-readable-letter {
      display: flex;
      justify-content: center;
    }

    .sm-readable-letter-paper {
      width: min(100%, 640px);
      padding: 24px;
      background:
        linear-gradient(180deg, rgba(245,224,220,0.08), rgba(205,214,244,0.04));
    }

    .sm-readable-letter-meta {
      margin-bottom: 16px;
    }

    .sm-readable-letter-signoff {
      margin-top: 18px;
      color: #f9e2af;
      font-style: italic;
      white-space: pre-wrap;
    }

    .sm-readable-postcard {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }

    .sm-readable-postcard-face {
      min-height: 280px;
      padding: 20px;
      background:
        radial-gradient(circle at top right, rgba(137,180,250,0.12), transparent 32%),
        linear-gradient(180deg, rgba(69,71,90,0.92), rgba(30,30,46,0.92));
    }

    .sm-readable-postcard-label {
      margin-bottom: 12px;
      color: #89b4fa;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .sm-readable-postcard-back {
      position: relative;
    }

    .sm-readable-postcard-stamp {
      position: absolute;
      right: 20px;
      top: 20px;
      width: 44px;
      height: 54px;
      border: 2px dashed rgba(249,226,175,0.4);
      border-radius: 8px;
    }

    .sm-readable-postcard-meta {
      margin: 70px 0 18px;
    }

    .sm-readable-flyer {
      padding: 28px 24px;
      text-align: center;
      background:
        radial-gradient(circle at top, rgba(166,227,161,0.14), transparent 42%),
        linear-gradient(180deg, rgba(49,50,68,0.94), rgba(24,24,37,0.98));
    }

    .sm-readable-flyer .sm-readable-title {
      margin-bottom: 10px;
    }

    .sm-readable-flyer-footer {
      margin-top: 18px;
      color: #a6e3a1;
      font-weight: 700;
    }

    @media (max-width: 720px) {
      .sm-readable-newspaper-columns,
      .sm-readable-postcard {
        grid-template-columns: 1fr;
      }
    }

    .sm-item-view-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      padding: 0 22px 22px;
    }

    .sm-item-view-close,
    .sm-item-view-consume {
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      background: #313244;
      color: #cdd6f4;
      padding: 10px 14px;
      cursor: pointer;
    }

    .sm-item-view-consume {
      background: #a6e3a1;
      color: #11111b;
      font-weight: 700;
    }

    .sm-item-pickup-toast-container {
      position: absolute;
      left: 50%;
      top: 32px;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 17;
      pointer-events: none;
    }

    .sm-item-pickup-toast {
      opacity: 0;
      transform: translateY(-8px);
      transition: opacity 0.18s ease-out, transform 0.18s ease-out;
      padding: 10px 14px;
      border-radius: 12px;
      border: 1px solid rgba(166, 227, 161, 0.22);
      background: rgba(24,24,37,0.96);
      color: #a6e3a1;
      box-shadow: 0 10px 28px rgba(0,0,0,0.28);
    }

    .sm-item-pickup-toast.visible {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  document.head.appendChild(style);
}
