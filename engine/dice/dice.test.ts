import { describe, it, expect } from 'vitest'
import { rollDice, isValidDiceExpression, extractDiceExpressions } from './index'

describe('rollDice', () => {
  describe('basic dice rolling', () => {
    it('should roll a single die', () => {
      const result = rollDice('1d6')
      expect(result.total).toBeGreaterThanOrEqual(1)
      expect(result.total).toBeLessThanOrEqual(6)
      expect(result.rolls).toHaveLength(1)
    })

    it('should roll multiple dice', () => {
      const result = rollDice('3d6')
      expect(result.total).toBeGreaterThanOrEqual(3)
      expect(result.total).toBeLessThanOrEqual(18)
      expect(result.rolls).toHaveLength(3)
    })

    it('should handle large dice', () => {
      const result = rollDice('1d100')
      expect(result.total).toBeGreaterThanOrEqual(1)
      expect(result.total).toBeLessThanOrEqual(100)
    })
  })

  describe('modifiers', () => {
    it('should add a flat modifier', () => {
      // Roll 1d1 (always 1) + 5 = 6
      const result = rollDice('1d1+5')
      expect(result.total).toBe(6)
    })

    it('should subtract a modifier', () => {
      // Roll 1d1 (always 1) - 1 = 0
      const result = rollDice('1d1-1')
      expect(result.total).toBe(0)
    })

    it('should multiply by a modifier', () => {
      // Roll 1d1 (always 1) * 10 = 10
      const result = rollDice('1d1*10')
      expect(result.total).toBe(10)
    })
  })

  describe('keep highest/lowest', () => {
    it('should keep highest dice', () => {
      // With many rolls, we can verify keep logic statistically
      const result = rollDice('4d6k3')
      expect(result.kept).toHaveLength(3)
      expect(result.rolls.length).toBeGreaterThanOrEqual(4)

      // All kept dice should be in the original rolls
      for (const die of result.kept) {
        expect(result.rolls).toContain(die)
      }
    })

    it('should keep lowest dice', () => {
      const result = rollDice('2d20kl1')
      expect(result.kept).toHaveLength(1)
      expect(result.rolls).toHaveLength(2)

      // The kept die should be the minimum
      const minRoll = Math.min(...result.rolls)
      expect(result.kept[0]).toBe(minRoll)
    })

    it('should handle kh notation explicitly', () => {
      const result = rollDice('4d6kh3')
      expect(result.kept).toHaveLength(3)
    })
  })

  describe('exploding dice', () => {
    it('should handle exploding dice', () => {
      // We can't deterministically test explosions, but we can verify it parses
      const result = rollDice('1d6!')
      expect(result.expression).toBe('1d6!')
      expect(result.rolls.length).toBeGreaterThanOrEqual(1)
    })

    it('should respect max exploding limit', () => {
      // Roll 1d1! - this will always explode, but should be limited
      const result = rollDice('1d1!', { maxExplodingDice: 5 })
      // Should have initial roll + up to 5 explosions
      expect(result.rolls.length).toBeLessThanOrEqual(6)
    })
  })

  describe('complex expressions', () => {
    it('should handle keep + modifier', () => {
      const result = rollDice('4d6k3+2')
      expect(result.kept).toHaveLength(3)
      // Total should be sum of kept + 2
      const keptSum = result.kept.reduce((a, b) => a + b, 0)
      expect(result.total).toBe(keptSum + 2)
    })

    it('should handle exploding + modifier', () => {
      const result = rollDice('1d6!+5')
      expect(result.total).toBeGreaterThanOrEqual(6) // min 1 + 5
    })
  })

  describe('error handling', () => {
    it('should throw on invalid expression', () => {
      expect(() => rollDice('invalid')).toThrow()
      expect(() => rollDice('d6')).toThrow() // missing count
      expect(() => rollDice('3d')).toThrow() // missing sides
    })

    it('should throw on zero dice', () => {
      expect(() => rollDice('0d6')).toThrow()
    })

    it('should throw on zero sides', () => {
      expect(() => rollDice('1d0')).toThrow()
    })

    it('should throw when keeping more dice than rolled', () => {
      expect(() => rollDice('2d6k5')).toThrow()
    })
  })

  describe('result structure', () => {
    it('should include expression in result', () => {
      const result = rollDice('3d6+5')
      expect(result.expression).toBe('3d6+5')
    })

    it('should include breakdown in result', () => {
      const result = rollDice('2d6+3')
      expect(result.breakdown).toContain('[')
      expect(result.breakdown).toContain(']')
      expect(result.breakdown).toContain('=')
    })
  })
})

describe('isValidDiceExpression', () => {
  it('should return true for valid expressions', () => {
    expect(isValidDiceExpression('1d6')).toBe(true)
    expect(isValidDiceExpression('3d6')).toBe(true)
    expect(isValidDiceExpression('4d6k3')).toBe(true)
    expect(isValidDiceExpression('2d6+5')).toBe(true)
    expect(isValidDiceExpression('1d6!')).toBe(true)
    expect(isValidDiceExpression('4d6kh3+2')).toBe(true)
  })

  it('should return false for invalid expressions', () => {
    expect(isValidDiceExpression('invalid')).toBe(false)
    expect(isValidDiceExpression('d6')).toBe(false)
    expect(isValidDiceExpression('1d')).toBe(false)
    expect(isValidDiceExpression('')).toBe(false)
  })
})

describe('extractDiceExpressions', () => {
  it('should extract dice expressions from template', () => {
    const template = 'You find {{dice:2d6*10}} gold pieces'
    const expressions = extractDiceExpressions(template)
    expect(expressions).toEqual(['2d6*10'])
  })

  it('should extract multiple expressions', () => {
    const template = '{{dice:1d4}} goblins with {{dice:3d6}} gold each'
    const expressions = extractDiceExpressions(template)
    expect(expressions).toEqual(['1d4', '3d6'])
  })

  it('should return empty array when no expressions', () => {
    const template = 'No dice here'
    const expressions = extractDiceExpressions(template)
    expect(expressions).toEqual([])
  })
})
