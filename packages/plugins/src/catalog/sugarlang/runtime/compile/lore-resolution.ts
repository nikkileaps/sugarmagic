/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/lore-resolution.ts
 *
 * Purpose: Resolves canonical lore wiki page ids into compile-ready scene lore pages.
 *
 * Exports:
 *   - SugarlangResolvedLorePageSection
 *   - SugarlangResolvedLorePage
 *   - SugarlangLoreResolutionClient
 *   - SugarlangGatewayLoreClient
 *   - resolveSugarlangGatewayBaseUrl
 *   - resolveSceneAuthoringContexts
 *
 * Relationships:
 *   - Depends on scene-traversal for the final scene-context assembly shape.
 *   - Is consumed by Studio authoring helpers and preview boot so compile-time
 *     lore resolution matches SugarAgent's canonical lore wiki path.
 *
 * Implements: Fast-path gateway-backed lore resolution for Sugarlang compile
 *
 * Status: active
 */

import type {
  DialogueDefinition,
  DocumentDefinition,
  ItemDefinition,
  NPCDefinition,
  QuestDefinition,
  RegionDocument
} from "@sugarmagic/domain";
import { SUGARLANG_PROXY_BASE_URL_ENV } from "../../config";
import {
  createSceneAuthoringContext,
  type SceneAuthoringContext,
  type SceneLorePage
} from "./scene-traversal";

export interface SugarlangResolvedLorePageSection {
  heading: string;
  slug: string;
  content: string;
}

export interface SugarlangResolvedLorePage {
  pageId: string;
  title: string;
  relativePath: string;
  body: string;
  sections: SugarlangResolvedLorePageSection[];
}

export interface SugarlangLoreResolutionClient {
  resolveLorePages(pageIds: string[]): Promise<SugarlangResolvedLorePage[]>;
}

export interface ResolveSceneAuthoringContextsInput {
  region: RegionDocument;
  targetLanguage: string;
  supportLanguage?: string;
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
}

type SugarlangGatewayEnvironment = Partial<
  Record<
    | typeof SUGARLANG_PROXY_BASE_URL_ENV
    | "SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL",
    string | undefined
  >
>;

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResolvedLorePageSection(
  value: unknown
): value is SugarlangResolvedLorePageSection {
  return (
    isRecord(value) &&
    typeof value.heading === "string" &&
    typeof value.slug === "string" &&
    typeof value.content === "string"
  );
}

function isResolvedLorePage(value: unknown): value is SugarlangResolvedLorePage {
  return (
    isRecord(value) &&
    typeof value.pageId === "string" &&
    typeof value.title === "string" &&
    typeof value.relativePath === "string" &&
    typeof value.body === "string" &&
    Array.isArray(value.sections) &&
    value.sections.every(isResolvedLorePageSection)
  );
}

function toSceneLorePage(page: SugarlangResolvedLorePage): SceneLorePage {
  return {
    lorePageId: page.pageId,
    displayName: page.title,
    body: page.body,
    pages: [],
    sections: page.sections.map((section) => ({
      heading: section.heading,
      body: section.content
    }))
  };
}

function collectReferencedWikiLorePageIds(
  region: RegionDocument,
  npcDefinitions: NPCDefinition[]
): string[] {
  const presentNpcIds = new Set(
    region.scene.npcPresences.map((presence) => presence.npcDefinitionId)
  );
  const referenced = new Set<string>();

  const pushMaybe = (value: string | null | undefined) => {
    if (typeof value === "string" && value.trim().length > 0) {
      referenced.add(value.trim());
    }
  };

  pushMaybe(region.lorePageId);
  for (const area of region.areas) {
    pushMaybe(area.lorePageId);
  }
  for (const npc of npcDefinitions) {
    if (presentNpcIds.has(npc.definitionId)) {
      pushMaybe(npc.lorePageId);
    }
  }

  return [...referenced].sort((left, right) => left.localeCompare(right));
}

export function resolveSugarlangGatewayBaseUrl(
  environment?: SugarlangGatewayEnvironment,
  host: Record<string, unknown> = globalThis as Record<string, unknown>
): string {
  const value =
    environment?.[SUGARLANG_PROXY_BASE_URL_ENV]?.trim() ||
    environment?.SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL?.trim() ||
    (typeof host[SUGARLANG_PROXY_BASE_URL_ENV] === "string"
      ? String(host[SUGARLANG_PROXY_BASE_URL_ENV]).trim()
      : "") ||
    (typeof host.SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL === "string"
      ? String(host.SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL).trim()
      : "");

  return value;
}

export class SugarlangGatewayLoreClient implements SugarlangLoreResolutionClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    if (!baseUrl.trim()) {
      throw new Error(
        "SugarlangGatewayLoreClient requires a non-empty base URL. " +
          "Set SUGARMAGIC_SUGARLANG_PROXY_BASE_URL or SUGARMAGIC_SUGARAGENT_PROXY_BASE_URL."
      );
    }
    this.baseUrl = normalizeBaseUrl(baseUrl.trim());
  }

  async resolveLorePages(pageIds: string[]): Promise<SugarlangResolvedLorePage[]> {
    const normalizedPageIds = [...new Set(pageIds.map((pageId) => pageId.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    if (normalizedPageIds.length === 0) {
      return [];
    }

    const response = await fetch(`${this.baseUrl}/api/sugaragent/lore/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pageIds: normalizedPageIds })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(unreadable)");
      throw new Error(
        `Sugarlang gateway lore resolve failed: ${response.status} ${response.statusText} — ${body}`
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    return Array.isArray(payload.pages)
      ? payload.pages.filter(isResolvedLorePage)
      : [];
  }
}

export async function resolveSceneAuthoringContexts(
  inputs: ResolveSceneAuthoringContextsInput[],
  loreClient?: SugarlangLoreResolutionClient | null
): Promise<SceneAuthoringContext[]> {
  const referencedLorePageIds = new Set<string>();
  for (const input of inputs) {
    for (const pageId of collectReferencedWikiLorePageIds(
      input.region,
      input.npcDefinitions
    )) {
      referencedLorePageIds.add(pageId);
    }
  }

  const resolvedPages = loreClient
    ? await loreClient.resolveLorePages([...referencedLorePageIds])
    : [];
  const resolvedPagesById = new Map(
    resolvedPages.map((page) => [page.pageId, toSceneLorePage(page)])
  );

  return inputs
    .map((input) =>
      createSceneAuthoringContext({
        ...input,
        resolvedLorePages: collectReferencedWikiLorePageIds(
          input.region,
          input.npcDefinitions
        )
          .map((pageId) => resolvedPagesById.get(pageId) ?? null)
          .filter((page): page is SceneLorePage => page !== null)
      })
    )
    .sort((left, right) => left.sceneId.localeCompare(right.sceneId));
}
