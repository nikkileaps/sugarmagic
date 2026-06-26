import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { sugarmagicTheme } from "@sugarmagic/ui";
import { App } from "./App";

// Story 47.7.5 — SugarProfile's LoginModal + SignedInBadge use
// Mantine components; published-web needs the MantineProvider at
// the React root same as Studio's main.tsx. The provider also gives
// every future Mantine component (modals, tooltips, IdChip, etc.)
// the portal + theme context they require to render.
import "@mantine/core/styles.css";
import "@sugarmagic/ui/shell-variables.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={sugarmagicTheme} defaultColorScheme="dark">
      <App />
    </MantineProvider>
  </React.StrictMode>
);
