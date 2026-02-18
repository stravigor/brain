import { describe, test, expect, beforeEach } from 'bun:test'
import BrainManager from '../src/brain_manager.ts'
import { brain } from '../src/helpers.ts'
import { Agent } from '../src/agent.ts'
import { z } from 'zod'
import type {
  AIProvider,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
} from '../src/types.ts'

// ── Mock Provider ────────────────────────────────────────────────────────────

class MockProvider implements AIProvider {
  readonly name = 'mock'
  responses: CompletionResponse[] = []
  requests: CompletionRequest[] = []
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
    yield { type: 'done' }
  }
}

// ── Test Agents ──────────────────────────────────────────────────────────────

class ResearchAgent extends Agent {
  provider = 'mock'
  instructions = 'Research the topic.'
}

class WriterAgent extends Agent {
  provider = 'mock'
  instructions = 'Write based on research.'
}

class ReviewerAgent extends Agent {
  provider = 'mock'
  instructions = 'Review the content.'
}

class SentimentAgent extends Agent {
  provider = 'mock'
  instructions = 'Analyze sentiment.'
}

class SummaryAgent extends Agent {
  provider = 'mock'
  instructions = 'Summarize.'
}

class RouterAgent extends Agent {
  provider = 'mock'
  instructions = 'Route to the right specialist.'
  output = z.object({ route: z.string() })
}

class BillingAgent extends Agent {
  provider = 'mock'
  instructions = 'Handle billing.'
}

class ShippingAgent extends Agent {
  provider = 'mock'
  instructions = 'Handle shipping.'
}

class ScoreAgent extends Agent {
  provider = 'mock'
  instructions = 'Score the input.'
  output = z.object({ score: z.number() })
}

// ── Setup ────────────────────────────────────────────────────────────────────

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

describe('Workflow', () => {
  test('sequential steps execute in order', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: 'Research findings.' })
    mock.queueResponse({ content: 'Written article.' })
    mock.queueResponse({ content: 'Looks good!' })

    const result = await brain
      .workflow('pipeline')
      .step('research', ResearchAgent)
      .step('write', WriterAgent)
      .step('review', ReviewerAgent)
      .run({ topic: 'AI' })

    expect(result.results.research.text).toBe('Research findings.')
    expect(result.results.write.text).toBe('Written article.')
    expect(result.results.review.text).toBe('Looks good!')
    expect(mock.requests).toHaveLength(3)
    expect(result.duration).toBeGreaterThan(0)
  })

  test('step with mapInput transforms context', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: 'Research findings.' })
    mock.queueResponse({ content: 'Article about findings.' })

    const result = await brain
      .workflow('mapped')
      .step('research', ResearchAgent)
      .step('write', WriterAgent, ctx => ({
        prompt: `Write about: ${ctx.results.research.text}`,
      }))
      .run({ topic: 'AI' })

    // The second request's input should contain the mapped data
    const secondInput = mock.requests[1]!.messages[0]!.content as string
    expect(secondInput).toContain('Write about: Research findings.')
  })

  test('parallel steps execute concurrently', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: 'Positive sentiment.' })
    mock.queueResponse({ content: 'Short summary.' })

    const result = await brain
      .workflow('parallel')
      .parallel('analyze', [
        { name: 'sentiment', agent: SentimentAgent },
        { name: 'summary', agent: SummaryAgent },
      ])
      .run({ text: 'Some article text' })

    expect(result.results.sentiment.text).toBe('Positive sentiment.')
    expect(result.results.summary.text).toBe('Short summary.')
    expect(mock.requests).toHaveLength(2)
  })

  test('route step dispatches to correct branch', async () => {
    const mock = setupMock()
    // Router response
    mock.queueResponse({ content: '{"route":"billing"}' })
    // Branch response
    mock.queueResponse({ content: 'Billing handled.' })

    const result = await brain
      .workflow('router')
      .route('support', RouterAgent, {
        billing: BillingAgent,
        shipping: ShippingAgent,
      })
      .run({ message: 'I need a refund' })

    expect(result.results['support:router'].text).toBe('{"route":"billing"}')
    expect(result.results.support.text).toBe('Billing handled.')
  })

  test('loop step iterates until condition', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: '{"score":3}' })
    mock.queueResponse({ content: '{"score":7}' })
    mock.queueResponse({ content: '{"score":9}' })

    const result = await brain
      .workflow('loop')
      .loop('improve', ScoreAgent, {
        maxIterations: 5,
        until: result => {
          try {
            return JSON.parse(result.text).score >= 8
          } catch {
            return false
          }
        },
        feedback: result => `Previous score: ${result.text}. Improve.`,
      })
      .run({ task: 'Write code' })

    // Should stop after 3rd iteration (score 9 >= 8)
    expect(mock.requests).toHaveLength(3)
    expect(result.results.improve).toBeDefined()
  })

  test('loop step respects maxIterations', async () => {
    const mock = setupMock()
    mock.queueResponse({ content: '{"score":1}' })
    mock.queueResponse({ content: '{"score":2}' })

    const result = await brain
      .workflow('limited-loop')
      .loop('improve', ScoreAgent, {
        maxIterations: 2,
        until: () => false, // Never satisfied
      })
      .run({ task: 'test' })

    expect(mock.requests).toHaveLength(2)
    expect(result.results.improve).toBeDefined()
  })

  test('usage is aggregated across all steps', async () => {
    const mock = setupMock()
    mock.queueResponse({
      content: 'r1',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    })
    mock.queueResponse({
      content: 'r2',
      usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
    })

    const result = await brain
      .workflow('usage')
      .step('a', ResearchAgent)
      .step('b', WriterAgent)
      .run({ topic: 'test' })

    expect(result.usage.inputTokens).toBe(300)
    expect(result.usage.outputTokens).toBe(150)
    expect(result.usage.totalTokens).toBe(450)
  })
})
