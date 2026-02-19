import type { SerializedMemoryThread, ThreadStore } from './types.ts'

/**
 * In-memory thread store for development and testing.
 *
 * Platform will provide a DatabaseThreadStore backed by PostgreSQL.
 * This implementation stores everything in a Map — data is lost
 * when the process exits.
 */
export class InMemoryThreadStore implements ThreadStore {
  private threads = new Map<string, SerializedMemoryThread>()

  async save(thread: SerializedMemoryThread): Promise<void> {
    this.threads.set(thread.id, {
      ...thread,
      messages: [...thread.messages],
      facts: thread.facts ? [...thread.facts] : undefined,
    })
  }

  async load(id: string): Promise<SerializedMemoryThread | null> {
    const thread = this.threads.get(id)
    if (!thread) return null

    return {
      ...thread,
      messages: [...thread.messages],
      facts: thread.facts ? [...thread.facts] : undefined,
    }
  }

  async delete(id: string): Promise<void> {
    this.threads.delete(id)
  }

  async list(options?: { limit?: number; offset?: number }): Promise<SerializedMemoryThread[]> {
    const all = Array.from(this.threads.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    )

    const offset = options?.offset ?? 0
    const limit = options?.limit ?? all.length

    return all.slice(offset, offset + limit)
  }

  /** Get the number of stored threads. For testing. */
  get size(): number {
    return this.threads.size
  }

  /** Clear all stored threads. For testing. */
  clear(): void {
    this.threads.clear()
  }
}
