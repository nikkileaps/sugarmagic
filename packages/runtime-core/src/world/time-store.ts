export type { TimeOfDayBand } from "@sugarmagic/domain";
import type { TimeOfDayBand } from "@sugarmagic/domain";

export interface WorldTimeState {
  day: number;
  band: TimeOfDayBand;
}

const DEFAULT_BAND: TimeOfDayBand = "morning";
const DEFAULT_DAY = 1;

export class WorldTimeStore {
  private _band: TimeOfDayBand = DEFAULT_BAND;
  private _day: number = DEFAULT_DAY;
  private onBandChange: ((band: TimeOfDayBand) => void) | null = null;
  private onDayChange: ((day: number) => void) | null = null;
  private onDayRestore: ((day: number) => void) | null = null;

  getState(): WorldTimeState {
    return { day: this._day, band: this._band };
  }

  getBand(): TimeOfDayBand {
    return this._band;
  }

  getDay(): number {
    return this._day;
  }

  setTimeBand(band: TimeOfDayBand): void {
    if (band === this._band) return;
    this._band = band;
    this.onBandChange?.(band);
  }

  advanceDay(): void {
    this._day += 1;
    this.onDayChange?.(this._day);
  }

  setBandChangeCallback(cb: (band: TimeOfDayBand) => void): void {
    this.onBandChange = cb;
  }

  setDayChangeCallback(cb: (day: number) => void): void {
    this.onDayChange = cb;
  }

  /** Separate callback slot fired only by restore(), not by advanceDay().
   *  Use this to sync the blackboard without recording a recent-event. */
  setDayRestoreCallback(cb: (day: number) => void): void {
    this.onDayRestore = cb;
  }

  /** Restore state from a save slice. Fires band and day-restore callbacks so
   *  the blackboard tracks the restored state. Does NOT fire onDayChange so
   *  the event collector does not record a spurious day-advance event. */
  restore(state: WorldTimeState): void {
    this._band = state.band;
    this._day = state.day;
    this.onBandChange?.(state.band);
    this.onDayRestore?.(state.day);
  }
}

export function createWorldTimeStore(): WorldTimeStore {
  return new WorldTimeStore();
}
