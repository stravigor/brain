# AI

Multi-provider AI with agents, tool use, structured output, multi-turn threads, and workflow orchestration. Supports Anthropic, OpenAI, and DeepSeek out of the box. Zero SDK dependencies — all provider communication uses raw `fetch()`.

## Quick start

```typescript
import { brain } from '@stravigor/brain'

// One-shot chat
const answer = await brain.chat('What is the capital of France?')

// Structured output
const { data } = await brain.generate({
  prompt: 'Extract: "Alice is 30 years old"',
  schema: z.object({ name: z.string(), age: z.number() }),
})
// data.name === 'Alice', data.age === 30

// Streaming
for await (const chunk of brain.stream('Write a haiku about code')) {
  if (chunk.type === 'text') process.stdout.write(chunk.text!)
}
```

## Setup

### Using a service provider (recommended)

```typescript
import { BrainProvider } from '@stravigor/brain'

app.use(new BrainProvider())
```

The `BrainProvider` registers `BrainManager` as a singleton. It depends on the `config` provider.

### Manual setup

```typescript
import BrainManager from '@stravigor/brain/brain_manager'

app.singleton(BrainManager)
app.resolve(BrainManager)
```

Create `config/ai.ts`:

```typescript
import { env } from '@stravigor/core/helpers/env'

export default {
  default: env('AI_PROVIDER', 'anthropic'),

  providers: {
    anthropic: {
      driver: 'anthropic',
      apiKey: env('ANTHROPIC_API_KEY', ''),
      model: env('ANTHROPIC_MODEL', 'claude-sonnet-4-5-20250929'),
    },
    openai: {
      driver: 'openai',
      apiKey: env('OPENAI_API_KEY', ''),
      model: env('OPENAI_MODEL', 'gpt-4o'),
    },
    deepseek: {
      driver: 'openai',
      apiKey: env('DEEPSEEK_API_KEY', ''),
      model: env('DEEPSEEK_MODEL', 'deepseek-chat'),
      baseUrl: 'https://api.deepseek.com',
    },
  },

  maxTokens: env.int('AI_MAX_TOKENS', 4096),
  temperature: env.float('AI_TEMPERATURE', 0.7),
  maxIterations: env.int('AI_MAX_ITERATIONS', 10),
}
```

DeepSeek uses the OpenAI-compatible API — set `driver: 'openai'` with a custom `baseUrl`.

## brain helper

The `brain` object is the primary API. All methods respect provider configuration and support per-call overrides.

```typescript
import { brain } from '@stravigor/brain'
```

### chat

One-shot completion, returns a string:

```typescript
const answer = await brain.chat('Summarize this article: ...')

// With options
const answer = await brain.chat('Translate to French: Hello', {
  provider: 'openai',
  model: 'gpt-4o-mini',
  temperature: 0.3,
  system: 'You are a professional translator.',
})
```

### generate

Structured output with Zod or raw JSON Schema:

```typescript
import { z } from 'zod'

const { data, text, usage } = await brain.generate({
  prompt: 'Extract entities: "John works at Acme Corp in Paris"',
  schema: z.object({
    name: z.string(),
    company: z.string(),
    city: z.string(),
  }),
})
// data.name === 'John', data.company === 'Acme Corp', data.city === 'Paris'

// Raw JSON Schema also works
const { data } = await brain.generate({
  prompt: 'Classify sentiment: "I love this product"',
  schema: {
    type: 'object',
    properties: {
      sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
      confidence: { type: 'number' },
    },
    required: ['sentiment', 'confidence'],
  },
})
```

### stream

Streaming completion, returns an async iterable:

```typescript
for await (const chunk of brain.stream('Write a poem about TypeScript')) {
  if (chunk.type === 'text') process.stdout.write(chunk.text!)
}
```

### embed

Generate embeddings (OpenAI provider):

```typescript
const vectors = await brain.embed('Hello world', { provider: 'openai' })
// vectors: number[][] — one embedding per input

const batch = await brain.embed(['Hello', 'World'], { provider: 'openai' })
```

## Agents

Agents encapsulate instructions, tools, output format, and lifecycle hooks into reusable classes. They are the building blocks for complex AI interactions.

### Defining an agent

```typescript
import { Agent } from '@stravigor/brain'
import { defineTool } from '@stravigor/brain'
import { z } from 'zod'

class SupportAgent extends Agent {
  provider = 'anthropic'
  model = 'claude-sonnet-4-5-20250929'
  instructions = 'You are a customer support agent for {{companyName}}. Help the user with their issue.'

  tools = [
    defineTool({
      name: 'lookup_order',
      description: 'Look up an order by ID',
      parameters: z.object({ orderId: z.string() }),
      execute: async ({ orderId }) => {
        const order = await Order.find(orderId)
        return { status: order.status, items: order.items }
      },
    }),
  ]

  output = z.object({
    reply: z.string(),
    category: z.enum(['billing', 'shipping', 'product', 'other']),
  })
}
```

### Agent properties

| Property | Description | Default |
|---|---|---|
| `provider` | Provider name (`'anthropic'`, `'openai'`, etc.) | Config default |
| `model` | Model identifier | Provider default |
| `instructions` | System prompt. Supports `{{key}}` interpolation | `''` |
| `tools` | Array of `ToolDefinition` objects | `undefined` |
| `output` | Zod schema or JSON Schema for structured output | `undefined` |
| `maxIterations` | Max tool-use loop iterations | Config default (10) |
| `maxTokens` | Max tokens per request | Config default (4096) |
| `temperature` | Temperature | Config default (0.7) |

### Running an agent

Use the fluent `AgentRunner` via `brain.agent()`:

```typescript
const result = await brain.agent(SupportAgent)
  .input('Where is my order #12345?')
  .with({ companyName: 'Acme Corp' })     // context for {{key}} interpolation
  .run()

result.text       // raw response text
result.data       // parsed structured output (if agent has `output` schema)
result.toolCalls  // array of tool calls with results and durations
result.usage      // { inputTokens, outputTokens, totalTokens }
result.iterations // number of completion rounds (1 if no tool use)
```

The runner handles the tool-use loop automatically: when the model calls a tool, the runner executes it, feeds the result back, and re-requests until the model stops or hits `maxIterations`.

### Provider override

Override the provider for a specific run without changing the agent class:

```typescript
const result = await brain.agent(SupportAgent)
  .input('Help me')
  .using('openai', 'gpt-4o')
  .run()
```

### Streaming agents

```typescript
for await (const event of brain.agent(SupportAgent).input('Help me').stream()) {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.text!)
      break
    case 'tool_result':
      console.log('Tool:', event.toolCall!.name, '→', event.toolCall!.result)
      break
    case 'done':
      console.log('Final result:', event.result!.data)
      break
  }
}
```

### Lifecycle hooks

Override methods on the agent class to hook into the execution lifecycle:

```typescript
class LoggingAgent extends Agent {
  instructions = 'You are a helpful assistant.'

  async onStart(input: string, context: Record<string, unknown>) {
    console.log('Agent started with:', input)
  }

  async onToolCall(call: ToolCall) {
    console.log(`Calling tool: ${call.name}`)
  }

  async onToolResult(record: ToolCallRecord) {
    console.log(`Tool ${record.name} took ${record.duration}ms`)
  }

  async onComplete(result: AgentResult) {
    console.log('Agent completed:', result.text)
  }

  async onError(error: Error) {
    console.error('Agent failed:', error.message)
  }
}
```

## Tools

Tools give agents the ability to call functions. Define them with `defineTool()`:

```typescript
import { defineTool, defineToolbox } from '@stravigor/brain'

const searchTool = defineTool({
  name: 'search',
  description: 'Search the knowledge base',
  parameters: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional(),
  }),
  execute: async ({ query, limit }) => {
    return await KnowledgeBase.search(query, limit ?? 10)
  },
})
```

Parameters accept either a Zod schema (automatically converted to JSON Schema) or a raw JSON Schema object.

### Toolboxes

Group related tools for organization:

```typescript
const dbTools = defineToolbox('database', [
  searchTool,
  insertTool,
  updateTool,
])

class MyAgent extends Agent {
  tools = [...dbTools, weatherTool]
}
```

### Error handling

Tool errors are caught automatically and fed back to the model as error strings. The model can then decide how to proceed:

```typescript
const riskyTool = defineTool({
  name: 'external_api',
  description: 'Call an external API',
  parameters: z.object({ url: z.string() }),
  execute: async ({ url }) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`API returned ${res.status}`)
    return await res.json()
  },
})
// If fetch fails, the model receives: "Error: API returned 500"
```

## Threads

Threads manage multi-turn conversations with automatic history tracking:

```typescript
const thread = brain.thread()
thread.system('You are a helpful math tutor.')

const r1 = await thread.send('What is 2 + 2?')    // "4"
const r2 = await thread.send('Multiply that by 3') // "12" — remembers context
```

### Thread with agent

Inherit provider, model, system prompt, and tools from an agent:

```typescript
const thread = brain.thread(SupportAgent)
const reply = await thread.send('I need help with my order')
```

### Persistence

Serialize a thread for storage (database, session, cache) and restore later:

```typescript
// Save
const snapshot = thread.serialize()
await cache.set(`thread:${userId}`, snapshot, 3600)

// Restore
const saved = await cache.get<SerializedThread>(`thread:${userId}`)
const thread = brain.thread().restore(saved)
const reply = await thread.send('Continue our conversation')
```

### Streaming threads

`thread.stream()` works like `thread.send()` but yields chunks as they arrive. Tool calls are handled automatically in a loop, just like `send()`:

```typescript
for await (const chunk of thread.stream('What tools do you have?')) {
  if (chunk.type === 'text') process.stdout.write(chunk.text!)
}
// Messages (user, assistant, tool results) are appended to the thread history automatically.
```

### Thread API

```typescript
thread.system('prompt')           // set/override system prompt
thread.using('openai', 'gpt-4o') // override provider
thread.tools([searchTool])        // set available tools
thread.send('message')            // send and get response (handles tool calls)
thread.stream('message')          // stream response (handles tool calls)
thread.getMessages()              // get copy of message history
thread.clear()                    // reset conversation
```

## Workflows

Workflows orchestrate multiple agents in sequence, parallel, routing, or loop patterns:

```typescript
const result = await brain.workflow('content-pipeline')
  .step('research', ResearchAgent)
  .step('write', WriterAgent, (ctx) => ({
    prompt: `Write about: ${ctx.results.research.text}`,
  }))
  .step('review', ReviewerAgent)
  .run({ topic: 'AI in healthcare' })

result.results.research.text  // research output
result.results.write.text     // written article
result.results.review.text    // review feedback
result.usage                  // aggregated token usage
result.duration               // total wall-clock time (ms)
```

### Sequential steps

Steps run in order. Each step receives the full workflow context (input + all previous results). Use `mapInput` to transform context into the agent's input:

```typescript
brain.workflow('pipeline')
  .step('analyze', AnalyzerAgent)
  .step('summarize', SummaryAgent, (ctx) => ({
    text: ctx.results.analyze.text,
  }))
  .run({ document: '...' })
```

### Parallel steps

Run multiple agents concurrently:

```typescript
brain.workflow('analysis')
  .parallel('analyze', [
    { name: 'sentiment', agent: SentimentAgent },
    { name: 'summary', agent: SummaryAgent },
    { name: 'keywords', agent: KeywordAgent },
  ])
  .run({ text: 'Some article...' })
```

### Routing

A router agent decides which specialist to dispatch to:

```typescript
class TriageAgent extends Agent {
  instructions = 'Classify the support request. Return the category.'
  output = z.object({ route: z.string() })
}

brain.workflow('support')
  .route('triage', TriageAgent, {
    billing: BillingAgent,
    shipping: ShippingAgent,
    technical: TechnicalAgent,
  })
  .run({ message: 'I need a refund' })
```

The router's output must contain a `route` field matching one of the branch keys.

### Loops

Iterate an agent until a condition is met:

```typescript
brain.workflow('refinement')
  .loop('improve', WriterAgent, {
    maxIterations: 5,
    until: (result) => {
      const score = JSON.parse(result.text).quality
      return score >= 8
    },
    feedback: (result) => `Previous attempt scored ${JSON.parse(result.text).quality}/10. Improve.`,
  })
  .run({ task: 'Write a product description' })
```

## Hooks

Register global before/after hooks on `BrainManager` for logging, cost tracking, or rate limiting:

```typescript
import BrainManager from '@stravigor/brain/brain_manager'

// Log all completions
BrainManager.before((request) => {
  console.log(`AI request: ${request.model}, ${request.messages.length} messages`)
})

BrainManager.after((request, response) => {
  console.log(`AI response: ${response.usage.totalTokens} tokens`)
})
```

## Custom provider

Implement the `AIProvider` interface to add any provider:

```typescript
import type { AIProvider, CompletionRequest, CompletionResponse, StreamChunk } from '@stravigor/brain'
import BrainManager from '@stravigor/brain/brain_manager'

class OllamaProvider implements AIProvider {
  readonly name = 'ollama'

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
      }),
    })

    const data = await response.json() as any
    return {
      id: crypto.randomUUID(),
      content: data.message.content,
      toolCalls: [],
      stopReason: 'end',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      raw: data,
    }
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    // streaming implementation...
    yield { type: 'done' }
  }
}

// In bootstrap
BrainManager.useProvider(new OllamaProvider())
```

## Testing

Swap in a mock provider with `BrainManager.useProvider()`:

```typescript
import { test, expect, beforeEach } from 'bun:test'
import BrainManager from '@stravigor/brain/brain_manager'
import { brain } from '@stravigor/brain'
import type { AIProvider, CompletionRequest, CompletionResponse, StreamChunk } from '@stravigor/brain'

class MockProvider implements AIProvider {
  readonly name = 'mock'
  responses: CompletionResponse[] = []
  requests: CompletionRequest[] = []
  private callIndex = 0

  queueResponse(response: Partial<CompletionResponse>) {
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
    return this.responses[this.callIndex++]!
  }

  async *stream(): AsyncIterable<StreamChunk> {
    yield { type: 'done' }
  }
}

let mock: MockProvider

beforeEach(() => {
  mock = new MockProvider()
  BrainManager.reset()
  BrainManager.useProvider(mock)
  ;(BrainManager as any)._config = {
    default: 'mock',
    providers: { mock: { driver: 'openai', apiKey: 'k', model: 'mock-model' } },
    maxTokens: 4096,
    temperature: 0.7,
    maxIterations: 10,
  }
})

test('one-shot chat', async () => {
  mock.queueResponse({ content: 'Hello!' })
  const answer = await brain.chat('Hi')
  expect(answer).toBe('Hello!')
})
```

## Controller example

```typescript
import { brain } from '@stravigor/brain'
import { Agent } from '@stravigor/brain'
import { defineTool } from '@stravigor/brain'
import { z } from 'zod'

class AssistantAgent extends Agent {
  provider = 'anthropic'
  instructions = 'You are a project management assistant for {{orgName}}.'

  tools = [
    defineTool({
      name: 'list_projects',
      description: 'List active projects for the organization',
      parameters: z.object({ orgId: z.string() }),
      execute: async ({ orgId }) => {
        return await Project.where('organization_id', orgId)
          .where('status', 'active')
          .all()
      },
    }),
  ]
}

export default class AiAssistantController {
  async chat(ctx: Context) {
    const [user, org] = ctx.get<User, Organization>('user', 'organization')
    const { message } = await ctx.body<{ message: string }>()

    const result = await brain.agent(AssistantAgent)
      .input(message)
      .with({ orgName: org.name })
      .run()

    return ctx.json({
      reply: result.text,
      usage: result.usage,
    })
  }
}
```
