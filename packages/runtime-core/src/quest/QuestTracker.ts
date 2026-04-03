import type { QuestTrackerView } from "./QuestManager";

export interface RuntimeQuestTracker {
  update: (quest: QuestTrackerView | null) => void;
  dispose: () => void;
}

export function createRuntimeQuestTracker(
  parentContainer: HTMLElement
): RuntimeQuestTracker {
  injectStyles();

  const container = document.createElement("div");
  container.className = "sm-quest-tracker";
  parentContainer.appendChild(container);

  return {
    update(quest) {
      container.innerHTML = "";
      if (!quest || quest.objectives.length === 0) {
        container.classList.remove("visible");
        return;
      }

      container.classList.add("visible");

      const title = document.createElement("div");
      title.className = "sm-quest-tracker-title";
      title.textContent = quest.displayName;
      container.appendChild(title);

      const stage = document.createElement("div");
      stage.className = "sm-quest-tracker-stage";
      stage.textContent = quest.stageDisplayName;
      container.appendChild(stage);

      const list = document.createElement("div");
      list.className = "sm-quest-tracker-list";
      for (const objective of quest.objectives) {
        const item = document.createElement("div");
        item.className = "sm-quest-tracker-item";
        item.textContent = objective.description || objective.displayName;
        list.appendChild(item);
      }
      container.appendChild(list);
    },
    dispose() {
      parentContainer.removeChild(container);
    }
  };
}

function injectStyles() {
  if (document.getElementById("sm-quest-tracker-styles")) return;

  const style = document.createElement("style");
  style.id = "sm-quest-tracker-styles";
  style.textContent = `
    .sm-quest-tracker {
      position: absolute;
      top: 28px;
      left: 28px;
      width: min(320px, calc(100vw - 56px));
      padding: 16px 18px;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.08);
      background: linear-gradient(180deg, rgba(24,24,37,0.94), rgba(17,17,27,0.96));
      box-shadow: 0 18px 54px rgba(0,0,0,0.34);
      color: #cdd6f4;
      z-index: 14;
      opacity: 0;
      transform: translateY(-6px);
      transition: opacity 0.18s ease-out, transform 0.18s ease-out;
      pointer-events: none;
    }

    .sm-quest-tracker.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .sm-quest-tracker-title {
      font-size: 14px;
      font-weight: 700;
      color: #a6e3a1;
      margin-bottom: 2px;
    }

    .sm-quest-tracker-stage {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #6c7086;
      margin-bottom: 10px;
    }

    .sm-quest-tracker-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .sm-quest-tracker-item {
      position: relative;
      padding-left: 14px;
      font-size: 13px;
      line-height: 1.45;
      color: #f5e0dc;
    }

    .sm-quest-tracker-item::before {
      content: "";
      position: absolute;
      left: 0;
      top: 8px;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #89b4fa;
      box-shadow: 0 0 10px rgba(137, 180, 250, 0.35);
    }
  `;
  document.head.appendChild(style);
}
