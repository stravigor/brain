import { describe, test, expect, afterEach } from 'bun:test'
import { OpenAIResponsesProvider } from '../src/providers/openai_responses_provider.ts'
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

function mockStreamFetch(events: Array<{ event?: string; data: string }>) {
  globalThis.fetch = async (url: any, init: any) => {
    ;(globalThis.fetch as any).__lastCall = { url: String(url), init }
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        for (const sse of events) {
          if (sse.event) controller.enqueue(encoder.encode(`event: ${sse.event}\n`))
          controller.enqueue(encoder.encode(`data: ${sse.data}\n\n`))
        }
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
}

function lastFetchCall() {
  return (globalThis.fetch as any).__lastCall as { url: string; init: any }
}

function lastFetchBody() {
  return JSON.parse(lastFetchCall().init.body)
}

async function collectStream(provider: OpenAIResponsesProvider, request: any) {
  const chunks: any[] = []
  for await (const chunk of provider.stream(request)) {
    chunks.push(chunk)
  }
  return chunks
}

describe('OpenAIResponsesProvider', () => {
  const provider = new OpenAIResponsesProvider({
    driver: 'openai-responses',
    apiKey: 'test-key',
    model: 'gpt-4.1',
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ── Request mapping ──────────────────────────────────────────────────────

  test('sends correct headers', async () => {
    mockFetch({
      id: 'resp_1',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] },
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    })

    await provider.complete({ model: 'gpt-4.1', messages: [{ role: 'user', content: 'hi' }] })

    const { init } = lastFetchCall()
    expect(init.headers.authorization).toBe('Bearer test-key')
    expect(init.headers['content-type']).toBe('application/json')
  })

  test('sends correct endpoint URL', async () => {
    mockFetch({
      id: 'resp_1',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({ model: 'gpt-4.1', messages: [{ role: 'user', content: 'hi' }] })

    expect(lastFetchCall().url).toBe('https://api.openai.com/v1/responses')
  })

  test('uses custom baseUrl', async () => {
    const custom = new OpenAIResponsesProvider({
      driver: 'openai-responses',
      apiKey: 'k',
      model: 'gpt-4.1',
      baseUrl: 'https://custom.api.com/',
    })
    mockFetch({
      id: 'resp_1',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    await custom.complete({ model: 'gpt-4.1', messages: [{ role: 'user', content: 'hi' }] })

    expect(lastFetchCall().url).toBe('https://custom.api.com/v1/responses')
  })

  test('allows custom name via constructor', () => {
    const named = new OpenAIResponsesProvider(
      { driver: 'openai-responses', apiKey: 'k', model: 'm' },
      'custom-openai'
    )
    expect(named.name).toBe('custom-openai')
  })

  test('defaults name to openai', () => {
    expect(provider.name).toBe('openai')
  })

  test('maps system prompt to instructions field', async () => {
    mockFetch({
      id: 'resp_1',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
      ],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
      system: 'You are helpful.',
    })

    const body = lastFetchBody()
    expect(body.instructions).toBe('You are helpful.')
    // System should NOT be in input items
    expect(body.input.every((m: any) => m.role !== 'system')).toBe(true)
  })

  test('maps tools to Responses API function format', async () => {
    mockFetch({
      id: 'resp_1',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({
      model: 'gpt-4.1',
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
    expect(tool.name).toBe('get_weather')
    expect(tool.description).toBe('Get weather')
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: { city: { type: 'string' } },
    })
  })

  test('maps toolChoice strings', async () => {
    mockFetch({
      id: 'resp_1',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
      toolChoice: 'auto',
    })
    expect(lastFetchBody().tool_choice).toBe('auto')

    await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
      toolChoice: 'required',
    })
    expect(lastFetchBody().tool_choice).toBe('required')
  })

  test('maps toolChoice with specific name', async () => {
    mockFetch({
      id: 'resp_1',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
      toolChoice: { name: 'search' },
    })

    expect(lastFetchBody().tool_choice).toEqual({ type: 'function', name: 'search' })
  })

  test('maps structured output to text.format', async () => {
    mockFetch({
      id: 'resp_1',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{}' }] },
      ],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    const schema = { type: 'object', properties: { name: { type: 'string' } } }
    await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
      schema,
    })

    expect(lastFetchBody().text).toEqual({
      format: {
        type: 'json_schema',
        name: 'response',
        schema,
        strict: true,
      },
    })
  })

  test('sends max_output_tokens from request', async () => {
    mockFetch({
      id: 'resp_1',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 2000,
    })

    expect(lastFetchBody().max_output_tokens).toBe(2000)
  })

  test('falls back to defaultMaxTokens from config', async () => {
    const withDefaults = new OpenAIResponsesProvider({
      driver: 'openai-responses',
      apiKey: 'k',
      model: 'gpt-4.1',
      maxTokens: 4096,
    })
    mockFetch({
      id: 'resp_1',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    await withDefaults.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(lastFetchBody().max_output_tokens).toBe(4096)
  })

  test('sends stop sequences', async () => {
    mockFetch({
      id: 'resp_1',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
      stopSequences: ['STOP', 'END'],
    })

    expect(lastFetchBody().stop).toEqual(['STOP', 'END'])
  })

  // ── Message mapping ────────────────────────────────────────────────────

  test('maps user messages to input items', async () => {
    mockFetch({
      id: 'resp_1',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hello' }],
    })

    const input = lastFetchBody().input
    expect(input[0]).toEqual({ role: 'user', content: 'hello' })
  })

  test('maps assistant messages with text to message items', async () => {
    mockFetch({
      id: 'resp_1',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    const messages: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello there!' },
      { role: 'user', content: 'more' },
    ]

    await provider.complete({ model: 'gpt-4.1', messages })

    const input = lastFetchBody().input
    expect(input[1]).toEqual({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello there!' }],
    })
  })

  test('maps assistant messages with tool calls to function_call items', async () => {
    mockFetch({
      id: 'resp_1',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
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

    await provider.complete({ model: 'gpt-4.1', messages })

    const input = lastFetchBody().input
    // Assistant text → message item
    expect(input[1].type).toBe('message')
    expect(input[1].role).toBe('assistant')
    // Tool call → function_call item
    expect(input[2].type).toBe('function_call')
    expect(input[2].call_id).toBe('call_1')
    expect(input[2].name).toBe('search')
    expect(input[2].arguments).toBe('{"q":"test"}')
    // Tool result → function_call_output item
    expect(input[3].type).toBe('function_call_output')
    expect(input[3].call_id).toBe('call_1')
    expect(input[3].output).toBe('results')
  })

  test('skips assistant message item when content is empty', async () => {
    mockFetch({
      id: 'resp_1',
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    const messages: Message[] = [
      { role: 'user', content: 'search' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'search', arguments: { q: 'test' } }],
      },
    ]

    await provider.complete({ model: 'gpt-4.1', messages })

    const input = lastFetchBody().input
    // Should only have user + function_call (no empty message item)
    expect(input).toHaveLength(2)
    expect(input[1].type).toBe('function_call')
  })

  // ── Response parsing ─────────────────────────────────────────────────────

  test('parses text response', async () => {
    mockFetch({
      id: 'resp_123',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello world' }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    })

    const response = await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(response.id).toBe('resp_123')
    expect(response.content).toBe('Hello world')
    expect(response.toolCalls).toHaveLength(0)
    expect(response.stopReason).toBe('end')
    expect(response.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  })

  test('parses tool calls', async () => {
    mockFetch({
      id: 'resp_456',
      output: [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'search',
          arguments: '{"query":"test"}',
        },
      ],
      usage: { input_tokens: 20, output_tokens: 15, total_tokens: 35 },
    })

    const response = await provider.complete({
      model: 'gpt-4.1',
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
      id: 'resp_1',
      output: [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'search',
          arguments: 'not json',
        },
      ],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })

    const response = await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(response.toolCalls[0]!.arguments).toEqual({ _raw: 'not json' })
  })

  test('parses mixed text and tool calls', async () => {
    mockFetch({
      id: 'resp_mix',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Let me search.' }],
        },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'search',
          arguments: '{"q":"test"}',
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    })

    const response = await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'search' }],
    })

    expect(response.content).toBe('Let me search.')
    expect(response.toolCalls).toHaveLength(1)
    expect(response.stopReason).toBe('tool_use')
  })

  test('maps stop reasons correctly', async () => {
    // Default (no tool calls, status complete) → 'end'
    mockFetch({
      id: 'resp_1',
      status: 'completed',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] },
      ],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })
    let response = await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(response.stopReason).toBe('end')

    // Tool calls → 'tool_use'
    mockFetch({
      id: 'resp_2',
      output: [{ type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' }],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })
    response = await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(response.stopReason).toBe('tool_use')

    // Incomplete status → 'max_tokens'
    mockFetch({
      id: 'resp_3',
      status: 'incomplete',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'partial' }] },
      ],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    })
    response = await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(response.stopReason).toBe('max_tokens')
  })

  // ── Streaming ─────────────────────────────────────────────────────────────

  test('streams text deltas', async () => {
    mockStreamFetch([
      { event: 'response.output_text.delta', data: JSON.stringify({ delta: 'Hello' }) },
      { event: 'response.output_text.delta', data: JSON.stringify({ delta: ' world' }) },
      {
        event: 'response.completed',
        data: JSON.stringify({
          response: { usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } },
        }),
      },
    ])

    const chunks = await collectStream(provider, {
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(chunks[0]).toEqual({ type: 'text', text: 'Hello' })
    expect(chunks[1]).toEqual({ type: 'text', text: ' world' })
    expect(chunks[2]).toEqual({
      type: 'usage',
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    })
    expect(chunks[3]).toEqual({ type: 'done' })
  })

  test('streams tool calls', async () => {
    mockStreamFetch([
      {
        event: 'response.output_item.added',
        data: JSON.stringify({
          output_index: 0,
          item: { type: 'function_call', call_id: 'call_1', name: 'search' },
        }),
      },
      {
        event: 'response.function_call_arguments.delta',
        data: JSON.stringify({ output_index: 0, delta: '{"q":' }),
      },
      {
        event: 'response.function_call_arguments.delta',
        data: JSON.stringify({ output_index: 0, delta: '"test"}' }),
      },
      {
        event: 'response.function_call_arguments.done',
        data: JSON.stringify({ output_index: 0 }),
      },
      {
        event: 'response.completed',
        data: JSON.stringify({
          response: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
        }),
      },
    ])

    const chunks = await collectStream(provider, {
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'search' }],
    })

    expect(chunks[0]).toEqual({
      type: 'tool_start',
      toolCall: { id: 'call_1', name: 'search' },
      toolIndex: 0,
    })
    expect(chunks[1]).toEqual({ type: 'tool_delta', text: '{"q":', toolIndex: 0 })
    expect(chunks[2]).toEqual({ type: 'tool_delta', text: '"test"}', toolIndex: 0 })
    expect(chunks[3]).toEqual({ type: 'tool_end', toolIndex: 0 })
    expect(chunks[4].type).toBe('usage')
    expect(chunks[5]).toEqual({ type: 'done' })
  })

  test('streams multiple parallel tool calls', async () => {
    mockStreamFetch([
      {
        event: 'response.output_item.added',
        data: JSON.stringify({
          output_index: 0,
          item: { type: 'function_call', call_id: 'call_1', name: 'search' },
        }),
      },
      {
        event: 'response.output_item.added',
        data: JSON.stringify({
          output_index: 1,
          item: { type: 'function_call', call_id: 'call_2', name: 'fetch' },
        }),
      },
      {
        event: 'response.function_call_arguments.delta',
        data: JSON.stringify({ output_index: 0, delta: '{}' }),
      },
      {
        event: 'response.function_call_arguments.delta',
        data: JSON.stringify({ output_index: 1, delta: '{}' }),
      },
      {
        event: 'response.function_call_arguments.done',
        data: JSON.stringify({ output_index: 0 }),
      },
      {
        event: 'response.function_call_arguments.done',
        data: JSON.stringify({ output_index: 1 }),
      },
      {
        event: 'response.completed',
        data: JSON.stringify({
          response: { usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
        }),
      },
    ])

    const chunks = await collectStream(provider, {
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'do both' }],
    })

    const toolStarts = chunks.filter(c => c.type === 'tool_start')
    expect(toolStarts).toHaveLength(2)
    expect(toolStarts[0].toolCall.name).toBe('search')
    expect(toolStarts[0].toolIndex).toBe(0)
    expect(toolStarts[1].toolCall.name).toBe('fetch')
    expect(toolStarts[1].toolIndex).toBe(1)

    const toolEnds = chunks.filter(c => c.type === 'tool_end')
    expect(toolEnds).toHaveLength(2)
    expect(toolEnds[0].toolIndex).toBe(0)
    expect(toolEnds[1].toolIndex).toBe(1)
  })

  test('stream skips unparseable SSE data', async () => {
    mockStreamFetch([
      { event: 'response.output_text.delta', data: 'not json' },
      { event: 'response.output_text.delta', data: JSON.stringify({ delta: 'ok' }) },
      {
        event: 'response.completed',
        data: JSON.stringify({
          response: { usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
        }),
      },
    ])

    const chunks = await collectStream(provider, {
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(chunks[0]).toEqual({ type: 'text', text: 'ok' })
  })

  test('stream throws on error event', async () => {
    mockStreamFetch([{ event: 'error', data: JSON.stringify({ message: 'rate limited' }) }])

    await expect(
      collectStream(provider, { model: 'gpt-4.1', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('rate limited')
  })

  test('stream sets stream=true in body', async () => {
    mockStreamFetch([
      {
        event: 'response.completed',
        data: JSON.stringify({
          response: { usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
        }),
      },
    ])

    await collectStream(provider, {
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(lastFetchBody().stream).toBe(true)
  })

  // ── Error handling ───────────────────────────────────────────────────────

  test('throws on non-2xx response', async () => {
    mockFetch({ error: { message: 'invalid api key' } }, 401)

    await expect(
      provider.complete({ model: 'gpt-4.1', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('OpenAI error (401)')
  })

  test('preserves raw response', async () => {
    const rawData = {
      id: 'resp_raw',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }
    mockFetch(rawData)

    const response = await provider.complete({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(response.raw).toEqual(rawData)
  })
})
