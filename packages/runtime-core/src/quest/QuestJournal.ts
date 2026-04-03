import type { QuestJournalQuestView } from "./QuestManager";

export interface RuntimeQuestJournalData {
  active: QuestJournalQuestView[];
  completed: QuestJournalQuestView[];
  trackedQuestDefinitionId: string | null;
}

export interface RuntimeQuestJournal {
  update: (data: RuntimeQuestJournalData) => void;
  isOpen: () => boolean;
  setOnOpenChange: (handler: (isOpen: boolean) => void) => void;
  setOnTrackedQuestChange: (handler: (questDefinitionId: string) => void) => void;
  dispose: () => void;
}

export function createRuntimeQuestJournal(
  parentContainer: HTMLElement
): RuntimeQuestJournal {
  injectStyles();

  const container = document.createElement("div");
  container.className = "sm-quest-journal";
  parentContainer.appendChild(container);

  const panel = document.createElement("div");
  panel.className = "sm-quest-journal-panel";
  container.appendChild(panel);

  const header = document.createElement("div");
  header.className = "sm-quest-journal-header";
  header.innerHTML = `<span>Quest Journal</span><span class="sm-quest-journal-header-key">J</span>`;
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "sm-quest-journal-body";
  panel.appendChild(body);

  let latestData: RuntimeQuestJournalData = {
    active: [],
    completed: [],
    trackedQuestDefinitionId: null
  };
  let open = false;
  let onOpenChange: ((isOpen: boolean) => void) | null = null;
  let onTrackedQuestChange: ((questDefinitionId: string) => void) | null = null;

  function setOpen(next: boolean) {
    if (open === next) return;
    open = next;
    container.classList.toggle("visible", open);
    onOpenChange?.(open);
  }

  function render() {
    body.innerHTML = "";

    const activeSection = document.createElement("div");
    activeSection.className = "sm-quest-journal-section";
    activeSection.innerHTML = `<div class="sm-quest-journal-section-title">Active</div>`;
    body.appendChild(activeSection);

    if (latestData.active.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sm-quest-journal-empty";
      empty.textContent = "No active quests.";
      activeSection.appendChild(empty);
    }

    for (const quest of latestData.active) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "sm-quest-journal-card";
      if (quest.questDefinitionId === latestData.trackedQuestDefinitionId) {
        card.classList.add("tracked");
      }
      card.addEventListener("click", () => onTrackedQuestChange?.(quest.questDefinitionId));
      card.innerHTML = `
        <div class="sm-quest-journal-card-title">${escapeHtml(quest.displayName)}</div>
        <div class="sm-quest-journal-card-stage">${escapeHtml(quest.stageDisplayName)}</div>
        <div class="sm-quest-journal-card-description">${escapeHtml(quest.description)}</div>
      `;

      const objectives = document.createElement("div");
      objectives.className = "sm-quest-journal-objectives";
      for (const objective of quest.objectives) {
        const row = document.createElement("div");
        row.className = "sm-quest-journal-objective";
        row.textContent = objective.description || objective.displayName;
        objectives.appendChild(row);
      }
      card.appendChild(objectives);
      activeSection.appendChild(card);
    }

    const completedSection = document.createElement("div");
    completedSection.className = "sm-quest-journal-section";
    completedSection.innerHTML = `<div class="sm-quest-journal-section-title">Completed</div>`;
    body.appendChild(completedSection);

    if (latestData.completed.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sm-quest-journal-empty";
      empty.textContent = "No completed quests yet.";
      completedSection.appendChild(empty);
    }

    for (const quest of latestData.completed) {
      const card = document.createElement("div");
      card.className = "sm-quest-journal-card completed";
      card.innerHTML = `
        <div class="sm-quest-journal-card-title">${escapeHtml(quest.displayName)}</div>
        <div class="sm-quest-journal-card-description">${escapeHtml(quest.description)}</div>
      `;
      completedSection.appendChild(card);
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key.toLowerCase() === "j") {
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
    update(data) {
      latestData = data;
      render();
    },
    isOpen() {
      return open;
    },
    setOnOpenChange(handler) {
      onOpenChange = handler;
    },
    setOnTrackedQuestChange(handler) {
      onTrackedQuestChange = handler;
    },
    dispose() {
      window.removeEventListener("keydown", handleKeyDown);
      parentContainer.removeChild(container);
    }
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function injectStyles() {
  if (document.getElementById("sm-quest-journal-styles")) return;

  const style = document.createElement("style");
  style.id = "sm-quest-journal-styles";
  style.textContent = `
    .sm-quest-journal {
      position: absolute;
      inset: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      background: rgba(10, 10, 15, 0.55);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease-out;
      z-index: 19;
    }

    .sm-quest-journal.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .sm-quest-journal-panel {
      width: min(880px, calc(100vw - 48px));
      max-height: min(80vh, 760px);
      display: flex;
      flex-direction: column;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(24,24,37,0.97), rgba(17,17,27,0.98));
      box-shadow: 0 20px 72px rgba(0,0,0,0.4);
      overflow: hidden;
    }

    .sm-quest-journal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 22px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      font-size: 16px;
      font-weight: 700;
      color: #cdd6f4;
    }

    .sm-quest-journal-header-key {
      font-size: 12px;
      font-weight: 700;
      color: #89b4fa;
      padding: 6px 8px;
      border: 1px solid rgba(137, 180, 250, 0.38);
      border-radius: 8px;
      background: rgba(137, 180, 250, 0.14);
    }

    .sm-quest-journal-body {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      padding: 22px;
      overflow: auto;
    }

    .sm-quest-journal-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .sm-quest-journal-section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #6c7086;
    }

    .sm-quest-journal-empty {
      color: #9399b2;
      font-size: 13px;
      padding: 12px 0;
    }

    .sm-quest-journal-card {
      text-align: left;
      border: 1px solid rgba(255,255,255,0.08);
      background: #181825;
      border-radius: 14px;
      color: inherit;
      padding: 14px 16px;
      cursor: pointer;
    }

    .sm-quest-journal-card.completed {
      cursor: default;
      opacity: 0.8;
    }

    .sm-quest-journal-card.tracked {
      border-color: rgba(166, 227, 161, 0.5);
      box-shadow: inset 0 0 0 1px rgba(166, 227, 161, 0.2);
    }

    .sm-quest-journal-card-title {
      color: #cdd6f4;
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .sm-quest-journal-card-stage {
      color: #a6e3a1;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 8px;
    }

    .sm-quest-journal-card-description {
      color: #bac2de;
      font-size: 13px;
      line-height: 1.5;
    }

    .sm-quest-journal-objectives {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 12px;
    }

    .sm-quest-journal-objective {
      position: relative;
      padding-left: 14px;
      color: #f5e0dc;
      font-size: 12px;
      line-height: 1.45;
    }

    .sm-quest-journal-objective::before {
      content: "";
      position: absolute;
      top: 7px;
      left: 0;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #89b4fa;
    }
  `;
  document.head.appendChild(style);
}
