import { describe, test, expect } from 'bun:test'
import { SlidingWindowStrategy } from '../src/memory/strategies/sliding_window.ts'
import type { Message } from '../src/types.ts'

describe('SlidingWindowStrategy', () => {
  test('returns empty summary', async () => {
    const strategy = new SlidingWindowStrategy()
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ]

    const result = await strategy.compact(messages, { provider: 'test', model: 'test' })

    expect(result.summary).toBe('')
    expect(result.facts).toEqual([])
    expect(result.summaryTokens).toBe(0)
  })

  test('has name "sliding_window"', () => {
    expect(new SlidingWindowStrategy().name).toBe('sliding_window')
  })
})
