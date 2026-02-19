import { describe, test, expect } from 'bun:test'
import { TokenCounter } from '../src/memory/token_counter.ts'
import type { Message } from '../src/types.ts'

describe('TokenCounter', () => {
  describe('estimate()', () => {
    test('returns 0 for empty string', () => {
      expect(TokenCounter.estimate('')).toBe(0)
    })

    test('estimates ~4 chars per token', () => {
      const text = 'Hello, world!' // 13 chars → ceil(13/4) = 4
      expect(TokenCounter.estimate(text)).toBe(4)
    })

    test('handles long text', () => {
      const text = 'a'.repeat(1000) // 1000 chars → 250 tokens
      expect(TokenCounter.estimate(text)).toBe(250)
    })
  })

  describe('estimateMessages()', () => {
    test('returns 0 for empty array', () => {
      expect(TokenCounter.estimateMessages([])).toBe(0)
    })

    test('accounts for message overhead', () => {
      const messages: Message[] = [{ role: 'user', content: '' }]
      // Empty content → 0 + 4 overhead = 4
      expect(TokenCounter.estimateMessages(messages)).toBe(4)
    })

    test('estimates a simple conversation', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello there' },
        { role: 'assistant', content: 'Hi! How can I help?' },
      ]
      const estimate = TokenCounter.estimateMessages(messages)
      // Each message: overhead (4) + content tokens
      // "Hello there" = 11 chars → 3 tokens + 4 overhead = 7
      // "Hi! How can I help?" = 19 chars → 5 tokens + 4 overhead = 9
      expect(estimate).toBe(16)
    })

    test('includes tool call tokens', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tc_1', name: 'search', arguments: { query: 'test' } }],
        },
      ]
      const estimate = TokenCounter.estimateMessages(messages)
      // overhead(4) + content(0) + tool_name("search"→2) + tool_args({"query":"test"}→4) + tool_overhead(4)
      expect(estimate).toBeGreaterThan(4)
    })

    test('handles ContentBlock[] content', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Here is the result' },
            { type: 'tool_use', id: 'tc_1', name: 'calc', input: { x: 1 } },
          ],
        },
      ]
      const estimate = TokenCounter.estimateMessages(messages)
      expect(estimate).toBeGreaterThan(4) // More than just overhead
    })
  })

  describe('contextWindow()', () => {
    test('returns known window for Claude models', () => {
      expect(TokenCounter.contextWindow('claude-opus-4-20250514')).toBe(200_000)
      expect(TokenCounter.contextWindow('claude-sonnet-4-20250514')).toBe(200_000)
    })

    test('returns known window for OpenAI models', () => {
      expect(TokenCounter.contextWindow('gpt-4o')).toBe(128_000)
      expect(TokenCounter.contextWindow('gpt-4o-mini')).toBe(128_000)
      expect(TokenCounter.contextWindow('o3')).toBe(200_000)
    })

    test('falls back to default for unknown models', () => {
      expect(TokenCounter.contextWindow('unknown-model-v9')).toBe(128_000)
    })

    test('prefix-matches model variants', () => {
      // "gpt-4o-2024-08-06" starts with "gpt-4o" key
      expect(TokenCounter.contextWindow('gpt-4o-2024-08-06')).toBe(128_000)
    })
  })
})
