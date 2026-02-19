import { describe, test, expect, beforeEach } from 'bun:test'
import BrainManager from '../src/brain_manager.ts'
import { brain, Thread } from '../src/helpers.ts'
import { InMemoryThreadStore } from '../src/memory/thread_store.ts'
import type { AIProvider, CompletionRequest, CompletionResponse, StreamChunk } from '../src/types.ts'

// ── Mock Provider ────────────────────────────────────────────────────────────

class MockProvider implements AIProvider {
  readonly name = 'mock'
  requests: CompletionRequest[] = []
  responses: CompletionResponse[] = []
  private callIndex = 0

  queueResponse(response: Partial<CompletionResponse>): void {
    this.responses.push({
      id: `mock-${this.responses.length}`,
      content: '',
      toolCalls: [],
      stopReason: 'end',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      raw: {},
      ...response,
    })
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request)
    const response = this.responses[this.callIndex]
    if (!response) throw new Error(`No mock response queued for call ${this.callIndex}`)
    this.callIndex++
    return response
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
  ;(BrainManager as any)._memoryConfig = {}
  return mock
}

describe('Thread with memory', () => {
  test('memory() enables memory management', () => {
    setupMock()
    const thread = brain.thread().memory()
    expect(thread.facts).toBeDefined()
  })

  test('without memory(), facts is undefined', () => {
    setupMock()
    const thread = brain.thread()
    expect(thread.facts).toBeUndefined()
  })

  test('send() works with memory enabled (no compaction)', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: 'Hello!' })

    const thread = brain.thread().memory({ maxContextTokens: 100000 })
    const result = await thread.send('Hi there')

    expect(result).toBe('Hello!')
    expect(mock.requests).toHaveLength(1)
  })

  test('facts are injected into system prompt', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: 'I see you have a logistics venture.' })

    const thread = brain.thread()
      .system('Be helpful.')
      .memory({ maxContextTokens: 100000 })

    thread.facts!.set('venture', 'SaaS logistics')

    await thread.send('Tell me about my venture')

    // The system prompt should include the facts
    expect(mock.requests[0]!.system).toContain('Be helpful.')
    expect(mock.requests[0]!.system).toContain('<known_facts>')
    expect(mock.requests[0]!.system).toContain('- venture: SaaS logistics')
  })

  test('compaction is triggered when context exceeds budget', async () => {
    const mock = setupMock()

    // Queue responses for the conversation
    for (let i = 0; i < 12; i++) {
      mock.queueResponse({ content: `Response ${i}: ${'y'.repeat(100)}` })
    }

    // Use sliding_window to avoid extra LLM calls for summarization
    const thread = brain.thread().memory({
      maxContextTokens: 500, // Very tight budget to force compaction
      responseReserve: 0.25,
      minWorkingMessages: 2,
      compactionBatchSize: 20,
      strategy: 'sliding_window',
    })

    // Send many messages to build up history
    for (let i = 0; i < 12; i++) {
      await thread.send(`User message ${i}: ${'x'.repeat(100)}`)
    }

    // With a 500-token budget and ~29 tokens per message (100 chars + overhead),
    // the thread should have fewer messages than 24 (12 user + 12 assistant)
    // because compaction removed oldest ones
    const messages = thread.getMessages()
    expect(messages.length).toBeLessThan(24)
    expect(messages.length).toBeGreaterThanOrEqual(2) // At least minWorkingMessages
  })

  test('backward compatibility — Thread works without memory()', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: 'Hello!' })
    mock.queueResponse({ content: 'Your name is Alice.' })

    const thread = brain.thread()
    const r1 = await thread.send('My name is Alice')
    const r2 = await thread.send('What is my name?')

    expect(r1).toBe('Hello!')
    expect(r2).toBe('Your name is Alice.')
    // Full conversation history sent (no trimming)
    expect(mock.requests[1]!.messages).toHaveLength(3)
  })

  test('id() sets thread identifier', () => {
    setupMock()
    const thread = brain.thread().id('my-thread-123').memory()
    const serialized = thread.serializeMemory()
    expect(serialized.id).toBe('my-thread-123')
  })

  test('serializeMemory() includes memory state', () => {
    setupMock()
    const thread = brain.thread().id('t1').memory()
    thread.facts!.set('key', 'value')

    const data = thread.serializeMemory()
    expect(data.id).toBe('t1')
    expect(data.facts).toHaveLength(1)
    expect(data.facts![0]!.key).toBe('key')
    expect(data.messages).toHaveLength(0)
    expect(data.createdAt).toBeDefined()
    expect(data.updatedAt).toBeDefined()
  })

  test('restoreMemory() restores full state', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: 'Restored!' })

    const thread = brain.thread().memory({ maxContextTokens: 100000 })
    thread.restoreMemory({
      id: 't1',
      messages: [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
      ],
      system: 'Restored system prompt',
      summary: 'Earlier conversation about logistics.',
      facts: [{ key: 'venture', value: 'logistics', source: 'explicit', confidence: 1, createdAt: '', updatedAt: '' }],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    })

    await thread.send('Continue')

    // Should have previous messages + new user message
    expect(mock.requests[0]!.messages).toHaveLength(3) // prev_user + prev_asst + new_user
    // System should include the restored summary and facts
    expect(mock.requests[0]!.system).toContain('Restored system prompt')
    expect(mock.requests[0]!.system).toContain('<conversation_history_summary>')
    expect(mock.requests[0]!.system).toContain('<known_facts>')
    expect(thread.facts!.get('venture')!.value).toBe('logistics')
  })

  test('persist() auto-saves to thread store after send()', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: 'Saved!' })

    const store = new InMemoryThreadStore()
    BrainManager.useThreadStore(store)

    const thread = brain.thread()
      .id('auto-save-thread')
      .memory({ maxContextTokens: 100000 })
      .persist()

    await thread.send('Hello')

    const saved = await store.load('auto-save-thread')
    expect(saved).not.toBeNull()
    expect(saved!.messages).toHaveLength(2) // user + assistant
  })

  test('persist() does not save without thread store', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: 'Not saved.' })

    // No store registered
    const thread = brain.thread()
      .id('no-store-thread')
      .memory({ maxContextTokens: 100000 })
      .persist()

    // Should not throw
    await thread.send('Hello')
  })

  test('persist() does not save without thread id', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: 'Not saved.' })

    const store = new InMemoryThreadStore()
    BrainManager.useThreadStore(store)

    const thread = brain.thread()
      .memory({ maxContextTokens: 100000 })
      .persist()

    await thread.send('Hello')
    expect(store.size).toBe(0)
  })

  test('existing serialize()/restore() still work unchanged', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: 'First' })
    mock.queueResponse({ content: 'Second' })

    const thread1 = brain.thread()
    thread1.system('Test.')
    await thread1.send('Hello')

    const snapshot = thread1.serialize()
    expect(snapshot.messages).toHaveLength(2)
    expect(snapshot.system).toBe('Test.')

    const thread2 = brain.thread().restore(snapshot)
    await thread2.send('Continue')

    expect(mock.requests[1]!.messages).toHaveLength(3)
  })
})
