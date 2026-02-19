import { describe, test, expect, beforeEach } from 'bun:test'
import { SemanticMemory } from '../src/memory/semantic_memory.ts'

describe('SemanticMemory', () => {
  let mem: SemanticMemory

  beforeEach(() => {
    mem = new SemanticMemory()
  })

  test('set() and get() a fact', () => {
    mem.set('name', 'Alice')
    const fact = mem.get('name')
    expect(fact).toBeDefined()
    expect(fact!.value).toBe('Alice')
    expect(fact!.source).toBe('explicit')
    expect(fact!.confidence).toBe(1.0)
  })

  test('set() updates existing fact and preserves createdAt', async () => {
    mem.set('stage', 'Ideation')
    const created = mem.get('stage')!.createdAt

    // Ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 2))

    mem.set('stage', 'Validation')
    const updated = mem.get('stage')!

    expect(updated.value).toBe('Validation')
    expect(updated.createdAt).toBe(created) // Preserves createdAt
    expect(updated.updatedAt).not.toBe(created) // Updates updatedAt
  })

  test('set() with custom source and confidence', () => {
    mem.set('risk', 'High', 'extracted', 0.7)
    const fact = mem.get('risk')!
    expect(fact.source).toBe('extracted')
    expect(fact.confidence).toBe(0.7)
  })

  test('all() returns all facts', () => {
    mem.set('a', '1')
    mem.set('b', '2')
    mem.set('c', '3')
    expect(mem.all()).toHaveLength(3)
  })

  test('size returns count', () => {
    expect(mem.size).toBe(0)
    mem.set('a', '1')
    expect(mem.size).toBe(1)
  })

  test('remove() deletes a fact', () => {
    mem.set('temp', 'value')
    expect(mem.remove('temp')).toBe(true)
    expect(mem.get('temp')).toBeUndefined()
    expect(mem.remove('nonexistent')).toBe(false)
  })

  test('toPromptBlock() formats facts for injection', () => {
    mem.set('venture', 'SaaS logistics')
    mem.set('stage', 'Validation')

    const block = mem.toPromptBlock()
    expect(block).toContain('<known_facts>')
    expect(block).toContain('- venture: SaaS logistics')
    expect(block).toContain('- stage: Validation')
    expect(block).toContain('</known_facts>')
  })

  test('toPromptBlock() returns empty string when no facts', () => {
    expect(mem.toPromptBlock()).toBe('')
  })

  test('serialize() and restore()', () => {
    mem.set('a', '1', 'explicit', 1.0)
    mem.set('b', '2', 'extracted', 0.8)

    const serialized = mem.serialize()
    expect(serialized).toHaveLength(2)

    const mem2 = new SemanticMemory()
    mem2.restore(serialized)
    expect(mem2.size).toBe(2)
    expect(mem2.get('a')!.value).toBe('1')
    expect(mem2.get('b')!.confidence).toBe(0.8)
  })

  test('restore() replaces existing facts', () => {
    mem.set('old', 'data')
    mem.restore([{ key: 'new', value: 'data', source: 'explicit', confidence: 1, createdAt: '', updatedAt: '' }])
    expect(mem.get('old')).toBeUndefined()
    expect(mem.get('new')!.value).toBe('data')
  })

  test('clear() removes all facts', () => {
    mem.set('a', '1')
    mem.set('b', '2')
    mem.clear()
    expect(mem.size).toBe(0)
    expect(mem.all()).toHaveLength(0)
  })

  test('formatFacts() static method', () => {
    const block = SemanticMemory.formatFacts([
      { key: 'k', value: 'v', source: 'explicit', confidence: 1, createdAt: '', updatedAt: '' },
    ])
    expect(block).toContain('<known_facts>')
    expect(block).toContain('- k: v')
  })

  test('formatFacts() returns empty for no facts', () => {
    expect(SemanticMemory.formatFacts([])).toBe('')
  })
})
