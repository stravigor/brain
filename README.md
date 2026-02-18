# @stravigor/brain

AI module for the [Strav](https://www.npmjs.com/package/@stravigor/core) framework. Provides a unified interface for AI providers with support for agents, threads, tool use, and multi-step workflows.

## Install

```bash
bun add @stravigor/brain
```

Requires `@stravigor/core` as a peer dependency.

## Providers

- **Anthropic** (Claude)
- **OpenAI** (GPT, also works with DeepSeek via custom `baseUrl`)

## Usage

```ts
import { brain } from '@stravigor/brain'

// One-shot chat
const response = await brain.chat('Explain quantum computing')

// Streaming
for await (const chunk of brain.stream('Write a poem')) {
  process.stdout.write(chunk.text)
}

// Structured output with Zod
import { z } from 'zod'
const result = await brain.generate('List 3 colors', {
  schema: z.object({ colors: z.array(z.string()) }),
})

// Embeddings
const vectors = await brain.embed('Hello world')
```

## Agents

```ts
import { Agent, defineTool } from '@stravigor/brain'

class ResearchAgent extends Agent {
  provider = 'anthropic'
  model = 'claude-sonnet-4-20250514'
  instructions = 'You are a research assistant.'
  tools = [searchTool, summarizeTool]
}

const result = await brain.agent(ResearchAgent).input('Find info on Bun').run()
```

## Threads

Multi-turn conversations with serialization support:

```ts
const thread = brain.thread({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' })
await thread.send('Hello')
await thread.send('Tell me more')
const saved = thread.serialize() // persist and restore later
```

## Workflows

Orchestrate multi-agent pipelines:

```ts
const workflow = brain.workflow()
  .step('research', ResearchAgent)
  .step('summarize', SummaryAgent)
  .parallel('review', [FactCheckAgent, StyleAgent])

const result = await workflow.run('Analyze this topic')
```

## License

MIT
