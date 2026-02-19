import type { Message, ContentBlock } from '../types.ts'

/** Known context window sizes by model identifier. */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  'claude-opus-4-20250514': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-sonnet-4-5-20250514': 200_000,
  'claude-haiku-3-5-20241022': 200_000,

  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4.1': 1_000_000,
  'gpt-4.1-mini': 1_000_000,
  'gpt-4.1-nano': 1_000_000,
  o3: 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,

  // DeepSeek
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
}

const DEFAULT_CONTEXT_WINDOW = 128_000

/** Overhead tokens per message (role, formatting, separators). */
const MESSAGE_OVERHEAD = 4

/** Average characters per token for estimation. */
const CHARS_PER_TOKEN = 4

/**
 * Approximate token counting without external dependencies.
 *
 * Uses character-based estimation (~4 chars per token) which is
 * conservative enough for budget management. Exact counts are not
 * needed — we just need to know when we're approaching the limit.
 */
export class TokenCounter {
  /** Estimate token count for a string. */
  static estimate(text: string): number {
    if (!text) return 0
    return Math.ceil(text.length / CHARS_PER_TOKEN)
  }

  /** Estimate token count for a Message array. */
  static estimateMessages(messages: Message[]): number {
    let total = 0

    for (const msg of messages) {
      total += MESSAGE_OVERHEAD
      total += TokenCounter.estimateContent(msg.content)

      if (msg.toolCalls) {
        for (const call of msg.toolCalls) {
          total += TokenCounter.estimate(call.name)
          total += TokenCounter.estimate(JSON.stringify(call.arguments))
          total += MESSAGE_OVERHEAD
        }
      }
    }

    return total
  }

  /** Get the context window size for a model, or the default fallback. */
  static contextWindow(model: string): number {
    // Exact match
    if (MODEL_CONTEXT_WINDOWS[model] !== undefined) {
      return MODEL_CONTEXT_WINDOWS[model]!
    }

    // Prefix match (e.g. 'claude-sonnet-4-20250514' matches 'claude-sonnet-4')
    for (const [key, size] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
      if (model.startsWith(key) || key.startsWith(model)) {
        return size
      }
    }

    return DEFAULT_CONTEXT_WINDOW
  }

  /** Estimate tokens for message content (string or ContentBlock[]). */
  private static estimateContent(content: string | ContentBlock[]): number {
    if (typeof content === 'string') {
      return TokenCounter.estimate(content)
    }

    let total = 0
    for (const block of content) {
      if (block.text) total += TokenCounter.estimate(block.text)
      if (block.content) total += TokenCounter.estimate(block.content)
      if (block.input) total += TokenCounter.estimate(JSON.stringify(block.input))
      if (block.name) total += TokenCounter.estimate(block.name)
    }
    return total
  }
}
