import type { JsonSchema } from '../types.ts'

/**
 * Convert a Zod schema to a JSON Schema object.
 *
 * Detection logic:
 * - If the input has a `toJSONSchema()` method (Zod v4+), use it directly
 * - If the input is already a plain object (raw JSON Schema), return as-is
 * - null/undefined pass through unchanged
 *
 * The `$schema` meta-field is stripped from the output since
 * AI provider APIs don't expect it.
 */
export function zodToJsonSchema(schema: any): JsonSchema {
  if (schema == null) return schema

  // Zod v4+: native toJSONSchema() method
  if (typeof schema.toJSONSchema === 'function') {
    const jsonSchema = schema.toJSONSchema()
    // Strip the $schema meta-field — providers don't need it
    const { $schema, ...rest } = jsonSchema
    return rest as JsonSchema
  }

  // Already a plain JSON Schema object
  return schema as JsonSchema
}
