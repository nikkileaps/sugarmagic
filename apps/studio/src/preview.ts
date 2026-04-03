import type {
  ContentLibrarySnapshot,
  DocumentDefinition,
  DialogueDefinition,
  ItemDefinition,
  NPCDefinition,
  PlayerDefinition,
  QuestDefinition,
  SpellDefinition,
  RegionDocument
} from "@sugarmagic/domain";
import type { RuntimeBootModel } from "@sugarmagic/runtime-core";
import { createWebRuntimeHost } from "@sugarmagic/target-web";

interface PreviewBootMessage {
  type: "PREVIEW_BOOT";
  regions: RegionDocument[];
  activeRegionId?: string | null;
  activeEnvironmentId?: string | null;
  contentLibrary: ContentLibrarySnapshot;
  playerDefinition: PlayerDefinition;
  spellDefinitions: SpellDefinition[];
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
  assetSources: Record<string, string>;
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
    host.start({
      regions: data.regions,
      activeRegionId: data.activeRegionId,
      activeEnvironmentId: data.activeEnvironmentId,
      contentLibrary: data.contentLibrary,
      playerDefinition: data.playerDefinition,
      spellDefinitions: data.spellDefinitions,
      itemDefinitions: data.itemDefinitions,
      documentDefinitions: data.documentDefinitions,
      npcDefinitions: data.npcDefinitions,
      dialogueDefinitions: data.dialogueDefinitions,
      questDefinitions: data.questDefinitions,
      assetSources: data.assetSources
    });
  }
});

if (window.opener) {
  const message: PreviewReadyMessage = { type: "PREVIEW_READY", boot: host.boot };
  window.opener.postMessage(message, "*");
}
