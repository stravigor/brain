import { zodToJsonSchema } from './utils/schema.ts'
import type { ToolDefinition, JsonSchema } from './types.ts'

/**
 * Define a tool that an agent can invoke.
 *
 * Accepts either a Zod schema or a raw JSON Schema object
 * for `parameters`. Zod schemas are automatically converted.
 *
 * @example
 * const searchTool = defineTool({
 *   name: 'search',
 *   description: 'Search the database',
 *   parameters: z.object({ query: z.string() }),
 *   execute: async ({ query }) => {
 *     return await db.search(query)
 *   },
 * })
 */
export function defineTool(config: {
  name: string
  description: string
  parameters: any
  execute: (args: any) => unknown | Promise<unknown>
}): ToolDefinition {
  return {
    name: config.name,
    description: config.description,
    parameters: zodToJsonSchema(config.parameters) as JsonSchema,
    execute: config.execute,
  }
}

/**
 * Group related tools into a named collection.
 *
 * A toolbox is simply a labeled array — useful for organizing
 * tools by domain (e.g., database tools, API tools) and
 * spreading them into an agent's `tools` array.
 *
 * @example
 * const dbTools = defineToolbox('database', [searchTool, insertTool])
 *
 * class MyAgent extends Agent {
 *   tools = [...dbTools, weatherTool]
 * }
 */
export function defineToolbox(_name: string, tools: ToolDefinition[]): ToolDefinition[] {
  return tools
}
