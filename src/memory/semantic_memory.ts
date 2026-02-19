import type { Fact } from './types.ts'

/**
 * In-memory structured fact store.
 *
 * Facts are key-value pairs representing stable knowledge about the
 * user and their situation, extracted from conversation or set explicitly.
 * They are injected into the system prompt so the model always has
 * access to critical context regardless of compaction.
 *
 * Platform can persist facts via the ThreadStore's `facts` field.
 */
export class SemanticMemory {
  private _facts = new Map<string, Fact>()

  /** Add or update a fact. */
  set(
    key: string,
    value: string,
    source: 'extracted' | 'explicit' = 'explicit',
    confidence: number = 1.0
  ): void {
    const now = new Date().toISOString()
    const existing = this._facts.get(key)

    this._facts.set(key, {
      key,
      value,
      source,
      confidence,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
  }

  /** Get a specific fact by key. */
  get(key: string): Fact | undefined {
    return this._facts.get(key)
  }

  /** Get all facts as an array. */
  all(): Fact[] {
    return Array.from(this._facts.values())
  }

  /** Get the number of stored facts. */
  get size(): number {
    return this._facts.size
  }

  /** Remove a fact by key. */
  remove(key: string): boolean {
    return this._facts.delete(key)
  }

  /** Format all facts as a prompt block for injection into the system prompt. */
  toPromptBlock(): string {
    return SemanticMemory.formatFacts(this.all())
  }

  /**
   * Static formatter — also used by ContextBudget for token estimation
   * without needing a SemanticMemory instance.
   */
  static formatFacts(facts: Fact[]): string {
    if (facts.length === 0) return ''

    const lines = facts.map(f => `- ${f.key}: ${f.value}`)
    return `<known_facts>\n${lines.join('\n')}\n</known_facts>`
  }

  /** Serialize facts for persistence. */
  serialize(): Fact[] {
    return this.all()
  }

  /** Restore facts from persisted data. */
  restore(facts: Fact[]): void {
    this._facts.clear()
    for (const fact of facts) {
      this._facts.set(fact.key, { ...fact })
    }
  }

  /** Clear all facts. */
  clear(): void {
    this._facts.clear()
  }
}
