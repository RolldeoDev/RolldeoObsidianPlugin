/**
 * Document Validator
 *
 * Validates RandomTableDocument structure and references.
 * Performs both schema validation and semantic validation.
 */

import type {
  RandomTableDocument,
  Table,
  SimpleTable,
  CompositeTable,
  CollectionTable,
  Template,
} from '../types'

// ============================================================================
// Types
// ============================================================================

export type ValidationSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  severity: ValidationSeverity
  code: string
  message: string
  path?: string // JSON path to the problematic element
  suggestion?: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

// ============================================================================
// Reserved Words
// ============================================================================

const RESERVED_WORDS = new Set([
  'dice',
  'unique',
  'again',
  'true',
  'false',
  'null',
  'and',
  'or',
  'not',
  'contains',
  'matches',
  'shared',
  'math',
])

// ============================================================================
// Patterns
// ============================================================================

const NAMESPACE_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/
const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/
// Variable names can optionally start with $ for context-sensitive variables
const VARIABLE_NAME_PATTERN = /^\$?[a-zA-Z_][a-zA-Z0-9_]*$/

// ============================================================================
// Main Validator
// ============================================================================

/**
 * Validate a RandomTableDocument
 */
export function validateDocument(doc: RandomTableDocument): ValidationResult {
  const issues: ValidationIssue[] = []

  // Validate metadata
  validateMetadata(doc, issues)

  // Build table registry for reference checking
  const tableIds = new Set<string>()
  const templateIds = new Set<string>()

  for (const table of doc.tables) {
    tableIds.add(table.id)
  }

  for (const template of doc.templates ?? []) {
    templateIds.add(template.id)
  }

  // Validate tables
  for (let i = 0; i < doc.tables.length; i++) {
    validateTable(doc.tables[i], `tables[${i}]`, tableIds, issues)
  }

  // Validate templates
  for (let i = 0; i < (doc.templates ?? []).length; i++) {
    validateTemplate(doc.templates![i], `templates[${i}]`, tableIds, issues)
  }

  // Validate variables
  if (doc.variables) {
    validateVariables(doc.variables, 'variables', issues)
  }

  // Validate shared
  if (doc.shared) {
    validateVariables(doc.shared, 'shared', issues)
  }

  // Check for ID collisions between tables and templates
  for (const tableId of tableIds) {
    if (templateIds.has(tableId)) {
      issues.push({
        severity: 'warning',
        code: 'ID_COLLISION',
        message: `Table and template share the same ID: ${tableId}`,
        suggestion: 'Consider using unique IDs to avoid confusion',
      })
    }
  }

  // Check for circular inheritance
  validateInheritance(doc.tables, issues)

  // Separate errors and warnings
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
  }
}

// ============================================================================
// Metadata Validation
// ============================================================================

function validateMetadata(doc: RandomTableDocument, issues: ValidationIssue[]): void {
  const meta = doc.metadata

  // Required fields
  if (!meta.name || meta.name.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'MISSING_NAME',
      message: 'Metadata name is required',
      path: 'metadata.name',
    })
  }

  if (!meta.namespace) {
    issues.push({
      severity: 'error',
      code: 'MISSING_NAMESPACE',
      message: 'Metadata namespace is required',
      path: 'metadata.namespace',
    })
  } else if (!NAMESPACE_PATTERN.test(meta.namespace)) {
    issues.push({
      severity: 'error',
      code: 'INVALID_NAMESPACE',
      message: `Invalid namespace format: ${meta.namespace}`,
      path: 'metadata.namespace',
      suggestion: 'Use dot-separated segments (e.g., "fantasy.core")',
    })
  }

  if (!meta.version) {
    issues.push({
      severity: 'error',
      code: 'MISSING_VERSION',
      message: 'Metadata version is required',
      path: 'metadata.version',
    })
  } else if (!VERSION_PATTERN.test(meta.version)) {
    issues.push({
      severity: 'warning',
      code: 'INVALID_VERSION',
      message: `Version should follow semver format: ${meta.version}`,
      path: 'metadata.version',
      suggestion: 'Use semantic versioning (e.g., "1.0.0")',
    })
  }

  if (meta.specVersion !== '1.0') {
    issues.push({
      severity: 'error',
      code: 'INVALID_SPEC_VERSION',
      message: `Unsupported spec version: ${meta.specVersion}`,
      path: 'metadata.specVersion',
      suggestion: 'Use specVersion "1.0"',
    })
  }

  // Optional field validation
  if (meta.maxRecursionDepth !== undefined && meta.maxRecursionDepth < 1) {
    issues.push({
      severity: 'error',
      code: 'INVALID_CONFIG',
      message: 'maxRecursionDepth must be at least 1',
      path: 'metadata.maxRecursionDepth',
    })
  }

  if (meta.maxExplodingDice !== undefined && meta.maxExplodingDice < 1) {
    issues.push({
      severity: 'error',
      code: 'INVALID_CONFIG',
      message: 'maxExplodingDice must be at least 1',
      path: 'metadata.maxExplodingDice',
    })
  }

  if (meta.maxInheritanceDepth !== undefined && meta.maxInheritanceDepth < 1) {
    issues.push({
      severity: 'error',
      code: 'INVALID_CONFIG',
      message: 'maxInheritanceDepth must be at least 1',
      path: 'metadata.maxInheritanceDepth',
    })
  }
}

// ============================================================================
// Table Validation
// ============================================================================

function validateTable(
  table: Table,
  path: string,
  tableIds: Set<string>,
  issues: ValidationIssue[]
): void {
  // Validate ID
  validateIdentifier(table.id, `${path}.id`, 'Table', issues)

  // Validate name
  if (!table.name || table.name.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'MISSING_TABLE_NAME',
      message: 'Table name is required',
      path: `${path}.name`,
    })
  }

  // Validate extends reference
  if (table.extends) {
    const extendsId = table.extends.split('.').pop() // Handle alias.tableId
    if (extendsId && !tableIds.has(extendsId) && !table.extends.includes('.')) {
      issues.push({
        severity: 'error',
        code: 'INVALID_EXTENDS',
        message: `Extends references unknown table: ${table.extends}`,
        path: `${path}.extends`,
      })
    }
  }

  // Type-specific validation
  if (table.type === 'simple') {
    validateSimpleTable(table as SimpleTable, path, issues)
  } else if (table.type === 'composite') {
    validateCompositeTable(table as CompositeTable, path, tableIds, issues)
  } else if (table.type === 'collection') {
    validateCollectionTable(table as CollectionTable, path, tableIds, issues)
  }

  // Validate table-level shared variables
  if (table.shared) {
    validateVariables(table.shared, `${path}.shared`, issues)
  }
}

function validateSimpleTable(
  table: SimpleTable,
  path: string,
  issues: ValidationIssue[]
): void {
  if (!table.entries || table.entries.length === 0) {
    issues.push({
      severity: 'error',
      code: 'EMPTY_ENTRIES',
      message: 'Simple table must have at least one entry',
      path: `${path}.entries`,
    })
    return
  }

  const entryIds = new Set<string>()

  for (let i = 0; i < table.entries.length; i++) {
    const entry = table.entries[i]
    const entryPath = `${path}.entries[${i}]`

    // Check for duplicate entry IDs
    if (entry.id) {
      if (entryIds.has(entry.id)) {
        issues.push({
          severity: 'error',
          code: 'DUPLICATE_ENTRY_ID',
          message: `Duplicate entry ID: ${entry.id}`,
          path: `${entryPath}.id`,
        })
      }
      entryIds.add(entry.id)

      // Validate entry ID format
      validateIdentifier(entry.id, `${entryPath}.id`, 'Entry', issues)
    }

    // Check for both weight and range
    if (entry.weight !== undefined && entry.range !== undefined) {
      issues.push({
        severity: 'error',
        code: 'WEIGHT_RANGE_CONFLICT',
        message: 'Entry cannot have both weight and range',
        path: entryPath,
        suggestion: 'Use either weight or range, not both',
      })
    }

    // Validate weight
    if (entry.weight !== undefined && entry.weight < 0) {
      issues.push({
        severity: 'error',
        code: 'INVALID_WEIGHT',
        message: `Entry weight cannot be negative: ${entry.weight}`,
        path: `${entryPath}.weight`,
      })
    }

    // Validate range
    if (entry.range) {
      if (entry.range.length !== 2) {
        issues.push({
          severity: 'error',
          code: 'INVALID_RANGE',
          message: 'Range must be a two-element array [min, max]',
          path: `${entryPath}.range`,
        })
      } else if (entry.range[0] > entry.range[1]) {
        issues.push({
          severity: 'error',
          code: 'INVALID_RANGE',
          message: `Range min (${entry.range[0]}) cannot exceed max (${entry.range[1]})`,
          path: `${entryPath}.range`,
        })
      }
    }

    // Validate value
    // Value is required UNLESS the table extends another and this entry has an ID
    // (which means it's overriding an inherited entry's weight/tags without changing value)
    const isInheritedOverride = table.extends && entry.id
    if (!entry.value && entry.value !== '' && !isInheritedOverride) {
      issues.push({
        severity: 'error',
        code: 'MISSING_VALUE',
        message: 'Entry value is required',
        path: `${entryPath}.value`,
      })
    }
  }

  // Check if all entries are disabled
  // Skip this check if the table extends another - the parent table may provide
  // active entries that aren't visible in the child's override list
  if (!table.extends) {
    const hasActiveEntries = table.entries.some((e) => {
      const weight = e.range ? e.range[1] - e.range[0] + 1 : (e.weight ?? 1)
      return weight > 0
    })

    if (!hasActiveEntries) {
      issues.push({
        severity: 'error',
        code: 'NO_ACTIVE_ENTRIES',
        message: 'Table has no entries with positive weight',
        path: `${path}.entries`,
      })
    }
  }
}

function validateCompositeTable(
  table: CompositeTable,
  path: string,
  tableIds: Set<string>,
  issues: ValidationIssue[]
): void {
  if (!table.sources || table.sources.length === 0) {
    issues.push({
      severity: 'error',
      code: 'EMPTY_SOURCES',
      message: 'Composite table must have at least one source',
      path: `${path}.sources`,
    })
    return
  }

  for (let i = 0; i < table.sources.length; i++) {
    const source = table.sources[i]
    const sourcePath = `${path}.sources[${i}]`

    // Check if source table exists (local reference only)
    const sourceId = source.tableId.split('.').pop()
    if (sourceId && !tableIds.has(sourceId) && !source.tableId.includes('.')) {
      issues.push({
        severity: 'error',
        code: 'INVALID_SOURCE',
        message: `Source references unknown table: ${source.tableId}`,
        path: `${sourcePath}.tableId`,
      })
    }

    // Validate weight
    if (source.weight !== undefined && source.weight < 0) {
      issues.push({
        severity: 'error',
        code: 'INVALID_WEIGHT',
        message: `Source weight cannot be negative: ${source.weight}`,
        path: `${sourcePath}.weight`,
      })
    }
  }
}

function validateCollectionTable(
  table: CollectionTable,
  path: string,
  tableIds: Set<string>,
  issues: ValidationIssue[]
): void {
  if (!table.collections || table.collections.length === 0) {
    issues.push({
      severity: 'error',
      code: 'EMPTY_COLLECTIONS',
      message: 'Collection table must reference at least one table',
      path: `${path}.collections`,
    })
    return
  }

  for (let i = 0; i < table.collections.length; i++) {
    const collectionId = table.collections[i]

    // Check if collection table exists (local reference only)
    const localId = collectionId.split('.').pop()
    if (localId && !tableIds.has(localId) && !collectionId.includes('.')) {
      issues.push({
        severity: 'error',
        code: 'INVALID_COLLECTION',
        message: `Collection references unknown table: ${collectionId}`,
        path: `${path}.collections[${i}]`,
      })
    }
  }
}

// ============================================================================
// Template Validation
// ============================================================================

function validateTemplate(
  template: Template,
  path: string,
  _tableIds: Set<string>,
  issues: ValidationIssue[]
): void {
  validateIdentifier(template.id, `${path}.id`, 'Template', issues)

  if (!template.name || template.name.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'MISSING_TEMPLATE_NAME',
      message: 'Template name is required',
      path: `${path}.name`,
    })
  }

  if (!template.pattern && template.pattern !== '') {
    issues.push({
      severity: 'error',
      code: 'MISSING_PATTERN',
      message: 'Template pattern is required',
      path: `${path}.pattern`,
    })
  }

  // Validate template-level shared variables
  if (template.shared) {
    validateVariables(template.shared, `${path}.shared`, issues)
  }

  // Note: We could validate table references in patterns here,
  // but that would require parsing the pattern. Deferred for now.
}

// ============================================================================
// Variable Validation
// ============================================================================

function validateVariables(
  variables: Record<string, string>,
  path: string,
  issues: ValidationIssue[]
): void {
  for (const name of Object.keys(variables)) {
    if (!VARIABLE_NAME_PATTERN.test(name)) {
      issues.push({
        severity: 'error',
        code: 'INVALID_VARIABLE_NAME',
        message: `Invalid variable name: ${name}`,
        path: `${path}.${name}`,
        suggestion:
          'Variable names must start with a letter (or $ for context-sensitive variables) and contain only alphanumeric characters and underscores',
      })
    }

    // Check reserved words (strip $ prefix for comparison)
    const nameWithoutPrefix = name.startsWith('$') ? name.slice(1) : name
    if (RESERVED_WORDS.has(nameWithoutPrefix)) {
      issues.push({
        severity: 'error',
        code: 'RESERVED_WORD',
        message: `Variable name is a reserved word: ${name}`,
        path: `${path}.${name}`,
      })
    }
  }
}

// ============================================================================
// Inheritance Validation
// ============================================================================

function validateInheritance(tables: Table[], issues: ValidationIssue[]): void {
  const tableMap = new Map<string, Table>()
  for (const table of tables) {
    tableMap.set(table.id, table)
  }

  // Check for circular inheritance
  for (const table of tables) {
    if (table.extends) {
      const chain = new Set<string>()
      let current: Table | undefined = table

      while (current?.extends) {
        if (chain.has(current.id)) {
          issues.push({
            severity: 'error',
            code: 'CIRCULAR_INHERITANCE',
            message: `Circular inheritance detected involving table: ${current.id}`,
            path: `tables`,
          })
          break
        }

        chain.add(current.id)
        const parentId = current.extends.split('.').pop()
        current = parentId ? tableMap.get(parentId) : undefined
      }
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function validateIdentifier(
  id: string,
  path: string,
  type: string,
  issues: ValidationIssue[]
): void {
  if (!id || id.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'MISSING_ID',
      message: `${type} ID is required`,
      path,
    })
    return
  }

  if (id.includes('.')) {
    issues.push({
      severity: 'error',
      code: 'INVALID_ID',
      message: `${type} ID cannot contain periods: ${id}`,
      path,
      suggestion: 'Use underscores or camelCase instead',
    })
  }

  if (!IDENTIFIER_PATTERN.test(id)) {
    issues.push({
      severity: 'error',
      code: 'INVALID_ID',
      message: `Invalid ${type} ID format: ${id}`,
      path,
      suggestion: 'IDs must start with a letter and contain only alphanumeric characters and underscores',
    })
  }

  if (RESERVED_WORDS.has(id.toLowerCase())) {
    issues.push({
      severity: 'error',
      code: 'RESERVED_WORD',
      message: `${type} ID is a reserved word: ${id}`,
      path,
    })
  }
}
