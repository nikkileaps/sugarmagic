import type { QuestRuntimeEvent } from "../quest/QuestManager";

const MAX_RECENT_EVENTS = 10;

export class RecentEventCollector {
  private events: string[] = [];

  /** Secondary tap on QuestManager.setEventHandler -- additive, not replacing. */
  onQuestEvent(event: QuestRuntimeEvent): void {
    if (event.type === "stage-advance") {
      this.push(
        `Quest '${event.displayName}' stage '${event.stageDisplayName}' reached.`
      );
    } else if (event.type === "quest-complete") {
      this.push(`Quest '${event.displayName}' completed.`);
    }
    // quest-start and objective-complete are player-private, not public world facts.
  }

  /** Tap on worldTimeStore's day-change callback fan-out. */
  onDayAdvance(day: number): void {
    this.push(`Day advanced to ${day}.`);
  }

  getRecentEvents(): string[] {
    return [...this.events];
  }

  /** Session-only: no serialize/deserialize. Block is empty after a load. */
  clear(): void {
    this.events = [];
  }

  private push(line: string): void {
    this.events.push(line);
    if (this.events.length > MAX_RECENT_EVENTS) {
      this.events = this.events.slice(this.events.length - MAX_RECENT_EVENTS);
    }
  }
}

export function createRecentEventCollector(): RecentEventCollector {
  return new RecentEventCollector();
}
