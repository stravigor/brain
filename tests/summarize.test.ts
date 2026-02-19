import { describe, test, expect, beforeEach } from 'bun:test'
import BrainManager from '../src/brain_manager.ts'
import { SummarizeStrategy } from '../src/memory/strategies/summarize.ts'
import type { AIProvider, CompletionRequest, CompletionResponse, StreamChunk } from '../src/types.ts'

// ── Mock Provider ────────────────────────────────────────────────────────────

class MockProvider implements AIProvider {
  readonly name = 'mock'
  requests: CompletionRequest[] = []
  responseContent = 'Summary of the conversation.'

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request)
    return {
      id: 'mock-1',
      content: this.responseContent,
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

describe('SummarizeStrategy', () => {
  test('has name "summarize"', () => {
    expect(new SummarizeStrategy().name).toBe('summarize')
  })

  test('generates summary from messages', async () => {
    const mock = setupMock()
    mock.responseContent = 'User asked about pricing. Assistant explained tiers.'

    const strategy = new SummarizeStrategy()
    const result = await strategy.compact(
      [
        { role: 'user', content: 'What are your pricing tiers?' },
        { role: 'assistant', content: 'We have three tiers: Basic, Pro, and Enterprise.' },
      ],
      { provider: 'mock', model: 'mock-model' }
    )

    expect(result.summary).toBe('User asked about pricing. Assistant explained tiers.')
    expect(result.summaryTokens).toBeGreaterThan(0)
    expect(mock.requests).toHaveLength(1)
    expect(mock.requests[0]!.messages[0]!.content).toContain('Summarize')
  })

  test('merges with existing summary', async () => {
    const mock = setupMock()
    mock.responseContent = 'Updated merged summary.'

    const strategy = new SummarizeStrategy()
    const result = await strategy.compact(
      [{ role: 'user', content: 'New message' }],
      {
        provider: 'mock',
        model: 'mock-model',
        existingSummary: 'Previous conversation about pricing.',
      }
    )

    expect(result.summary).toBe('Updated merged summary.')
    // Should include the existing summary in the prompt
    expect(mock.requests[0]!.messages[0]!.content).toContain('Previous conversation about pricing.')
  })

  test('extracts facts when enabled', async () => {
    const mock = setupMock()
    mock.responseContent = `Summary of the conversation.

<facts>
[{"key": "venture_type", "value": "SaaS logistics", "confidence": 0.9}]
</facts>`

    const strategy = new SummarizeStrategy()
    const result = await strategy.compact(
      [{ role: 'user', content: "I'm building a SaaS for logistics" }],
      { provider: 'mock', model: 'mock-model', extractFacts: true }
    )

    expect(result.summary).toBe('Summary of the conversation.')
    expect(result.facts).toHaveLength(1)
    expect(result.facts![0]!.key).toBe('venture_type')
    expect(result.facts![0]!.value).toBe('SaaS logistics')
    expect(result.facts![0]!.confidence).toBe(0.9)
    expect(result.facts![0]!.source).toBe('extracted')
  })

  test('handles malformed facts gracefully', async () => {
    const mock = setupMock()
    mock.responseContent = `Summary text.

<facts>
not valid json
</facts>`

    const strategy = new SummarizeStrategy()
    const result = await strategy.compact(
      [{ role: 'user', content: 'test' }],
      { provider: 'mock', model: 'mock-model', extractFacts: true }
    )

    expect(result.summary).toBe('Summary text.')
    expect(result.facts).toHaveLength(0)
  })

  test('does not request facts when extractFacts is false', async () => {
    const mock = setupMock()
    mock.responseContent = 'Just a summary.'

    const strategy = new SummarizeStrategy()
    await strategy.compact(
      [{ role: 'user', content: 'test' }],
      { provider: 'mock', model: 'mock-model', extractFacts: false }
    )

    // The prompt should not contain fact extraction instructions
    expect(mock.requests[0]!.messages[0]!.content).not.toContain('<facts>')
  })

  test('uses low temperature for summarization', async () => {
    const mock = setupMock()
    mock.responseContent = 'Summary.'

    const strategy = new SummarizeStrategy()
    await strategy.compact(
      [{ role: 'user', content: 'test' }],
      { provider: 'mock', model: 'mock-model' }
    )

    expect(mock.requests[0]!.temperature).toBe(0.3)
  })
})
