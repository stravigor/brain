import type { Message } from '../types.ts'
import type { MemoryConfig, Fact } from './types.ts'
import { TokenCounter } from './token_counter.ts'
import { SemanticMemory } from './semantic_memory.ts'

export interface BudgetBreakdown {
  /** Total context window tokens. */
  total: number
  /** Reserved for the model's response. */
  response: number
  /** Tokens used by system prompt + injected facts. */
  system: number
  /** Tokens used by the episodic summary. */
  summary: number
  /** Available budget for working messages. */
  working: number
  /** Tokens currently used by working messages. */
  used: number
  /** Remaining headroom before compaction is triggered. */
  remaining: number
}

const DEFAULT_RESPONSE_RESERVE = 0.25
const DEFAULT_MIN_WORKING_MESSAGES = 4

/**
 * Calculates and tracks how the context window budget is allocated
 * across system prompt, episodic summaries, semantic facts, and
 * working messages.
 */
export class ContextBudget {
  private readonly maxTokens: number
  private readonly responseReserve: number
  private readonly minWorkingMessages: number

  constructor(config: MemoryConfig, model: string) {
    this.maxTokens = config.maxContextTokens ?? TokenCounter.contextWindow(model)
    this.responseReserve = config.responseReserve ?? DEFAULT_RESPONSE_RESERVE
    this.minWorkingMessages = config.minWorkingMessages ?? DEFAULT_MIN_WORKING_MESSAGES
  }

  /** Check whether the current context fits within the token budget. */
  fits(system: string | undefined, summary: string, facts: Fact[], messages: Message[]): boolean {
    const bd = this.breakdown(system, summary, facts, messages)
    return bd.remaining >= 0
  }

  /** Get a detailed breakdown of token usage. */
  breakdown(
    system: string | undefined,
    summary: string,
    facts: Fact[],
    messages: Message[]
  ): BudgetBreakdown {
    const total = this.maxTokens
    const response = Math.ceil(total * this.responseReserve)

    const systemTokens = TokenCounter.estimate(system ?? '')
    const factsTokens =
      facts.length > 0 ? TokenCounter.estimate(SemanticMemory.formatFacts(facts)) : 0
    const systemTotal = systemTokens + factsTokens

    const summaryTokens = TokenCounter.estimate(summary)
    const messageTokens = TokenCounter.estimateMessages(messages)

    const working = total - response - systemTotal - summaryTokens
    const remaining = working - messageTokens

    return {
      total,
      response,
      system: systemTotal,
      summary: summaryTokens,
      working: Math.max(working, 0),
      used: messageTokens,
      remaining,
    }
  }

  /**
   * Determine how many messages from the front of the array
   * need to be compacted so the rest fits within budget.
   *
   * Returns 0 if everything already fits.
   * Respects minWorkingMessages — never compacts below that threshold.
   */
  compactionNeeded(
    system: string | undefined,
    summary: string,
    facts: Fact[],
    messages: Message[]
  ): number {
    if (this.fits(system, summary, facts, messages)) return 0

    const total = this.maxTokens
    const response = Math.ceil(total * this.responseReserve)
    const systemTokens = TokenCounter.estimate(system ?? '')
    const factsTokens =
      facts.length > 0 ? TokenCounter.estimate(SemanticMemory.formatFacts(facts)) : 0
    const summaryTokens = TokenCounter.estimate(summary)

    const available = total - response - systemTokens - factsTokens - summaryTokens
    const maxCompactable = Math.max(0, messages.length - this.minWorkingMessages)

    // Accumulate from the back (most recent) until we exceed the budget
    let kept = 0
    let tokensFromBack = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = TokenCounter.estimateMessages([messages[i]!])
      if (tokensFromBack + msgTokens > available) break
      tokensFromBack += msgTokens
      kept++
    }

    const toCompact = messages.length - kept

    // Never compact below minWorkingMessages
    return Math.min(toCompact, maxCompactable)
  }
}
