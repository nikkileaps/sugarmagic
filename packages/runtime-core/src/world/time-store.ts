export type TimeOfDayBand =
  | "dawn"
  | "morning"
  | "midday"
  | "afternoon"
  | "dusk"
  | "evening"
  | "night";

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

  /** Restore state from a save slice. Does NOT fire callbacks --
   *  074.2' wires the blackboard after deserialization completes. */
  restore(state: WorldTimeState): void {
    this._band = state.band;
    this._day = state.day;
  }
}

export function createWorldTimeStore(): WorldTimeStore {
  return new WorldTimeStore();
}
