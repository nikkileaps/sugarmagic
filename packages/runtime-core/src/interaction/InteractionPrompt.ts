export interface RuntimeInteractionPrompt {
  show: (actionText?: string) => void;
  hide: () => void;
  dispose: () => void;
}

export function createRuntimeInteractionPrompt(
  parentContainer: HTMLElement
): RuntimeInteractionPrompt {
  injectStyles();

  const element = document.createElement("div");
  element.className = "sm-interaction-prompt";

  const keyElement = document.createElement("span");
  keyElement.className = "sm-interaction-key";
  keyElement.textContent = "E";
  element.appendChild(keyElement);

  const textElement = document.createElement("span");
  textElement.className = "sm-interaction-text";
  textElement.textContent = " Talk";
  element.appendChild(textElement);

  parentContainer.appendChild(element);

  return {
    show(actionText = "Interact") {
      textElement.textContent = ` ${actionText}`;
      element.classList.add("visible");
    },
    hide() {
      element.classList.remove("visible");
    },
    dispose() {
      parentContainer.removeChild(element);
    }
  };
}

function injectStyles() {
  if (document.getElementById("sm-interaction-prompt-styles")) return;

  const style = document.createElement("style");
  style.id = "sm-interaction-prompt-styles";
  style.textContent = `
    .sm-interaction-prompt {
      position: absolute;
      left: 50%;
      bottom: 100px;
      transform: translateX(-50%) translateY(6px);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 18px;
      border-radius: 12px;
      border: 1px solid rgba(180, 160, 140, 0.35);
      background: linear-gradient(180deg, rgba(35, 30, 45, 0.95), rgba(25, 22, 35, 0.95));
      color: #f0e6d8;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      pointer-events: none;
      z-index: 15;
      opacity: 0;
      transition: opacity 0.18s ease-out, transform 0.18s ease-out;
    }

    .sm-interaction-prompt.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    .sm-interaction-key {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 28px;
      height: 28px;
      padding: 0 8px;
      border-radius: 8px;
      border: 1px solid rgba(136, 180, 220, 0.4);
      background: linear-gradient(135deg, rgba(136, 180, 220, 0.3), rgba(100, 140, 180, 0.2));
      color: #a8d4f0;
      font-size: 14px;
      font-weight: 700;
      box-shadow: 0 0 8px rgba(136, 180, 220, 0.18);
    }

    .sm-interaction-text {
      font-size: 15px;
      font-weight: 500;
      letter-spacing: 0.01em;
    }
  `;
  document.head.appendChild(style);
}
