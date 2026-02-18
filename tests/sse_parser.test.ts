import { describe, test, expect } from 'bun:test'
import { parseSSE } from '../src/utils/sse_parser.ts'

function toStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!))
        index++
      } else {
        controller.close()
      }
    },
  })
}

async function collectEvents(stream: ReadableStream<Uint8Array>) {
  const events = []
  for await (const event of parseSSE(stream)) {
    events.push(event)
  }
  return events
}

describe('parseSSE', () => {
  test('parses a single event', async () => {
    const stream = toStream(['data: {"hello":"world"}\n\n'])
    const events = await collectEvents(stream)

    expect(events).toHaveLength(1)
    expect(events[0]!.data).toBe('{"hello":"world"}')
    expect(events[0]!.event).toBeUndefined()
  })

  test('parses multiple events in one chunk', async () => {
    const stream = toStream(['data: first\n\ndata: second\n\n'])
    const events = await collectEvents(stream)

    expect(events).toHaveLength(2)
    expect(events[0]!.data).toBe('first')
    expect(events[1]!.data).toBe('second')
  })

  test('parses event with event field', async () => {
    const stream = toStream(['event: content_block_delta\ndata: {"text":"hi"}\n\n'])
    const events = await collectEvents(stream)

    expect(events).toHaveLength(1)
    expect(events[0]!.event).toBe('content_block_delta')
    expect(events[0]!.data).toBe('{"text":"hi"}')
  })

  test('handles events split across chunks', async () => {
    const stream = toStream(['data: hel', 'lo\n\ndata: world\n\n'])
    const events = await collectEvents(stream)

    expect(events).toHaveLength(2)
    expect(events[0]!.data).toBe('hello')
    expect(events[1]!.data).toBe('world')
  })

  test('handles multi-line data fields', async () => {
    const stream = toStream(['data: line1\ndata: line2\n\n'])
    const events = await collectEvents(stream)

    expect(events).toHaveLength(1)
    expect(events[0]!.data).toBe('line1\nline2')
  })

  test('skips empty events', async () => {
    const stream = toStream(['\n\ndata: actual\n\n'])
    const events = await collectEvents(stream)

    expect(events).toHaveLength(1)
    expect(events[0]!.data).toBe('actual')
  })

  test('handles data field with no space after colon', async () => {
    const stream = toStream(['data:\n\n'])
    const events = await collectEvents(stream)

    expect(events).toHaveLength(1)
    expect(events[0]!.data).toBe('')
  })

  test('handles trailing data without final double newline', async () => {
    const stream = toStream(['data: trailing'])
    const events = await collectEvents(stream)

    expect(events).toHaveLength(1)
    expect(events[0]!.data).toBe('trailing')
  })

  test('handles empty stream', async () => {
    const stream = toStream([])
    const events = await collectEvents(stream)
    expect(events).toHaveLength(0)
  })

  test('handles many events across many small chunks', async () => {
    // Split each character into its own chunk
    const full = 'data: a\n\ndata: b\n\ndata: c\n\n'
    const chunks = full.split('').map(c => c)
    const stream = toStream(chunks)
    const events = await collectEvents(stream)

    expect(events).toHaveLength(3)
    expect(events[0]!.data).toBe('a')
    expect(events[1]!.data).toBe('b')
    expect(events[2]!.data).toBe('c')
  })
})
