/**
 * Tests for the Document Validator
 */

import { validateDocument } from '../engine/core/validator';
import type { RandomTableDocument } from '../engine/types';

// Helper to create a minimal valid document
function createValidDocument(overrides: Partial<RandomTableDocument> = {}): RandomTableDocument {
  return {
    metadata: {
      name: 'Test Collection',
      namespace: 'test.collection',
      version: '1.0.0',
      specVersion: '1.0',
      ...overrides.metadata,
    },
    tables: overrides.tables ?? [
      {
        id: 'testTable',
        name: 'Test Table',
        type: 'simple',
        entries: [{ value: 'Entry 1' }],
      },
    ],
    templates: overrides.templates,
    variables: overrides.variables,
    shared: overrides.shared,
  };
}

describe('Validator', () => {
  describe('metadata validation', () => {
    it('should validate a complete document', () => {
      const doc = createValidDocument();
      const result = validateDocument(doc);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error on missing name', () => {
      const doc = createValidDocument({
        metadata: {
          name: '',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MISSING_NAME')).toBe(true);
    });

    it('should error on missing namespace', () => {
      const doc = createValidDocument({
        metadata: {
          name: 'Test',
          namespace: '',
          version: '1.0.0',
          specVersion: '1.0',
        },
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MISSING_NAMESPACE')).toBe(true);
    });

    it('should error on invalid namespace format', () => {
      const doc = createValidDocument({
        metadata: {
          name: 'Test',
          namespace: '123invalid',
          version: '1.0.0',
          specVersion: '1.0',
        },
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_NAMESPACE')).toBe(true);
    });

    it('should error on missing version', () => {
      const doc = createValidDocument({
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '',
          specVersion: '1.0',
        },
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MISSING_VERSION')).toBe(true);
    });

    it('should warn on non-semver version', () => {
      const doc = createValidDocument({
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: 'v1',
          specVersion: '1.0',
        },
      });
      const result = validateDocument(doc);
      expect(result.warnings.some((w) => w.code === 'INVALID_VERSION')).toBe(true);
    });

    it('should error on unsupported spec version', () => {
      const doc = createValidDocument({
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '2.0' as '1.0',
        },
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_SPEC_VERSION')).toBe(true);
    });

    it('should error on invalid maxRecursionDepth', () => {
      const doc = createValidDocument({
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
          maxRecursionDepth: 0,
        },
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_CONFIG')).toBe(true);
    });
  });

  describe('table validation', () => {
    it('should error on missing table ID', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: '',
            name: 'Test',
            type: 'simple',
            entries: [{ value: 'Entry' }],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_IDENTIFIER' || e.code === 'EMPTY_IDENTIFIER')).toBe(true);
    });

    it('should error on missing table name', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'testTable',
            name: '',
            type: 'simple',
            entries: [{ value: 'Entry' }],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MISSING_TABLE_NAME')).toBe(true);
    });

    it('should error on reserved word as ID', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'dice',
            name: 'Test',
            type: 'simple',
            entries: [{ value: 'Entry' }],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'RESERVED_WORD')).toBe(true);
    });

    it('should error on empty entries in simple table', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'testTable',
            name: 'Test',
            type: 'simple',
            entries: [],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'EMPTY_ENTRIES')).toBe(true);
    });

    it('should error on invalid extends reference', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'childTable',
            name: 'Child',
            type: 'simple',
            extends: 'nonExistent',
            entries: [{ value: 'Entry' }],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_EXTENDS')).toBe(true);
    });

    it('should validate valid extends reference', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'parentTable',
            name: 'Parent',
            type: 'simple',
            entries: [{ value: 'Parent Entry' }],
          },
          {
            id: 'childTable',
            name: 'Child',
            type: 'simple',
            extends: 'parentTable',
            entries: [{ value: 'Child Entry' }],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(true);
    });
  });

  describe('simple table entry validation', () => {
    it('should error on entry without value when not extending', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'testTable',
            name: 'Test',
            type: 'simple',
            // @ts-expect-error - testing invalid input
            entries: [{ weight: 1 }], // no value
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MISSING_VALUE')).toBe(true);
    });

    it('should error on negative entry weight', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'testTable',
            name: 'Test',
            type: 'simple',
            entries: [{ value: 'Entry', weight: -1 }],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_WEIGHT')).toBe(true);
    });

    it('should error on duplicate entry IDs', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'testTable',
            name: 'Test',
            type: 'simple',
            entries: [
              { id: 'entry1', value: 'First' },
              { id: 'entry1', value: 'Duplicate' },
            ],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.errors.some((e) => e.code === 'DUPLICATE_ENTRY_ID')).toBe(true);
    });
  });

  describe('composite table validation', () => {
    it('should error on composite table without sources', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'compositeTable',
            name: 'Composite',
            type: 'composite',
            sources: [],
            pattern: '{{segment}}',
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'EMPTY_SOURCES' || e.code === 'EMPTY_SEGMENTS')).toBe(true);
    });

    it('should error on composite table without pattern', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'compositeTable',
            name: 'Composite',
            type: 'composite',
            sources: [
              {
                name: 'seg1',
                entries: [{ value: 'Entry' }],
              },
            ],
            pattern: '',
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MISSING_PATTERN')).toBe(true);
    });

    it('should validate valid composite table', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'compositeTable',
            name: 'Composite',
            type: 'composite',
            sources: [
              {
                name: 'color',
                entries: [{ value: 'Red' }],
              },
              {
                name: 'item',
                entries: [{ value: 'Apple' }],
              },
            ],
            pattern: '{{@color}} {{@item}}',
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(true);
    });
  });

  describe('collection table validation', () => {
    it('should error on collection table without items', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'collectionTable',
            name: 'Collection',
            type: 'collection',
            items: [],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'EMPTY_ITEMS')).toBe(true);
    });

    it('should error on invalid table reference in collection', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'collectionTable',
            name: 'Collection',
            type: 'collection',
            items: [{ table: 'nonExistent' }],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_TABLE_REF')).toBe(true);
    });

    it('should validate valid collection table', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'simpleTable',
            name: 'Simple',
            type: 'simple',
            entries: [{ value: 'Entry' }],
          },
          {
            id: 'collectionTable',
            name: 'Collection',
            type: 'collection',
            items: [{ table: 'simpleTable' }],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(true);
    });
  });

  describe('template validation', () => {
    it('should error on template without pattern', () => {
      const doc = createValidDocument({
        templates: [
          {
            id: 'testTemplate',
            name: 'Test Template',
            pattern: '',
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MISSING_PATTERN')).toBe(true);
    });

    it('should validate valid template', () => {
      const doc = createValidDocument({
        templates: [
          {
            id: 'testTemplate',
            name: 'Test Template',
            pattern: 'Hello {{testTable}}!',
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(true);
    });

    it('should warn on table/template ID collision', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'sharedId',
            name: 'Table',
            type: 'simple',
            entries: [{ value: 'Entry' }],
          },
        ],
        templates: [
          {
            id: 'sharedId',
            name: 'Template',
            pattern: 'Pattern',
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.warnings.some((w) => w.code === 'ID_COLLISION')).toBe(true);
    });
  });

  describe('variable validation', () => {
    it('should validate valid variables', () => {
      const doc = createValidDocument({
        variables: {
          count: '10',
          name: 'Test',
        },
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(true);
    });

    it('should error on invalid variable name', () => {
      const doc = createValidDocument({
        variables: {
          '123invalid': 'value',
        },
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_IDENTIFIER')).toBe(true);
    });

    it('should error on reserved word as variable', () => {
      const doc = createValidDocument({
        variables: {
          dice: 'value',
        },
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'RESERVED_WORD')).toBe(true);
    });

    it('should allow $ prefix in variable names', () => {
      const doc = createValidDocument({
        variables: {
          $count: '10',
        },
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(true);
    });
  });

  describe('circular inheritance', () => {
    it('should error on direct circular inheritance', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'tableA',
            name: 'Table A',
            type: 'simple',
            extends: 'tableB',
            entries: [{ value: 'A' }],
          },
          {
            id: 'tableB',
            name: 'Table B',
            type: 'simple',
            extends: 'tableA',
            entries: [{ value: 'B' }],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'CIRCULAR_INHERITANCE')).toBe(true);
    });

    it('should error on self-referencing inheritance', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'selfRef',
            name: 'Self Ref',
            type: 'simple',
            extends: 'selfRef',
            entries: [{ value: 'Entry' }],
          },
        ],
      });
      const result = validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'CIRCULAR_INHERITANCE')).toBe(true);
    });
  });

  describe('validation result structure', () => {
    it('should return proper result structure', () => {
      const doc = createValidDocument();
      const result = validateDocument(doc);

      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(Array.isArray(result.issues)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should include path in issues', () => {
      const doc = createValidDocument({
        metadata: {
          name: '',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
      });
      const result = validateDocument(doc);
      const nameError = result.errors.find((e) => e.code === 'MISSING_NAME');
      expect(nameError?.path).toBe('metadata.name');
    });

    it('should include suggestion when available', () => {
      const doc = createValidDocument({
        metadata: {
          name: 'Test',
          namespace: 'invalid-namespace',
          version: '1.0.0',
          specVersion: '1.0',
        },
      });
      const result = validateDocument(doc);
      const nsError = result.errors.find((e) => e.code === 'INVALID_NAMESPACE');
      expect(nsError?.suggestion).toBeDefined();
    });
  });
});
