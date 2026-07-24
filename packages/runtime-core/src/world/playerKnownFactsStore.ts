export interface PlayerKnownFact {
  id: string;
  text: string;
}

const MAX_KNOWN_FACTS = 20;

export class PlayerKnownFactsStore {
  private facts: PlayerKnownFact[] = [];
  private onChange: ((texts: string[]) => void) | null = null;

  learnFact(id: string, text: string): void {
    this.facts = this.facts.filter((f) => f.id !== id);
    this.facts.push({ id, text });
    if (this.facts.length > MAX_KNOWN_FACTS) {
      this.facts = this.facts.slice(this.facts.length - MAX_KNOWN_FACTS);
    }
    this.onChange?.(this.getFactTexts());
  }

  getFactTexts(): string[] {
    return this.facts.map((f) => f.text);
  }

  getFacts(): PlayerKnownFact[] {
    return [...this.facts];
  }

  setChangeCallback(cb: (texts: string[]) => void): void {
    this.onChange = cb;
  }

  /** Restore state from a save slice. Fires callback so the blackboard
   *  tracks the restored facts (callback is wired before deserializeAll runs). */
  restore(facts: PlayerKnownFact[]): void {
    this.facts = [...facts];
    this.onChange?.(this.getFactTexts());
  }
}

export function createPlayerKnownFactsStore(): PlayerKnownFactsStore {
  return new PlayerKnownFactsStore();
}
