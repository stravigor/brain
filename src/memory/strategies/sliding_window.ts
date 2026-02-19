import type { Message } from '../../types.ts'
import type { CompactionResult, CompactionStrategy } from '../types.ts'

/**
 * Simplest compaction strategy — discards oldest messages
 * without producing a summary. No LLM call required.
 *
 * Use this when you want fast, predictable compaction
 * and don't need continuity from older messages.
 */
export class SlidingWindowStrategy implements CompactionStrategy {
  readonly name = 'sliding_window'

  async compact(
    _messages: Message[],
    _options: { provider: string; model: string; existingSummary?: string; extractFacts?: boolean }
  ): Promise<CompactionResult> {
    return { summary: '', facts: [], summaryTokens: 0 }
  }
}
