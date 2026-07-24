import { describe, expect, it, vi } from "vitest";
import {
  createWorldTimeStore,
  WorldTimeStore
} from "@sugarmagic/runtime-core";
import {
  createWorldTimeSaveParticipant,
  WORLD_TIME_PARTICIPANT_ID,
  WORLD_TIME_SLICE_SCHEMA_VERSION,
  type WorldTimeSlice
} from "@sugarmagic/runtime-core";
import type { SaveSlice } from "@sugarmagic/domain";

describe("WorldTimeStore", () => {
  it("defaults to morning day 1", () => {
    const store = createWorldTimeStore();
    expect(store.getBand()).toBe("morning");
    expect(store.getDay()).toBe(1);
  });

  it("setTimeBand updates the band", () => {
    const store = createWorldTimeStore();
    store.setTimeBand("dusk");
    expect(store.getBand()).toBe("dusk");
  });

  it("advanceDay increments the day", () => {
    const store = createWorldTimeStore();
    store.advanceDay();
    store.advanceDay();
    expect(store.getDay()).toBe(3);
  });

  it("setTimeBand fires the band callback", () => {
    const store = createWorldTimeStore();
    const cb = vi.fn();
    store.setBandChangeCallback(cb);
    store.setTimeBand("night");
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith("night");
  });

  it("advanceDay fires the day callback", () => {
    const store = createWorldTimeStore();
    const cb = vi.fn();
    store.setDayChangeCallback(cb);
    store.advanceDay();
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(2);
  });

  it("equality gate: setTimeBand with the same band does NOT fire callback", () => {
    const store = createWorldTimeStore();
    const cb = vi.fn();
    store.setBandChangeCallback(cb);
    store.setTimeBand("morning"); // already morning
    expect(cb).not.toHaveBeenCalled();
  });

  it("equality gate: setTimeBand night then dawn fires on both transitions", () => {
    const store = createWorldTimeStore();
    const cb = vi.fn();
    store.setBandChangeCallback(cb);
    store.setTimeBand("night");
    store.setTimeBand("dawn");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("getState returns consistent snapshot", () => {
    const store = createWorldTimeStore();
    store.setTimeBand("evening");
    store.advanceDay();
    expect(store.getState()).toEqual({ day: 2, band: "evening" });
  });

  it("restore sets state without firing callbacks", () => {
    const store = createWorldTimeStore();
    const bandCb = vi.fn();
    const dayCb = vi.fn();
    store.setBandChangeCallback(bandCb);
    store.setDayChangeCallback(dayCb);
    store.restore({ day: 5, band: "dusk" });
    expect(store.getBand()).toBe("dusk");
    expect(store.getDay()).toBe(5);
    expect(bandCb).not.toHaveBeenCalled();
    expect(dayCb).not.toHaveBeenCalled();
  });
});

describe("createWorldTimeSaveParticipant", () => {
  it("declares correct participantId, tier, schemaVersion", () => {
    const p = createWorldTimeSaveParticipant({ getWorldTimeStore: () => null });
    expect(p.participantId).toBe(WORLD_TIME_PARTICIPANT_ID);
    expect(p.tier).toBe("default");
    expect(p.schemaVersion).toBe(WORLD_TIME_SLICE_SCHEMA_VERSION);
  });

  it("serialize returns empty slice when getter yields null", () => {
    const p = createWorldTimeSaveParticipant({ getWorldTimeStore: () => null });
    expect(p.serialize()).toEqual({ day: 1, band: "morning" });
  });

  it("deserialize is a no-op when getter yields null", () => {
    const p = createWorldTimeSaveParticipant({ getWorldTimeStore: () => null });
    expect(() =>
      p.deserialize({ schemaVersion: 1, data: { day: 3, band: "dusk" } } as SaveSlice<WorldTimeSlice>)
    ).not.toThrow();
  });

  it("serialize reflects live store state", () => {
    const store = createWorldTimeStore();
    store.setTimeBand("night");
    store.advanceDay();
    store.advanceDay();
    const p = createWorldTimeSaveParticipant({ getWorldTimeStore: () => store });
    expect(p.serialize()).toEqual({ day: 3, band: "night" });
  });

  it("deserialize restores state into the store", () => {
    const store = createWorldTimeStore();
    const p = createWorldTimeSaveParticipant({ getWorldTimeStore: () => store });
    p.deserialize({ schemaVersion: 1, data: { day: 7, band: "dawn" } } as SaveSlice<WorldTimeSlice>);
    expect(store.getBand()).toBe("dawn");
    expect(store.getDay()).toBe(7);
  });

  it("deserialize(null) resets to defaults", () => {
    const store = createWorldTimeStore();
    store.setTimeBand("night");
    store.advanceDay();
    const p = createWorldTimeSaveParticipant({ getWorldTimeStore: () => store });
    p.deserialize(null);
    expect(store.getBand()).toBe("morning");
    expect(store.getDay()).toBe(1);
  });

  it("slice contains no timestamp fields (no wall-clock)", () => {
    const store = createWorldTimeStore();
    store.setTimeBand("midday");
    store.advanceDay();
    const p = createWorldTimeSaveParticipant({ getWorldTimeStore: () => store });
    const slice = p.serialize();
    const keys = Object.keys(slice);
    expect(keys).toEqual(expect.arrayContaining(["day", "band"]));
    expect(keys).not.toContain("timestamp");
    expect(keys).not.toContain("updatedAt");
    expect(keys.length).toBe(2);
  });
});
