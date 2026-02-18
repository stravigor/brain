import type { SSEEvent } from '../types.ts'

/**
 * Parse a Server-Sent Events stream into structured events.
 *
 * Handles:
 * - Chunks split at arbitrary byte boundaries
 * - Multi-line `data:` fields (concatenated with newlines)
 * - Optional `event:` field
 * - Empty lines / keepalive comments
 */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncIterable<SSEEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const events = buffer.split('\n\n')
      // Last element is either empty (if buffer ended with \n\n) or incomplete
      buffer = events.pop()!

      for (const block of events) {
        const parsed = parseBlock(block)
        if (parsed) yield parsed
      }
    }

    // Flush any remaining data in buffer
    if (buffer.trim()) {
      const parsed = parseBlock(buffer)
      if (parsed) yield parsed
    }
  } finally {
    reader.releaseLock()
  }
}

function parseBlock(block: string): SSEEvent | null {
  let event: string | undefined
  const dataLines: string[] = []

  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) {
      event = line.slice(7)
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6))
    } else if (line === 'data:') {
      dataLines.push('')
    }
    // Skip comments (lines starting with ':') and other fields
  }

  if (dataLines.length === 0) return null

  return { event, data: dataLines.join('\n') }
}
