# @stravigor/brain

Multi-provider AI module with agents, tool use, structured output, multi-turn threads, and workflow orchestration. Supports Anthropic, OpenAI, and DeepSeek. Zero SDK dependencies — all provider communication uses raw fetch().

## Dependencies
- @stravigor/kernel (peer)
- @stravigor/workflow (peer)

## Commands
- bun test
- bun run build

## Architecture
- src/brain_manager.ts — main manager class
- src/brain_provider.ts — service provider registration
- src/agent.ts — AI agent abstraction
- src/tool.ts — tool definitions for AI tool use
- src/workflow.ts — AI workflow orchestration (uses @stravigor/workflow)
- src/providers/ — provider implementations (Anthropic, OpenAI, DeepSeek)
- src/utils/ — shared utilities
- src/types.ts — type definitions

## Conventions
- Providers implement a common interface — no SDK dependencies, raw fetch() only
- Tools are defined declaratively and passed to agents
- Workflows compose agents and tools into multi-step processes via @stravigor/workflow
