import type { RegionDocument } from "@sugarmagic/domain";
import type { RuntimeBootModel } from "@sugarmagic/runtime-core";
import { createWebRuntimeHost } from "@sugarmagic/target-web";

interface PreviewBootMessage {
  type: "PREVIEW_BOOT";
  regions: RegionDocument[];
}

interface PreviewReadyMessage {
  type: "PREVIEW_READY";
  boot: RuntimeBootModel;
}

const root = document.getElementById("preview-root");

if (!root) {
  throw new Error("Preview root element was not found.");
}

const host = createWebRuntimeHost({
  root,
  ownerWindow: window,
  request: {
    hostKind: "studio",
    compileProfile: "runtime-preview",
    contentSource: "authored-game-root"
  }
});

window.addEventListener("message", (event) => {
  const data = event.data as PreviewBootMessage | undefined;
  if (data?.type === "PREVIEW_BOOT") {
    host.start(data.regions);
  }
});

if (window.opener) {
  const message: PreviewReadyMessage = { type: "PREVIEW_READY", boot: host.boot };
  window.opener.postMessage(message, "*");
}
