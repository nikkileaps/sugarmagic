import type { SaveSlice, WorldFlagNameResolver } from "@sugarmagic/domain";

/**
 * Turn a flag value typed into an editor into the value the flag store holds.
 * Both the `setFlag` action and the `hasFlag` condition run their authored text
 * through this, so the two sides always land on the same type and `===` can
 * decide the comparison.
 *
 * Without it, an author who leaves a `setFlag` action's value box empty stores
 * boolean `true`, then types `true` into a condition and stores the string
 * `"true"`, and the condition never matches.
 *
 * Anything that is not a string is already typed -- a save restored from JSON,
 * a flag set from code -- and passes through untouched.
 */
export function coerceAuthoredWorldFlagValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  const asNumber = Number(value);
  if (value.trim() !== "" && Number.isFinite(asNumber)) {
    return asNumber;
  }
  return value;
}

export interface WorldFlagSlice {
  /** Keyed by flag NAME, which is what the runtime store is keyed by. */
  worldFlags: Record<string, unknown>;
}

/**
 * The project's world flags at runtime.
 *
 * One store, read and written by quests, dialogue, spells, NPC behavior,
 * containment volumes and agent conversation. It lived on `QuestManager` for
 * historical reasons; four of its five writers and four of its six readers are
 * outside the quest system, so quests are a caller here like anything else.
 *
 * Keyed by flag NAME. Authored content references a flag by id and resolves
 * through `setWorldFlagNameResolver`; the paths that can only name a flag in a
 * string -- the dev handles, an agent's proposal -- use the name directly.
 */
export class WorldFlagManager {
  private flags = new Map<string, unknown>();
  private onChange: (() => void) | null = null;
  /**
   * Resolves a flag reference to the flag's name. Injected rather than read
   * from a registry here: the registry lives on GameProject, which
   * runtime-core does not depend on. Default resolves nothing, so a manager
   * with no registry wired treats every reference as dangling.
   */
  private resolveFlagName: WorldFlagNameResolver = () => null;

  /**
   * Called after any write that goes through `setFlag`. The quest system uses
   * it to re-evaluate conditions; see `setFlagWithoutNotifying` for the write
   * that must not.
   */
  setChangeHandler(handler: () => void): void {
    this.onChange = handler;
  }

  setWorldFlagNameResolver(resolver: WorldFlagNameResolver): void {
    this.resolveFlagName = resolver;
  }

  /**
   * True when the flag holds `value`. An unset flag is false, so a condition
   * reads the same whether the flag was never written or holds something else.
   *
   * `value` defaults to `true` because that is what `setFlag` writes by
   * default, so `hasFlag(key)` asks the question it looks like it asks.
   * Authored values are coerced by the caller before they get here; this is
   * only the comparison.
   */
  hasFlag(key: string, value: unknown = true): boolean {
    if (!this.flags.has(key)) {
      return false;
    }
    return this.flags.get(key) === value;
  }

  setFlag(key: string, value: unknown = true): void {
    this.flags.set(key, value);
    this.onChange?.();
  }

  /**
   * Writes without telling anyone. The quest system's `executeActions` runs
   * reentrantly inside its own refresh loop, so a write that triggers another
   * refresh would recurse. Exposed rather than left as a direct reach into the
   * map, so the store still has one owner.
   */
  setFlagWithoutNotifying(key: string, value: unknown = true): void {
    this.flags.set(key, value);
  }

  /**
   * The same question as `hasFlag`, asked the way authored content asks it: by
   * flag reference rather than by store key. Resolves, then hands off -- the
   * comparison itself stays in one place.
   *
   * A reference that names no flag fails closed. The condition cannot be
   * evaluated, so guessing a key would be worse than answering no.
   */
  hasFlagById(worldFlagId: string, value: unknown = true): boolean {
    const name = this.resolveFlagName(worldFlagId);
    return name === null ? false : this.hasFlag(name, value);
  }

  /** Writes by flag reference. An unresolved reference writes nothing. */
  setFlagById(worldFlagId: string, value: unknown = true): void {
    const name = this.resolveFlagName(worldFlagId);
    if (name === null) {
      this.warnUnresolved(worldFlagId);
      return;
    }
    this.setFlag(name, value);
  }

  /** `setFlagById` for a caller that must not trigger a change notification. */
  setFlagByIdWithoutNotifying(worldFlagId: string, value: unknown = true): void {
    const name = this.resolveFlagName(worldFlagId);
    if (name === null) {
      this.warnUnresolved(worldFlagId);
      return;
    }
    this.setFlagWithoutNotifying(name, value);
  }

  private warnUnresolved(worldFlagId: string): void {
    console.warn(
      `[world-flags] Flag reference "${worldFlagId}" is not in the project's flag registry. Nothing was set. Re-pick the flag on the content that writes it.`
    );
  }

  /** Every flag and its value. For debug readouts and the quest state dump. */
  getAllFlags(): Record<string, unknown> {
    return Object.fromEntries(this.flags);
  }

  serializeSaveSlice(): WorldFlagSlice {
    return { worldFlags: this.getAllFlags() };
  }

  deserializeSaveSlice(slice: SaveSlice<WorldFlagSlice> | null): void {
    if (!slice) return;
    this.flags = new Map(Object.entries(slice.data.worldFlags ?? {}));
    this.onChange?.();
  }
}
