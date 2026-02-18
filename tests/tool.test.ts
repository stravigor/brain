import { describe, test, expect } from 'bun:test'
import { defineTool, defineToolbox } from '../src/tool.ts'
import { z } from 'zod'

describe('defineTool', () => {
  test('creates tool with Zod schema', () => {
    const tool = defineTool({
      name: 'search',
      description: 'Search the database',
      parameters: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().optional(),
      }),
      execute: async ({ query }) => `results for ${query}`,
    })

    expect(tool.name).toBe('search')
    expect(tool.description).toBe('Search the database')
    // Check key structural properties (Zod v4 may add additionalProperties: false)
    expect(tool.parameters.type).toBe('object')
    expect((tool.parameters.properties as any).query.type).toBe('string')
    expect((tool.parameters.properties as any).query.description).toBe('Search query')
    expect((tool.parameters.properties as any).limit.type).toBe('number')
    expect(tool.parameters.required).toEqual(['query'])
    expect(typeof tool.execute).toBe('function')
  })

  test('creates tool with raw JSON Schema', () => {
    const params = { type: 'object', properties: { q: { type: 'string' } } }
    const tool = defineTool({
      name: 'search',
      description: 'Search',
      parameters: params,
      execute: async () => {},
    })

    expect(tool.parameters).toEqual(params)
  })

  test('execute function works', async () => {
    const tool = defineTool({
      name: 'add',
      description: 'Add two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }: { a: number; b: number }) => a + b,
    })

    const result = await tool.execute({ a: 2, b: 3 })
    expect(result).toBe(5)
  })
})

describe('defineToolbox', () => {
  test('returns the tools array', () => {
    const tool1 = defineTool({
      name: 'a',
      description: 'A',
      parameters: {},
      execute: async () => {},
    })
    const tool2 = defineTool({
      name: 'b',
      description: 'B',
      parameters: {},
      execute: async () => {},
    })

    const toolbox = defineToolbox('test', [tool1, tool2])

    expect(toolbox).toHaveLength(2)
    expect(toolbox[0]!.name).toBe('a')
    expect(toolbox[1]!.name).toBe('b')
  })
})
