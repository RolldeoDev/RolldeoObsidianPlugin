/**
 * Tests for the Dice Roller Module
 */

import { rollDice, isValidDiceExpression, extractDiceExpressions } from '../engine/dice';

describe('Dice Roller', () => {
  describe('rollDice', () => {
    describe('basic dice notation', () => {
      it('should roll a single die', () => {
        const result = rollDice('1d6');
        expect(result.total).toBeGreaterThanOrEqual(1);
        expect(result.total).toBeLessThanOrEqual(6);
        expect(result.rolls).toHaveLength(1);
        expect(result.expression).toBe('1d6');
      });

      it('should roll multiple dice', () => {
        const result = rollDice('3d6');
        expect(result.total).toBeGreaterThanOrEqual(3);
        expect(result.total).toBeLessThanOrEqual(18);
        expect(result.rolls).toHaveLength(3);
        expect(result.kept).toHaveLength(3);
      });

      it('should handle d20', () => {
        const result = rollDice('1d20');
        expect(result.total).toBeGreaterThanOrEqual(1);
        expect(result.total).toBeLessThanOrEqual(20);
      });

      it('should handle d100', () => {
        const result = rollDice('1d100');
        expect(result.total).toBeGreaterThanOrEqual(1);
        expect(result.total).toBeLessThanOrEqual(100);
      });

      it('should handle large dice pools', () => {
        const result = rollDice('10d6');
        expect(result.total).toBeGreaterThanOrEqual(10);
        expect(result.total).toBeLessThanOrEqual(60);
        expect(result.rolls).toHaveLength(10);
      });
    });

    describe('modifiers', () => {
      it('should add a positive modifier', () => {
        // Mock Math.random to get predictable results
        const mockRandom = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const result = rollDice('1d6+5');
        // With random = 0.5, a d6 gives 4 (Math.floor(0.5 * 6) + 1 = 4)
        expect(result.total).toBe(9); // 4 + 5
        expect(result.expression).toBe('1d6+5');

        mockRandom.mockRestore();
      });

      it('should subtract a modifier', () => {
        const mockRandom = jest.spyOn(Math, 'random').mockReturnValue(0.99);

        const result = rollDice('1d6-2');
        // With random = 0.99, a d6 gives 6
        expect(result.total).toBe(4); // 6 - 2

        mockRandom.mockRestore();
      });

      it('should multiply by a modifier', () => {
        const mockRandom = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        const result = rollDice('1d6*2');
        // With random = 0.5, a d6 gives 4
        expect(result.total).toBe(8); // 4 * 2

        mockRandom.mockRestore();
      });
    });

    describe('keep highest/lowest', () => {
      it('should keep highest N dice (kN syntax)', () => {
        const mockRandom = jest.spyOn(Math, 'random')
          .mockReturnValueOnce(0.1)  // 1
          .mockReturnValueOnce(0.5)  // 4
          .mockReturnValueOnce(0.9)  // 6
          .mockReturnValueOnce(0.3); // 2

        const result = rollDice('4d6k3');
        expect(result.rolls).toEqual([1, 4, 6, 2]);
        expect(result.kept).toEqual([6, 4, 2]);
        expect(result.total).toBe(12); // 6 + 4 + 2

        mockRandom.mockRestore();
      });

      it('should keep highest N dice (khN syntax)', () => {
        const mockRandom = jest.spyOn(Math, 'random')
          .mockReturnValueOnce(0.1)  // 1
          .mockReturnValueOnce(0.9)  // 6
          .mockReturnValueOnce(0.5); // 4

        const result = rollDice('3d6kh2');
        expect(result.kept).toEqual([6, 4]);
        expect(result.total).toBe(10);

        mockRandom.mockRestore();
      });

      it('should keep lowest N dice (klN syntax)', () => {
        const mockRandom = jest.spyOn(Math, 'random')
          .mockReturnValueOnce(0.1)  // 1
          .mockReturnValueOnce(0.9)  // 6
          .mockReturnValueOnce(0.5); // 4

        const result = rollDice('3d6kl1');
        expect(result.kept).toEqual([1]);
        expect(result.total).toBe(1);

        mockRandom.mockRestore();
      });
    });

    describe('exploding dice', () => {
      it('should explode on max value', () => {
        const mockRandom = jest.spyOn(Math, 'random')
          .mockReturnValueOnce(0.99)  // 6 (explodes)
          .mockReturnValueOnce(0.99)  // 6 (explodes again)
          .mockReturnValueOnce(0.5);  // 4 (stops)

        const result = rollDice('1d6!');
        expect(result.rolls).toEqual([6, 6, 4]);
        expect(result.total).toBe(16); // 6 + 6 + 4

        mockRandom.mockRestore();
      });

      it('should respect max exploding dice limit', () => {
        // Create a mock that always returns max value
        const mockRandom = jest.spyOn(Math, 'random').mockReturnValue(0.99);

        const result = rollDice('1d6!', { maxExplodingDice: 5 });
        // Should have 1 original + up to 5 explosions
        expect(result.rolls.length).toBeLessThanOrEqual(6);

        mockRandom.mockRestore();
      });
    });

    describe('combined modifiers', () => {
      it('should handle keep highest with modifier', () => {
        const mockRandom = jest.spyOn(Math, 'random')
          .mockReturnValueOnce(0.1)  // 1
          .mockReturnValueOnce(0.5)  // 4
          .mockReturnValueOnce(0.9)  // 6
          .mockReturnValueOnce(0.3); // 2

        const result = rollDice('4d6kh3+5');
        expect(result.kept).toEqual([6, 4, 2]);
        expect(result.total).toBe(17); // 6 + 4 + 2 + 5

        mockRandom.mockRestore();
      });
    });

    describe('error handling', () => {
      it('should throw on invalid dice expression', () => {
        expect(() => rollDice('invalid')).toThrow();
        expect(() => rollDice('d6')).toThrow();
        expect(() => rollDice('1d')).toThrow();
      });

      it('should throw on zero dice count', () => {
        expect(() => rollDice('0d6')).toThrow();
      });

      it('should throw on zero sides', () => {
        expect(() => rollDice('1d0')).toThrow();
      });

      it('should throw on excessive dice count', () => {
        expect(() => rollDice('100000d6')).toThrow(/too many dice/i);
      });

      it('should throw on excessive sides', () => {
        expect(() => rollDice('1d100000')).toThrow(/sides too large/i);
      });

      it('should throw when keeping more dice than rolled', () => {
        expect(() => rollDice('2d6k5')).toThrow();
      });
    });

    describe('breakdown string', () => {
      it('should include all dice in breakdown', () => {
        const mockRandom = jest.spyOn(Math, 'random')
          .mockReturnValueOnce(0.1)
          .mockReturnValueOnce(0.5)
          .mockReturnValueOnce(0.9);

        const result = rollDice('3d6');
        expect(result.breakdown).toContain('[');
        expect(result.breakdown).toContain(']');
        expect(result.breakdown).toContain('=');

        mockRandom.mockRestore();
      });
    });
  });

  describe('isValidDiceExpression', () => {
    it('should return true for valid expressions', () => {
      expect(isValidDiceExpression('1d6')).toBe(true);
      expect(isValidDiceExpression('2d10')).toBe(true);
      expect(isValidDiceExpression('4d6k3')).toBe(true);
      expect(isValidDiceExpression('1d20+5')).toBe(true);
      expect(isValidDiceExpression('2d6!')).toBe(true);
      expect(isValidDiceExpression('4d6kh3+2')).toBe(true);
    });

    it('should return false for invalid expressions', () => {
      expect(isValidDiceExpression('invalid')).toBe(false);
      expect(isValidDiceExpression('d6')).toBe(false);
      expect(isValidDiceExpression('1d')).toBe(false);
      expect(isValidDiceExpression('')).toBe(false);
      expect(isValidDiceExpression('roll a d20')).toBe(false);
    });
  });

  describe('extractDiceExpressions', () => {
    it('should extract dice expressions from template strings', () => {
      const template = 'Roll {{dice:2d6}} for damage and {{dice:1d20+5}} for attack';
      const expressions = extractDiceExpressions(template);
      expect(expressions).toEqual(['2d6', '1d20+5']);
    });

    it('should return empty array when no dice expressions', () => {
      const template = 'No dice here, just {{someTable}}';
      const expressions = extractDiceExpressions(template);
      expect(expressions).toEqual([]);
    });

    it('should handle multiple dice expressions', () => {
      const template = '{{dice:1d6}} {{dice:2d6}} {{dice:3d6}}';
      const expressions = extractDiceExpressions(template);
      expect(expressions).toHaveLength(3);
    });
  });
});

describe('Dice Distribution', () => {
  // Statistical tests to verify dice are reasonably distributed
  it('should produce a reasonable distribution for 1d6', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    const iterations = 6000;

    for (let i = 0; i < iterations; i++) {
      const result = rollDice('1d6');
      counts[result.total - 1]++;
    }

    // Each face should appear roughly 1/6 of the time
    // Allow for statistical variance (within 20% of expected)
    const expected = iterations / 6;
    const tolerance = expected * 0.3; // 30% tolerance for randomness

    counts.forEach((count, index) => {
      expect(count).toBeGreaterThan(expected - tolerance);
      expect(count).toBeLessThan(expected + tolerance);
    });
  });
});
