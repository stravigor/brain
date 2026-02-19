import { describe, test, expect, beforeEach } from 'bun:test'
import BrainManager from '../src/brain_manager.ts'
import { MemoryManager } from '../src/memory/memory_manager.ts'
import { ContextBudget } from '../src/memory/context_budget.ts'
import type { AIProvider, CompletionRequest, CompletionResponse, StreamChunk, Message } from '../src/types.ts'
import type { MemoryConfig } from '../src/memory/types.ts'

// ── Mock Provider ────────────────────────────────────────────────────────────

class MockProvider implements AIProvider {
  readonly name = 'mock'
  requests: CompletionRequest[] = []
  summaryResponse = 'Condensed summary of previous conversation.'

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request)
    return {
      id: 'mock-1',
      content: this.summaryResponse,
      toolCalls: [],
      stopReason: 'end',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      raw: {},
    }
  }

  async *stream(_request: CompletionRequest): AsyncIterable<StreamChunk> {
    yield { type: 'text', text: 'streamed' }
    yield { type: 'done' }
  }
}

function setupMock(): MockProvider {
  const mock = new MockProvider()
  BrainManager.reset()
  BrainManager.useProvider(mock)
  ;(BrainManager as any)._config = {
    default: 'mock',
    providers: { mock: { driver: 'openai', apiKey: 'k', model: 'mock-model' } },
    maxTokens: 4096,
    temperature: 0.7,
    maxIterations: 10,
  }
  return mock
}

function makeMessages(count: number, charsPerMessage = 100): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `Message ${i}: ${'x'.repeat(charsPerMessage)}`,
  }))
}

describe('MemoryManager', () => {
  describe('prepareContext() — no compaction needed', () => {
    test('returns context unchanged when within budget', async () => {
      setupMock()
      const config: MemoryConfig = { maxContextTokens: 100000 }
      const budget = new ContextBudget(config, 'mock-model')
      const mm = new MemoryManager(config, budget)

      const messages = makeMessages(4, 40)
      const original = [...messages]

      const result = await mm.prepareContext('System prompt', messages, {
        provider: 'mock',
        model: 'mock-model',
      })

      expect(result.compacted).toBe(false)
      expect(result.messages).toHaveLength(4)
      expect(messages).toEqual(original) // Not mutated
    })

    test('injects facts into system prompt', async () => {
      setupMock()
      const config: MemoryConfig = { maxContextTokens: 100000 }
      const budget = new ContextBudget(config, 'mock-model')
      const mm = new MemoryManager(config, budget)

      mm.facts.set('venture', 'SaaS logistics')
      mm.facts.set('stage', 'Validation')

      const result = await mm.prepareContext('Be helpful.', makeMessages(2), {
        provider: 'mock',
        model: 'mock-model',
      })

      expect(result.system).toContain('Be helpful.')
      expect(result.system).toContain('<known_facts>')
      expect(result.system).toContain('- venture: SaaS logistics')
      expect(result.system).toContain('- stage: Validation')
    })
  })

  describe('prepareContext() — compaction triggered', () => {
    test('compacts oldest messages when over budget', async () => {
      const mock = setupMock()
      mock.summaryResponse = 'User discussed their logistics startup idea.'

      const config: MemoryConfig = {
        maxContextTokens: 300, // Very tight budget
        responseReserve: 0.25,
        minWorkingMessages: 2,
        compactionBatchSize: 20,
        strategy: 'summarize',
      }
      const budget = new ContextBudget(config, 'mock-model')
      const mm = new MemoryManager(config, budget)

      const messages = makeMessages(10, 100) // Will exceed 300 token budget

      const result = await mm.prepareContext(undefined, messages, {
        provider: 'mock',
        model: 'mock-model',
      })

      expect(result.compacted).toBe(true)
      expect(result.messages.length).toBeLessThan(10) // Some messages compacted
      expect(mm.episodicSummary).toBe('User discussed their logistics startup idea.')
      expect(result.system).toContain('<conversation_history_summary>')
    })

    test('uses sliding_window strategy when configured', async () => {
      setupMock()

      const config: MemoryConfig = {
        maxContextTokens: 300,
        responseReserve: 0.25,
        minWorkingMessages: 2,
        compactionBatchSize: 20,
        strategy: 'sliding_window',
      }
      const budget = new ContextBudget(config, 'mock-model')
      const mm = new MemoryManager(config, budget)

      const messages = makeMessages(10, 100)
      const result = await mm.prepareContext(undefined, messages, {
        provider: 'mock',
        model: 'mock-model',
      })

      expect(result.compacted).toBe(true)
      // Sliding window produces no summary
      expect(mm.episodicSummary).toBe('')
    })

    test('mutates the input messages array during compaction', async () => {
      const mock = setupMock()
      mock.summaryResponse = 'Summary.'

      const config: MemoryConfig = {
        maxContextTokens: 300,
        responseReserve: 0.25,
        minWorkingMessages: 2,
        compactionBatchSize: 20,
      }
      const budget = new ContextBudget(config, 'mock-model')
      const mm = new MemoryManager(config, budget)

      const messages = makeMessages(10, 100)

      await mm.prepareContext(undefined, messages, {
        provider: 'mock',
        model: 'mock-model',
      })

      // The input array should have been spliced (oldest messages removed)
      expect(messages.length).toBeLessThan(10)
    })
  })

  describe('prepareContext() — fact extraction', () => {
    test('merges extracted facts into semantic memory', async () => {
      const mock = setupMock()
      mock.summaryResponse = `Summary.

<facts>
[{"key": "product", "value": "logistics SaaS", "confidence": 0.9}]
</facts>`

      const config: MemoryConfig = {
        maxContextTokens: 300,
        responseReserve: 0.25,
        minWorkingMessages: 2,
        compactionBatchSize: 20,
        extractFacts: true,
      }
      const budget = new ContextBudget(config, 'mock-model')
      const mm = new MemoryManager(config, budget)

      await mm.prepareContext(undefined, makeMessages(10, 100), {
        provider: 'mock',
        model: 'mock-model',
      })

      expect(mm.facts.get('product')!.value).toBe('logistics SaaS')
    })
  })

  describe('serialize() / restore()', () => {
    test('round-trips memory state', () => {
      setupMock()
      const config: MemoryConfig = { maxContextTokens: 100000 }
      const budget = new ContextBudget(config, 'mock-model')
      const mm = new MemoryManager(config, budget)

      mm.facts.set('venture', 'logistics')
      ;(mm as any)._summary = 'Previous summary.'

      const serialized = mm.serialize()
      expect(serialized.summary).toBe('Previous summary.')
      expect(serialized.facts).toHaveLength(1)

      const mm2 = new MemoryManager(config, budget)
      mm2.restore(serialized)
      expect(mm2.episodicSummary).toBe('Previous summary.')
      expect(mm2.facts.get('venture')!.value).toBe('logistics')
    })
  })

  describe('useStrategy()', () => {
    test('replaces the compaction strategy', async () => {
      setupMock()
      const config: MemoryConfig = {
        maxContextTokens: 300,
        responseReserve: 0.25,
        minWorkingMessages: 2,
        compactionBatchSize: 20,
      }
      const budget = new ContextBudget(config, 'mock-model')
      const mm = new MemoryManager(config, budget)

      // Custom strategy
      mm.useStrategy({
        name: 'custom',
        async compact() {
          return { summary: 'Custom summary.', summaryTokens: 5 }
        },
      })

      await mm.prepareContext(undefined, makeMessages(10, 100), {
        provider: 'mock',
        model: 'mock-model',
      })

      expect(mm.episodicSummary).toBe('Custom summary.')
    })
  })
})
