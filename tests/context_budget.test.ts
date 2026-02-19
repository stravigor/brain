import { describe, test, expect } from 'bun:test'
import { ContextBudget } from '../src/memory/context_budget.ts'
import type { Message } from '../src/types.ts'
import type { Fact } from '../src/memory/types.ts'

function makeFact(key: string, value: string): Fact {
  const now = new Date().toISOString()
  return { key, value, source: 'explicit', confidence: 1.0, createdAt: now, updatedAt: now }
}

function makeMessages(count: number, charsPerMessage = 100): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: 'x'.repeat(charsPerMessage),
  }))
}

describe('ContextBudget', () => {
  describe('fits()', () => {
    test('returns true when messages fit within budget', () => {
      const budget = new ContextBudget({ maxContextTokens: 1000, responseReserve: 0.25 }, 'mock')
      const messages = makeMessages(2, 40) // ~10 tokens each + overhead = ~28 total
      expect(budget.fits('system', '', [], messages)).toBe(true)
    })

    test('returns false when messages exceed budget', () => {
      const budget = new ContextBudget({ maxContextTokens: 100, responseReserve: 0.25 }, 'mock')
      // 75 tokens available (100 - 25 response reserve)
      // system "test" = ~1 token
      // 20 messages × ~29 tokens each = way over budget
      const messages = makeMessages(20, 100)
      expect(budget.fits('test', '', [], messages)).toBe(false)
    })

    test('accounts for summary tokens', () => {
      const budget = new ContextBudget({ maxContextTokens: 200, responseReserve: 0.25 }, 'mock')
      const summary = 'x'.repeat(200) // 50 tokens
      const messages = makeMessages(2, 40)
      // 150 available - 50 summary = 100 for system+messages
      expect(budget.fits(undefined, summary, [], messages)).toBe(true)
    })

    test('accounts for facts tokens', () => {
      // 100 total, 25 reserved for response = 75 available
      // Fact: "<known_facts>\n- big_fact: xxx...xxx\n</known_facts>" (~220 chars = ~55 tokens)
      // Messages: 2 × (4 overhead + 10 tokens) = 28
      // 55 + 28 = 83 > 75 available → should not fit
      const budget = new ContextBudget({ maxContextTokens: 100, responseReserve: 0.25 }, 'mock')
      const facts = [makeFact('big_fact', 'x'.repeat(160))]
      const messages = makeMessages(2, 40)
      expect(budget.fits(undefined, '', facts, messages)).toBe(false)
    })
  })

  describe('breakdown()', () => {
    test('returns correct breakdown', () => {
      const budget = new ContextBudget({ maxContextTokens: 1000, responseReserve: 0.20 }, 'mock')
      const bd = budget.breakdown('System prompt', '', [], makeMessages(2, 40))

      expect(bd.total).toBe(1000)
      expect(bd.response).toBe(200) // 20% of 1000
      expect(bd.system).toBeGreaterThan(0)
      expect(bd.summary).toBe(0) // no summary
      expect(bd.working).toBeGreaterThan(0)
      expect(bd.used).toBeGreaterThan(0)
      expect(bd.remaining).toBe(bd.working - bd.used)
    })
  })

  describe('compactionNeeded()', () => {
    test('returns 0 when everything fits', () => {
      const budget = new ContextBudget({ maxContextTokens: 10000, responseReserve: 0.25 }, 'mock')
      const messages = makeMessages(4, 40)
      expect(budget.compactionNeeded(undefined, '', [], messages)).toBe(0)
    })

    test('returns count of messages to compact', () => {
      const budget = new ContextBudget(
        { maxContextTokens: 200, responseReserve: 0.25, minWorkingMessages: 2 },
        'mock'
      )
      const messages = makeMessages(10, 100)
      const needed = budget.compactionNeeded(undefined, '', [], messages)
      expect(needed).toBeGreaterThan(0)
      expect(needed).toBeLessThanOrEqual(8) // 10 - minWorkingMessages(2)
    })

    test('respects minWorkingMessages', () => {
      const budget = new ContextBudget(
        { maxContextTokens: 50, responseReserve: 0.25, minWorkingMessages: 4 },
        'mock'
      )
      // Even if everything overflows, we never compact below 4 messages
      const messages = makeMessages(6, 100)
      const needed = budget.compactionNeeded(undefined, '', [], messages)
      expect(needed).toBeLessThanOrEqual(2) // 6 - 4
    })

    test('uses model context window when maxContextTokens not specified', () => {
      const budget = new ContextBudget({}, 'gpt-4o') // Should use 128k
      const messages = makeMessages(4, 40)
      expect(budget.compactionNeeded(undefined, '', [], messages)).toBe(0) // Fits easily in 128k
    })
  })
})
