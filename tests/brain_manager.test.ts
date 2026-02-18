import { describe, test, expect, beforeEach } from 'bun:test'
import BrainManager from '../src/brain_manager.ts'
import type {
  AIProvider,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
} from '../src/types.ts'

// Mock provider
class MockProvider implements AIProvider {
  readonly name: string
  calls: CompletionRequest[] = []
  response: CompletionResponse = {
    id: 'mock-1',
    content: 'mock response',
    toolCalls: [],
    stopReason: 'end',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    raw: {},
  }

  constructor(name = 'mock') {
    this.name = name
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.calls.push(request)
    return this.response
  }

  async *stream(_request: CompletionRequest): AsyncIterable<StreamChunk> {
    yield { type: 'text', text: 'streamed' }
    yield { type: 'done' }
  }
}

describe('BrainManager', () => {
  beforeEach(() => {
    BrainManager.reset()
  })

  test('useProvider() registers a provider', () => {
    const mock = new MockProvider()
    BrainManager.useProvider(mock)
    expect(BrainManager.provider('mock')).toBe(mock)
  })

  test('provider() throws for unregistered provider', () => {
    expect(() => BrainManager.provider('nonexistent')).toThrow('not configured')
  })

  test('complete() delegates to provider', async () => {
    const mock = new MockProvider()
    BrainManager.useProvider(mock)

    const request: CompletionRequest = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    }

    const response = await BrainManager.complete('mock', request)

    expect(mock.calls).toHaveLength(1)
    expect(response.content).toBe('mock response')
  })

  test('before hooks run before completion', async () => {
    const mock = new MockProvider()
    BrainManager.useProvider(mock)

    const hookCalls: string[] = []
    BrainManager.before(async req => {
      hookCalls.push(`before:${req.messages[0]!.content}`)
    })

    await BrainManager.complete('mock', {
      model: 'test',
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(hookCalls).toEqual(['before:hello'])
  })

  test('after hooks run after completion', async () => {
    const mock = new MockProvider()
    BrainManager.useProvider(mock)

    const hookCalls: string[] = []
    BrainManager.after(async (_req, res) => {
      hookCalls.push(`after:${res.content}`)
    })

    await BrainManager.complete('mock', {
      model: 'test',
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(hookCalls).toEqual(['after:mock response'])
  })

  test('multiple hooks run in order', async () => {
    const mock = new MockProvider()
    BrainManager.useProvider(mock)

    const order: number[] = []
    BrainManager.before(async () => {
      order.push(1)
    })
    BrainManager.before(async () => {
      order.push(2)
    })
    BrainManager.after(async () => {
      order.push(3)
    })
    BrainManager.after(async () => {
      order.push(4)
    })

    await BrainManager.complete('mock', {
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(order).toEqual([1, 2, 3, 4])
  })

  test('useProvider() replaces existing provider', () => {
    const mock1 = new MockProvider()
    const mock2 = new MockProvider()
    mock2.response = { ...mock2.response, content: 'replacement' }

    BrainManager.useProvider(mock1)
    BrainManager.useProvider(mock2)

    expect(BrainManager.provider('mock')).toBe(mock2)
  })

  test('reset() clears everything', async () => {
    const mock = new MockProvider()
    BrainManager.useProvider(mock)
    BrainManager.before(async () => {})
    BrainManager.after(async () => {})

    BrainManager.reset()

    expect(() => BrainManager.provider('mock')).toThrow()
  })
})
