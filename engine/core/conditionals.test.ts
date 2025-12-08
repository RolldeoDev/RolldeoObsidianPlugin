/**
 * Conditionals Tests
 *
 * Tests for the condition expression evaluator used in switch expressions.
 * Covers comparison operators, logical operators, and value resolution.
 */

import { describe, it, expect } from 'vitest'
import { evaluateWhenClause } from './conditionals'
import { createContext, setPlaceholders, setSharedVariable } from './context'
import type { EngineConfig, CaptureItem } from '../types'

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
// Comparison Operator Tests
// ============================================================================

describe('evaluateWhenClause - equality operators', () => {
  it('should evaluate == for equal strings', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'race', { value: 'Elf' })

    expect(evaluateWhenClause('@race == Elf', ctx)).toBe(true)
    expect(evaluateWhenClause('@race == Human', ctx)).toBe(false)
  })

  it('should evaluate == for equal numbers', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('level', '5')

    expect(evaluateWhenClause('$level == 5', ctx)).toBe(true)
    expect(evaluateWhenClause('$level == 6', ctx)).toBe(false)
  })

  it('should evaluate != for not equal', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'race', { value: 'Dwarf' })

    expect(evaluateWhenClause('@race != Elf', ctx)).toBe(true)
    expect(evaluateWhenClause('@race != Dwarf', ctx)).toBe(false)
  })

  it('should handle quoted strings', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'name', { value: 'John Doe' })

    expect(evaluateWhenClause('@name == "John Doe"', ctx)).toBe(true)
    expect(evaluateWhenClause("@name == 'John Doe'", ctx)).toBe(true)
  })
})

describe('evaluateWhenClause - numeric comparisons', () => {
  it('should evaluate > greater than', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('level', '10')

    expect(evaluateWhenClause('$level > 5', ctx)).toBe(true)
    expect(evaluateWhenClause('$level > 10', ctx)).toBe(false)
    expect(evaluateWhenClause('$level > 15', ctx)).toBe(false)
  })

  it('should evaluate < less than', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('hp', '3')

    expect(evaluateWhenClause('$hp < 5', ctx)).toBe(true)
    expect(evaluateWhenClause('$hp < 3', ctx)).toBe(false)
    expect(evaluateWhenClause('$hp < 1', ctx)).toBe(false)
  })

  it('should evaluate >= greater than or equal', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('score', '10')

    expect(evaluateWhenClause('$score >= 10', ctx)).toBe(true)
    expect(evaluateWhenClause('$score >= 5', ctx)).toBe(true)
    expect(evaluateWhenClause('$score >= 15', ctx)).toBe(false)
  })

  it('should evaluate <= less than or equal', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('count', '5')

    expect(evaluateWhenClause('$count <= 5', ctx)).toBe(true)
    expect(evaluateWhenClause('$count <= 10', ctx)).toBe(true)
    expect(evaluateWhenClause('$count <= 3', ctx)).toBe(false)
  })
})

describe('evaluateWhenClause - string operators', () => {
  it('should evaluate contains (case insensitive)', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'description', { value: 'A large red dragon' })

    expect(evaluateWhenClause('@description contains dragon', ctx)).toBe(true)
    expect(evaluateWhenClause('@description contains DRAGON', ctx)).toBe(true)
    expect(evaluateWhenClause('@description contains goblin', ctx)).toBe(false)
  })

  it('should evaluate matches with regex', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'name', { value: 'Fire Sword' })

    expect(evaluateWhenClause('@name matches ^Fire', ctx)).toBe(true)
    expect(evaluateWhenClause('@name matches Sword$', ctx)).toBe(true)
    expect(evaluateWhenClause('@name matches ^Ice', ctx)).toBe(false)
  })

  it('should handle invalid regex gracefully', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'text', { value: 'test' })

    // Invalid regex should return false
    expect(evaluateWhenClause('@text matches [invalid(', ctx)).toBe(false)
  })
})

// ============================================================================
// Logical Operator Tests
// ============================================================================

describe('evaluateWhenClause - logical operators', () => {
  it('should evaluate && (AND)', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('level', '10')
    setPlaceholders(ctx, 'class', { value: 'Warrior' })

    expect(evaluateWhenClause('$level > 5 && @class == Warrior', ctx)).toBe(true)
    expect(evaluateWhenClause('$level > 5 && @class == Mage', ctx)).toBe(false)
    expect(evaluateWhenClause('$level > 15 && @class == Warrior', ctx)).toBe(false)
  })

  it('should evaluate || (OR)', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'race', { value: 'Elf' })

    expect(evaluateWhenClause('@race == Elf || @race == Human', ctx)).toBe(true)
    expect(evaluateWhenClause('@race == Human || @race == Dwarf', ctx)).toBe(false)
  })

  it('should evaluate ! (NOT)', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'evil', { value: 'false' })

    expect(evaluateWhenClause('!@evil == true', ctx)).toBe(true)
  })

  it('should handle combined && and ||', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('level', '10')
    setPlaceholders(ctx, 'class', { value: 'Warrior' })
    setPlaceholders(ctx, 'race', { value: 'Elf' })

    // OR has lower precedence
    expect(evaluateWhenClause('@class == Warrior && $level > 5 || @race == Dwarf', ctx)).toBe(true)
    expect(evaluateWhenClause('@class == Mage && $level > 5 || @race == Dwarf', ctx)).toBe(false)
    expect(evaluateWhenClause('@class == Mage && $level > 5 || @race == Elf', ctx)).toBe(true)
  })
})

describe('evaluateWhenClause - parentheses', () => {
  it('should handle parentheses for grouping', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('level', '5')
    setPlaceholders(ctx, 'class', { value: 'Mage' })
    setPlaceholders(ctx, 'race', { value: 'Elf' })

    // Without parentheses: class == Mage AND (level > 10 OR race == Elf)
    // With OR lower precedence, this is: (class == Mage AND level > 10) OR race == Elf
    // But with parentheses we can control it
    expect(evaluateWhenClause('(@class == Mage || @class == Warrior) && $level > 3', ctx)).toBe(true)
    expect(evaluateWhenClause('(@class == Mage || @class == Warrior) && $level > 10', ctx)).toBe(false)
  })

  it('should handle nested parentheses', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('a', '1')
    ctx.staticVariables.set('b', '2')
    ctx.staticVariables.set('c', '3')

    expect(evaluateWhenClause('(($a == 1 && $b == 2) || $c == 5)', ctx)).toBe(true)
    expect(evaluateWhenClause('(($a == 1 && $b == 5) || $c == 3)', ctx)).toBe(true)
    expect(evaluateWhenClause('(($a == 1 && $b == 5) || $c == 5)', ctx)).toBe(false)
  })
})

// ============================================================================
// Value Resolution Tests
// ============================================================================

describe('evaluateWhenClause - value resolution', () => {
  it('should resolve @placeholder values', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'weapon', { type: 'Sword', damage: 'fire' })

    expect(evaluateWhenClause('@weapon.type == Sword', ctx)).toBe(true)
    expect(evaluateWhenClause('@weapon.damage == fire', ctx)).toBe(true)
  })

  it('should resolve $variable values', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('strength', '16')

    expect(evaluateWhenClause('$strength >= 15', ctx)).toBe(true)
  })

  it('should resolve $var.@property for shared variables', () => {
    const ctx = createTestContext()
    setSharedVariable(ctx, 'hero', createCaptureItem('Knight', { alignment: 'good' }))

    expect(evaluateWhenClause('$hero.@alignment == good', ctx)).toBe(true)
    expect(evaluateWhenClause('$hero.@alignment == evil', ctx)).toBe(false)
  })

  it('should handle literal values', () => {
    const ctx = createTestContext()

    expect(evaluateWhenClause('5 > 3', ctx)).toBe(true)
    expect(evaluateWhenClause('hello == hello', ctx)).toBe(true)
  })

  it('should treat undefined values as falsy', () => {
    const ctx = createTestContext()

    // Missing variables are treated as falsy (empty string)
    expect(evaluateWhenClause('@missing', ctx)).toBe(false)
    expect(evaluateWhenClause('$undefined', ctx)).toBe(false)
  })
})

// ============================================================================
// Truthy Value Tests
// ============================================================================

describe('evaluateWhenClause - truthy values', () => {
  it('should treat non-empty string as truthy', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'name', { value: 'Test' })

    expect(evaluateWhenClause('@name', ctx)).toBe(true)
  })

  it('should treat empty string as falsy', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'empty', { value: '' })

    expect(evaluateWhenClause('@empty', ctx)).toBe(false)
  })

  it('should treat number as truthy', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('count', '5')

    expect(evaluateWhenClause('$count', ctx)).toBe(true)
  })

  it('should treat undefined as falsy', () => {
    const ctx = createTestContext()

    expect(evaluateWhenClause('$missing', ctx)).toBe(false)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('evaluateWhenClause - edge cases', () => {
  it('should handle empty expression', () => {
    const ctx = createTestContext()

    expect(evaluateWhenClause('', ctx)).toBe(false)
  })

  it('should handle whitespace-only expression', () => {
    const ctx = createTestContext()

    expect(evaluateWhenClause('   ', ctx)).toBe(false)
  })

  it('should handle numeric string comparison correctly', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('level', '10')

    // String comparison: "10" vs "5" (lexicographic: "10" < "5")
    // But == should still work for numeric equality
    expect(evaluateWhenClause('$level == 10', ctx)).toBe(true)
  })

  it('should handle comparison with zero', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('count', '0')

    expect(evaluateWhenClause('$count == 0', ctx)).toBe(true)
    expect(evaluateWhenClause('$count > 0', ctx)).toBe(false)
    expect(evaluateWhenClause('$count >= 0', ctx)).toBe(true)
  })

  it('should handle negative numbers', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('modifier', '-2')

    expect(evaluateWhenClause('$modifier < 0', ctx)).toBe(true)
    expect(evaluateWhenClause('$modifier >= -2', ctx)).toBe(true)
  })

  it('should handle multi-word quoted values', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'title', { value: 'Lord of the Rings' })

    expect(evaluateWhenClause('@title == "Lord of the Rings"', ctx)).toBe(true)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('evaluateWhenClause - integration', () => {
  it('should handle complex character check', () => {
    const ctx = createTestContext()

    // Character setup
    ctx.staticVariables.set('level', '15')
    ctx.staticVariables.set('hp', '85')
    setPlaceholders(ctx, 'class', { value: 'Paladin' })
    setPlaceholders(ctx, 'alignment', { value: 'lawful good' })
    setSharedVariable(ctx, 'weapon', createCaptureItem('Holy Avenger', { type: 'sword' }))

    // Complex condition: High-level paladin with holy sword
    expect(
      evaluateWhenClause(
        '$level >= 10 && @class == Paladin && $weapon.@type == sword',
        ctx
      )
    ).toBe(true)

    // Check alignment contains "good"
    expect(
      evaluateWhenClause('@alignment contains good && $hp > 50', ctx)
    ).toBe(true)
  })

  it('should handle encounter difficulty check', () => {
    const ctx = createTestContext()

    ctx.staticVariables.set('partyLevel', '5')
    ctx.staticVariables.set('partySize', '4')
    setPlaceholders(ctx, 'monster', { cr: '8', type: 'dragon' })

    // Easy encounter: CR <= party level
    expect(evaluateWhenClause('@monster.cr <= $partyLevel', ctx)).toBe(false) // 8 > 5

    // Dragon encounter special
    expect(
      evaluateWhenClause('@monster.type == dragon && $partySize >= 4', ctx)
    ).toBe(true)
  })

  it('should handle loot table conditions', () => {
    const ctx = createTestContext()

    setPlaceholders(ctx, 'monster', { value: 'Ancient Red Dragon', rarity: 'legendary' })
    ctx.staticVariables.set('luck', '18')

    // Legendary loot: rarity is legendary OR luck >= 20
    expect(
      evaluateWhenClause('@monster.rarity == legendary || $luck >= 20', ctx)
    ).toBe(true)

    // Both conditions
    expect(
      evaluateWhenClause('@monster.rarity == legendary && $luck >= 15', ctx)
    ).toBe(true)
  })
})
