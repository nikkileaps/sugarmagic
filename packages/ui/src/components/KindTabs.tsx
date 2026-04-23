/**
 * KindTabs
 *
 * Generic tabbed picker over a string-literal union. Callers own the actual
 * domain meaning of each tab.
 */

import { Tabs } from "@mantine/core";
import type { ReactNode } from "react";

export interface KindTabsOption<K extends string> {
  value: K;
  label: string;
}

export interface KindTabsProps<K extends string> {
  value: K;
  options: readonly KindTabsOption<K>[];
  onChange: (value: K) => void;
  renderPanel: (value: K) => ReactNode;
}

export function KindTabs<K extends string>({
  value,
  options,
  onChange,
  renderPanel
}: KindTabsProps<K>) {
  return (
    <Tabs
      value={value}
      onChange={(next) => {
        if (!next) {
          return;
        }
        onChange(next as K);
      }}
    >
      <Tabs.List>
        {options.map((option) => (
          <Tabs.Tab key={option.value} value={option.value}>
            {option.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {options.map((option) => (
        <Tabs.Panel key={option.value} value={option.value} pt="sm">
          {renderPanel(option.value)}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
