import { describe, test, expect } from 'bun:test'
import { zodToJsonSchema } from '../src/utils/schema.ts'
import { z } from 'zod'

describe('zodToJsonSchema', () => {
  test('passes through plain JSON Schema objects', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } } }
    expect(zodToJsonSchema(schema)).toEqual(schema)
  })

  test('converts ZodString', () => {
    const result = zodToJsonSchema(z.string())
    expect(result.type).toBe('string')
  })

  test('converts ZodString with description', () => {
    const result = zodToJsonSchema(z.string().describe('A name'))
    expect(result.type).toBe('string')
    expect(result.description).toBe('A name')
  })

  test('converts ZodString with min/max', () => {
    const result = zodToJsonSchema(z.string().min(1).max(100))
    expect(result.type).toBe('string')
    expect(result.minLength).toBe(1)
    expect(result.maxLength).toBe(100)
  })

  test('converts ZodNumber', () => {
    const result = zodToJsonSchema(z.number())
    expect(result.type).toBe('number')
  })

  test('converts ZodNumber.int() to integer', () => {
    const result = zodToJsonSchema(z.number().int())
    expect(result.type).toBe('integer')
  })

  test('converts ZodBoolean', () => {
    const result = zodToJsonSchema(z.boolean())
    expect(result.type).toBe('boolean')
  })

  test('converts ZodEnum', () => {
    const result = zodToJsonSchema(z.enum(['a', 'b', 'c']))
    expect(result.type).toBe('string')
    expect(result.enum).toEqual(['a', 'b', 'c'])
  })

  test('converts ZodArray', () => {
    const result = zodToJsonSchema(z.array(z.string()))
    expect(result.type).toBe('array')
    expect(result.items).toEqual({ type: 'string' })
  })

  test('converts ZodObject with required and optional fields', () => {
    const result = zodToJsonSchema(
      z.object({
        name: z.string(),
        age: z.number(),
        email: z.string().optional(),
      })
    )

    expect(result.type).toBe('object')
    expect((result.properties as any).name).toEqual({ type: 'string' })
    expect((result.properties as any).age).toEqual({ type: 'number' })
    expect((result.properties as any).email).toEqual({ type: 'string' })
    expect(result.required).toEqual(['name', 'age'])
  })

  test('converts ZodDefault', () => {
    const result = zodToJsonSchema(z.string().default('hello'))
    expect(result.type).toBe('string')
    expect(result.default).toBe('hello')
  })

  test('converts ZodNullable', () => {
    const result = zodToJsonSchema(z.string().nullable())
    expect(result.anyOf).toBeDefined()
    const anyOf = result.anyOf as any[]
    expect(anyOf).toContainEqual({ type: 'string' })
    expect(anyOf).toContainEqual({ type: 'null' })
  })

  test('converts ZodUnion', () => {
    const result = zodToJsonSchema(z.union([z.string(), z.number()]))
    expect(result.anyOf).toBeDefined()
    const anyOf = result.anyOf as any[]
    expect(anyOf).toContainEqual({ type: 'string' })
    expect(anyOf).toContainEqual({ type: 'number' })
  })

  test('converts nested objects', () => {
    const result = zodToJsonSchema(
      z.object({
        user: z.object({
          name: z.string(),
          tags: z.array(z.string()),
        }),
      })
    )

    expect(result.type).toBe('object')
    const userProp = (result.properties as any).user
    expect(userProp.type).toBe('object')
    expect(userProp.properties.name).toEqual({ type: 'string' })
    expect(userProp.properties.tags).toEqual({ type: 'array', items: { type: 'string' } })
    expect(userProp.required).toEqual(['name', 'tags'])
  })

  test('converts ZodLiteral', () => {
    const result = zodToJsonSchema(z.literal('hello'))
    expect(result.const).toBe('hello')
  })

  test('strips $schema field', () => {
    const result = zodToJsonSchema(z.string())
    expect(result.$schema).toBeUndefined()
  })

  test('returns null/undefined as-is', () => {
    expect(zodToJsonSchema(null)).toBeNull()
    expect(zodToJsonSchema(undefined)).toBeUndefined()
  })
})
