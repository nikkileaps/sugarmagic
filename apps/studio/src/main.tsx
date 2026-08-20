import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { sugarmagicTheme } from "@sugarmagic/ui";
import { App } from "./App";

import "@mantine/core/styles.css";
import "@sugarmagic/ui/shell-variables.css";
// Node-editor styles. Imported here rather than in @sugarmagic/ui because a CSS
// import is a side effect that survives tree-shaking: from the ui barrel it would
// reach the shipped game bundle, which never renders a node editor.
import "@xyflow/react/dist/style.css";
import "@sugarmagic/ui/node-editor.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={sugarmagicTheme} defaultColorScheme="dark">
      <App />
    </MantineProvider>
  </React.StrictMode>
);
