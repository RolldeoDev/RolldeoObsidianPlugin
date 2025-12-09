/**
 * Integration Tests for the Random Table Engine
 */

import { RandomTableEngine } from '../engine/core';
import type { RandomTableDocument } from '../engine/types';

// Helper to create a minimal collection
function createTestCollection(id: string, doc: Partial<RandomTableDocument>): { id: string; doc: RandomTableDocument } {
  return {
    id,
    doc: {
      metadata: {
        name: doc.metadata?.name || 'Test Collection',
        namespace: doc.metadata?.namespace || 'test',
        version: doc.metadata?.version || '1.0.0',
        specVersion: '1.0',
      },
      tables: doc.tables || [],
      templates: doc.templates,
      variables: doc.variables,
      shared: doc.shared,
    },
  };
}

describe('RandomTableEngine', () => {
  describe('initialization', () => {
    it('should create engine with default config', () => {
      const engine = new RandomTableEngine();
      expect(engine).toBeDefined();
    });

    it('should create engine with custom config', () => {
      const engine = new RandomTableEngine({
        config: {
          maxRecursionDepth: 50,
          maxExplodingDice: 50,
        },
      });
      expect(engine).toBeDefined();
    });
  });

  describe('collection loading', () => {
    it('should load a valid collection', () => {
      const engine = new RandomTableEngine();
      const collection = createTestCollection('colors', {
        tables: [
          {
            id: 'colorTable',
            name: 'Colors',
            type: 'simple',
            entries: [
              { value: 'Red' },
              { value: 'Blue' },
              { value: 'Green' },
            ],
          },
        ],
      });

      // loadCollection doesn't return a result, it just loads
      engine.loadCollection(collection.doc, collection.id);
      expect(engine.hasCollection(collection.id)).toBe(true);
    });

    it('should validate and reject invalid collection', () => {
      const engine = new RandomTableEngine();
      // Invalid: missing specVersion (required field)
      const invalidDoc = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          // specVersion is missing - this should fail validation
        },
        tables: [],
      } as unknown as RandomTableDocument;

      const result = engine.validate(invalidDoc);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should unload collections', () => {
      const engine = new RandomTableEngine();
      const collection = createTestCollection('colors', {
        tables: [
          {
            id: 'colorTable',
            name: 'Colors',
            type: 'simple',
            entries: [{ value: 'Red' }],
          },
        ],
      });

      engine.loadCollection(collection.doc, collection.id);
      expect(engine.hasCollection('colors')).toBe(true);

      engine.unloadCollection('colors');
      expect(engine.hasCollection('colors')).toBe(false);
    });
  });

  describe('simple table rolling', () => {
    let engine: RandomTableEngine;

    beforeEach(() => {
      engine = new RandomTableEngine();
      const collection = createTestCollection('test', {
        tables: [
          {
            id: 'colorTable',
            name: 'Colors',
            type: 'simple',
            entries: [
              { id: 'red', value: 'Red' },
              { id: 'blue', value: 'Blue' },
              { id: 'green', value: 'Green' },
            ],
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);
    });

    it('should roll on a simple table', () => {
      const result = engine.roll('colorTable', 'test');
      expect(result).toBeDefined();
      expect(['Red', 'Blue', 'Green']).toContain(result?.text);
    });

    it('should throw for unknown table', () => {
      expect(() => engine.roll('unknownTable', 'test')).toThrow('Table not found');
    });
  });

  describe('weighted entries', () => {
    it('should respect entry weights', () => {
      const engine = new RandomTableEngine();
      const collection = createTestCollection('test', {
        tables: [
          {
            id: 'weightedTable',
            name: 'Weighted',
            type: 'simple',
            entries: [
              { value: 'Common', weight: 100 },
              { value: 'Rare', weight: 1 },
            ],
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);

      // Roll many times and check distribution
      const results: Record<string, number> = { Common: 0, Rare: 0 };
      for (let i = 0; i < 1000; i++) {
        const result = engine.roll('weightedTable', 'test');
        if (result) {
          results[result.text]++;
        }
      }

      // Common should appear much more often
      expect(results.Common).toBeGreaterThan(results.Rare * 5);
    });
  });

  describe('composite tables', () => {
    it('should roll composite table by selecting from source tables', () => {
      const engine = new RandomTableEngine();
      const collection = createTestCollection('test', {
        tables: [
          {
            id: 'adjectives',
            name: 'Adjectives',
            type: 'simple',
            entries: [{ value: 'Big' }, { value: 'Small' }],
          },
          {
            id: 'nouns',
            name: 'Nouns',
            type: 'simple',
            entries: [{ value: 'Dog' }, { value: 'Cat' }],
          },
          {
            id: 'mixedWords',
            name: 'Mixed Words',
            type: 'composite',
            sources: [
              { tableId: 'adjectives', weight: 1 },
              { tableId: 'nouns', weight: 1 },
            ],
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);

      const result = engine.roll('mixedWords', 'test');
      expect(result).toBeDefined();
      expect(['Big', 'Small', 'Dog', 'Cat']).toContain(result?.text);
    });
  });

  describe('collection tables', () => {
    it('should roll from collection table', () => {
      const engine = new RandomTableEngine();
      const collection = createTestCollection('test', {
        tables: [
          {
            id: 'colorsTable',
            name: 'Colors',
            type: 'simple',
            entries: [{ value: 'Red' }],
          },
          {
            id: 'sizesTable',
            name: 'Sizes',
            type: 'simple',
            entries: [{ value: 'Large' }],
          },
          {
            id: 'mixedCollection',
            name: 'Mixed',
            type: 'collection',
            collections: ['colorsTable', 'sizesTable'],
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);

      const result = engine.roll('mixedCollection', 'test');
      expect(result).toBeDefined();
      expect(['Red', 'Large']).toContain(result?.text);
    });
  });

  describe('templates', () => {
    it('should evaluate template', () => {
      const engine = new RandomTableEngine();
      const collection = createTestCollection('test', {
        tables: [
          {
            id: 'colorTable',
            name: 'Colors',
            type: 'simple',
            entries: [{ value: 'red' }],
          },
        ],
        templates: [
          {
            id: 'colorSentence',
            name: 'Color Sentence',
            pattern: 'The color is {{colorTable}}.',
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);

      const result = engine.rollTemplate('colorSentence', 'test');
      expect(result).toBeDefined();
      expect(result?.text).toBe('The color is red.');
    });
  });

  describe('variables', () => {
    it('should use static variables', () => {
      const engine = new RandomTableEngine();
      const collection = createTestCollection('test', {
        variables: {
          bonus: '5',
        },
        tables: [
          {
            id: 'testTable',
            name: 'Test',
            type: 'simple',
            entries: [{ value: 'Bonus is {{$bonus}}' }],
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);

      const result = engine.roll('testTable', 'test');
      expect(result?.text).toBe('Bonus is 5');
    });
  });

  describe('dice expressions', () => {
    it('should evaluate dice in patterns', () => {
      const mockRandom = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      const engine = new RandomTableEngine();
      const collection = createTestCollection('test', {
        tables: [
          {
            id: 'diceTable',
            name: 'Dice',
            type: 'simple',
            entries: [{ value: 'You rolled {{dice:1d6}}' }],
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);

      const result = engine.roll('diceTable', 'test');
      expect(result?.text).toBe('You rolled 4');

      mockRandom.mockRestore();
    });
  });

  describe('table references', () => {
    it('should resolve table references in patterns', () => {
      const engine = new RandomTableEngine();
      const collection = createTestCollection('test', {
        tables: [
          {
            id: 'innerTable',
            name: 'Inner',
            type: 'simple',
            entries: [{ value: 'INNER' }],
          },
          {
            id: 'outerTable',
            name: 'Outer',
            type: 'simple',
            entries: [{ value: 'Result: {{innerTable}}' }],
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);

      const result = engine.roll('outerTable', 'test');
      expect(result?.text).toBe('Result: INNER');
    });
  });

  describe('sets/placeholders', () => {
    it('should populate sets from entries', () => {
      const engine = new RandomTableEngine();
      const collection = createTestCollection('test', {
        tables: [
          {
            id: 'personTable',
            name: 'Person',
            type: 'simple',
            entries: [
              {
                value: '{{@personTable.firstName}} {{@personTable.lastName}}',
                sets: {
                  firstName: 'John',
                  lastName: 'Doe',
                },
              },
            ],
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);

      const result = engine.roll('personTable', 'test');
      expect(result?.text).toBe('John Doe');
    });
  });

  describe('multi-roll', () => {
    it('should perform multi-roll', () => {
      const engine = new RandomTableEngine();
      const collection = createTestCollection('test', {
        tables: [
          {
            id: 'itemTable',
            name: 'Items',
            type: 'simple',
            entries: [{ value: 'Sword' }, { value: 'Shield' }, { value: 'Potion' }],
          },
        ],
        templates: [
          {
            id: 'inventory',
            name: 'Inventory',
            pattern: '{{3*itemTable}}',
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);

      const result = engine.rollTemplate('inventory', 'test');
      expect(result).toBeDefined();
      // Should contain 3 items separated by default separator
      const items = result?.text.split(', ');
      expect(items).toHaveLength(3);
    });

    it('should perform unique multi-roll', () => {
      const engine = new RandomTableEngine();
      const collection = createTestCollection('test', {
        tables: [
          {
            id: 'colorTable',
            name: 'Colors',
            type: 'simple',
            entries: [
              { id: 'red', value: 'Red' },
              { id: 'blue', value: 'Blue' },
              { id: 'green', value: 'Green' },
            ],
          },
        ],
        templates: [
          {
            id: 'uniqueColors',
            name: 'Unique Colors',
            pattern: '{{3*unique*colorTable}}',
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);

      const result = engine.rollTemplate('uniqueColors', 'test');
      const items = result?.text.split(', ');
      // All items should be unique
      const uniqueItems = new Set(items);
      expect(uniqueItems.size).toBe(items?.length);
    });
  });

  describe('listTables', () => {
    it('should return all loaded tables', () => {
      const engine = new RandomTableEngine();
      const collection = createTestCollection('test', {
        tables: [
          {
            id: 'table1',
            name: 'Table 1',
            type: 'simple',
            entries: [{ value: 'Entry' }],
          },
          {
            id: 'table2',
            name: 'Table 2',
            type: 'simple',
            entries: [{ value: 'Entry' }],
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);

      const tables = engine.listTables('test');
      expect(tables).toHaveLength(2);
      expect(tables.map((t) => t.id)).toContain('table1');
      expect(tables.map((t) => t.id)).toContain('table2');
    });
  });

  describe('error handling', () => {
    it('should throw on recursion limit exceeded', () => {
      const engine = new RandomTableEngine({ config: { maxRecursionDepth: 5 } });
      const collection = createTestCollection('test', {
        tables: [
          {
            id: 'recursiveTable',
            name: 'Recursive',
            type: 'simple',
            entries: [{ value: '{{recursiveTable}}' }],
          },
        ],
      });
      engine.loadCollection(collection.doc, collection.id);

      // Should throw when recursion limit is exceeded
      expect(() => engine.roll('recursiveTable', 'test')).toThrow('Recursion limit exceeded');
    });
  });
});
