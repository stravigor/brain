import type { Message } from '../types.ts'

// ── Configuration ───────────────────────────────────────────────────────────

export interface MemoryConfig {
  /** Max tokens for the entire context window (default: auto-detect from model). */
  maxContextTokens?: number
  /** Strategy: 'sliding_window' | 'summarize' (default: 'summarize'). */
  strategy?: string
  /** Reserve this fraction of context for the response (default: 0.25). */
  responseReserve?: number
  /** Min messages to keep in working memory before compacting (default: 4). */
  minWorkingMessages?: number
  /** Number of oldest messages to compact per cycle (default: 10). */
  compactionBatchSize?: number
  /** Enable semantic fact extraction during compaction (default: true). */
  extractFacts?: boolean
}

// ── Compaction Strategy ─────────────────────────────────────────────────────

export interface CompactionResult {
  /** Summary text replacing the compacted messages. */
  summary: string
  /** Facts extracted during compaction (if enabled). */
  facts?: Fact[]
  /** Token count of the summary. */
  summaryTokens: number
}

export interface CompactionStrategy {
  readonly name: string
  compact(
    messages: Message[],
    options: { provider: string; model: string; existingSummary?: string; extractFacts?: boolean }
  ): Promise<CompactionResult>
}

// ── Thread Store ────────────────────────────────────────────────────────────

export interface SerializedMemoryThread {
  id: string
  messages: Message[]
  system?: string
  summary?: string
  facts?: Fact[]
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ThreadStore {
  save(thread: SerializedMemoryThread): Promise<void>
  load(id: string): Promise<SerializedMemoryThread | null>
  delete(id: string): Promise<void>
  list(options?: { limit?: number; offset?: number }): Promise<SerializedMemoryThread[]>
}

// ── Semantic Memory ─────────────────────────────────────────────────────────

export interface Fact {
  key: string
  value: string
  source: 'extracted' | 'explicit'
  confidence: number
  createdAt: string
  updatedAt: string
}
