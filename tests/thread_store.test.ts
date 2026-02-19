import { describe, test, expect, beforeEach } from 'bun:test'
import { InMemoryThreadStore } from '../src/memory/thread_store.ts'
import type { SerializedMemoryThread } from '../src/memory/types.ts'

function makeThread(id: string, overrides?: Partial<SerializedMemoryThread>): SerializedMemoryThread {
  return {
    id,
    messages: [{ role: 'user', content: 'hello' }],
    system: 'Be helpful.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('InMemoryThreadStore', () => {
  let store: InMemoryThreadStore

  beforeEach(() => {
    store = new InMemoryThreadStore()
  })

  test('save() and load()', async () => {
    const thread = makeThread('t1')
    await store.save(thread)

    const loaded = await store.load('t1')
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe('t1')
    expect(loaded!.messages).toHaveLength(1)
    expect(loaded!.system).toBe('Be helpful.')
  })

  test('load() returns null for nonexistent thread', async () => {
    const loaded = await store.load('nonexistent')
    expect(loaded).toBeNull()
  })

  test('save() updates existing thread', async () => {
    await store.save(makeThread('t1', { system: 'v1' }))
    await store.save(makeThread('t1', { system: 'v2' }))

    const loaded = await store.load('t1')
    expect(loaded!.system).toBe('v2')
    expect(store.size).toBe(1)
  })

  test('save() stores deep copies', async () => {
    const thread = makeThread('t1')
    await store.save(thread)

    // Mutating the original should not affect stored data
    thread.messages.push({ role: 'assistant', content: 'mutated' })
    const loaded = await store.load('t1')
    expect(loaded!.messages).toHaveLength(1)
  })

  test('load() returns deep copies', async () => {
    await store.save(makeThread('t1'))

    const loaded1 = await store.load('t1')
    loaded1!.messages.push({ role: 'assistant', content: 'mutated' })

    const loaded2 = await store.load('t1')
    expect(loaded2!.messages).toHaveLength(1)
  })

  test('delete() removes a thread', async () => {
    await store.save(makeThread('t1'))
    await store.delete('t1')
    expect(await store.load('t1')).toBeNull()
    expect(store.size).toBe(0)
  })

  test('list() returns threads sorted by updatedAt desc', async () => {
    await store.save(makeThread('t1', { updatedAt: '2025-01-01T00:00:00Z' }))
    await store.save(makeThread('t2', { updatedAt: '2025-03-01T00:00:00Z' }))
    await store.save(makeThread('t3', { updatedAt: '2025-02-01T00:00:00Z' }))

    const list = await store.list()
    expect(list.map(t => t.id)).toEqual(['t2', 't3', 't1'])
  })

  test('list() supports limit and offset', async () => {
    await store.save(makeThread('t1', { updatedAt: '2025-01-01T00:00:00Z' }))
    await store.save(makeThread('t2', { updatedAt: '2025-03-01T00:00:00Z' }))
    await store.save(makeThread('t3', { updatedAt: '2025-02-01T00:00:00Z' }))

    const page = await store.list({ limit: 2, offset: 1 })
    expect(page).toHaveLength(2)
    expect(page[0]!.id).toBe('t3')
    expect(page[1]!.id).toBe('t1')
  })

  test('stores and retrieves facts and summary', async () => {
    const thread = makeThread('t1', {
      summary: 'User discussed logistics SaaS idea.',
      facts: [{ key: 'venture', value: 'logistics', source: 'extracted', confidence: 0.9, createdAt: '', updatedAt: '' }],
    })
    await store.save(thread)

    const loaded = await store.load('t1')
    expect(loaded!.summary).toBe('User discussed logistics SaaS idea.')
    expect(loaded!.facts).toHaveLength(1)
    expect(loaded!.facts![0]!.key).toBe('venture')
  })

  test('clear() removes all threads', async () => {
    await store.save(makeThread('t1'))
    await store.save(makeThread('t2'))
    store.clear()
    expect(store.size).toBe(0)
  })
})
