import type { QuestRuntimeEvent } from "./QuestManager";

export interface RuntimeQuestNotificationCenter {
  push: (event: QuestRuntimeEvent) => void;
  dispose: () => void;
}

export function createRuntimeQuestNotificationCenter(
  parentContainer: HTMLElement
): RuntimeQuestNotificationCenter {
  injectStyles();

  const container = document.createElement("div");
  container.className = "sm-quest-notifications";
  parentContainer.appendChild(container);

  let counter = 0;

  function createMessage(event: QuestRuntimeEvent): string | null {
    switch (event.type) {
      case "quest-start":
        return `Quest started: ${event.displayName}`;
      case "stage-advance":
        return `${event.displayName}: ${event.stageDisplayName}`;
      case "quest-complete":
        return `Quest complete: ${event.displayName}`;
      case "objective-complete":
        return `${event.displayName}: ${event.objectiveDisplayName}`;
      default:
        return null;
    }
  }

  function pushToast(message: string) {
    const toast = document.createElement("div");
    toast.className = "sm-quest-toast";
    toast.style.setProperty("--toast-index", String(counter++));
    toast.textContent = message;
    container.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("leaving");
      window.setTimeout(() => {
        if (toast.parentElement === container) {
          container.removeChild(toast);
        }
      }, 180);
    }, 2400);
  }

  return {
    push(event) {
      const message = createMessage(event);
      if (!message) return;
      pushToast(message);
    },
    dispose() {
      parentContainer.removeChild(container);
    }
  };
}

function injectStyles() {
  if (document.getElementById("sm-quest-notification-styles")) return;

  const style = document.createElement("style");
  style.id = "sm-quest-notification-styles";
  style.textContent = `
    .sm-quest-notifications {
      position: absolute;
      right: 24px;
      bottom: 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: flex-end;
      z-index: 18;
      pointer-events: none;
    }

    .sm-quest-toast {
      min-width: 240px;
      max-width: min(360px, calc(100vw - 48px));
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(166, 227, 161, 0.22);
      background: linear-gradient(180deg, rgba(36, 38, 50, 0.95), rgba(24, 24, 37, 0.97));
      color: #f5e0dc;
      box-shadow: 0 10px 24px rgba(0,0,0,0.26);
      opacity: 0;
      transform: translateY(8px);
      animation: sm-quest-toast-in 180ms ease-out forwards;
    }

    .sm-quest-toast.leaving {
      opacity: 0;
      transform: translateY(6px);
      transition: opacity 180ms ease-out, transform 180ms ease-out;
    }

    @keyframes sm-quest-toast-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `;
  document.head.appendChild(style);
}
