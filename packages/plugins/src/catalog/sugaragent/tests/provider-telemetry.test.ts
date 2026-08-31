/**
 * packages/plugins/src/catalog/sugaragent/tests/provider-telemetry.test.ts
 *
 * Purpose: a turn driven through the real provider emits the degraded-turn
 *   event, through the collector the plugin was handed.
 *
 * The other telemetry test exercises the event BUILDER in isolation. Nothing
 * exercised the wiring that calls it, and two real gaps reached production as
 * a result: stalled turns emitted nothing, and the Plan verdict was missing
 * from every event. Both were found by reading prod logs, which is the
 * expensive way.
 *
 * No gateway is configured here, so the pipeline degrades on its own -- which
 * is the turn worth reporting anyway.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { BindableTelemetryCollector, type TelemetryEventBase } from "@sugarmagic/runtime-core";
import { createSugarAgentConversationProvider } from "../runtime/provider";
import { normalizeSugarAgentPluginConfig } from "../index";

function collectorCapturing(events: TelemetryEventBase[]) {
  const collector = new BindableTelemetryCollector();
  collector.bind({ emit: (event) => void events.push(event) });
  return collector;
}

async function runOneTurn(playerText: string) {
  const events: TelemetryEventBase[] = [];
  const provider = createSugarAgentConversationProvider(
    // No proxy base URL: every gateway-backed provider resolves to null, so
    // the pipeline takes its deterministic path without any network.
    normalizeSugarAgentPluginConfig({}),
    collectorCapturing(events)
  );

  const selection = {
    conversationKind: "free-form" as const,
    npcDefinitionId: "npc-penelope",
    npcDisplayName: "Penelope"
  };
  const execution = {
    selection,
    input: null,
    state: {} as Record<string, unknown>,
    annotations: {}
  };

  const started = await provider.startSession({ selection, execution } as never);
  expect(started).not.toBeNull();

  const turn = await started!.session.advance(
    { kind: "free_text", text: playerText } as never,
    execution as never
  );

  return { events, turn };
}

describe("the provider emits through the collector it was given", () => {
  it("a degraded turn reaches the collector", async () => {
    const { events } = await runOneTurn("wakka wakka");

    const degraded = events.filter(
      (event) => event.kind === "sugaragent.turn-degraded"
    );
    expect(degraded.length).toBeGreaterThan(0);
  });

  it("the emitted event carries the ids and the Plan verdict", async () => {
    const { events } = await runOneTurn("where should I go next?");

    const event = events.find(
      (candidate) => candidate.kind === "sugaragent.turn-degraded"
    ) as Record<string, unknown> | undefined;
    expect(event).toBeDefined();

    // Ids, so a row in the logs can be traced to a turn and a conversation.
    expect(event!.turnId).toEqual(expect.any(String));
    expect(event!.sessionId).toEqual(expect.any(String));
    expect(event!.conversationId).toBe("npc-penelope");

    // The Plan verdict rides along. These are the fields isStalledTurn reads,
    // and without them a close cannot be attributed.
    expect(event).toHaveProperty("responseIntent");
    expect(event).toHaveProperty("responseSpecificity");
    expect(event).toHaveProperty("turnPath");
  });

  it("carries no player text, on a real turn", async () => {
    const marker = "zzz-player-typing-marker-zzz";
    const { events } = await runOneTurn(marker);

    expect(JSON.stringify(events)).not.toContain(marker);
  });

  it("emits nothing when the plugin was handed no collector", async () => {
    // The default is a no-op collector, so a host with no gateway does not
    // make the provider throw on every turn.
    const provider = createSugarAgentConversationProvider(
      normalizeSugarAgentPluginConfig({})
    );
    const selection = {
      conversationKind: "free-form" as const,
      npcDefinitionId: "npc-penelope",
      npcDisplayName: "Penelope"
    };
    const execution = {
      selection,
      input: null,
      state: {} as Record<string, unknown>,
      annotations: {}
    };

    const started = await provider.startSession({ selection, execution } as never);
    await expect(
      started!.session.advance(
        { kind: "free_text", text: "hello" } as never,
        execution as never
      )
    ).resolves.toBeDefined();
  });
});
