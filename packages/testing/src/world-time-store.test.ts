import { describe, expect, it, vi } from "vitest";
import {
  createWorldTimeStore,
  WorldTimeStore,
  createWorldTimeSaveParticipant,
  WORLD_TIME_PARTICIPANT_ID,
  WORLD_TIME_SLICE_SCHEMA_VERSION,
  type WorldTimeSlice,
  createRuntimeBlackboard,
  getTimeOfDayBand,
  getWorldDay,
  setWorldTimeOfDay,
  setWorldDay,
  WORLD_TIME_OF_DAY_FACT,
  WORLD_DAY_FACT
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

  it("restore fires band and day-restore callbacks (not day-change) so blackboard syncs without a recent-event", () => {
    const store = createWorldTimeStore();
    const bandCb = vi.fn();
    const dayChangeCb = vi.fn();
    const dayRestoreCb = vi.fn();
    store.setBandChangeCallback(bandCb);
    store.setDayChangeCallback(dayChangeCb);
    store.setDayRestoreCallback(dayRestoreCb);
    store.restore({ day: 5, band: "dusk" });
    expect(store.getBand()).toBe("dusk");
    expect(store.getDay()).toBe(5);
    expect(bandCb).toHaveBeenCalledOnce();
    expect(bandCb).toHaveBeenCalledWith("dusk");
    expect(dayRestoreCb).toHaveBeenCalledOnce();
    expect(dayRestoreCb).toHaveBeenCalledWith(5);
    expect(dayChangeCb).not.toHaveBeenCalled();
  });

  it("restore without callbacks wired does not throw", () => {
    const store = createWorldTimeStore();
    expect(() => store.restore({ day: 5, band: "dusk" })).not.toThrow();
  });
});

describe("world.time-of-day and world.day blackboard facts", () => {
  it("getTimeOfDayBand defaults to morning when no fact set", () => {
    const bb = createRuntimeBlackboard();
    expect(getTimeOfDayBand(bb)).toBe("morning");
  });

  it("getWorldDay defaults to 1 when no fact set", () => {
    const bb = createRuntimeBlackboard();
    expect(getWorldDay(bb)).toBe(1);
  });

  it("setWorldTimeOfDay / getTimeOfDayBand round-trip", () => {
    const bb = createRuntimeBlackboard();
    setWorldTimeOfDay(bb, "dusk");
    expect(getTimeOfDayBand(bb)).toBe("dusk");
  });

  it("setWorldDay / getWorldDay round-trip", () => {
    const bb = createRuntimeBlackboard();
    setWorldDay(bb, 4);
    expect(getWorldDay(bb)).toBe(4);
  });

  it("fact definitions exist in RUNTIME_BLACKBOARD_FACT_DEFINITIONS (blackboard accepts them)", () => {
    const bb = createRuntimeBlackboard();
    setWorldTimeOfDay(bb, "night");
    setWorldDay(bb, 7);
    expect(getTimeOfDayBand(bb)).toBe("night");
    expect(getWorldDay(bb)).toBe(7);
  });

  it("store callback -> blackboard round-trip via setWorldTimeOfDay", () => {
    const store = createWorldTimeStore();
    const bb = createRuntimeBlackboard();
    store.setBandChangeCallback((band) => setWorldTimeOfDay(bb, band));
    store.setDayChangeCallback((day) => setWorldDay(bb, day));
    setWorldTimeOfDay(bb, store.getBand());
    setWorldDay(bb, store.getDay());
    store.setTimeBand("evening");
    store.advanceDay();
    expect(getTimeOfDayBand(bb)).toBe("evening");
    expect(getWorldDay(bb)).toBe(2);
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
