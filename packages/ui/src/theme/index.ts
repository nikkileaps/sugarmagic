import { createTheme } from "@mantine/core";
import { shellColors } from "../tokens";

/**
 * Sugarmagic Mantine theme.
 *
 * Inherits the Sugarengine Catppuccin Mocha palette through shared tokens.
 * This theme is for the editor shell only — published-game UI must not use it.
 */
export const sugarmagicTheme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",
  colors: {
    dark: [
      shellColors.text,
      shellColors.subtext,
      "#a6adc8",
      shellColors.overlay2,
      shellColors.overlay1,
      shellColors.overlay0,
      shellColors.surface2,
      shellColors.surface1,
      shellColors.base,
      shellColors.mantle
    ]
  },
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
});
