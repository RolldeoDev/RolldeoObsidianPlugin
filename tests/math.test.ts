/**
 * Tests for the Math Expression Evaluator
 */

import { evaluateMath, isValidMathExpression } from '../engine/core/math';
import { createContext } from '../engine/core/context';
import type { GenerationContext } from '../engine/core/context';
import type { EngineConfig } from '../engine/types';

const defaultConfig: EngineConfig = {
  maxRecursionDepth: 100,
  maxExplodingDice: 100,
};

// Helper to create a test context with optional static/shared variables
function createTestContext(options: {
  staticVariables?: Map<string, string>;
  sharedVariables?: Map<string, { value: string; sets: Record<string, unknown> }>;
} = {}): GenerationContext {
  const ctx = createContext(defaultConfig, options.staticVariables);
  if (options.sharedVariables) {
    for (const [k, v] of options.sharedVariables) {
      ctx.sharedVariables.set(k, v);
    }
  }
  return ctx;
}

describe('Math Evaluator', () => {
  describe('basic arithmetic', () => {
    it('should evaluate addition', () => {
      const context = createTestContext();
      expect(evaluateMath('2 + 3', context)).toBe(5);
    });

    it('should evaluate subtraction', () => {
      const context = createTestContext();
      expect(evaluateMath('10 - 4', context)).toBe(6);
    });

    it('should evaluate multiplication', () => {
      const context = createTestContext();
      expect(evaluateMath('3 * 4', context)).toBe(12);
    });

    it('should evaluate division', () => {
      const context = createTestContext();
      expect(evaluateMath('15 / 3', context)).toBe(5);
    });

    it('should truncate division (not floor)', () => {
      const context = createTestContext();
      expect(evaluateMath('7 / 2', context)).toBe(3);
      expect(evaluateMath('-7 / 2', context)).toBe(-3); // Truncate, not floor
    });

    it('should handle division by zero', () => {
      const context = createTestContext();
      expect(evaluateMath('10 / 0', context)).toBe(0);
    });
  });

  describe('operator precedence', () => {
    it('should respect multiplication over addition', () => {
      const context = createTestContext();
      expect(evaluateMath('2 + 3 * 4', context)).toBe(14);
    });

    it('should respect division over subtraction', () => {
      const context = createTestContext();
      expect(evaluateMath('10 - 6 / 2', context)).toBe(7);
    });

    it('should handle complex expressions', () => {
      const context = createTestContext();
      expect(evaluateMath('2 + 3 * 4 - 6 / 2', context)).toBe(11);
    });
  });

  describe('parentheses', () => {
    it('should override precedence with parentheses', () => {
      const context = createTestContext();
      expect(evaluateMath('(2 + 3) * 4', context)).toBe(20);
    });

    it('should handle nested parentheses', () => {
      const context = createTestContext();
      expect(evaluateMath('((2 + 3) * 4) - 5', context)).toBe(15);
    });

    it('should handle deeply nested parentheses', () => {
      const context = createTestContext();
      expect(evaluateMath('(((10)))', context)).toBe(10);
    });
  });

  describe('unary minus', () => {
    it('should handle negative numbers', () => {
      const context = createTestContext();
      expect(evaluateMath('-5', context)).toBe(-5);
    });

    it('should handle unary minus in expressions', () => {
      const context = createTestContext();
      expect(evaluateMath('10 + -5', context)).toBe(5);
    });

    it('should handle unary minus with parentheses', () => {
      const context = createTestContext();
      expect(evaluateMath('-(2 + 3)', context)).toBe(-5);
    });
  });

  describe('variables', () => {
    it('should resolve static variables', () => {
      const context = createTestContext({
        staticVariables: new Map([['count', '10']]),
      });
      expect(evaluateMath('$count + 5', context)).toBe(15);
    });

    it('should resolve shared variables', () => {
      const context = createTestContext({
        sharedVariables: new Map([['multiplier', { value: '3', sets: {} }]]),
      });
      expect(evaluateMath('$multiplier * 4', context)).toBe(12);
    });

    it('should use 0 for undefined variables', () => {
      const context = createTestContext();
      expect(evaluateMath('$undefined + 10', context)).toBe(10);
    });

    it('should handle non-numeric variables', () => {
      const context = createTestContext({
        staticVariables: new Map([['text', 'hello']]),
      });
      // Non-numeric should coerce to 0
      expect(evaluateMath('$text + 10', context)).toBe(10);
    });
  });

  describe('placeholders', () => {
    it('should resolve placeholders', () => {
      const context = createTestContext();
      context.placeholders.set('myTable', { level: '5' });
      expect(evaluateMath('@myTable.level + 2', context)).toBe(7);
    });

    it('should use 0 for undefined placeholders', () => {
      const context = createTestContext();
      expect(evaluateMath('@undefined + 10', context)).toBe(10);
    });
  });

  describe('dice expressions', () => {
    it('should roll dice and use result', () => {
      const context = createTestContext();
      const mockRandom = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const result = evaluateMath('dice:1d6 + 5', context);
      // With random = 0.5, d6 = 4, so 4 + 5 = 9
      expect(result).toBe(9);

      mockRandom.mockRestore();
    });

    it('should handle dice with modifiers', () => {
      const context = createTestContext();
      const mockRandom = jest.spyOn(Math, 'random').mockReturnValue(0.99);

      const result = evaluateMath('dice:1d6 * 2', context);
      // With random = 0.99, d6 = 6, so 6 * 2 = 12
      expect(result).toBe(12);

      mockRandom.mockRestore();
    });
  });

  describe('capture access', () => {
    it('should access capture variable properties', () => {
      const context = createTestContext({
        sharedVariables: new Map([
          ['npc', { value: 'Gandalf', sets: { level: '20', hp: '100' } }],
        ]),
      });
      expect(evaluateMath('$npc.@level + 5', context)).toBe(25);
    });

    it('should access nested capture properties', () => {
      const context = createTestContext({
        sharedVariables: new Map([
          ['character', {
            value: 'Hero',
            sets: {
              stats: {
                value: 'Stats Block',
                sets: { strength: '18' },
              },
            },
          }],
        ]),
      });
      expect(evaluateMath('$character.@stats.@strength', context)).toBe(18);
    });
  });

  describe('complex expressions', () => {
    it('should handle combined variables and numbers', () => {
      const context = createTestContext({
        staticVariables: new Map([['base', '10'], ['bonus', '5']]),
      });
      expect(evaluateMath('($base + $bonus) * 2', context)).toBe(30);
    });

    it('should handle whitespace', () => {
      const context = createTestContext();
      expect(evaluateMath('  2   +   3   ', context)).toBe(5);
    });
  });

  describe('error handling', () => {
    it('should return null for invalid expressions', () => {
      const context = createTestContext();
      expect(evaluateMath('2 + +', context)).toBeNull();
    });

    it('should return null for mismatched parentheses', () => {
      const context = createTestContext();
      expect(evaluateMath('(2 + 3', context)).toBeNull();
    });
  });

  describe('isValidMathExpression', () => {
    it('should return true for valid expressions', () => {
      expect(isValidMathExpression('2 + 3')).toBe(true);
      expect(isValidMathExpression('$var * 4')).toBe(true);
      expect(isValidMathExpression('dice:1d6')).toBe(true);
    });

    it('should return true for expressions with valid tokens', () => {
      // Note: this only checks tokenization, not full parsing
      expect(isValidMathExpression('(2 + 3)')).toBe(true);
    });
  });
});
