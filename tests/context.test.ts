/**
 * Tests for the Generation Context
 */

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
  addDescription,
  beginSetEvaluation,
  endSetEvaluation,
  registerDocumentSharedName,
  wouldShadowDocumentShared,
} from '../engine/core/context';
import type { EngineConfig } from '../engine/types';

const defaultConfig: EngineConfig = {
  maxRecursionDepth: 100,
  maxExplodingDice: 100,
};

describe('Context', () => {
  describe('createContext', () => {
    it('should create context with default values', () => {
      const ctx = createContext(defaultConfig);
      expect(ctx.staticVariables.size).toBe(0);
      expect(ctx.sharedVariables.size).toBe(0);
      expect(ctx.placeholders.size).toBe(0);
      expect(ctx.recursionDepth).toBe(0);
      expect(ctx.config).toBe(defaultConfig);
    });

    it('should accept initial static variables', () => {
      const staticVars = new Map([['name', 'test']]);
      const ctx = createContext(defaultConfig, staticVars);
      expect(ctx.staticVariables.get('name')).toBe('test');
    });

    it('should create trace context when enabled', () => {
      const ctx = createContext(defaultConfig, undefined, { enableTrace: true });
      expect(ctx.trace).toBeDefined();
    });

    it('should not create trace context by default', () => {
      const ctx = createContext(defaultConfig);
      expect(ctx.trace).toBeUndefined();
    });
  });

  describe('cloneContext', () => {
    it('should create a shallow clone with isolated placeholders', () => {
      const ctx = createContext(defaultConfig);
      setPlaceholders(ctx, 'table1', { value: 'original' });

      const clone = cloneContext(ctx);
      setPlaceholders(clone, 'table1', { value: 'modified' });

      expect(getPlaceholder(ctx, 'table1', 'value')).toBe('original');
      expect(getPlaceholder(clone, 'table1', 'value')).toBe('modified');
    });

    it('should share static variables reference', () => {
      const staticVars = new Map([['key', 'value']]);
      const ctx = createContext(defaultConfig, staticVars);
      const clone = cloneContext(ctx);

      expect(clone.staticVariables).toBe(ctx.staticVariables);
    });

    it('should share shared variables reference', () => {
      const ctx = createContext(defaultConfig);
      setSharedVariable(ctx, 'shared', { value: 'test', sets: {} });

      const clone = cloneContext(ctx);
      setSharedVariable(clone, 'shared', { value: 'modified', sets: {} });

      expect(getSharedVariable(ctx, 'shared')?.value).toBe('modified');
    });
  });

  describe('variable resolution', () => {
    it('should resolve static variables', () => {
      const staticVars = new Map([['count', '10']]);
      const ctx = createContext(defaultConfig, staticVars);
      expect(resolveVariable(ctx, 'count')).toBe('10');
    });

    it('should resolve shared variables', () => {
      const ctx = createContext(defaultConfig);
      setSharedVariable(ctx, 'name', { value: 'Gandalf', sets: {} });
      expect(resolveVariable(ctx, 'name')).toBe('Gandalf');
    });

    it('should prioritize shared over static', () => {
      const staticVars = new Map([['name', 'static']]);
      const ctx = createContext(defaultConfig, staticVars);
      setSharedVariable(ctx, 'name', { value: 'shared', sets: {} });
      expect(resolveVariable(ctx, 'name')).toBe('shared');
    });

    it('should return undefined for unknown variables', () => {
      const ctx = createContext(defaultConfig);
      expect(resolveVariable(ctx, 'unknown')).toBeUndefined();
    });
  });

  describe('shared variables', () => {
    it('should set and get shared variables', () => {
      const ctx = createContext(defaultConfig);
      setSharedVariable(ctx, 'hero', {
        value: 'Aragorn',
        sets: { title: 'King' },
      });

      const result = getSharedVariable(ctx, 'hero');
      expect(result?.value).toBe('Aragorn');
      expect(result?.sets.title).toBe('King');
    });

    it('should check if shared variable exists', () => {
      const ctx = createContext(defaultConfig);
      expect(hasSharedVariable(ctx, 'hero')).toBe(false);

      setSharedVariable(ctx, 'hero', { value: 'test', sets: {} });
      expect(hasSharedVariable(ctx, 'hero')).toBe(true);
    });
  });

  describe('document shared name shadowing', () => {
    it('should register document shared names', () => {
      const ctx = createContext(defaultConfig);
      registerDocumentSharedName(ctx, 'globalVar');

      expect(wouldShadowDocumentShared(ctx, 'globalVar')).toBe(true);
      expect(wouldShadowDocumentShared(ctx, 'otherVar')).toBe(false);
    });
  });

  describe('placeholders', () => {
    it('should set and get placeholder values', () => {
      const ctx = createContext(defaultConfig);
      setPlaceholders(ctx, 'colorTable', { color: 'red', shade: 'dark' });

      expect(getPlaceholder(ctx, 'colorTable', 'color')).toBe('red');
      expect(getPlaceholder(ctx, 'colorTable', 'shade')).toBe('dark');
    });

    it('should return default value property', () => {
      const ctx = createContext(defaultConfig);
      setPlaceholders(ctx, 'table', { value: 'default' });

      expect(getPlaceholder(ctx, 'table')).toBe('default');
    });

    it('should return undefined for missing placeholders', () => {
      const ctx = createContext(defaultConfig);
      expect(getPlaceholder(ctx, 'missing', 'prop')).toBeUndefined();
    });

    it('should merge placeholders', () => {
      const ctx = createContext(defaultConfig);
      setPlaceholders(ctx, 'table', { a: '1' });
      setPlaceholders(ctx, 'table', { b: '2' });

      expect(getPlaceholder(ctx, 'table', 'a')).toBe('1');
      expect(getPlaceholder(ctx, 'table', 'b')).toBe('2');
    });

    it('should handle nested CaptureItems', () => {
      const ctx = createContext(defaultConfig);
      setPlaceholders(ctx, 'table', {
        nested: {
          value: 'nestedValue',
          sets: {},
        },
      });

      expect(getPlaceholder(ctx, 'table', 'nested')).toBe('nestedValue');
    });
  });

  describe('recursion tracking', () => {
    it('should increment and check depth', () => {
      const config = { ...defaultConfig, maxRecursionDepth: 3 };
      const ctx = createContext(config);

      expect(incrementRecursion(ctx)).toBe(true);
      expect(ctx.recursionDepth).toBe(1);

      expect(incrementRecursion(ctx)).toBe(true);
      expect(ctx.recursionDepth).toBe(2);

      expect(incrementRecursion(ctx)).toBe(true);
      expect(ctx.recursionDepth).toBe(3);

      // Should exceed limit
      expect(incrementRecursion(ctx)).toBe(false);
    });

    it('should decrement depth', () => {
      const ctx = createContext(defaultConfig);
      ctx.recursionDepth = 5;

      decrementRecursion(ctx);
      expect(ctx.recursionDepth).toBe(4);
    });

    it('should not go below zero', () => {
      const ctx = createContext(defaultConfig);
      decrementRecursion(ctx);
      expect(ctx.recursionDepth).toBe(0);
    });
  });

  describe('unique selection tracking', () => {
    it('should track used entries', () => {
      const ctx = createContext(defaultConfig);

      expect(isEntryUsed(ctx, 'table1', 'entry1')).toBe(false);

      markEntryUsed(ctx, 'table1', 'entry1');
      expect(isEntryUsed(ctx, 'table1', 'entry1')).toBe(true);
      expect(isEntryUsed(ctx, 'table1', 'entry2')).toBe(false);
    });

    it('should get set of used entries', () => {
      const ctx = createContext(defaultConfig);
      markEntryUsed(ctx, 'table1', 'entry1');
      markEntryUsed(ctx, 'table1', 'entry2');

      const used = getUsedEntries(ctx, 'table1');
      expect(used.size).toBe(2);
      expect(used.has('entry1')).toBe(true);
      expect(used.has('entry2')).toBe(true);
    });

    it('should clear used entries', () => {
      const ctx = createContext(defaultConfig);
      markEntryUsed(ctx, 'table1', 'entry1');
      clearUsedEntries(ctx, 'table1');

      expect(isEntryUsed(ctx, 'table1', 'entry1')).toBe(false);
    });

    it('should track entries per table independently', () => {
      const ctx = createContext(defaultConfig);
      markEntryUsed(ctx, 'table1', 'entry1');
      markEntryUsed(ctx, 'table2', 'entry1');

      expect(isEntryUsed(ctx, 'table1', 'entry1')).toBe(true);
      expect(isEntryUsed(ctx, 'table2', 'entry1')).toBe(true);

      clearUsedEntries(ctx, 'table1');
      expect(isEntryUsed(ctx, 'table1', 'entry1')).toBe(false);
      expect(isEntryUsed(ctx, 'table2', 'entry1')).toBe(true);
    });
  });

  describe('instance tracking', () => {
    it('should store and retrieve instances', () => {
      const ctx = createContext(defaultConfig);
      const result = {
        text: 'Hero Result',
        tableName: 'characters',
        tableId: 'char-table',
      };

      setInstance(ctx, 'hero', result);
      expect(getInstance(ctx, 'hero')).toBe(result);
    });

    it('should return undefined for missing instances', () => {
      const ctx = createContext(defaultConfig);
      expect(getInstance(ctx, 'missing')).toBeUndefined();
    });
  });

  describe('capture variables', () => {
    it('should set and get capture variables', () => {
      const ctx = createContext(defaultConfig);
      const captureVar = {
        items: [
          { value: 'item1', sets: {} },
          { value: 'item2', sets: {} },
        ],
      };

      setCaptureVariable(ctx, 'inventory', captureVar);
      expect(getCaptureVariable(ctx, 'inventory')).toBe(captureVar);
    });

    it('should return true when overwriting capture variable', () => {
      const ctx = createContext(defaultConfig);
      setCaptureVariable(ctx, 'var', { items: [] });

      expect(setCaptureVariable(ctx, 'var', { items: [] })).toBe(true);
    });

    it('should return false for new capture variable', () => {
      const ctx = createContext(defaultConfig);
      expect(setCaptureVariable(ctx, 'newVar', { items: [] })).toBe(false);
    });
  });

  describe('variable conflict detection', () => {
    it('should detect capture variable conflict', () => {
      const ctx = createContext(defaultConfig);
      setCaptureVariable(ctx, 'items', { items: [] });

      expect(hasVariableConflict(ctx, 'items')).toBe('capture');
    });

    it('should detect shared variable conflict', () => {
      const ctx = createContext(defaultConfig);
      setSharedVariable(ctx, 'hero', { value: 'test', sets: {} });

      expect(hasVariableConflict(ctx, 'hero')).toBe('shared');
    });

    it('should detect static variable conflict', () => {
      const staticVars = new Map([['count', '10']]);
      const ctx = createContext(defaultConfig, staticVars);

      expect(hasVariableConflict(ctx, 'count')).toBe('static');
    });

    it('should return null when no conflict', () => {
      const ctx = createContext(defaultConfig);
      expect(hasVariableConflict(ctx, 'unknown')).toBeNull();
    });

    it('should prioritize capture > shared > static', () => {
      const staticVars = new Map([['var', 'static']]);
      const ctx = createContext(defaultConfig, staticVars);
      setSharedVariable(ctx, 'var', { value: 'shared', sets: {} });
      setCaptureVariable(ctx, 'var', { items: [] });

      expect(hasVariableConflict(ctx, 'var')).toBe('capture');
    });
  });

  describe('current table state', () => {
    it('should set current table and entry', () => {
      const ctx = createContext(defaultConfig);
      setCurrentTable(ctx, 'tableId', 'entryId');

      expect(ctx.currentTableId).toBe('tableId');
      expect(ctx.currentEntryId).toBe('entryId');
    });
  });

  describe('description collection', () => {
    it('should add descriptions', () => {
      const ctx = createContext(defaultConfig);
      addDescription(ctx, 'Colors', 'colorTable', 'red', 'A warm color');

      expect(ctx.collectedDescriptions).toHaveLength(1);
      expect(ctx.collectedDescriptions[0].tableName).toBe('Colors');
      expect(ctx.collectedDescriptions[0].rolledValue).toBe('red');
      expect(ctx.collectedDescriptions[0].description).toBe('A warm color');
    });

    it('should track depth', () => {
      const ctx = createContext(defaultConfig);
      ctx.recursionDepth = 3;
      addDescription(ctx, 'Table', 'id', 'value', 'desc');

      expect(ctx.collectedDescriptions[0].depth).toBe(3);
    });

    it('should allow explicit depth', () => {
      const ctx = createContext(defaultConfig);
      addDescription(ctx, 'Table', 'id', 'value', 'desc', 5);

      expect(ctx.collectedDescriptions[0].depth).toBe(5);
    });
  });

  describe('set evaluation cycle detection', () => {
    it('should allow first evaluation', () => {
      const ctx = createContext(defaultConfig);
      expect(beginSetEvaluation(ctx, 'table.prop')).toBe(true);
    });

    it('should detect cycle on second evaluation', () => {
      const ctx = createContext(defaultConfig);
      beginSetEvaluation(ctx, 'table.prop');

      expect(beginSetEvaluation(ctx, 'table.prop')).toBe(false);
    });

    it('should allow re-evaluation after end', () => {
      const ctx = createContext(defaultConfig);
      beginSetEvaluation(ctx, 'table.prop');
      endSetEvaluation(ctx, 'table.prop');

      expect(beginSetEvaluation(ctx, 'table.prop')).toBe(true);
    });

    it('should track multiple keys independently', () => {
      const ctx = createContext(defaultConfig);
      beginSetEvaluation(ctx, 'table.propA');
      beginSetEvaluation(ctx, 'table.propB');

      expect(beginSetEvaluation(ctx, 'table.propA')).toBe(false);
      expect(beginSetEvaluation(ctx, 'table.propC')).toBe(true);
    });
  });
});
