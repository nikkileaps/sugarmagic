import { createPreviewWindowHost } from "@sugarmagic/runtime-web";

const root = document.getElementById("preview-root");

if (!root) {
  throw new Error("Preview root element was not found.");
}

const host = createPreviewWindowHost({
  root,
  opener: window.opener,
  ownerWindow: window
});

host.start();
