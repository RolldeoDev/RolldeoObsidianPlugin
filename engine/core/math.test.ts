/**
 * Math Expression Tests
 *
 * Tests for the math expression evaluator including
 * arithmetic, variables, placeholders, and dice.
 */

import { describe, it, expect } from 'vitest'
import { evaluateMath, isValidMathExpression } from './math'
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
// Basic Arithmetic Tests
// ============================================================================

describe('evaluateMath - basic arithmetic', () => {
  it('should evaluate addition', () => {
    const ctx = createTestContext()
    expect(evaluateMath('2 + 3', ctx)).toBe(5)
  })

  it('should evaluate subtraction', () => {
    const ctx = createTestContext()
    expect(evaluateMath('10 - 4', ctx)).toBe(6)
  })

  it('should evaluate multiplication', () => {
    const ctx = createTestContext()
    expect(evaluateMath('3 * 4', ctx)).toBe(12)
  })

  it('should evaluate division with truncation', () => {
    const ctx = createTestContext()
    expect(evaluateMath('10 / 3', ctx)).toBe(3) // Truncates toward zero
  })

  it('should handle division by zero gracefully', () => {
    const ctx = createTestContext()
    expect(evaluateMath('10 / 0', ctx)).toBe(0)
  })

  it('should respect operator precedence', () => {
    const ctx = createTestContext()
    expect(evaluateMath('2 + 3 * 4', ctx)).toBe(14) // Not 20
  })

  it('should handle parentheses', () => {
    const ctx = createTestContext()
    expect(evaluateMath('(2 + 3) * 4', ctx)).toBe(20)
  })

  it('should handle nested parentheses', () => {
    const ctx = createTestContext()
    expect(evaluateMath('((2 + 3) * (4 - 1))', ctx)).toBe(15)
  })

  it('should handle unary minus', () => {
    const ctx = createTestContext()
    expect(evaluateMath('-5 + 10', ctx)).toBe(5)
  })

  it('should handle multiple unary minus', () => {
    const ctx = createTestContext()
    expect(evaluateMath('--5', ctx)).toBe(5)
  })

  it('should handle negative numbers in expression', () => {
    const ctx = createTestContext()
    expect(evaluateMath('5 * -3', ctx)).toBe(-15)
  })

  it('should handle complex expression', () => {
    const ctx = createTestContext()
    expect(evaluateMath('10 + 5 * 2 - 8 / 4', ctx)).toBe(18) // 10 + 10 - 2
  })
})

// ============================================================================
// Variable Tests
// ============================================================================

describe('evaluateMath - variables', () => {
  it('should resolve simple variable', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('level', '5')

    expect(evaluateMath('$level * 2', ctx)).toBe(10)
  })

  it('should use shared variable over static', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('count', '3')
    setSharedVariable(ctx, 'count', createCaptureItem('7'))

    expect(evaluateMath('$count + 1', ctx)).toBe(8)
  })

  it('should return 0 for undefined variable', () => {
    const ctx = createTestContext()

    expect(evaluateMath('$missing + 5', ctx)).toBe(5)
  })

  it('should handle variable in complex expression', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('base', '10')
    ctx.staticVariables.set('bonus', '3')

    expect(evaluateMath('($base + $bonus) * 2', ctx)).toBe(26)
  })

  it('should handle non-numeric variable gracefully', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('name', 'Hero')

    // Non-numeric should return 0
    expect(evaluateMath('$name + 1', ctx)).toBe(1)
  })
})

// ============================================================================
// Placeholder Tests
// ============================================================================

describe('evaluateMath - placeholders', () => {
  it('should resolve simple placeholder', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'weapon', { damage: '8' })

    expect(evaluateMath('@weapon.damage + 2', ctx)).toBe(10)
  })

  it('should resolve placeholder without property (uses value)', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'dice', { value: '6' })

    expect(evaluateMath('@dice * 2', ctx)).toBe(12)
  })

  it('should return 0 for undefined placeholder', () => {
    const ctx = createTestContext()

    expect(evaluateMath('@missing + 5', ctx)).toBe(5)
  })

  it('should handle placeholder in complex expression', () => {
    const ctx = createTestContext()
    setPlaceholders(ctx, 'weapon', { baseDamage: '10' })
    ctx.staticVariables.set('strength', '4')

    expect(evaluateMath('@weapon.baseDamage + $strength', ctx)).toBe(14)
  })
})

// ============================================================================
// Capture Access Tests
// ============================================================================

describe('evaluateMath - capture access', () => {
  it('should access capture variable property', () => {
    const ctx = createTestContext()
    setSharedVariable(ctx, 'weapon', createCaptureItem('Sword', { bonus: '3' }))

    expect(evaluateMath('$weapon.@bonus + 1', ctx)).toBe(4)
  })

  it('should return 0 for missing capture variable', () => {
    const ctx = createTestContext()

    expect(evaluateMath('$missing.@prop + 5', ctx)).toBe(5)
  })

  it('should return 0 for missing property', () => {
    const ctx = createTestContext()
    setSharedVariable(ctx, 'item', createCaptureItem('Test'))

    expect(evaluateMath('$item.@missing + 5', ctx)).toBe(5)
  })

  it('should handle chained property access', () => {
    const ctx = createTestContext()
    const nestedItem: CaptureItem = {
      value: 'Fire',
      sets: { extraDamage: '5' },
    }
    setSharedVariable(ctx, 'weapon', {
      value: 'Sword',
      sets: {
        enchantment: nestedItem as unknown as string,
      },
    })

    // Note: Chained access like $weapon.@enchantment.@extraDamage
    // The math parser handles this
    expect(evaluateMath('$weapon.@enchantment.@extraDamage + 1', ctx)).toBe(6)
  })
})

// ============================================================================
// Dice Tests
// ============================================================================

describe('evaluateMath - dice', () => {
  it('should evaluate dice expression', () => {
    const ctx = createTestContext()

    // Roll 1d1 for deterministic result
    expect(evaluateMath('dice:1d1 + 5', ctx)).toBe(6)
  })

  it('should integrate dice with other expressions', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('bonus', '2')

    // 1d1 = 1, plus bonus 2, times 2
    expect(evaluateMath('(dice:1d1 + $bonus) * 2', ctx)).toBe(6)
  })

  it('should handle multiple dice', () => {
    const ctx = createTestContext()

    // 2d1 = 2
    expect(evaluateMath('dice:2d1 * 3', ctx)).toBe(6)
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('evaluateMath - edge cases', () => {
  it('should handle whitespace', () => {
    const ctx = createTestContext()
    expect(evaluateMath('  5   +   3  ', ctx)).toBe(8)
  })

  it('should handle just a number', () => {
    const ctx = createTestContext()
    expect(evaluateMath('42', ctx)).toBe(42)
  })

  it('should handle just a variable', () => {
    const ctx = createTestContext()
    ctx.staticVariables.set('answer', '42')
    expect(evaluateMath('$answer', ctx)).toBe(42)
  })

  it('should return null for invalid expression', () => {
    const ctx = createTestContext()
    expect(evaluateMath('2 + + 3', ctx)).toBeNull()
  })

  it('should return null for unclosed parentheses', () => {
    const ctx = createTestContext()
    expect(evaluateMath('(2 + 3', ctx)).toBeNull()
  })

  it('should handle large numbers', () => {
    const ctx = createTestContext()
    expect(evaluateMath('999999 + 1', ctx)).toBe(1000000)
  })

  it('should handle zero', () => {
    const ctx = createTestContext()
    expect(evaluateMath('0 + 0', ctx)).toBe(0)
  })

  it('should handle negative result', () => {
    const ctx = createTestContext()
    expect(evaluateMath('5 - 10', ctx)).toBe(-5)
  })

  it('should handle integer division truncation toward zero', () => {
    const ctx = createTestContext()
    // Positive division
    expect(evaluateMath('7 / 3', ctx)).toBe(2)
    // Negative division - truncate toward zero
    expect(evaluateMath('-7 / 3', ctx)).toBe(-2)
  })
})

// ============================================================================
// isValidMathExpression Tests
// ============================================================================

describe('isValidMathExpression', () => {
  it('should return true for valid expressions', () => {
    expect(isValidMathExpression('2 + 3')).toBe(true)
    expect(isValidMathExpression('$var * 2')).toBe(true)
    expect(isValidMathExpression('@placeholder.prop')).toBe(true)
    expect(isValidMathExpression('dice:1d6 + 5')).toBe(true)
  })

  it('should return true for complex valid expressions', () => {
    expect(isValidMathExpression('(2 + 3) * ($level - 1)')).toBe(true)
    expect(isValidMathExpression('$weapon.@damage + dice:1d6')).toBe(true)
  })

  // Note: The tokenizer is lenient, so most strings will tokenize
  // This just tests that tokenization succeeds
  it('should handle empty string', () => {
    expect(isValidMathExpression('')).toBe(true) // Empty tokenizes fine
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('evaluateMath - integration', () => {
  it('should handle complex RPG damage calculation', () => {
    const ctx = createTestContext()

    // Set up character stats
    ctx.staticVariables.set('strength', '4')
    ctx.staticVariables.set('proficiency', '2')

    // Set up weapon data
    setPlaceholders(ctx, 'weapon', {
      baseDamage: '8',
      enchantBonus: '1',
    })

    // Damage = baseDamage + strength + enchantBonus
    expect(evaluateMath('@weapon.baseDamage + $strength + @weapon.enchantBonus', ctx)).toBe(13)
  })

  it('should handle spell damage with level scaling', () => {
    const ctx = createTestContext()

    ctx.staticVariables.set('level', '5')
    ctx.staticVariables.set('spellMod', '3')

    // Fireball: 8d6 at level 3, +1d6 per level above 3
    // Using deterministic 1d1s for testing
    // ((level - 3) + 8) * (1d1) + spellMod
    expect(evaluateMath('($level - 3 + 8) * dice:1d1 + $spellMod', ctx)).toBe(13)
  })

  it('should handle inventory weight calculation', () => {
    const ctx = createTestContext()

    setSharedVariable(ctx, 'sword', createCaptureItem('Longsword', { weight: '3' }))
    setSharedVariable(ctx, 'armor', createCaptureItem('Plate', { weight: '65' }))
    ctx.staticVariables.set('gold', '100')

    // Total weight: sword + armor + (gold / 50)
    expect(evaluateMath('$sword.@weight + $armor.@weight + $gold / 50', ctx)).toBe(70)
  })
})
