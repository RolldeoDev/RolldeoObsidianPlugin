/**
 * Validator Tests
 *
 * Tests for document validation including schema validation,
 * metadata validation, table validation, and inheritance checks.
 */

import { describe, it, expect } from 'vitest'
import { validateDocument } from './validator'
import type { RandomTableDocument } from '../types'

// ============================================================================
// Helper Functions
// ============================================================================

function createValidDocument(overrides: Partial<RandomTableDocument> = {}): RandomTableDocument {
  return {
    metadata: {
      name: 'Test Document',
      namespace: 'test.namespace',
      version: '1.0.0',
      specVersion: '1.0',
    },
    tables: [
      {
        id: 'testTable',
        name: 'Test Table',
        type: 'simple',
        entries: [{ value: 'Entry 1' }],
      },
    ],
    ...overrides,
  }
}

// ============================================================================
// Metadata Validation Tests
// ============================================================================

describe('Validator - Metadata', () => {
  describe('name validation', () => {
    it('should require metadata name', () => {
      const doc = createValidDocument()
      doc.metadata.name = ''
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'MISSING_NAME')).toBe(true)
    })

    it('should reject whitespace-only name', () => {
      const doc = createValidDocument()
      doc.metadata.name = '   '
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'MISSING_NAME')).toBe(true)
    })

    it('should accept valid name', () => {
      const doc = createValidDocument()
      doc.metadata.name = 'My Valid Name'
      const result = validateDocument(doc)
      expect(result.errors.some((e) => e.code === 'MISSING_NAME')).toBe(false)
    })
  })

  describe('namespace validation', () => {
    it('should require namespace', () => {
      const doc = createValidDocument()
      // @ts-expect-error - Testing invalid input
      doc.metadata.namespace = undefined
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'MISSING_NAMESPACE')).toBe(true)
    })

    it('should reject invalid namespace format - starting with number', () => {
      const doc = createValidDocument()
      doc.metadata.namespace = '123invalid'
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_NAMESPACE')).toBe(true)
    })

    it('should reject invalid namespace format - special characters', () => {
      const doc = createValidDocument()
      doc.metadata.namespace = 'invalid-namespace'
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_NAMESPACE')).toBe(true)
    })

    it('should accept valid single-segment namespace', () => {
      const doc = createValidDocument()
      doc.metadata.namespace = 'fantasy'
      const result = validateDocument(doc)
      expect(result.errors.some((e) => e.code === 'INVALID_NAMESPACE')).toBe(false)
    })

    it('should accept valid multi-segment namespace', () => {
      const doc = createValidDocument()
      doc.metadata.namespace = 'fantasy.core.weapons'
      const result = validateDocument(doc)
      expect(result.errors.some((e) => e.code === 'INVALID_NAMESPACE')).toBe(false)
    })

    it('should accept namespace with underscores', () => {
      const doc = createValidDocument()
      doc.metadata.namespace = 'my_namespace.sub_space'
      const result = validateDocument(doc)
      expect(result.errors.some((e) => e.code === 'INVALID_NAMESPACE')).toBe(false)
    })
  })

  describe('version validation', () => {
    it('should require version', () => {
      const doc = createValidDocument()
      // @ts-expect-error - Testing invalid input
      doc.metadata.version = undefined
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'MISSING_VERSION')).toBe(true)
    })

    it('should warn on invalid version format', () => {
      const doc = createValidDocument()
      doc.metadata.version = 'v1.0'
      const result = validateDocument(doc)
      expect(result.warnings.some((e) => e.code === 'INVALID_VERSION')).toBe(true)
    })

    it('should accept valid semver version', () => {
      const doc = createValidDocument()
      doc.metadata.version = '1.2.3'
      const result = validateDocument(doc)
      expect(result.issues.some((e) => e.code === 'INVALID_VERSION')).toBe(false)
    })

    it('should accept semver with prerelease', () => {
      const doc = createValidDocument()
      doc.metadata.version = '1.0.0-beta.1'
      const result = validateDocument(doc)
      expect(result.issues.some((e) => e.code === 'INVALID_VERSION')).toBe(false)
    })

    it('should accept semver with build metadata', () => {
      const doc = createValidDocument()
      doc.metadata.version = '1.0.0+build.123'
      const result = validateDocument(doc)
      expect(result.issues.some((e) => e.code === 'INVALID_VERSION')).toBe(false)
    })
  })

  describe('specVersion validation', () => {
    it('should reject invalid spec version', () => {
      const doc = createValidDocument()
      // @ts-expect-error - Testing invalid input
      doc.metadata.specVersion = '2.0'
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_SPEC_VERSION')).toBe(true)
    })

    it('should accept valid spec version 1.0', () => {
      const doc = createValidDocument()
      doc.metadata.specVersion = '1.0'
      const result = validateDocument(doc)
      expect(result.errors.some((e) => e.code === 'INVALID_SPEC_VERSION')).toBe(false)
    })
  })

  describe('configuration validation', () => {
    it('should reject maxRecursionDepth less than 1', () => {
      const doc = createValidDocument()
      doc.metadata.maxRecursionDepth = 0
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_CONFIG')).toBe(true)
    })

    it('should reject maxExplodingDice less than 1', () => {
      const doc = createValidDocument()
      doc.metadata.maxExplodingDice = 0
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_CONFIG')).toBe(true)
    })

    it('should reject maxInheritanceDepth less than 1', () => {
      const doc = createValidDocument()
      doc.metadata.maxInheritanceDepth = 0
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_CONFIG')).toBe(true)
    })

    it('should accept valid configuration values', () => {
      const doc = createValidDocument()
      doc.metadata.maxRecursionDepth = 50
      doc.metadata.maxExplodingDice = 100
      doc.metadata.maxInheritanceDepth = 10
      const result = validateDocument(doc)
      expect(result.errors.some((e) => e.code === 'INVALID_CONFIG')).toBe(false)
    })
  })
})

// ============================================================================
// Table Validation Tests
// ============================================================================

describe('Validator - Tables', () => {
  describe('table ID validation', () => {
    it('should require table ID', () => {
      const doc = createValidDocument()
      doc.tables[0].id = ''
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'MISSING_ID')).toBe(true)
    })

    it('should reject ID containing periods', () => {
      const doc = createValidDocument()
      doc.tables[0].id = 'table.with.dots'
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_ID')).toBe(true)
    })

    it('should reject ID starting with number', () => {
      const doc = createValidDocument()
      doc.tables[0].id = '123table'
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_ID')).toBe(true)
    })

    it('should reject reserved word as ID', () => {
      const doc = createValidDocument()
      doc.tables[0].id = 'dice'
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'RESERVED_WORD')).toBe(true)
    })

    it('should accept valid camelCase ID', () => {
      const doc = createValidDocument()
      doc.tables[0].id = 'myTableName'
      const result = validateDocument(doc)
      expect(result.errors.some((e) => e.code === 'INVALID_ID' && e.path?.includes('myTableName'))).toBe(false)
    })

    it('should accept valid snake_case ID', () => {
      const doc = createValidDocument()
      doc.tables[0].id = 'my_table_name'
      const result = validateDocument(doc)
      expect(result.errors.some((e) => e.code === 'INVALID_ID')).toBe(false)
    })
  })

  describe('table name validation', () => {
    it('should require table name', () => {
      const doc = createValidDocument()
      doc.tables[0].name = ''
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'MISSING_TABLE_NAME')).toBe(true)
    })
  })

  describe('simple table validation', () => {
    it('should require at least one entry', () => {
      const doc = createValidDocument()
      ;(doc.tables[0] as any).entries = []
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'EMPTY_ENTRIES')).toBe(true)
    })

    it('should reject negative weight', () => {
      const doc = createValidDocument()
      ;(doc.tables[0] as any).entries = [{ value: 'Test', weight: -1 }]
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_WEIGHT')).toBe(true)
    })

    it('should reject entry with both weight and range', () => {
      const doc = createValidDocument()
      ;(doc.tables[0] as any).entries = [{ value: 'Test', weight: 1, range: [1, 5] }]
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'WEIGHT_RANGE_CONFLICT')).toBe(true)
    })

    it('should reject invalid range format', () => {
      const doc = createValidDocument()
      ;(doc.tables[0] as any).entries = [{ value: 'Test', range: [1] }]
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_RANGE')).toBe(true)
    })

    it('should reject range where min exceeds max', () => {
      const doc = createValidDocument()
      ;(doc.tables[0] as any).entries = [{ value: 'Test', range: [10, 5] }]
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_RANGE')).toBe(true)
    })

    it('should accept valid range', () => {
      const doc = createValidDocument()
      ;(doc.tables[0] as any).entries = [{ value: 'Test', range: [1, 10] }]
      const result = validateDocument(doc)
      expect(result.errors.some((e) => e.code === 'INVALID_RANGE')).toBe(false)
    })

    it('should reject duplicate entry IDs', () => {
      const doc = createValidDocument()
      ;(doc.tables[0] as any).entries = [
        { id: 'entry1', value: 'Entry 1' },
        { id: 'entry1', value: 'Entry 2' },
      ]
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'DUPLICATE_ENTRY_ID')).toBe(true)
    })

    it('should reject table with all zero-weight entries', () => {
      const doc = createValidDocument()
      ;(doc.tables[0] as any).entries = [
        { value: 'Entry 1', weight: 0 },
        { value: 'Entry 2', weight: 0 },
      ]
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'NO_ACTIVE_ENTRIES')).toBe(true)
    })

    it('should require entry value', () => {
      const doc = createValidDocument()
      ;(doc.tables[0] as any).entries = [{ weight: 1 }]
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'MISSING_VALUE')).toBe(true)
    })

    it('should allow empty string value', () => {
      const doc = createValidDocument()
      ;(doc.tables[0] as any).entries = [{ value: '' }]
      const result = validateDocument(doc)
      expect(result.errors.some((e) => e.code === 'MISSING_VALUE')).toBe(false)
    })
  })

  describe('composite table validation', () => {
    it('should require at least one source', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'composite',
            name: 'Composite Table',
            type: 'composite',
            sources: [],
          },
        ],
      })
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'EMPTY_SOURCES')).toBe(true)
    })

    it('should reject reference to unknown table', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'composite',
            name: 'Composite Table',
            type: 'composite',
            sources: [{ tableId: 'nonexistent' }],
          },
        ],
      })
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_SOURCE')).toBe(true)
    })

    it('should reject negative source weight', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'source1',
            name: 'Source',
            type: 'simple',
            entries: [{ value: 'Entry' }],
          },
          {
            id: 'composite',
            name: 'Composite',
            type: 'composite',
            sources: [{ tableId: 'source1', weight: -5 }],
          },
        ],
      })
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_WEIGHT')).toBe(true)
    })

    it('should accept valid composite table', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'source1',
            name: 'Source 1',
            type: 'simple',
            entries: [{ value: 'Entry' }],
          },
          {
            id: 'composite',
            name: 'Composite',
            type: 'composite',
            sources: [{ tableId: 'source1', weight: 10 }],
          },
        ],
      })
      const result = validateDocument(doc)
      expect(result.valid).toBe(true)
    })
  })

  describe('collection table validation', () => {
    it('should require at least one collection', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'collection',
            name: 'Collection Table',
            type: 'collection',
            collections: [],
          },
        ],
      })
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'EMPTY_COLLECTIONS')).toBe(true)
    })

    it('should reject reference to unknown table', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'collection',
            name: 'Collection Table',
            type: 'collection',
            collections: ['nonexistent'],
          },
        ],
      })
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_COLLECTION')).toBe(true)
    })

    it('should accept valid collection table', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'source1',
            name: 'Source 1',
            type: 'simple',
            entries: [{ value: 'Entry' }],
          },
          {
            id: 'collection',
            name: 'Collection',
            type: 'collection',
            collections: ['source1'],
          },
        ],
      })
      const result = validateDocument(doc)
      expect(result.valid).toBe(true)
    })
  })

  describe('extends validation', () => {
    it('should reject extends to unknown table', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'child',
            name: 'Child Table',
            type: 'simple',
            extends: 'nonexistent',
            entries: [{ id: 'entry1', value: 'Override', weight: 2 }],
          },
        ],
      })
      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_EXTENDS')).toBe(true)
    })

    it('should accept extends to known table', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'parent',
            name: 'Parent',
            type: 'simple',
            entries: [{ id: 'entry1', value: 'Original' }],
          },
          {
            id: 'child',
            name: 'Child',
            type: 'simple',
            extends: 'parent',
            entries: [{ id: 'entry1', value: 'Override', weight: 2 }],
          },
        ],
      })
      const result = validateDocument(doc)
      expect(result.errors.some((e) => e.code === 'INVALID_EXTENDS')).toBe(false)
    })

    it('should allow aliased extends reference', () => {
      const doc = createValidDocument({
        tables: [
          {
            id: 'child',
            name: 'Child',
            type: 'simple',
            extends: 'otherCollection.parentTable',
            entries: [{ id: 'entry1', value: 'Override', weight: 2 }],
          },
        ],
      })
      const result = validateDocument(doc)
      // Should not error - aliased references are validated at runtime
      expect(result.errors.some((e) => e.code === 'INVALID_EXTENDS')).toBe(false)
    })
  })
})

// ============================================================================
// Template Validation Tests
// ============================================================================

describe('Validator - Templates', () => {
  it('should require template ID', () => {
    const doc = createValidDocument({
      templates: [
        {
          id: '',
          name: 'Test Template',
          pattern: 'Hello {{world}}',
        },
      ],
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'MISSING_ID')).toBe(true)
  })

  it('should require template name', () => {
    const doc = createValidDocument({
      templates: [
        {
          id: 'testTemplate',
          name: '',
          pattern: 'Hello {{world}}',
        },
      ],
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'MISSING_TEMPLATE_NAME')).toBe(true)
  })

  it('should require template pattern', () => {
    const doc = createValidDocument({
      templates: [
        {
          id: 'testTemplate',
          name: 'Test Template',
          // @ts-expect-error - Testing invalid input
          pattern: undefined,
        },
      ],
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'MISSING_PATTERN')).toBe(true)
  })

  it('should allow empty string pattern', () => {
    const doc = createValidDocument({
      templates: [
        {
          id: 'testTemplate',
          name: 'Test Template',
          pattern: '',
        },
      ],
    })
    const result = validateDocument(doc)
    expect(result.errors.some((e) => e.code === 'MISSING_PATTERN')).toBe(false)
  })

  it('should validate template shared variables', () => {
    const doc = createValidDocument({
      templates: [
        {
          id: 'testTemplate',
          name: 'Test Template',
          pattern: 'Hello',
          shared: {
            '123invalid': 'value',
          },
        },
      ],
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'INVALID_VARIABLE_NAME')).toBe(true)
  })

  it('should accept valid template', () => {
    const doc = createValidDocument({
      templates: [
        {
          id: 'testTemplate',
          name: 'Test Template',
          pattern: 'Hello {{tableName}}',
          shared: {
            validVar: 'value',
          },
        },
      ],
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(true)
  })
})

// ============================================================================
// Variable Validation Tests
// ============================================================================

describe('Validator - Variables', () => {
  it('should reject invalid variable name starting with number', () => {
    const doc = createValidDocument({
      variables: {
        '123invalid': 'value',
      },
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'INVALID_VARIABLE_NAME')).toBe(true)
  })

  it('should reject reserved word as variable name', () => {
    const doc = createValidDocument({
      variables: {
        dice: 'value',
      },
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'RESERVED_WORD')).toBe(true)
  })

  it('should accept $ prefixed variable names', () => {
    const doc = createValidDocument({
      variables: {
        $myVar: 'value',
      },
    })
    const result = validateDocument(doc)
    expect(result.errors.some((e) => e.code === 'INVALID_VARIABLE_NAME')).toBe(false)
  })

  it('should reject reserved word even with $ prefix', () => {
    const doc = createValidDocument({
      variables: {
        $dice: 'value',
      },
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'RESERVED_WORD')).toBe(true)
  })

  it('should accept valid shared variables', () => {
    const doc = createValidDocument({
      shared: {
        _init: '{{someTable}}',
        heroName: 'Default',
      },
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(true)
  })
})

// ============================================================================
// Inheritance Validation Tests
// ============================================================================

describe('Validator - Inheritance', () => {
  it('should detect direct circular inheritance', () => {
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
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'CIRCULAR_INHERITANCE')).toBe(true)
  })

  it('should detect self-referencing inheritance', () => {
    const doc = createValidDocument({
      tables: [
        {
          id: 'tableA',
          name: 'Table A',
          type: 'simple',
          extends: 'tableA',
          entries: [{ value: 'A' }],
        },
      ],
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'CIRCULAR_INHERITANCE')).toBe(true)
  })

  it('should detect transitive circular inheritance', () => {
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
          extends: 'tableC',
          entries: [{ value: 'B' }],
        },
        {
          id: 'tableC',
          name: 'Table C',
          type: 'simple',
          extends: 'tableA',
          entries: [{ value: 'C' }],
        },
      ],
    })
    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'CIRCULAR_INHERITANCE')).toBe(true)
  })

  it('should accept valid linear inheritance', () => {
    const doc = createValidDocument({
      tables: [
        {
          id: 'grandparent',
          name: 'Grandparent',
          type: 'simple',
          entries: [{ id: 'entry1', value: 'Original' }],
        },
        {
          id: 'parent',
          name: 'Parent',
          type: 'simple',
          extends: 'grandparent',
          entries: [{ id: 'entry1', value: 'Parent Value', weight: 2 }],
        },
        {
          id: 'child',
          name: 'Child',
          type: 'simple',
          extends: 'parent',
          entries: [{ id: 'entry1', value: 'Child Value', weight: 3 }],
        },
      ],
    })
    const result = validateDocument(doc)
    expect(result.errors.some((e) => e.code === 'CIRCULAR_INHERITANCE')).toBe(false)
  })
})

// ============================================================================
// ID Collision Tests
// ============================================================================

describe('Validator - ID Collisions', () => {
  it('should warn when table and template share same ID', () => {
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
          pattern: 'Hello',
        },
      ],
    })
    const result = validateDocument(doc)
    expect(result.warnings.some((e) => e.code === 'ID_COLLISION')).toBe(true)
  })

  it('should not warn when IDs are unique', () => {
    const doc = createValidDocument({
      tables: [
        {
          id: 'tableId',
          name: 'Table',
          type: 'simple',
          entries: [{ value: 'Entry' }],
        },
      ],
      templates: [
        {
          id: 'templateId',
          name: 'Template',
          pattern: 'Hello',
        },
      ],
    })
    const result = validateDocument(doc)
    expect(result.warnings.some((e) => e.code === 'ID_COLLISION')).toBe(false)
  })
})

// ============================================================================
// Full Document Validation Tests
// ============================================================================

describe('Validator - Full Document', () => {
  it('should validate a complete valid document', () => {
    const doc: RandomTableDocument = {
      metadata: {
        name: 'Complete Test',
        namespace: 'test.complete',
        version: '1.0.0',
        specVersion: '1.0',
        author: 'Test Author',
        description: 'A complete test document',
        maxRecursionDepth: 50,
      },
      variables: {
        level: '5',
      },
      shared: {
        _init: '{{race}}',
      },
      tables: [
        {
          id: 'race',
          name: 'Race',
          type: 'simple',
          entries: [
            { id: 'human', value: 'Human' },
            { id: 'elf', value: 'Elf', weight: 2 },
            { value: 'Dwarf', range: [1, 3] },
          ],
        },
        {
          id: 'raceVariant',
          name: 'Race Variant',
          type: 'simple',
          extends: 'race',
          entries: [{ id: 'human', value: 'Human Variant', weight: 3 }],
        },
      ],
      templates: [
        {
          id: 'character',
          name: 'Character',
          pattern: 'A {{race}} adventurer',
          shared: {
            _raceInit: '{{race}}',
          },
        },
      ],
    }

    const result = validateDocument(doc)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should collect multiple errors from invalid document', () => {
    const doc = createValidDocument({
      metadata: {
        name: '',
        namespace: '123invalid',
        version: '',
        // @ts-expect-error - Testing invalid input
        specVersion: '2.0',
      },
      tables: [
        {
          id: '',
          name: '',
          type: 'simple',
          entries: [],
        },
      ],
    })

    const result = validateDocument(doc)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(4) // Multiple errors expected
  })
})
