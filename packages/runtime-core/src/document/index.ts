import type { DocumentDefinition, ItemDefinition } from "@sugarmagic/domain";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textToHtml(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br />");
}

function renderMetaLine(value: string): string {
  return value.trim().length > 0
    ? `<div class="sm-document-meta-line">${textToHtml(value)}</div>`
    : "";
}

function renderSections(definition: DocumentDefinition): string {
  const sections = definition.sections.filter(
    (section) => section.heading.trim().length > 0 || section.body.trim().length > 0
  );

  return sections
    .map(
      (section) => `
        <article class="sm-document-section">
          ${
            section.heading.trim().length > 0
              ? `<h3 class="sm-document-section-heading">${textToHtml(section.heading)}</h3>`
              : ""
          }
          <div class="sm-document-section-body">${textToHtml(section.body)}</div>
        </article>
      `
    )
    .join("");
}

export function createDocumentDefinitionFromItem(
  itemDefinition: ItemDefinition,
  documentDefinitions: DocumentDefinition[] = []
): DocumentDefinition | null {
  if (itemDefinition.interactionView.kind !== "readable") {
    return null;
  }

  const boundDocument = itemDefinition.interactionView.documentDefinitionId
    ? documentDefinitions.find(
        (definition) =>
          definition.definitionId === itemDefinition.interactionView.documentDefinitionId
      ) ?? null
    : null;

  if (boundDocument) {
    return boundDocument;
  }
  return null;
}

export function renderDocumentDefinitionHtml(definition: DocumentDefinition): string {
  const title = definition.displayName;
  const subtitle = definition.subtitle?.trim() ?? "";
  const author = definition.author.trim();
  const locationLine = definition.locationLine.trim();
  const dateLine = definition.dateLine.trim();
  const footer = definition.footer.trim();
  const backBody = definition.backBody.trim();

  switch (definition.template) {
    case "book": {
      const pages = definition.pages.filter((page) => page.trim().length > 0);
      return `
        <div class="sm-document sm-document-book">
          <section class="sm-document-book-cover">
            <div class="sm-document-title">${textToHtml(title)}</div>
            ${subtitle ? `<div class="sm-document-subtitle">${textToHtml(subtitle)}</div>` : ""}
            ${author ? `<div class="sm-document-byline">by ${textToHtml(author)}</div>` : ""}
            ${definition.body ? `<div class="sm-document-cover-copy">${textToHtml(definition.body)}</div>` : ""}
          </section>
          <section class="sm-document-book-pages">
            ${pages
              .map(
                (page, index) => `
                  <article class="sm-document-book-page">
                    <div class="sm-document-book-page-number">Page ${index + 1}</div>
                    <div class="sm-document-book-page-body">${textToHtml(page)}</div>
                  </article>
                `
              )
              .join("")}
          </section>
        </div>
      `;
    }
    case "newspaper":
      return `
        <div class="sm-document sm-document-newspaper">
          <section class="sm-document-newspaper-masthead">
            <div class="sm-document-title">${textToHtml(title)}</div>
            ${subtitle ? `<div class="sm-document-subtitle">${textToHtml(subtitle)}</div>` : ""}
            <div class="sm-document-newspaper-meta">
              ${renderMetaLine(locationLine)}
              ${renderMetaLine(dateLine)}
            </div>
          </section>
          ${
            definition.body.trim().length > 0
              ? `<section class="sm-document-newspaper-banner">${textToHtml(definition.body)}</section>`
              : ""
          }
          <section class="sm-document-newspaper-columns">${renderSections(definition)}</section>
          ${footer ? `<div class="sm-document-footer sm-document-newspaper-footer">${textToHtml(footer)}</div>` : ""}
        </div>
      `;
    case "letter":
      return `
        <div class="sm-document sm-document-letter">
          <div class="sm-document-letter-paper">
            <div class="sm-document-letter-meta">
              ${renderMetaLine(locationLine)}
              ${renderMetaLine(dateLine)}
            </div>
            <div class="sm-document-title">${textToHtml(title)}</div>
            ${subtitle ? `<div class="sm-document-subtitle">${textToHtml(subtitle)}</div>` : ""}
            <div class="sm-document-letter-body">${textToHtml(definition.body)}</div>
            ${footer || author ? `<div class="sm-document-letter-signoff">${textToHtml(footer || author)}</div>` : ""}
          </div>
        </div>
      `;
    case "postcard":
      return `
        <div class="sm-document sm-document-postcard">
          <section class="sm-document-postcard-face">
            <div class="sm-document-postcard-label">Front</div>
            <div class="sm-document-title">${textToHtml(title)}</div>
            ${subtitle ? `<div class="sm-document-subtitle">${textToHtml(subtitle)}</div>` : ""}
            <div class="sm-document-postcard-body">${textToHtml(definition.body)}</div>
          </section>
          <section class="sm-document-postcard-face sm-document-postcard-back">
            <div class="sm-document-postcard-label">Back</div>
            <div class="sm-document-postcard-stamp"></div>
            <div class="sm-document-postcard-meta">
              ${renderMetaLine(locationLine)}
              ${renderMetaLine(dateLine)}
            </div>
            <div class="sm-document-postcard-body">${textToHtml(backBody)}</div>
          </section>
        </div>
      `;
    case "flyer":
      return `
        <div class="sm-document sm-document-flyer">
          <div class="sm-document-title">${textToHtml(title)}</div>
          ${subtitle ? `<div class="sm-document-subtitle">${textToHtml(subtitle)}</div>` : ""}
          <div class="sm-document-flyer-body">${textToHtml(definition.body)}</div>
          ${footer ? `<div class="sm-document-footer sm-document-flyer-footer">${textToHtml(footer)}</div>` : ""}
        </div>
      `;
    case "sign":
      return `
        <div class="sm-document sm-document-sign">
          <div class="sm-document-title">${textToHtml(title)}</div>
          ${subtitle ? `<div class="sm-document-subtitle">${textToHtml(subtitle)}</div>` : ""}
          <div class="sm-document-sign-body">${textToHtml(definition.body)}</div>
        </div>
      `;
    case "plaque":
      return `
        <div class="sm-document sm-document-plaque">
          <div class="sm-document-plaque-title">${textToHtml(title)}</div>
          ${subtitle ? `<div class="sm-document-subtitle">${textToHtml(subtitle)}</div>` : ""}
          <div class="sm-document-plaque-body">${textToHtml(definition.body)}</div>
          ${footer ? `<div class="sm-document-footer">${textToHtml(footer)}</div>` : ""}
        </div>
      `;
  }
}

export interface RuntimeDocumentReaderUI {
  show: (definition: DocumentDefinition, options?: { kicker?: string }) => void;
  hide: () => void;
  isOpen: () => boolean;
  setOnOpenChange: (handler: (isOpen: boolean) => void) => void;
  dispose: () => void;
}

export function createRuntimeDocumentReaderUI(
  parentContainer: HTMLElement
): RuntimeDocumentReaderUI {
  injectDocumentStyles();

  const container = document.createElement("div");
  container.className = "sm-document-reader";
  parentContainer.appendChild(container);

  const panel = document.createElement("div");
  panel.className = "sm-document-reader-panel";
  container.appendChild(panel);

  let open = false;
  let onOpenChange: ((isOpen: boolean) => void) | null = null;
  let activeDefinition: DocumentDefinition | null = null;

  function setOpen(next: boolean) {
    if (open === next) return;
    open = next;
    container.classList.toggle("visible", open);
    onOpenChange?.(open);
  }

  function render(options?: { kicker?: string }) {
    if (!activeDefinition) {
      panel.innerHTML = "";
      return;
    }

    panel.innerHTML = `
      <div class="sm-document-reader-header">
        <div>
          <div class="sm-document-reader-kicker">${escapeHtml(options?.kicker ?? activeDefinition.template)}</div>
          <div class="sm-document-reader-title">${escapeHtml(activeDefinition.displayName)}</div>
        </div>
        <button type="button" class="sm-document-reader-close">Close</button>
      </div>
      <div class="sm-document-reader-body">${renderDocumentDefinitionHtml(activeDefinition)}</div>
      <div class="sm-document-reader-hint">Press <span class="sm-document-reader-key">Enter</span> or <span class="sm-document-reader-key">ESC</span> to close</div>
    `;

    panel
      .querySelector<HTMLButtonElement>(".sm-document-reader-close")
      ?.addEventListener("click", () => setOpen(false));
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      setOpen(false);
    }
  }

  window.addEventListener("keydown", handleKeyDown);

  return {
    show(definition, options) {
      activeDefinition = definition;
      render(options);
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
    dispose() {
      window.removeEventListener("keydown", handleKeyDown);
      parentContainer.removeChild(container);
    }
  };
}

function injectDocumentStyles() {
  if (document.getElementById("sm-document-reader-styles")) return;

  const style = document.createElement("style");
  style.id = "sm-document-reader-styles";
  style.textContent = `
    .sm-document-reader {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease-out;
      z-index: 19;
      background: rgba(10, 10, 15, 0.5);
    }

    .sm-document-reader.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .sm-document-reader-panel {
      width: min(760px, calc(100vw - 48px));
      max-height: min(84vh, 820px);
      display: flex;
      flex-direction: column;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(24,24,37,0.98), rgba(17,17,27,0.99));
      box-shadow: 0 20px 72px rgba(0,0,0,0.42);
      overflow: hidden;
    }

    .sm-document-reader-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 18px 22px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      color: #cdd6f4;
    }

    .sm-document-reader-kicker {
      color: #89b4fa;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 6px;
    }

    .sm-document-reader-title {
      font-size: 20px;
      font-weight: 700;
      color: #f5e0dc;
    }

    .sm-document-reader-close,
    .sm-document-reader-key {
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      background: #313244;
      color: #cdd6f4;
      padding: 10px 14px;
    }

    .sm-document-reader-body {
      padding: 20px 22px;
      overflow: auto;
    }

    .sm-document-reader-hint {
      padding: 16px 22px 22px;
      border-top: 1px solid rgba(255,255,255,0.06);
      color: #9399b2;
      font-size: 13px;
      text-align: center;
    }

    .sm-document,
    .sm-document * {
      box-sizing: border-box;
    }

    .sm-document {
      color: #dce0e8;
      line-height: 1.7;
    }

    .sm-document-title {
      font-size: 28px;
      font-weight: 800;
      line-height: 1.1;
      color: #f5e0dc;
    }

    .sm-document-subtitle {
      margin-top: 8px;
      color: #bac2de;
      font-size: 15px;
      line-height: 1.5;
    }

    .sm-document-byline,
    .sm-document-meta-line,
    .sm-document-footer {
      color: #a6adc8;
      font-size: 13px;
      line-height: 1.5;
    }

    .sm-document-book-cover,
    .sm-document-letter-paper,
    .sm-document-flyer,
    .sm-document-postcard-face,
    .sm-document-newspaper,
    .sm-document-sign,
    .sm-document-plaque {
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 18px;
      background: rgba(30, 30, 46, 0.72);
      box-shadow: 0 14px 36px rgba(0,0,0,0.18);
    }

    .sm-document-book { display: grid; gap: 18px; }
    .sm-document-book-cover {
      padding: 26px 24px;
      background: radial-gradient(circle at top, rgba(249,226,175,0.14), transparent 48%), linear-gradient(180deg, rgba(69,71,90,0.92), rgba(30,30,46,0.92));
    }
    .sm-document-cover-copy { margin-top: 18px; color: #cdd6f4; font-size: 14px; }
    .sm-document-book-pages { display: grid; gap: 14px; }
    .sm-document-book-page {
      padding: 20px 18px;
      border: 1px solid rgba(249,226,175,0.16);
      border-radius: 16px;
      background: linear-gradient(180deg, rgba(250,243,221,0.08), rgba(205,214,244,0.03));
    }
    .sm-document-book-page-number {
      margin-bottom: 12px;
      color: #f9e2af;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .sm-document-book-page-body,
    .sm-document-letter-body,
    .sm-document-postcard-body,
    .sm-document-flyer-body,
    .sm-document-section-body,
    .sm-document-sign-body,
    .sm-document-plaque-body {
      color: #dce0e8;
      font-size: 15px;
      line-height: 1.8;
      white-space: normal;
    }
    .sm-document-newspaper {
      padding: 22px;
      background: linear-gradient(180deg, rgba(50,51,61,0.96), rgba(30,30,46,0.96));
    }
    .sm-document-newspaper-masthead { padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .sm-document-newspaper-meta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
    .sm-document-newspaper-banner { margin-bottom: 18px; padding: 12px 14px; border-radius: 12px; background: rgba(137,180,250,0.08); color: #cdd6f4; font-weight: 600; }
    .sm-document-newspaper-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .sm-document-section { padding: 14px; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; background: rgba(17,17,27,0.34); }
    .sm-document-section-heading { margin: 0 0 10px; color: #f2cdcd; font-size: 18px; line-height: 1.25; }
    .sm-document-newspaper-footer { margin-top: 18px; text-align: right; }
    .sm-document-letter { display: flex; justify-content: center; }
    .sm-document-letter-paper { width: min(100%, 640px); padding: 24px; background: linear-gradient(180deg, rgba(245,224,220,0.08), rgba(205,214,244,0.04)); }
    .sm-document-letter-meta { margin-bottom: 16px; }
    .sm-document-letter-signoff { margin-top: 18px; color: #f9e2af; font-style: italic; white-space: pre-wrap; }
    .sm-document-postcard { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    .sm-document-postcard-face { min-height: 280px; padding: 20px; background: radial-gradient(circle at top right, rgba(137,180,250,0.12), transparent 32%), linear-gradient(180deg, rgba(69,71,90,0.92), rgba(30,30,46,0.92)); }
    .sm-document-postcard-label { margin-bottom: 12px; color: #89b4fa; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    .sm-document-postcard-back { position: relative; }
    .sm-document-postcard-stamp { position: absolute; right: 20px; top: 20px; width: 44px; height: 54px; border: 2px dashed rgba(249,226,175,0.4); border-radius: 8px; }
    .sm-document-postcard-meta { margin: 70px 0 18px; }
    .sm-document-flyer { padding: 28px 24px; text-align: center; background: radial-gradient(circle at top, rgba(166,227,161,0.14), transparent 42%), linear-gradient(180deg, rgba(49,50,68,0.94), rgba(24,24,37,0.98)); }
    .sm-document-flyer .sm-document-title { margin-bottom: 10px; }
    .sm-document-flyer-footer { margin-top: 18px; color: #a6e3a1; font-weight: 700; }
    .sm-document-sign {
      padding: 28px 24px;
      text-align: center;
      background: linear-gradient(180deg, rgba(70,52,32,0.94), rgba(42,30,18,0.98));
    }
    .sm-document-sign-body { margin-top: 18px; font-size: 20px; font-weight: 700; }
    .sm-document-plaque {
      padding: 28px 24px;
      text-align: center;
      background: linear-gradient(180deg, rgba(113,92,57,0.94), rgba(72,55,31,0.98));
    }
    .sm-document-plaque-title { font-size: 24px; font-weight: 800; color: #f9e2af; }
    @media (max-width: 720px) {
      .sm-document-newspaper-columns,
      .sm-document-postcard {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}
