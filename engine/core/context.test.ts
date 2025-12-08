/**
 * Context Tests
 *
 * Tests for generation context management including
 * variable resolution, placeholder handling, recursion tracking, and more.
 */

import { describe, it, expect } from 'vitest'
import {
  createContext,
  cloneContext,
  resolveVariable,
  getSharedVariable,
  setSharedVariable,
  hasSharedVariable,
  getPlaceholder,
  setPlaceholders,
  incrementRecursion,
  decrementRecursion,
  getUsedEntries,
  markEntryUsed,
  isEntryUsed,
  clearUsedEntries,
  setInstance,
  getInstance,
  getCaptureVariable,
  setCaptureVariable,
  hasVariableConflict,
  setCurrentTable,
  setCurrentCollection,
  addDescription,
  beginSetEvaluation,
  endSetEvaluation,
  registerDocumentSharedName,
  wouldShadowDocumentShared,
} from './context'
import type { EngineConfig, CaptureItem, CaptureVariable, RollResult } from '../types'

// ============================================================================
// Helper Functions
// ============================================================================

const defaultConfig: EngineConfig = {
  maxRecursionDepth: 50,
  maxExplodingDice: 100,
  maxInheritanceDepth: 10,
  uniqueOverflowBehavior: 'cycle',
}

function createTestContext() {
  return createContext(defaultConfig)
}

function createCaptureItem(value: string, sets: Record<string, string> = {}): CaptureItem {
  return { value, sets }
}

// ============================================================================
// Context Creation Tests
// ============================================================================

describe('createContext', () => {
  it('should create context with default values', () => {
    const ctx = createContext(defaultConfig)

    expect(ctx.staticVariables.size).toBe(0)
    expect(ctx.sharedVariables.size).toBe(0)
    expect(ctx.placeholders.size).toBe(0)
    expect(ctx.recursionDepth).toBe(0)
    expect(ctx.usedEntries.size).toBe(0)
    expect(ctx.instanceResults.size).toBe(0)
    expect(ctx.captureVariables.size).toBe(0)
    expect(ctx.config).toBe(defaultConfig)
    expect(ctx.trace).toBeUndefined()
  })

  it('should create context with static variables', () => {
    const staticVars = new Map([
      ['level', '5'],
      ['name', 'Hero'],
    ])
    const ctx = createContext(defaultConfig, staticVars)

    expect(ctx.staticVariables.get('level')).toBe('5')
    expect(ctx.staticVariables.get('name')).toBe('Hero')
  })

  it('should create context with tracing enabled', () => {
    const ctx = createContext(defaultConfig, undefined, { enableTrace: true })

    expect(ctx.trace).toBeDefined()
  })
})

// ============================================================================
// Context Cloning Tests
// ============================================================================

describe('cloneContext', () => {
  it('should create shallow clone with isolated placeholders', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'race', { value: 'Elf', raceId: 'elf' })

    const cloned = cloneContext(ctx)

    // Modify original
    setPlaceholders(ctx, 'race', { value: 'Human' })

    // Clone should have original value
    expect(getPlaceholder(cloned, 'race')).toBe('Elf')
  })

  it('should share sharedVariables reference', () => {
    const ctx = createTestContext()
    const item = createCaptureItem('Warrior')
    setSharedVariable(ctx, 'class', item)

    const cloned = cloneContext(ctx)

    // Changes in clone should reflect in original
    const newItem = createCaptureItem('Mage')
    setSharedVariable(cloned, 'newVar', newItem)

    expect(hasSharedVariable(ctx, 'newVar')).toBe(true)
  })

  it('should share usedEntries reference for unique tracking', () => {
    const ctx = createTestContext()
    markEntryUsed(ctx, 'weapons', 'sword')

    const cloned = cloneContext(ctx)
    markEntryUsed(cloned, 'weapons', 'axe')

    // Both entries should be marked in original
    expect(isEntryUsed(ctx, 'weapons', 'sword')).toBe(true)
    expect(isEntryUsed(ctx, 'weapons', 'axe')).toBe(true)
  })

  it('should preserve recursion depth', () => {
    const ctx = createTestContext()
    incrementRecursion(ctx)
    incrementRecursion(ctx)

    const cloned = cloneContext(ctx)

    expect(cloned.recursionDepth).toBe(2)
  })
})

// ============================================================================
// Variable Resolution Tests
// ============================================================================

describe('resolveVariable', () => {
  it('should resolve shared variable first', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('name', 'Static Name')
    setSharedVariable(ctx, 'name', createCaptureItem('Shared Name'))

    expect(resolveVariable(ctx, 'name')).toBe('Shared Name')
  })

  it('should fall back to static variable', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('level', '10')

    expect(resolveVariable(ctx, 'level')).toBe('10')
  })

  it('should return undefined for missing variable', () => {
    const ctx = createTestContext()

    expect(resolveVariable(ctx, 'missing')).toBeUndefined()
  })
})

describe('getSharedVariable / setSharedVariable', () => {
  it('should store and retrieve capture item', () => {
    const ctx = createTestContext()
    const item = createCaptureItem('Sword', { damage: '1d8', type: 'slashing' })
    setSharedVariable(ctx, 'weapon', item)

    const retrieved = getSharedVariable(ctx, 'weapon')
    expect(retrieved?.value).toBe('Sword')
    expect(retrieved?.sets.damage).toBe('1d8')
    expect(retrieved?.sets.type).toBe('slashing')
  })

  it('should overwrite existing variable', () => {
    const ctx = createTestContext()
    setSharedVariable(ctx, 'item', createCaptureItem('First'))
    setSharedVariable(ctx, 'item', createCaptureItem('Second'))

    expect(getSharedVariable(ctx, 'item')?.value).toBe('Second')
  })
})

describe('hasSharedVariable', () => {
  it('should return true for existing variable', () => {
    const ctx = createTestContext()
    setSharedVariable(ctx, 'test', createCaptureItem('value'))

    expect(hasSharedVariable(ctx, 'test')).toBe(true)
  })

  it('should return false for missing variable', () => {
    const ctx = createTestContext()

    expect(hasSharedVariable(ctx, 'missing')).toBe(false)
  })
})

// ============================================================================
// Document Shared Name Tests
// ============================================================================

describe('registerDocumentSharedName / wouldShadowDocumentShared', () => {
  it('should register and check document-level shared names', () => {
    const ctx = createTestContext()
    registerDocumentSharedName(ctx, 'globalVar')

    expect(wouldShadowDocumentShared(ctx, 'globalVar')).toBe(true)
    expect(wouldShadowDocumentShared(ctx, 'localVar')).toBe(false)
  })
})

// ============================================================================
// Placeholder Tests
// ============================================================================

describe('getPlaceholder / setPlaceholders', () => {
  it('should set and get placeholder value', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'race', { value: 'Dwarf' })

    expect(getPlaceholder(ctx, 'race')).toBe('Dwarf')
  })

  it('should get specific property from placeholder', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'weapon', {
      value: 'Sword',
      damage: '1d8',
      weight: '3 lbs',
    })

    expect(getPlaceholder(ctx, 'weapon', 'damage')).toBe('1d8')
    expect(getPlaceholder(ctx, 'weapon', 'weight')).toBe('3 lbs')
  })

  it('should return undefined for missing placeholder', () => {
    const ctx = createTestContext()

    expect(getPlaceholder(ctx, 'missing')).toBeUndefined()
  })

  it('should return undefined for missing property', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'item', { value: 'Test' })

    expect(getPlaceholder(ctx, 'item', 'nonexistent')).toBeUndefined()
  })

  it('should merge with existing placeholders', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'race', { value: 'Elf', speed: '30' })
    setPlaceholders(ctx, 'race', { bonus: '+2 DEX' })

    expect(getPlaceholder(ctx, 'race')).toBe('Elf')
    expect(getPlaceholder(ctx, 'race', 'speed')).toBe('30')
    expect(getPlaceholder(ctx, 'race', 'bonus')).toBe('+2 DEX')
  })

  it('should handle nested CaptureItem values', () => {
    const ctx = createTestContext()
    const nestedItem: CaptureItem = {
      value: 'Fire Damage',
      sets: { amount: '2d6' },
    }
    setPlaceholders(ctx, 'spell', {
      value: 'Fireball',
      damage: nestedItem as unknown as string, // CaptureItem in sets
    })

    // getPlaceholder extracts value from nested CaptureItem
    expect(getPlaceholder(ctx, 'spell', 'damage')).toBe('Fire Damage')
  })
})

// ============================================================================
// Recursion Tracking Tests
// ============================================================================

describe('incrementRecursion / decrementRecursion', () => {
  it('should track recursion depth', () => {
    const ctx = createTestContext()

    expect(ctx.recursionDepth).toBe(0)
    expect(incrementRecursion(ctx)).toBe(true)
    expect(ctx.recursionDepth).toBe(1)
    expect(incrementRecursion(ctx)).toBe(true)
    expect(ctx.recursionDepth).toBe(2)

    decrementRecursion(ctx)
    expect(ctx.recursionDepth).toBe(1)
  })

  it('should return false when exceeding limit', () => {
    const ctx = createContext({ ...defaultConfig, maxRecursionDepth: 2 })

    expect(incrementRecursion(ctx)).toBe(true) // 1
    expect(incrementRecursion(ctx)).toBe(true) // 2
    expect(incrementRecursion(ctx)).toBe(false) // 3 - exceeds limit
  })

  it('should not decrement below zero', () => {
    const ctx = createTestContext()

    decrementRecursion(ctx)
    decrementRecursion(ctx)

    expect(ctx.recursionDepth).toBe(0)
  })
})

// ============================================================================
// Unique Selection Tracking Tests
// ============================================================================

describe('getUsedEntries / markEntryUsed / isEntryUsed / clearUsedEntries', () => {
  it('should track used entries per table', () => {
    const ctx = createTestContext()

    markEntryUsed(ctx, 'weapons', 'sword')
    markEntryUsed(ctx, 'weapons', 'axe')
    markEntryUsed(ctx, 'armor', 'plate')

    expect(isEntryUsed(ctx, 'weapons', 'sword')).toBe(true)
    expect(isEntryUsed(ctx, 'weapons', 'axe')).toBe(true)
    expect(isEntryUsed(ctx, 'weapons', 'mace')).toBe(false)
    expect(isEntryUsed(ctx, 'armor', 'plate')).toBe(true)
    expect(isEntryUsed(ctx, 'armor', 'leather')).toBe(false)
  })

  it('should return used entries set', () => {
    const ctx = createTestContext()

    markEntryUsed(ctx, 'items', 'potion')
    markEntryUsed(ctx, 'items', 'scroll')

    const used = getUsedEntries(ctx, 'items')
    expect(used.size).toBe(2)
    expect(used.has('potion')).toBe(true)
    expect(used.has('scroll')).toBe(true)
  })

  it('should clear used entries for a table', () => {
    const ctx = createTestContext()

    markEntryUsed(ctx, 'weapons', 'sword')
    markEntryUsed(ctx, 'armor', 'plate')

    clearUsedEntries(ctx, 'weapons')

    expect(isEntryUsed(ctx, 'weapons', 'sword')).toBe(false)
    expect(isEntryUsed(ctx, 'armor', 'plate')).toBe(true)
  })

  it('should create empty set for untracked table', () => {
    const ctx = createTestContext()

    const used = getUsedEntries(ctx, 'newTable')
    expect(used.size).toBe(0)
  })
})

// ============================================================================
// Instance Tracking Tests
// ============================================================================

describe('setInstance / getInstance', () => {
  const createMockResult = (text: string, resultType: string = 'item'): RollResult => ({
    text,
    resultType,
    metadata: {
      sourceId: 'test',
      collectionId: 'test',
      timestamp: Date.now(),
    },
  })

  it('should store and retrieve instance results', () => {
    const ctx = createTestContext()
    const result = createMockResult('Fire Sword', 'item')

    setInstance(ctx, 'mainWeapon', result)

    expect(getInstance(ctx, 'mainWeapon')?.text).toBe('Fire Sword')
  })

  it('should return undefined for missing instance', () => {
    const ctx = createTestContext()

    expect(getInstance(ctx, 'missing')).toBeUndefined()
  })

  it('should allow overwriting instances', () => {
    const ctx = createTestContext()

    setInstance(ctx, 'item', createMockResult('First', 'item'))
    setInstance(ctx, 'item', createMockResult('Second', 'item'))

    expect(getInstance(ctx, 'item')?.text).toBe('Second')
  })
})

// ============================================================================
// Capture Variable Tests
// ============================================================================

describe('getCaptureVariable / setCaptureVariable', () => {
  it('should store and retrieve capture variables', () => {
    const ctx = createTestContext()
    const items = [
      createCaptureItem('Sword'),
      createCaptureItem('Shield'),
    ]
    const capture: CaptureVariable = {
      items,
      count: items.length,
    }

    const existed = setCaptureVariable(ctx, 'equipment', capture)
    expect(existed).toBe(false)

    const retrieved = getCaptureVariable(ctx, 'equipment')
    expect(retrieved?.items).toHaveLength(2)
    expect(retrieved?.items[0].value).toBe('Sword')
  })

  it('should return true when overwriting existing variable', () => {
    const ctx = createTestContext()

    setCaptureVariable(ctx, 'items', { items: [createCaptureItem('First')], count: 1 })
    const existed = setCaptureVariable(ctx, 'items', { items: [createCaptureItem('Second')], count: 1 })

    expect(existed).toBe(true)
  })

  it('should return undefined for missing capture variable', () => {
    const ctx = createTestContext()

    expect(getCaptureVariable(ctx, 'missing')).toBeUndefined()
  })
})

describe('hasVariableConflict', () => {
  it('should detect capture variable conflict', () => {
    const ctx = createTestContext()
    setCaptureVariable(ctx, 'items', { items: [], count: 0 })

    expect(hasVariableConflict(ctx, 'items')).toBe('capture')
  })

  it('should detect shared variable conflict', () => {
    const ctx = createTestContext()
    setSharedVariable(ctx, 'hero', createCaptureItem('Knight'))

    expect(hasVariableConflict(ctx, 'hero')).toBe('shared')
  })

  it('should detect static variable conflict', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('level', '5')

    expect(hasVariableConflict(ctx, 'level')).toBe('static')
  })

  it('should return null for no conflict', () => {
    const ctx = createTestContext()

    expect(hasVariableConflict(ctx, 'newVar')).toBeNull()
  })

  it('should prioritize capture over shared over static', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('test', 'static')
    setSharedVariable(ctx, 'test', createCaptureItem('shared'))
    setCaptureVariable(ctx, 'test', { items: [], count: 0 })

    expect(hasVariableConflict(ctx, 'test')).toBe('capture')
  })
})

// ============================================================================
// Current Roll State Tests
// ============================================================================

describe('setCurrentTable / setCurrentCollection', () => {
  it('should set current table and entry', () => {
    const ctx = createTestContext()

    setCurrentTable(ctx, 'weapons', 'sword_entry')

    expect(ctx.currentTableId).toBe('weapons')
    expect(ctx.currentEntryId).toBe('sword_entry')
  })

  it('should set current collection', () => {
    const ctx = createTestContext()

    setCurrentCollection(ctx, 'fantasy-weapons')

    expect(ctx.currentCollectionId).toBe('fantasy-weapons')
  })
})

// ============================================================================
// Description Collection Tests
// ============================================================================

describe('addDescription', () => {
  it('should collect entry descriptions', () => {
    const ctx = createTestContext()

    addDescription(ctx, 'Weapons', 'weapons', 'Sword', 'A sharp blade')
    addDescription(ctx, 'Armor', 'armor', 'Plate', 'Heavy protection')

    expect(ctx.collectedDescriptions).toHaveLength(2)
    expect(ctx.collectedDescriptions[0]).toEqual({
      tableName: 'Weapons',
      tableId: 'weapons',
      rolledValue: 'Sword',
      description: 'A sharp blade',
      depth: 0,
    })
  })

  it('should use current recursion depth when not specified', () => {
    const ctx = createTestContext()
    incrementRecursion(ctx)
    incrementRecursion(ctx)

    addDescription(ctx, 'Items', 'items', 'Potion', 'Heals wounds')

    expect(ctx.collectedDescriptions[0].depth).toBe(2)
  })

  it('should use explicit depth when specified', () => {
    const ctx = createTestContext()
    incrementRecursion(ctx)
    incrementRecursion(ctx)

    addDescription(ctx, 'Items', 'items', 'Potion', 'Heals wounds', 5)

    expect(ctx.collectedDescriptions[0].depth).toBe(5)
  })
})

// ============================================================================
// Set Evaluation Cycle Detection Tests
// ============================================================================

describe('beginSetEvaluation / endSetEvaluation', () => {
  it('should detect cycle in set evaluation', () => {
    const ctx = createTestContext()

    expect(beginSetEvaluation(ctx, 'table.prop1')).toBe(true)
    expect(beginSetEvaluation(ctx, 'table.prop2')).toBe(true)
    expect(beginSetEvaluation(ctx, 'table.prop1')).toBe(false) // Cycle!
  })

  it('should allow re-evaluation after ending', () => {
    const ctx = createTestContext()

    expect(beginSetEvaluation(ctx, 'table.prop')).toBe(true)
    endSetEvaluation(ctx, 'table.prop')
    expect(beginSetEvaluation(ctx, 'table.prop')).toBe(true)
  })

  it('should track multiple keys independently', () => {
    const ctx = createTestContext()

    beginSetEvaluation(ctx, 'table1.prop')
    beginSetEvaluation(ctx, 'table2.prop')

    endSetEvaluation(ctx, 'table1.prop')

    expect(beginSetEvaluation(ctx, 'table1.prop')).toBe(true)
    expect(beginSetEvaluation(ctx, 'table2.prop')).toBe(false) // Still evaluating
  })
})
