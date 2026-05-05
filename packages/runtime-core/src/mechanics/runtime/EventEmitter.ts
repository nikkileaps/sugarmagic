/**
 * Tiny runtime event emitter used by mechanics stat carriers.
 *
 * Kept local to mechanics so stat change subscription does not pull in DOM,
 * React, or target-specific event systems.
 */

export type Unsubscribe = () => void;

export class MechanicsEventEmitter<TEvent> {
  private readonly listeners = new Set<(event: TEvent) => void>();

  subscribe(listener: (event: TEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: TEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
