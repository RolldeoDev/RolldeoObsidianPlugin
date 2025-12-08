/**
 * Simple Table Tests
 *
 * Tests for simple table rolling including weighted selection,
 * unique selection, range-to-weight conversion, and probabilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildWeightedPool,
  calculateTotalWeight,
  selectByWeight,
  rollSimpleTable,
  getTableProbabilities,
  validateSimpleTable,
} from './simple'
import { createContext, markEntryUsed } from '../core/context'
import type { SimpleTable, Entry, EngineConfig } from '../types'

// ============================================================================
// Helper Functions
// ============================================================================

const defaultConfig: EngineConfig = {
  maxRecursionDepth: 50,
  maxExplodingDice: 100,
  maxInheritanceDepth: 10,
  uniqueOverflowBehavior: 'cycle',
}

function createTestContext(config: Partial<EngineConfig> = {}) {
  return createContext({ ...defaultConfig, ...config })
}

function createSimpleTable(entries: Entry[], overrides: Partial<SimpleTable> = {}): SimpleTable {
  return {
    id: 'testTable',
    name: 'Test Table',
    type: 'simple',
    entries,
    ...overrides,
  }
}

// ============================================================================
// buildWeightedPool Tests
// ============================================================================

describe('buildWeightedPool', () => {
  it('should build pool from entries with default weight', () => {
    const entries: Entry[] = [
      { value: 'A' },
      { value: 'B' },
      { value: 'C' },
    ]

    const pool = buildWeightedPool(entries, 'test')

    expect(pool).toHaveLength(3)
    expect(pool[0].weight).toBe(1)
    expect(pool[1].weight).toBe(1)
    expect(pool[2].weight).toBe(1)
  })

  it('should use explicit weights', () => {
    const entries: Entry[] = [
      { value: 'Common', weight: 10 },
      { value: 'Rare', weight: 3 },
      { value: 'Epic', weight: 1 },
    ]

    const pool = buildWeightedPool(entries, 'test')

    expect(pool[0].weight).toBe(10)
    expect(pool[1].weight).toBe(3)
    expect(pool[2].weight).toBe(1)
  })

  it('should convert range to weight', () => {
    const entries: Entry[] = [
      { value: 'Common', range: [1, 60] }, // 60 weight
      { value: 'Uncommon', range: [61, 80] }, // 20 weight
      { value: 'Rare', range: [81, 95] }, // 15 weight
      { value: 'Epic', range: [96, 100] }, // 5 weight
    ]

    const pool = buildWeightedPool(entries, 'test')

    expect(pool[0].weight).toBe(60)
    expect(pool[1].weight).toBe(20)
    expect(pool[2].weight).toBe(15)
    expect(pool[3].weight).toBe(5)
  })

  it('should filter out zero-weight entries', () => {
    const entries: Entry[] = [
      { value: 'Active', weight: 5 },
      { value: 'Disabled', weight: 0 },
      { value: 'Also Active', weight: 3 },
    ]

    const pool = buildWeightedPool(entries, 'test')

    expect(pool).toHaveLength(2)
    expect(pool.map((e) => e.entry.value)).toEqual(['Active', 'Also Active'])
  })

  it('should exclude specified IDs', () => {
    const entries: Entry[] = [
      { id: 'a', value: 'A' },
      { id: 'b', value: 'B' },
      { id: 'c', value: 'C' },
    ]

    const excludeIds = new Set(['b'])
    const pool = buildWeightedPool(entries, 'test', excludeIds)

    expect(pool).toHaveLength(2)
    expect(pool.map((e) => e.id)).toEqual(['a', 'c'])
  })

  it('should generate IDs for entries without explicit IDs', () => {
    const entries: Entry[] = [
      { value: 'First' },
      { value: 'Second' },
    ]

    const pool = buildWeightedPool(entries, 'weapons')

    expect(pool[0].id).toBe('weapons000')
    expect(pool[1].id).toBe('weapons001')
  })

  it('should use explicit entry IDs', () => {
    const entries: Entry[] = [
      { id: 'sword', value: 'Sword' },
      { id: 'axe', value: 'Axe' },
    ]

    const pool = buildWeightedPool(entries, 'weapons')

    expect(pool[0].id).toBe('sword')
    expect(pool[1].id).toBe('axe')
  })
})

// ============================================================================
// calculateTotalWeight Tests
// ============================================================================

describe('calculateTotalWeight', () => {
  it('should calculate total weight', () => {
    const entries: Entry[] = [
      { value: 'A', weight: 10 },
      { value: 'B', weight: 5 },
      { value: 'C', weight: 3 },
    ]

    const pool = buildWeightedPool(entries, 'test')
    const total = calculateTotalWeight(pool)

    expect(total).toBe(18)
  })

  it('should return 0 for empty pool', () => {
    expect(calculateTotalWeight([])).toBe(0)
  })

  it('should handle range-based weights', () => {
    const entries: Entry[] = [
      { value: 'A', range: [1, 50] },
      { value: 'B', range: [51, 100] },
    ]

    const pool = buildWeightedPool(entries, 'test')
    const total = calculateTotalWeight(pool)

    expect(total).toBe(100)
  })
})

// ============================================================================
// selectByWeight Tests
// ============================================================================

describe('selectByWeight', () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mathRandomSpy = vi.spyOn(Math, 'random')
  })

  afterEach(() => {
    mathRandomSpy.mockRestore()
  })

  it('should return null for empty pool', () => {
    expect(selectByWeight([])).toBeNull()
  })

  it('should return null for pool with zero total weight', () => {
    // This shouldn't happen in practice since we filter, but test anyway
    const pool = [{ entry: { value: 'A' }, weight: 0, id: 'a' }]
    expect(selectByWeight(pool)).toBeNull()
  })

  it('should select first entry with low random', () => {
    mathRandomSpy.mockReturnValue(0.05)

    const entries: Entry[] = [
      { value: 'First', weight: 1 },
      { value: 'Second', weight: 1 },
      { value: 'Third', weight: 1 },
    ]

    const pool = buildWeightedPool(entries, 'test')
    const selected = selectByWeight(pool)

    expect(selected?.entry.value).toBe('First')
  })

  it('should select last entry with high random', () => {
    mathRandomSpy.mockReturnValue(0.95)

    const entries: Entry[] = [
      { value: 'First', weight: 1 },
      { value: 'Second', weight: 1 },
      { value: 'Third', weight: 1 },
    ]

    const pool = buildWeightedPool(entries, 'test')
    const selected = selectByWeight(pool)

    expect(selected?.entry.value).toBe('Third')
  })

  it('should respect weight distribution', () => {
    // Total weight = 100, first entry has weight 60
    // Random 0.3 → cumulative 30, which is in first entry (0-60)
    mathRandomSpy.mockReturnValue(0.3)

    const entries: Entry[] = [
      { value: 'Common', range: [1, 60] },
      { value: 'Rare', range: [61, 100] },
    ]

    const pool = buildWeightedPool(entries, 'test')
    const selected = selectByWeight(pool)

    expect(selected?.entry.value).toBe('Common')
  })

  it('should select rare entry with appropriate random', () => {
    // Total weight = 100, random 0.7 → roll = 70, which is in range 61-100
    mathRandomSpy.mockReturnValue(0.7)

    const entries: Entry[] = [
      { value: 'Common', range: [1, 60] },
      { value: 'Rare', range: [61, 100] },
    ]

    const pool = buildWeightedPool(entries, 'test')
    const selected = selectByWeight(pool)

    expect(selected?.entry.value).toBe('Rare')
  })
})

// ============================================================================
// rollSimpleTable Tests
// ============================================================================

describe('rollSimpleTable', () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mathRandomSpy = vi.spyOn(Math, 'random')
  })

  afterEach(() => {
    mathRandomSpy.mockRestore()
  })

  it('should roll and return selected entry', () => {
    mathRandomSpy.mockReturnValue(0.1)

    const table = createSimpleTable([
      { value: 'Sword' },
      { value: 'Axe' },
      { value: 'Mace' },
    ])

    const ctx = createTestContext()
    const result = rollSimpleTable(table, ctx)

    expect(result).not.toBeNull()
    expect(result?.entry.value).toBe('Sword')
  })

  it('should merge defaultSets with entry sets', () => {
    mathRandomSpy.mockReturnValue(0.1)

    const table = createSimpleTable(
      [{ value: 'Longsword', sets: { damage: '1d8', type: 'slashing' } }],
      { defaultSets: { rarity: 'common', weight: '3 lbs' } }
    )

    const ctx = createTestContext()
    const result = rollSimpleTable(table, ctx)

    expect(result?.mergedSets).toEqual({
      rarity: 'common',
      weight: '3 lbs',
      damage: '1d8',
      type: 'slashing',
      value: 'Longsword',
    })
  })

  it('should override defaultSets with entry sets', () => {
    mathRandomSpy.mockReturnValue(0.1)

    const table = createSimpleTable(
      [{ value: 'Magic Sword', sets: { rarity: 'rare' } }],
      { defaultSets: { rarity: 'common' } }
    )

    const ctx = createTestContext()
    const result = rollSimpleTable(table, ctx)

    expect(result?.mergedSets.rarity).toBe('rare')
  })

  it('should include entry value in mergedSets', () => {
    mathRandomSpy.mockReturnValue(0.1)

    const table = createSimpleTable([{ value: 'Diamond' }])

    const ctx = createTestContext()
    const result = rollSimpleTable(table, ctx)

    expect(result?.mergedSets.value).toBe('Diamond')
  })

  it('should use entry resultType over table resultType', () => {
    mathRandomSpy.mockReturnValue(0.1)

    const table = createSimpleTable(
      [{ value: 'Fire Sword', resultType: 'magical-weapon' }],
      { resultType: 'weapon' }
    )

    const ctx = createTestContext()
    const result = rollSimpleTable(table, ctx)

    expect(result?.resultType).toBe('magical-weapon')
  })

  it('should use table resultType when entry has none', () => {
    mathRandomSpy.mockReturnValue(0.1)

    const table = createSimpleTable(
      [{ value: 'Basic Sword' }],
      { resultType: 'weapon' }
    )

    const ctx = createTestContext()
    const result = rollSimpleTable(table, ctx)

    expect(result?.resultType).toBe('weapon')
  })

  describe('unique selection', () => {
    it('should track used entries for unique selection', () => {
      mathRandomSpy.mockReturnValue(0.1)

      const table = createSimpleTable([
        { id: 'a', value: 'A' },
        { id: 'b', value: 'B' },
      ])

      const ctx = createTestContext()

      // First roll
      const first = rollSimpleTable(table, ctx, { unique: true })
      expect(first?.id).toBe('a')

      // Verify entry is marked as used
      expect(ctx.usedEntries.get('testTable')?.has('a')).toBe(true)
    })

    it('should exclude used entries on unique roll', () => {
      mathRandomSpy.mockReturnValue(0.1)

      const table = createSimpleTable([
        { id: 'a', value: 'A' },
        { id: 'b', value: 'B' },
      ])

      const ctx = createTestContext()
      markEntryUsed(ctx, 'testTable', 'a')

      const result = rollSimpleTable(table, ctx, { unique: true })

      expect(result?.id).toBe('b')
    })

    it('should return null when all entries used (stop behavior)', () => {
      const table = createSimpleTable([
        { id: 'a', value: 'A' },
        { id: 'b', value: 'B' },
      ])

      const ctx = createTestContext({ uniqueOverflowBehavior: 'stop' })
      markEntryUsed(ctx, 'testTable', 'a')
      markEntryUsed(ctx, 'testTable', 'b')

      const result = rollSimpleTable(table, ctx, { unique: true })

      expect(result).toBeNull()
    })

    it('should cycle when all entries used (cycle behavior)', () => {
      mathRandomSpy.mockReturnValue(0.1)

      const table = createSimpleTable([
        { id: 'a', value: 'A' },
        { id: 'b', value: 'B' },
      ])

      const ctx = createTestContext({ uniqueOverflowBehavior: 'cycle' })
      markEntryUsed(ctx, 'testTable', 'a')
      markEntryUsed(ctx, 'testTable', 'b')

      const result = rollSimpleTable(table, ctx, { unique: true })

      // Should clear used entries and return first entry
      expect(result?.id).toBe('a')
      expect(ctx.usedEntries.has('testTable')).toBe(false) // Cleared
    })

    it('should throw error when all entries used (error behavior)', () => {
      const table = createSimpleTable([
        { id: 'a', value: 'A' },
      ])

      const ctx = createTestContext({ uniqueOverflowBehavior: 'error' })
      markEntryUsed(ctx, 'testTable', 'a')

      expect(() => rollSimpleTable(table, ctx, { unique: true })).toThrow(
        /Unique selection overflow/
      )
    })
  })

  describe('excludeIds option', () => {
    it('should exclude specified IDs', () => {
      mathRandomSpy.mockReturnValue(0.1)

      const table = createSimpleTable([
        { id: 'a', value: 'A' },
        { id: 'b', value: 'B' },
        { id: 'c', value: 'C' },
      ])

      const ctx = createTestContext()
      const excludeIds = new Set(['a', 'b'])

      const result = rollSimpleTable(table, ctx, { excludeIds })

      expect(result?.id).toBe('c')
    })
  })

  it('should return null for table with no valid entries', () => {
    const table = createSimpleTable([
      { value: 'Disabled', weight: 0 },
    ])

    const ctx = createTestContext()
    const result = rollSimpleTable(table, ctx)

    expect(result).toBeNull()
  })
})

// ============================================================================
// getTableProbabilities Tests
// ============================================================================

describe('getTableProbabilities', () => {
  it('should calculate probabilities for equal weights', () => {
    const table = createSimpleTable([
      { id: 'a', value: 'A' },
      { id: 'b', value: 'B' },
      { id: 'c', value: 'C' },
      { id: 'd', value: 'D' },
    ])

    const probs = getTableProbabilities(table)

    expect(probs).toHaveLength(4)
    expect(probs[0].probability).toBeCloseTo(0.25, 4)
    expect(probs[0].percentage).toBe('25.00%')
  })

  it('should calculate probabilities for different weights', () => {
    const table = createSimpleTable([
      { id: 'common', value: 'Common', weight: 70 },
      { id: 'rare', value: 'Rare', weight: 25 },
      { id: 'epic', value: 'Epic', weight: 5 },
    ])

    const probs = getTableProbabilities(table)

    expect(probs[0].probability).toBeCloseTo(0.7, 4)
    expect(probs[0].percentage).toBe('70.00%')
    expect(probs[1].probability).toBeCloseTo(0.25, 4)
    expect(probs[1].percentage).toBe('25.00%')
    expect(probs[2].probability).toBeCloseTo(0.05, 4)
    expect(probs[2].percentage).toBe('5.00%')
  })

  it('should handle range-based entries', () => {
    const table = createSimpleTable([
      { value: 'Common', range: [1, 60] },
      { value: 'Rare', range: [61, 100] },
    ])

    const probs = getTableProbabilities(table)

    expect(probs[0].probability).toBeCloseTo(0.6, 4)
    expect(probs[1].probability).toBeCloseTo(0.4, 4)
  })

  it('should return empty array for table with no valid entries', () => {
    const table = createSimpleTable([
      { value: 'Disabled', weight: 0 },
    ])

    const probs = getTableProbabilities(table)

    expect(probs).toHaveLength(0)
  })

  it('should include weight in results', () => {
    const table = createSimpleTable([
      { id: 'heavy', value: 'Heavy', weight: 100 },
      { id: 'light', value: 'Light', weight: 1 },
    ])

    const probs = getTableProbabilities(table)

    expect(probs[0].weight).toBe(100)
    expect(probs[1].weight).toBe(1)
  })
})

// ============================================================================
// validateSimpleTable Tests
// ============================================================================

describe('validateSimpleTable', () => {
  it('should detect duplicate entry IDs', () => {
    const table = createSimpleTable([
      { id: 'sword', value: 'Sword' },
      { id: 'sword', value: 'Another Sword' },
    ])

    const issues = validateSimpleTable(table)

    expect(issues.some((i) => i.message.includes('Duplicate entry ID'))).toBe(true)
  })

  it('should detect weight and range conflict', () => {
    const table = createSimpleTable([
      { value: 'Conflicting', weight: 5, range: [1, 10] },
    ])

    const issues = validateSimpleTable(table)

    expect(issues.some((i) => i.message.includes('both weight and range'))).toBe(true)
  })

  it('should detect invalid range', () => {
    const table = createSimpleTable([
      { value: 'Invalid', range: [10, 5] },
    ])

    const issues = validateSimpleTable(table)

    expect(issues.some((i) => i.message.includes('Invalid range'))).toBe(true)
  })

  it('should detect negative weight', () => {
    const table = createSimpleTable([
      { value: 'Negative', weight: -5 },
    ])

    const issues = validateSimpleTable(table)

    expect(issues.some((i) => i.message.includes('Negative weight'))).toBe(true)
  })

  it('should warn about zero weight entries', () => {
    const table = createSimpleTable([
      { value: 'Active', weight: 5 },
      { value: 'Disabled', weight: 0 },
    ])

    const issues = validateSimpleTable(table)

    expect(issues.some((i) => i.type === 'warning' && i.message.includes('weight 0'))).toBe(true)
  })

  it('should error when all entries have zero weight', () => {
    const table = createSimpleTable([
      { value: 'Disabled1', weight: 0 },
      { value: 'Disabled2', weight: 0 },
    ])

    const issues = validateSimpleTable(table)

    expect(issues.some((i) => i.type === 'error' && i.message.includes('All entries have zero weight'))).toBe(true)
  })

  it('should return empty array for valid table', () => {
    const table = createSimpleTable([
      { id: 'sword', value: 'Sword', weight: 5 },
      { id: 'axe', value: 'Axe', weight: 3 },
    ])

    const issues = validateSimpleTable(table)

    expect(issues.filter((i) => i.type === 'error')).toHaveLength(0)
  })
})

// ============================================================================
// Distribution Tests (Statistical)
// ============================================================================

describe('selectByWeight - distribution', () => {
  it('should approximate expected distribution over many rolls', () => {
    const entries: Entry[] = [
      { value: 'Common', weight: 70 },
      { value: 'Rare', weight: 30 },
    ]

    const pool = buildWeightedPool(entries, 'test')
    const counts = { Common: 0, Rare: 0 }
    const iterations = 10000

    for (let i = 0; i < iterations; i++) {
      const selected = selectByWeight(pool)
      if (selected) {
        counts[selected.entry.value as 'Common' | 'Rare']++
      }
    }

    // Allow 5% deviation
    const commonRatio = counts.Common / iterations
    const rareRatio = counts.Rare / iterations

    expect(commonRatio).toBeGreaterThan(0.65)
    expect(commonRatio).toBeLessThan(0.75)
    expect(rareRatio).toBeGreaterThan(0.25)
    expect(rareRatio).toBeLessThan(0.35)
  })
})
