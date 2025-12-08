/**
 * Tests for the Conditionals Evaluator
 */

import { evaluateWhenClause } from '../engine/core/conditionals';
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

describe('Conditionals Evaluator', () => {
  describe('equality comparison', () => {
    it('should evaluate == for matching strings', () => {
      const context = createTestContext({
        staticVariables: new Map([['gender', 'male']]),
      });
      expect(evaluateWhenClause('$gender == "male"', context)).toBe(true);
    });

    it('should evaluate == for non-matching strings', () => {
      const context = createTestContext({
        staticVariables: new Map([['gender', 'male']]),
      });
      expect(evaluateWhenClause('$gender == "female"', context)).toBe(false);
    });

    it('should evaluate != for different values', () => {
      const context = createTestContext({
        staticVariables: new Map([['type', 'warrior']]),
      });
      expect(evaluateWhenClause('$type != "mage"', context)).toBe(true);
    });

    it('should evaluate != for same values', () => {
      const context = createTestContext({
        staticVariables: new Map([['type', 'warrior']]),
      });
      expect(evaluateWhenClause('$type != "warrior"', context)).toBe(false);
    });
  });

  describe('numeric comparison', () => {
    it('should evaluate > correctly', () => {
      const context = createTestContext({
        staticVariables: new Map([['level', '10']]),
      });
      expect(evaluateWhenClause('$level > 5', context)).toBe(true);
      expect(evaluateWhenClause('$level > 15', context)).toBe(false);
      expect(evaluateWhenClause('$level > 10', context)).toBe(false);
    });

    it('should evaluate < correctly', () => {
      const context = createTestContext({
        staticVariables: new Map([['level', '5']]),
      });
      expect(evaluateWhenClause('$level < 10', context)).toBe(true);
      expect(evaluateWhenClause('$level < 3', context)).toBe(false);
      expect(evaluateWhenClause('$level < 5', context)).toBe(false);
    });

    it('should evaluate >= correctly', () => {
      const context = createTestContext({
        staticVariables: new Map([['score', '75']]),
      });
      expect(evaluateWhenClause('$score >= 75', context)).toBe(true);
      expect(evaluateWhenClause('$score >= 70', context)).toBe(true);
      expect(evaluateWhenClause('$score >= 80', context)).toBe(false);
    });

    it('should evaluate <= correctly', () => {
      const context = createTestContext({
        staticVariables: new Map([['hp', '50']]),
      });
      expect(evaluateWhenClause('$hp <= 50', context)).toBe(true);
      expect(evaluateWhenClause('$hp <= 60', context)).toBe(true);
      expect(evaluateWhenClause('$hp <= 40', context)).toBe(false);
    });
  });

  describe('string operators', () => {
    it('should evaluate contains correctly', () => {
      const context = createTestContext({
        staticVariables: new Map([['description', 'A tall warrior']]),
      });
      expect(evaluateWhenClause('$description contains "warrior"', context)).toBe(true);
      expect(evaluateWhenClause('$description contains "mage"', context)).toBe(false);
    });

    it('should be case-insensitive for contains', () => {
      const context = createTestContext({
        staticVariables: new Map([['name', 'GANDALF']]),
      });
      expect(evaluateWhenClause('$name contains "gandalf"', context)).toBe(true);
    });

    it('should evaluate matches with regex', () => {
      const context = createTestContext({
        staticVariables: new Map([['email', 'test@example.com']]),
      });
      expect(evaluateWhenClause('$email matches ".*@.*\\.com"', context)).toBe(true);
      expect(evaluateWhenClause('$email matches "^[0-9]+$"', context)).toBe(false);
    });

    it('should handle invalid regex gracefully', () => {
      const context = createTestContext({
        staticVariables: new Map([['text', 'hello']]),
      });
      // Invalid regex should return false, not throw
      expect(evaluateWhenClause('$text matches "["', context)).toBe(false);
    });
  });

  describe('logical operators', () => {
    it('should evaluate && (AND)', () => {
      const context = createTestContext({
        staticVariables: new Map([
          ['level', '10'],
          ['type', 'warrior'],
        ]),
      });
      expect(evaluateWhenClause('$level > 5 && $type == "warrior"', context)).toBe(true);
      expect(evaluateWhenClause('$level > 15 && $type == "warrior"', context)).toBe(false);
      expect(evaluateWhenClause('$level > 5 && $type == "mage"', context)).toBe(false);
    });

    it('should evaluate || (OR)', () => {
      const context = createTestContext({
        staticVariables: new Map([
          ['class', 'mage'],
        ]),
      });
      expect(evaluateWhenClause('$class == "warrior" || $class == "mage"', context)).toBe(true);
      expect(evaluateWhenClause('$class == "rogue" || $class == "mage"', context)).toBe(true);
      expect(evaluateWhenClause('$class == "warrior" || $class == "rogue"', context)).toBe(false);
    });

    it('should evaluate ! (NOT)', () => {
      const context = createTestContext({
        staticVariables: new Map([['active', 'true']]),
      });
      expect(evaluateWhenClause('!$active == "false"', context)).toBe(true);
    });

    it('should handle complex logical expressions', () => {
      const context = createTestContext({
        staticVariables: new Map([
          ['level', '15'],
          ['class', 'warrior'],
          ['rank', 'elite'],
        ]),
      });
      // (level > 10 AND class == "warrior") OR rank == "elite"
      expect(
        evaluateWhenClause('$level > 10 && $class == "warrior" || $rank == "elite"', context)
      ).toBe(true);
    });
  });

  describe('parentheses', () => {
    it('should respect parentheses for grouping', () => {
      const context = createTestContext({
        staticVariables: new Map([
          ['a', 'true'],
          ['b', 'false'],
          ['c', 'true'],
        ]),
      });
      // Without proper grouping this would fail
      expect(evaluateWhenClause('($a == "true" || $b == "true") && $c == "true"', context)).toBe(
        true
      );
    });

    it('should handle nested parentheses', () => {
      const context = createTestContext({
        staticVariables: new Map([
          ['x', '5'],
          ['y', '10'],
        ]),
      });
      expect(evaluateWhenClause('(($x > 0) && ($y > 0))', context)).toBe(true);
    });
  });

  describe('placeholders', () => {
    it('should resolve @placeholder values', () => {
      const context = createTestContext();
      context.placeholders.set('character', { race: 'elf' });
      expect(evaluateWhenClause('@character.race == "elf"', context)).toBe(true);
    });

    it('should handle missing placeholders', () => {
      const context = createTestContext();
      expect(evaluateWhenClause('@missing == ""', context)).toBe(true);
    });
  });

  describe('shared variables with properties', () => {
    it('should access $var.@property', () => {
      const context = createTestContext();
      context.sharedVariables.set('npc', {
        value: 'Gandalf',
        sets: {
          class: 'wizard',
          level: '20',
        },
      });
      expect(evaluateWhenClause('$npc.@class == "wizard"', context)).toBe(true);
      expect(evaluateWhenClause('$npc.@level > 10', context)).toBe(true);
    });
  });

  describe('literal values', () => {
    it('should compare numbers directly', () => {
      const context = createTestContext();
      expect(evaluateWhenClause('5 > 3', context)).toBe(true);
      expect(evaluateWhenClause('10 == 10', context)).toBe(true);
    });

    it('should handle single truthy value', () => {
      const context = createTestContext({
        staticVariables: new Map([['flag', 'yes']]),
      });
      expect(evaluateWhenClause('$flag', context)).toBe(true);
    });

    it('should handle single falsy value', () => {
      const context = createTestContext({
        staticVariables: new Map([['flag', '']]),
      });
      expect(evaluateWhenClause('$flag', context)).toBe(false);
    });

    it('should handle undefined variables as falsy', () => {
      const context = createTestContext();
      expect(evaluateWhenClause('$undefined', context)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty expression', () => {
      const context = createTestContext();
      expect(evaluateWhenClause('', context)).toBe(false);
    });

    it('should handle whitespace in expressions', () => {
      const context = createTestContext({
        staticVariables: new Map([['x', '5']]),
      });
      expect(evaluateWhenClause('  $x  ==  5  ', context)).toBe(true);
    });

    it('should handle quoted strings with spaces', () => {
      const context = createTestContext({
        staticVariables: new Map([['name', 'Gandalf the Grey']]),
      });
      expect(evaluateWhenClause('$name == "Gandalf the Grey"', context)).toBe(true);
    });

    it('should handle single quotes', () => {
      const context = createTestContext({
        staticVariables: new Map([['type', 'warrior']]),
      });
      expect(evaluateWhenClause("$type == 'warrior'", context)).toBe(true);
    });
  });
});
