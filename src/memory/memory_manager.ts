import type { Message } from '../types.ts'
import type { CompactionStrategy, Fact, MemoryConfig } from './types.ts'
import { ContextBudget } from './context_budget.ts'
import { SemanticMemory } from './semantic_memory.ts'
import { SlidingWindowStrategy } from './strategies/sliding_window.ts'
import { SummarizeStrategy } from './strategies/summarize.ts'

const DEFAULT_COMPACTION_BATCH_SIZE = 10
const DEFAULT_EXTRACT_FACTS = true

export interface PreparedContext {
  /** Original system prompt augmented with summary and facts. */
  system: string | undefined
  /** Working messages (trimmed, possibly after compaction). */
  messages: Message[]
  /** Whether compaction occurred during this preparation. */
  compacted: boolean
}

/**
 * Orchestrates the three-tier memory system:
 * - Working memory (recent messages within context budget)
 * - Episodic memory (compacted summaries)
 * - Semantic memory (extracted facts)
 *
 * Instantiated per-Thread, not via DI. Configured through MemoryConfig.
 */
export class MemoryManager {
  private _strategy: CompactionStrategy
  private _semanticMemory = new SemanticMemory()
  private _summary = ''
  private _compactionBatchSize: number
  private _extractFacts: boolean

  constructor(
    private config: MemoryConfig,
    private budget: ContextBudget
  ) {
    this._compactionBatchSize = config.compactionBatchSize ?? DEFAULT_COMPACTION_BATCH_SIZE
    this._extractFacts = config.extractFacts ?? DEFAULT_EXTRACT_FACTS
    this._strategy = MemoryManager.createStrategy(config.strategy)
  }

  /**
   * Prepare context for sending to the LLM.
   *
   * This is the core method called by Thread before every completion request.
   * It checks the token budget, triggers compaction if needed, and builds
   * the final system prompt with summary and facts injected.
   *
   * Important: when compaction occurs, the `messages` array passed in is
   * mutated (oldest messages are spliced out). This keeps Thread's internal
   * state consistent with what was actually sent.
   */
  async prepareContext(
    system: string | undefined,
    messages: Message[],
    options: { provider: string; model: string }
  ): Promise<PreparedContext> {
    const facts = this._semanticMemory.all()
    let compacted = false

    // Check if compaction is needed
    const needed = this.budget.compactionNeeded(system, this._summary, facts, messages)

    if (needed > 0) {
      const toCompact = messages.splice(0, needed)

      const result = await this._strategy.compact(toCompact, {
        provider: options.provider,
        model: options.model,
        existingSummary: this._summary || undefined,
        extractFacts: this._extractFacts,
      })

      // Update episodic summary
      if (result.summary) {
        this._summary = result.summary
      }

      // Merge extracted facts
      if (result.facts) {
        for (const fact of result.facts) {
          this._semanticMemory.set(fact.key, fact.value, fact.source, fact.confidence)
        }
      }

      compacted = true
    }

    // Build augmented system prompt
    const augmentedSystem = this.buildSystemPrompt(system)

    return {
      system: augmentedSystem,
      messages: [...messages],
      compacted,
    }
  }

  /** Access the semantic memory for manual fact management. */
  get facts(): SemanticMemory {
    return this._semanticMemory
  }

  /** Get the current episodic summary. */
  get episodicSummary(): string {
    return this._summary
  }

  /** Replace the current compaction strategy. */
  useStrategy(strategy: CompactionStrategy): void {
    this._strategy = strategy
  }

  /** Serialize the full memory state for persistence. */
  serialize(): { summary: string; facts: Fact[] } {
    return {
      summary: this._summary,
      facts: this._semanticMemory.serialize(),
    }
  }

  /** Restore memory state from persisted data. */
  restore(data: { summary?: string; facts?: Fact[] }): void {
    if (data.summary !== undefined) {
      this._summary = data.summary
    }
    if (data.facts) {
      this._semanticMemory.restore(data.facts)
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** Build the final system prompt with summary and facts injected. */
  private buildSystemPrompt(original: string | undefined): string | undefined {
    const parts: string[] = []

    if (original) {
      parts.push(original)
    }

    if (this._summary) {
      parts.push(
        `<conversation_history_summary>\n${this._summary}\n</conversation_history_summary>`
      )
    }

    const factsBlock = this._semanticMemory.toPromptBlock()
    if (factsBlock) {
      parts.push(factsBlock)
    }

    return parts.length > 0 ? parts.join('\n\n') : undefined
  }

  /** Create a compaction strategy by name. */
  private static createStrategy(name?: string): CompactionStrategy {
    switch (name) {
      case 'sliding_window':
        return new SlidingWindowStrategy()
      case 'summarize':
      default:
        return new SummarizeStrategy()
    }
  }
}
