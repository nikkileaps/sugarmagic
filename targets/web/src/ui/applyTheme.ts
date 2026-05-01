/**
 * Web target compiler for project UI themes.
 *
 * Domain themes are target-agnostic token/style data. This module is the web
 * target's single place for turning those tokens into CSS custom properties
 * and React inline style objects.
 */

import type { CSSProperties } from "react";
import type { UIStyleDefinition, UITheme } from "@sugarmagic/domain";

function tokenToCssVariableName(token: string): string {
  return `--sm-game-ui-${token.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

export function compileThemeVariables(theme: UITheme): CSSProperties {
  const variables: Record<string, string> = {};
  for (const [token, value] of Object.entries(theme.tokens)) {
    variables[tokenToCssVariableName(token)] = value;
  }
  return variables as CSSProperties;
}

function resolveTokenValue(value: string | undefined, theme: UITheme): string | undefined {
  if (!value) return undefined;
  if (theme.tokens[value]) {
    return `var(${tokenToCssVariableName(value)})`;
  }
  return value;
}

export function compileStyleDefinition(
  style: UIStyleDefinition | null | undefined,
  theme: UITheme
): CSSProperties {
  if (!style) return {};
  const properties = style.properties;
  return {
    color: resolveTokenValue(properties.color, theme),
    background: resolveTokenValue(properties.background, theme),
    fontSize: properties.fontSize,
    fontFamily: resolveTokenValue(properties.fontFamily, theme),
    fontWeight: properties.fontWeight,
    borderRadius: resolveTokenValue(properties.borderRadius, theme),
    borderColor: resolveTokenValue(properties.borderColor, theme),
    borderWidth: properties.borderWidth,
    borderStyle: properties.borderWidth ? "solid" : undefined,
    opacity: properties.opacity
  };
}

export function findStyle(theme: UITheme, styleId: string | null | undefined) {
  if (!styleId) return null;
  return theme.styles.find((style) => style.styleId === styleId) ?? null;
}
