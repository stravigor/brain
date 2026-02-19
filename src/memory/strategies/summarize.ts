import BrainManager from '../../brain_manager.ts'
import type { Message } from '../../types.ts'
import type { CompactionResult, CompactionStrategy, Fact } from '../types.ts'
import { TokenCounter } from '../token_counter.ts'

const SUMMARIZE_SYSTEM = `You are a conversation summarizer. Your job is to produce a concise summary that preserves all information needed for conversation continuity.

Preserve:
- Key decisions and their reasoning
- Important facts about the user and their situation
- Open questions or pending action items
- Context that would be needed to continue the conversation naturally

Be concise but thorough. Write in third person past tense.`

const SUMMARIZE_PROMPT = `Summarize the following conversation segment. The summary will replace these messages in the conversation context, so it must preserve everything needed for continuity.

<messages>
{{messages}}
</messages>`

const MERGE_PROMPT = `Below is an existing conversation summary followed by a new segment of messages. Produce a single updated summary that merges the existing summary with the new information. Do not simply append — integrate and consolidate.

<existing_summary>
{{existingSummary}}
</existing_summary>

<new_messages>
{{messages}}
</new_messages>`

const EXTRACT_FACTS_SUFFIX = `

After the summary, output a JSON block with extracted facts. Each fact should be a key-value pair representing a stable piece of information about the user or their situation. Only include facts you are confident about.

Format:
<facts>
[{"key": "fact_key", "value": "fact value", "confidence": 0.9}]
</facts>`

/**
 * Uses the thread's own LLM to produce a natural-language summary
 * of compacted messages. Optionally extracts structured facts.
 *
 * When an existing summary is provided, it merges rather than
 * creating a summary-of-summary chain.
 */
export class SummarizeStrategy implements CompactionStrategy {
  readonly name = 'summarize'

  async compact(
    messages: Message[],
    options: { provider: string; model: string; existingSummary?: string; extractFacts?: boolean }
  ): Promise<CompactionResult> {
    const messagesText = SummarizeStrategy.formatMessages(messages)

    let prompt: string
    if (options.existingSummary) {
      prompt = MERGE_PROMPT.replace('{{existingSummary}}', options.existingSummary).replace(
        '{{messages}}',
        messagesText
      )
    } else {
      prompt = SUMMARIZE_PROMPT.replace('{{messages}}', messagesText)
    }

    if (options.extractFacts) {
      prompt += EXTRACT_FACTS_SUFFIX
    }

    const response = await BrainManager.complete(options.provider, {
      model: options.model,
      messages: [{ role: 'user', content: prompt }],
      system: SUMMARIZE_SYSTEM,
      maxTokens: 2048,
      temperature: 0.3,
    })

    const { summary, facts } = SummarizeStrategy.parseResponse(
      response.content,
      options.extractFacts
    )

    return {
      summary,
      facts,
      summaryTokens: TokenCounter.estimate(summary),
    }
  }

  /** Format messages into readable text for the summarization prompt. */
  private static formatMessages(messages: Message[]): string {
    const lines: string[] = []

    for (const msg of messages) {
      const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1)
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .filter(b => b.type === 'text' && b.text)
              .map(b => b.text)
              .join('\n')

      if (content) {
        lines.push(`${role}: ${content}`)
      }

      if (msg.toolCalls) {
        for (const call of msg.toolCalls) {
          lines.push(`[Tool call: ${call.name}(${JSON.stringify(call.arguments)})]`)
        }
      }
    }

    return lines.join('\n\n')
  }

  /** Parse the LLM response, extracting the summary and optional facts block. */
  private static parseResponse(
    content: string,
    extractFacts?: boolean
  ): { summary: string; facts: Fact[] } {
    if (!extractFacts) {
      return { summary: content.trim(), facts: [] }
    }

    const factsMatch = content.match(/<facts>\s*([\s\S]*?)\s*<\/facts>/)
    const now = new Date().toISOString()

    let facts: Fact[] = []
    if (factsMatch?.[1]) {
      try {
        const parsed = JSON.parse(factsMatch[1]) as Array<{
          key: string
          value: string
          confidence?: number
        }>
        facts = parsed.map(f => ({
          key: f.key,
          value: f.value,
          source: 'extracted' as const,
          confidence: f.confidence ?? 0.7,
          createdAt: now,
          updatedAt: now,
        }))
      } catch {
        // If fact parsing fails, continue with just the summary
      }
    }

    // Remove the facts block from the summary
    const summary = content.replace(/<facts>[\s\S]*?<\/facts>/, '').trim()

    return { summary, facts }
  }
}
