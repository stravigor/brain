import { describe, test, expect, afterEach } from 'bun:test'
import { OpenAIProvider } from '../src/providers/openai_provider.ts'
import type { Message } from '../src/types.ts'

const originalFetch = globalThis.fetch

function mockFetch(response: any, status = 200) {
  globalThis.fetch = async (url: any, init: any) => {
    ;(globalThis.fetch as any).__lastCall = { url: String(url), init }
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
}

function lastFetchCall() {
  return (globalThis.fetch as any).__lastCall as { url: string; init: any }
}

function lastFetchBody() {
  return JSON.parse(lastFetchCall().init.body)
}

describe('OpenAIProvider', () => {
  const provider = new OpenAIProvider({
    driver: 'openai',
    apiKey: 'test-key',
    model: 'gpt-4o',
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ── Request mapping ──────────────────────────────────────────────────────

  test('sends correct headers', async () => {
    mockFetch({
      id: 'chatcmpl-1',
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })

    await provider.complete({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })

    const { init } = lastFetchCall()
    expect(init.headers.authorization).toBe('Bearer test-key')
    expect(init.headers['content-type']).toBe('application/json')
  })

  test('sends correct endpoint URL', async () => {
    mockFetch({
      id: 'chatcmpl-1',
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({ model: 'test', messages: [{ role: 'user', content: 'hi' }] })

    expect(lastFetchCall().url).toBe('https://api.openai.com/v1/chat/completions')
  })

  test('uses custom baseUrl for DeepSeek', async () => {
    const deepseek = new OpenAIProvider(
      {
        driver: 'openai',
        apiKey: 'dk',
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com',
      },
      'deepseek'
    )
    mockFetch({
      id: '1',
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })

    await deepseek.complete({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] })

    expect(lastFetchCall().url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(deepseek.name).toBe('deepseek')
  })

  test('prepends system message from system field', async () => {
    mockFetch({
      id: '1',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      system: 'You are helpful.',
    })

    const body = lastFetchBody()
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toBe('You are helpful.')
    expect(body.messages[1].role).toBe('user')
  })

  test('maps tools to OpenAI function format', async () => {
    mockFetch({
      id: '1',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
          execute: async () => {},
        },
      ],
    })

    const tool = lastFetchBody().tools[0]
    expect(tool.type).toBe('function')
    expect(tool.function.name).toBe('get_weather')
    expect(tool.function.parameters).toEqual({
      type: 'object',
      properties: { city: { type: 'string' } },
    })
  })

  test('maps toolChoice strings', async () => {
    mockFetch({
      id: '1',
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      toolChoice: 'auto',
    })
    expect(lastFetchBody().tool_choice).toBe('auto')

    await provider.complete({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      toolChoice: 'required',
    })
    expect(lastFetchBody().tool_choice).toBe('required')
  })

  test('maps toolChoice with specific name', async () => {
    mockFetch({
      id: '1',
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      toolChoice: { name: 'search' },
    })

    expect(lastFetchBody().tool_choice).toEqual({ type: 'function', function: { name: 'search' } })
  })

  test('maps structured output to response_format', async () => {
    mockFetch({
      id: '1',
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })

    const schema = { type: 'object', properties: { name: { type: 'string' } } }
    await provider.complete({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      schema,
    })

    expect(lastFetchBody().response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'response',
        schema: {
          type: 'object',
          properties: {
            name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          required: ['name'],
          additionalProperties: false,
        },
        strict: true,
      },
    })
  })

  test('maps assistant messages with tool calls (JSON.stringify arguments)', async () => {
    mockFetch({
      id: '1',
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })

    const messages: Message[] = [
      { role: 'user', content: 'search' },
      {
        role: 'assistant',
        content: 'Searching...',
        toolCalls: [{ id: 'call_1', name: 'search', arguments: { q: 'test' } }],
      },
      { role: 'tool', toolCallId: 'call_1', content: 'results' },
    ]

    await provider.complete({ model: 'test', messages })

    const body = lastFetchBody()
    const assistantMsg = body.messages[1]
    expect(assistantMsg.tool_calls[0].function.arguments).toBe('{"q":"test"}')

    const toolMsg = body.messages[2]
    expect(toolMsg.role).toBe('tool')
    expect(toolMsg.tool_call_id).toBe('call_1')
    expect(toolMsg.content).toBe('results')
  })

  // ── Response parsing ─────────────────────────────────────────────────────

  test('parses text response', async () => {
    mockFetch({
      id: 'chatcmpl-123',
      choices: [{ message: { content: 'Hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })

    const response = await provider.complete({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(response.id).toBe('chatcmpl-123')
    expect(response.content).toBe('Hello world')
    expect(response.toolCalls).toHaveLength(0)
    expect(response.stopReason).toBe('end')
    expect(response.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  })

  test('parses tool calls (JSON string arguments)', async () => {
    mockFetch({
      id: 'chatcmpl-456',
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'search', arguments: '{"query":"test"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
    })

    const response = await provider.complete({
      model: 'test',
      messages: [{ role: 'user', content: 'search' }],
    })

    expect(response.toolCalls).toHaveLength(1)
    expect(response.toolCalls[0]!.id).toBe('call_1')
    expect(response.toolCalls[0]!.name).toBe('search')
    expect(response.toolCalls[0]!.arguments).toEqual({ query: 'test' })
    expect(response.stopReason).toBe('tool_use')
  })

  test('handles invalid JSON in tool arguments gracefully', async () => {
    mockFetch({
      id: '1',
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'search', arguments: 'not json' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })

    const response = await provider.complete({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(response.toolCalls[0]!.arguments).toEqual({ _raw: 'not json' })
  })

  test('maps finish reasons correctly', async () => {
    for (const [apiReason, expected] of [
      ['stop', 'end'],
      ['tool_calls', 'tool_use'],
      ['length', 'max_tokens'],
    ] as const) {
      mockFetch({
        id: '1',
        choices: [{ message: { content: '' }, finish_reason: apiReason }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      })
      const response = await provider.complete({
        model: 'test',
        messages: [{ role: 'user', content: 'hi' }],
      })
      expect(response.stopReason).toBe(expected)
    }
  })

  // ── Embeddings ───────────────────────────────────────────────────────────

  test('sends embedding request', async () => {
    mockFetch({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
      model: 'text-embedding-3-small',
      usage: { total_tokens: 5 },
    })

    const result = await provider.embed('Hello')

    expect(lastFetchCall().url).toBe('https://api.openai.com/v1/embeddings')
    expect(result.embeddings).toEqual([[0.1, 0.2, 0.3]])
    expect(result.model).toBe('text-embedding-3-small')
    expect(result.usage.totalTokens).toBe(5)
  })

  test('handles multiple embedding inputs', async () => {
    mockFetch({
      data: [{ embedding: [0.1] }, { embedding: [0.2] }],
      model: 'text-embedding-3-small',
      usage: { total_tokens: 10 },
    })

    const result = await provider.embed(['Hello', 'World'])

    const body = lastFetchBody()
    expect(body.input).toEqual(['Hello', 'World'])
    expect(result.embeddings).toHaveLength(2)
  })

  // ── Error handling ───────────────────────────────────────────────────────

  test('throws on non-2xx response', async () => {
    mockFetch({ error: { message: 'invalid api key' } }, 401)

    await expect(
      provider.complete({ model: 'test', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('OpenAI error (401)')
  })

  test('preserves raw response', async () => {
    const rawData = {
      id: 'chatcmpl-raw',
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }
    mockFetch(rawData)

    const response = await provider.complete({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(response.raw).toEqual(rawData)
  })
})
