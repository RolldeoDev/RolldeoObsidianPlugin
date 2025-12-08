/**
 * Random Table Engine
 *
 * Main orchestrator for loading, validating, and rolling on random tables.
 * Implements the Random Table JSON Spec v1.0.
 */

import type {
  RandomTableDocument,
  Table,
  SimpleTable,
  CompositeTable,
  CollectionTable,
  Template,
  Entry,
  RollResult,
  LoadedCollection,
  EngineConfig,
  Assets,
  Sets,
  EvaluatedSets,
} from '../types'

import { validateDocument, type ValidationResult } from './validator'
import {
  createContext,
  incrementRecursion,
  decrementRecursion,
  setCurrentTable,
  setCurrentCollection,
  mergePlaceholderSets,
  registerDocumentSharedName,
  addDescription,
  setCurrentEntryDescription,
  setCurrentEntryValue,
  type GenerationContext,
} from './context'
import { rollSimpleTable, buildWeightedPool, calculateTotalWeight } from '../tables/simple'
import { selectSource, buildSourcePool, calculateSourceWeight } from '../tables/composite'
import { rollCollectionTable } from '../tables/collection'
import {
  beginTraceNode,
  endTraceNode,
  addTraceLeaf,
  extractTrace,
  type EntrySelectMetadata,
  type CompositeSelectMetadata,
  type CollectionMergeMetadata,
} from './trace'
import {
  resolveTableRef as resolveTableRefFn,
  resolveTemplateRef as resolveTemplateRefFn,
} from './resolver'
import { ExpressionEvaluator } from './evaluator'

// ============================================================================
// Types
// ============================================================================

export interface TableInfo {
  id: string
  name: string
  type: 'simple' | 'composite' | 'collection'
  description?: string
  tags?: string[]
  hidden?: boolean
  entryCount?: number
  resultType?: string
}

export interface TemplateInfo {
  id: string
  name: string
  description?: string
  tags?: string[]
  resultType?: string
}

export interface ImportedTableInfo extends TableInfo {
  /** Alias prefix for import reference (e.g., "names") */
  alias: string
  /** Source collection namespace */
  sourceNamespace: string
  /** Source collection name for UI display */
  sourceCollectionName: string
}

export interface ImportedTemplateInfo extends TemplateInfo {
  /** Alias prefix for import reference (e.g., "names") */
  alias: string
  /** Source collection namespace */
  sourceNamespace: string
  /** Source collection name for UI display */
  sourceCollectionName: string
}

export interface EngineOptions {
  config?: Partial<EngineConfig>
}

export interface RollOptions {
  /** Enable trace mode to capture execution details */
  enableTrace?: boolean
}

// ============================================================================
// Engine Class
// ============================================================================

export class RandomTableEngine {
  private collections: Map<string, LoadedCollection> = new Map()
  private config: EngineConfig
  private evaluator: ExpressionEvaluator

  constructor(options: EngineOptions = {}) {
    this.config = {
      maxRecursionDepth: options.config?.maxRecursionDepth ?? 50,
      maxExplodingDice: options.config?.maxExplodingDice ?? 100,
      maxInheritanceDepth: options.config?.maxInheritanceDepth ?? 5,
      uniqueOverflowBehavior: options.config?.uniqueOverflowBehavior ?? 'stop',
    }

    // Create evaluator with dependencies
    // Note: We use bind() for methods that the evaluator needs to call back to
    this.evaluator = new ExpressionEvaluator({
      resolveTableRef: (ref, collectionId) => this.resolveTableRef(ref, collectionId),
      resolveTemplateRef: (ref, collectionId) => this.resolveTemplateRef(ref, collectionId),
      rollTable: (table, context, collectionId, options) =>
        this.rollTable(table, context, collectionId, options),
      getCollection: (id) => this.getCollection(id),
      getTable: (tableId, collectionId) => this.getTable(tableId, collectionId),
    })
  }

  // ==========================================================================
  // Loading
  // ==========================================================================

  /**
   * Load a collection from a parsed document
   */
  loadCollection(document: RandomTableDocument, id: string, isPreloaded = false): void {
    // Build table index for O(1) lookups
    const tableIndex = new Map<string, Table>()
    for (const table of document.tables) {
      tableIndex.set(table.id, table)
    }

    // Build template index for O(1) lookups
    const templateIndex = new Map<string, Template>()
    if (document.templates) {
      for (const template of document.templates) {
        templateIndex.set(template.id, template)
      }
    }

    const collection: LoadedCollection = {
      id,
      document,
      imports: new Map(), // TODO: Implement import resolution
      isPreloaded,
      source: isPreloaded ? 'preloaded' : id,
      tableIndex,
      templateIndex,
    }

    this.collections.set(id, collection)
  }

  /**
   * Load a collection from JSON string
   */
  loadFromJson(json: string, id: string, isPreloaded = false): ValidationResult {
    const document = JSON.parse(json) as RandomTableDocument
    const validation = this.validate(document)

    if (validation.valid) {
      this.loadCollection(document, id, isPreloaded)
    }

    return validation
  }

  /**
   * Unload a collection
   */
  unloadCollection(id: string): boolean {
    return this.collections.delete(id)
  }

  /**
   * Check if a collection is loaded
   */
  hasCollection(id: string): boolean {
    return this.collections.has(id)
  }

  /**
   * Get a loaded collection
   */
  getCollection(id: string): LoadedCollection | undefined {
    return this.collections.get(id)
  }

  /**
   * Update a collection's document (for live editing).
   * This updates the document and rebuilds indexes, then re-resolves imports.
   */
  updateDocument(id: string, document: RandomTableDocument): void {
    const existing = this.collections.get(id)
    if (!existing) return

    // Rebuild table index
    const tableIndex = new Map<string, Table>()
    for (const table of document.tables) {
      tableIndex.set(table.id, table)
    }

    // Rebuild template index
    const templateIndex = new Map<string, Template>()
    if (document.templates) {
      for (const template of document.templates) {
        templateIndex.set(template.id, template)
      }
    }

    // Update the collection in place
    existing.document = document
    existing.tableIndex = tableIndex
    existing.templateIndex = templateIndex

    // Re-resolve imports for all collections
    this.resolveImports()
  }

  /**
   * List all loaded collections
   */
  listCollections(): Array<{ id: string; name: string; isPreloaded: boolean }> {
    return Array.from(this.collections.values()).map((c) => ({
      id: c.id,
      name: c.document.metadata.name,
      isPreloaded: c.isPreloaded,
    }))
  }

  /**
   * Resolve import aliases for collections based on a path-to-ID mapping.
   * This wires up the imports map for each collection that has an imports array.
   * Call this after loading all collections from a ZIP file.
   *
   * Resolution order:
   * 1. Try pathToIdMap lookup (for file path based imports)
   * 2. Try matching by namespace (for namespace-based imports from editor)
   * 3. Try matching by collection ID (direct ID reference)
   */
  resolveImports(pathToIdMap?: Map<string, string>): void {
    for (const collection of this.collections.values()) {
      // Skip collections without imports
      if (!collection.document.imports || collection.document.imports.length === 0) {
        continue
      }

      // Clear existing imports (in case of re-resolution)
      collection.imports.clear()

      for (const imp of collection.document.imports) {
        let targetCollection: LoadedCollection | undefined

        // 1. Try pathToIdMap lookup first (file path based imports)
        if (pathToIdMap) {
          const targetId = pathToIdMap.get(imp.path)
          if (targetId) {
            targetCollection = this.collections.get(targetId)
          }
        }

        // 2. Try matching by namespace (for namespace-based imports from editor)
        if (!targetCollection) {
          for (const candidate of this.collections.values()) {
            if (candidate.document.metadata.namespace === imp.path) {
              targetCollection = candidate
              break
            }
          }
        }

        // 3. Try matching by collection ID (direct ID reference)
        if (!targetCollection) {
          targetCollection = this.collections.get(imp.path)
        }

        if (targetCollection) {
          collection.imports.set(imp.alias, targetCollection)
        }
      }
    }
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate a document
   */
  validate(document: RandomTableDocument): ValidationResult {
    return validateDocument(document)
  }

  // ==========================================================================
  // Table Access
  // ==========================================================================

  /**
   * Get a table by ID (O(1) lookup using index)
   */
  getTable(tableId: string, collectionId?: string): Table | undefined {
    if (collectionId) {
      const collection = this.collections.get(collectionId)
      return collection?.tableIndex.get(tableId)
    }

    // Search all collections
    for (const collection of this.collections.values()) {
      const table = collection.tableIndex.get(tableId)
      if (table) return table
    }

    return undefined
  }

  /**
   * List tables in a collection or all collections
   */
  listTables(collectionId?: string, includeHidden = false): TableInfo[] {
    const tables: TableInfo[] = []

    const addTables = (collection: LoadedCollection) => {
      for (const table of collection.document.tables) {
        if (!includeHidden && table.hidden) continue

        tables.push({
          id: table.id,
          name: table.name,
          type: table.type,
          description: table.description,
          tags: table.tags,
          hidden: table.hidden,
          entryCount: table.type === 'simple' ? (table as SimpleTable).entries.length : undefined,
          resultType: table.resultType,
        })
      }
    }

    if (collectionId) {
      const collection = this.collections.get(collectionId)
      if (collection) addTables(collection)
    } else {
      for (const collection of this.collections.values()) {
        addTables(collection)
      }
    }

    return tables
  }

  /**
   * Get a template by ID (O(1) lookup using index)
   */
  getTemplate(templateId: string, collectionId: string): Template | undefined {
    const collection = this.collections.get(collectionId)
    return collection?.templateIndex.get(templateId)
  }

  /**
   * List templates in a collection
   */
  listTemplates(collectionId: string): TemplateInfo[] {
    const collection = this.collections.get(collectionId)
    if (!collection?.document.templates) return []

    return collection.document.templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      tags: t.tags,
      resultType: t.resultType,
    }))
  }

  /**
   * List tables from a collection's imports (recursively).
   * Returns tables with their alias prefix for proper reference syntax.
   */
  listImportedTables(collectionId: string, includeHidden = true): ImportedTableInfo[] {
    const collection = this.collections.get(collectionId)
    if (!collection) return []

    const results: ImportedTableInfo[] = []
    const visited = new Set<string>()
    visited.add(collectionId) // Don't include current collection's tables

    for (const [alias, importedCollection] of collection.imports) {
      this.collectImportedTables(importedCollection, alias, includeHidden, visited, results)
    }

    return results
  }

  /**
   * List templates from a collection's imports (recursively).
   * Returns templates with their alias prefix for proper reference syntax.
   */
  listImportedTemplates(collectionId: string): ImportedTemplateInfo[] {
    const collection = this.collections.get(collectionId)
    if (!collection) return []

    const results: ImportedTemplateInfo[] = []
    const visited = new Set<string>()
    visited.add(collectionId) // Don't include current collection's templates

    for (const [alias, importedCollection] of collection.imports) {
      this.collectImportedTemplates(importedCollection, alias, visited, results)
    }

    return results
  }

  /**
   * Helper to recursively collect tables from an imported collection
   */
  private collectImportedTables(
    collection: LoadedCollection,
    alias: string,
    includeHidden: boolean,
    visited: Set<string>,
    results: ImportedTableInfo[]
  ): void {
    if (visited.has(collection.id)) return
    visited.add(collection.id)

    // Get direct tables from this imported collection
    for (const table of collection.document.tables) {
      if (!includeHidden && table.hidden) continue
      results.push({
        id: table.id,
        name: table.name,
        type: table.type,
        description: table.description,
        tags: table.tags,
        hidden: table.hidden,
        entryCount: table.type === 'simple' ? (table as SimpleTable).entries.length : undefined,
        alias,
        sourceNamespace: collection.document.metadata.namespace,
        sourceCollectionName: collection.document.metadata.name,
      })
    }

    // Recursively get from nested imports
    for (const [nestedAlias, nestedCollection] of collection.imports) {
      this.collectImportedTables(
        nestedCollection,
        `${alias}.${nestedAlias}`,
        includeHidden,
        visited,
        results
      )
    }
  }

  /**
   * Helper to recursively collect templates from an imported collection
   */
  private collectImportedTemplates(
    collection: LoadedCollection,
    alias: string,
    visited: Set<string>,
    results: ImportedTemplateInfo[]
  ): void {
    if (visited.has(collection.id)) return
    visited.add(collection.id)

    // Get direct templates from this imported collection
    if (collection.document.templates) {
      for (const template of collection.document.templates) {
        results.push({
          id: template.id,
          name: template.name,
          description: template.description,
          tags: template.tags,
          alias,
          sourceNamespace: collection.document.metadata.namespace,
          sourceCollectionName: collection.document.metadata.name,
        })
      }
    }

    // Recursively get from nested imports
    for (const [nestedAlias, nestedCollection] of collection.imports) {
      this.collectImportedTemplates(
        nestedCollection,
        `${alias}.${nestedAlias}`,
        visited,
        results
      )
    }
  }

  // ==========================================================================
  // Rolling
  // ==========================================================================

  /**
   * Roll on a table
   */
  roll(tableId: string, collectionId: string, options?: RollOptions): RollResult {
    const collection = this.collections.get(collectionId)
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`)
    }

    const table = collection.tableIndex.get(tableId)
    if (!table) {
      throw new Error(`Table not found: ${tableId} in collection ${collectionId}`)
    }

    // Create generation context with optional trace
    const context = this.createGenerationContext(collection, options)
    setCurrentCollection(context, collectionId)

    // Clear descriptions collected during document-level shared variable evaluation.
    // Document-level shared variables are eagerly evaluated in createGenerationContext(),
    // but they may not be used by this specific table roll. We only want to capture
    // descriptions from table rolls that are actually part of this output.
    context.collectedDescriptions = []

    // Start root trace node
    beginTraceNode(context, 'root', `Roll: ${table.name || tableId}`, {
      raw: tableId,
      parsed: { collectionId, tableType: table.type }
    })

    // Roll on the table
    const result = this.rollTable(table, context, collectionId)
    const finalText = result.text

    // End root trace and extract
    endTraceNode(context, { value: finalText })
    const trace = extractTrace(context)

    // Extract capture variables if any were created
    const captures = context.captureVariables.size > 0
      ? Object.fromEntries(context.captureVariables)
      : undefined

    // Extract descriptions if any were collected, sorted by depth (lowest first = parent before child)
    const descriptions = context.collectedDescriptions.length > 0
      ? [...context.collectedDescriptions].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0))
      : undefined

    return {
      text: finalText,
      resultType: result.resultType,
      assets: result.assets,
      placeholders: result.placeholders,
      metadata: {
        sourceId: tableId,
        collectionId,
        timestamp: Date.now(),
        entryId: result.entryId,
      },
      trace: trace ?? undefined,
      captures,
      descriptions,
    }
  }

  /**
   * Roll on a template
   */
  rollTemplate(templateId: string, collectionId: string, options?: RollOptions): RollResult {
    const collection = this.collections.get(collectionId)
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`)
    }

    const template = collection.templateIndex.get(templateId)
    if (!template) {
      throw new Error(`Template not found: ${templateId} in collection ${collectionId}`)
    }

    // Create generation context with optional trace
    const context = this.createGenerationContext(collection, options)
    setCurrentCollection(context, collectionId)

    // Clear descriptions collected during document-level shared variable evaluation.
    // Document-level shared variables are eagerly evaluated in createGenerationContext(),
    // but they may not be used by this specific template. We only want to capture
    // descriptions from table rolls that are actually part of this template's output.
    context.collectedDescriptions = []

    // Start root trace node
    beginTraceNode(context, 'root', `Template: ${template.name || templateId}`, {
      raw: templateId,
      parsed: { collectionId, pattern: template.pattern }
    })

    // Evaluate template-level shared variables (lazy evaluation)
    if (template.shared) {
      this.evaluator.evaluateTableLevelShared(template.shared, context, collectionId, templateId)
    }

    // Evaluate the template pattern
    const text = this.evaluator.evaluatePattern(template.pattern, context, collectionId)

    // End root trace and extract
    endTraceNode(context, { value: text })
    const trace = extractTrace(context)

    // Extract capture variables if any were created
    const captures = context.captureVariables.size > 0
      ? Object.fromEntries(context.captureVariables)
      : undefined

    // Extract descriptions if any were collected, sorted by depth (lowest first = parent before child)
    const descriptions = context.collectedDescriptions.length > 0
      ? [...context.collectedDescriptions].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0))
      : undefined

    return {
      text,
      resultType: template.resultType,
      metadata: {
        sourceId: templateId,
        collectionId,
        timestamp: Date.now(),
      },
      trace: trace ?? undefined,
      captures,
      descriptions,
    }
  }

  /**
   * Evaluate a raw pattern string within a collection context.
   * Used for live preview of patterns during editing.
   *
   * @param pattern The pattern string to evaluate (e.g., "{{tableName}} and {{dice:2d6}}")
   * @param collectionId The collection context to evaluate within
   * @param options Optional roll options (trace, shared variables, etc.)
   * @returns RollResult with evaluated text
   */
  evaluateRawPattern(
    pattern: string,
    collectionId: string,
    options?: RollOptions & { shared?: Record<string, string> }
  ): RollResult {
    const collection = this.collections.get(collectionId)
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`)
    }

    // Create generation context with optional trace
    const context = this.createGenerationContext(collection, options)
    setCurrentCollection(context, collectionId)

    // Clear descriptions collected during document-level shared variable evaluation.
    // Document-level shared variables are eagerly evaluated in createGenerationContext(),
    // but they may not be used by this pattern preview. We only want to capture
    // descriptions from table rolls that are actually part of this output.
    context.collectedDescriptions = []

    // Evaluate template/table-level shared variables if provided
    // This happens BEFORE the root trace node so they don't appear in pattern trace
    if (options?.shared) {
      this.evaluator.evaluateTableLevelShared(options.shared, context, collectionId, '__preview__')
    }

    // Start root trace node
    beginTraceNode(context, 'root', 'Pattern Preview', {
      raw: pattern,
      parsed: { collectionId, pattern }
    })

    // Evaluate the pattern and capture individual expression outputs
    const { text, expressionOutputs } =
      this.evaluator.evaluatePatternWithOutputs(pattern, context, collectionId)

    // End root trace and extract
    endTraceNode(context, { value: text })
    const trace = extractTrace(context)

    // Extract capture variables if any were created
    const captures = context.captureVariables.size > 0
      ? Object.fromEntries(context.captureVariables)
      : undefined

    return {
      text,
      metadata: {
        sourceId: '__preview__',
        collectionId,
        timestamp: Date.now(),
      },
      trace: trace ?? undefined,
      captures,
      expressionOutputs,
    }
  }

  // ==========================================================================
  // Internal: Context Creation
  // ==========================================================================

  private createGenerationContext(collection: LoadedCollection, options?: RollOptions): GenerationContext {
    // Load static variables
    const staticVariables = new Map<string, string>()
    if (collection.document.variables) {
      for (const [key, value] of Object.entries(collection.document.variables)) {
        staticVariables.set(key, value)
      }
    }

    // Create context with collection-specific config
    const config: EngineConfig = {
      maxRecursionDepth: collection.document.metadata.maxRecursionDepth ?? this.config.maxRecursionDepth,
      maxExplodingDice: collection.document.metadata.maxExplodingDice ?? this.config.maxExplodingDice,
      maxInheritanceDepth: collection.document.metadata.maxInheritanceDepth ?? this.config.maxInheritanceDepth,
      uniqueOverflowBehavior: collection.document.metadata.uniqueOverflowBehavior ?? this.config.uniqueOverflowBehavior,
    }

    const context = createContext(config, staticVariables, {
      enableTrace: options?.enableTrace,
    })

    // Evaluate shared variables (once per generation)
    if (collection.document.shared) {
      // Register all document-level shared variable names first (for shadowing prevention)
      for (const name of Object.keys(collection.document.shared)) {
        registerDocumentSharedName(context, name)
      }
      // Then evaluate them
      this.evaluator.evaluateSharedVariables(collection.document.shared, context, collection.id)
    }

    return context
  }

  // ==========================================================================
  // Internal: Table Inheritance
  // ==========================================================================

  /** Cache for resolved tables to avoid repeated inheritance resolution */
  private resolvedTables: Map<string, SimpleTable> = new Map()

  /**
   * Resolve table inheritance.
   * Merges parent entries into child, with child entries overriding by ID.
   */
  private resolveTableInheritance(
    table: SimpleTable,
    collectionId: string,
    depth: number = 0
  ): SimpleTable {
    // Check cache
    const cacheKey = `${collectionId}:${table.id}`
    const cached = this.resolvedTables.get(cacheKey)
    if (cached) return cached

    // No inheritance - return as-is
    if (!table.extends) {
      return table
    }

    // Check inheritance depth limit
    const collection = this.collections.get(collectionId)
    const maxDepth = collection?.document.metadata.maxInheritanceDepth ?? this.config.maxInheritanceDepth
    if (depth >= maxDepth) {
      throw new Error(
        `Inheritance depth limit exceeded for table '${table.id}' (max: ${maxDepth})`
      )
    }

    // Resolve parent table reference (may include namespace.tableId)
    const parentRef = table.extends
    const parentResult = this.resolveTableRef(parentRef, collectionId)

    if (!parentResult) {
      throw new Error(
        `Parent table not found: '${parentRef}' for table '${table.id}'`
      )
    }

    if (parentResult.table.type !== 'simple') {
      throw new Error(
        `Cannot extend non-simple table: '${parentRef}' (type: ${parentResult.table.type})`
      )
    }

    // Recursively resolve parent's inheritance (using parent's collection context)
    const resolvedParent = this.resolveTableInheritance(
      parentResult.table as SimpleTable,
      parentResult.collectionId,
      depth + 1
    )

    // Merge entries: parent entries first, child entries override by ID
    const mergedEntries: Entry[] = []
    const entryById = new Map<string, Entry>()

    // Add parent entries (with generated IDs if needed)
    for (let i = 0; i < resolvedParent.entries.length; i++) {
      const entry = resolvedParent.entries[i]
      const id = entry.id ?? `${resolvedParent.id}${String(i).padStart(3, '0')}`
      entryById.set(id, { ...entry, id })
    }

    // Override with child entries (merge with parent entry if same ID)
    for (let i = 0; i < table.entries.length; i++) {
      const entry = table.entries[i]
      const id = entry.id ?? `${table.id}${String(i).padStart(3, '0')}`
      const parentEntry = entryById.get(id)
      if (parentEntry) {
        // Merge child entry with parent entry (child properties override parent)
        entryById.set(id, { ...parentEntry, ...entry, id })
      } else {
        entryById.set(id, { ...entry, id })
      }
    }

    // Build final entry array
    for (const entry of entryById.values()) {
      mergedEntries.push(entry)
    }

    // Merge defaultSets: parent → child (child overrides)
    const mergedDefaultSets: Sets = {
      ...(resolvedParent.defaultSets ?? {}),
      ...(table.defaultSets ?? {}),
    }

    // Create resolved table
    const resolved: SimpleTable = {
      ...table,
      entries: mergedEntries,
      defaultSets: Object.keys(mergedDefaultSets).length > 0 ? mergedDefaultSets : undefined,
      extends: undefined, // Clear extends since we've resolved it
    }

    // Cache and return
    this.resolvedTables.set(cacheKey, resolved)
    return resolved
  }

  /**
   * Resolve a table reference that may include namespace or alias.
   * Format: tableId, alias.tableId, or namespace.tableId
   * Returns both the table and the collection ID where it was found.
   */
  private resolveTableRef(ref: string, collectionId: string): { table: Table; collectionId: string } | undefined {
    return resolveTableRefFn(ref, collectionId, { collections: this.collections })
  }

  /**
   * Resolve a template reference that may include namespace or alias.
   * Format: templateId, alias.templateId, or namespace.templateId
   */
  private resolveTemplateRef(ref: string, collectionId: string): { template: Template; collectionId: string } | undefined {
    return resolveTemplateRefFn(ref, collectionId, { collections: this.collections })
  }

  /**
   * Clear the resolved tables cache (call when collections change)
   */
  clearInheritanceCache(): void {
    this.resolvedTables.clear()
  }

  // ==========================================================================
  // Internal: Table Rolling
  // ==========================================================================

  private rollTable(
    table: Table,
    context: GenerationContext,
    collectionId: string,
    options: { unique?: boolean; excludeIds?: Set<string> } = {}
  ): { text: string; resultType?: string; assets?: Assets; placeholders?: EvaluatedSets; entryId?: string } {
    // Check recursion limit
    if (!incrementRecursion(context)) {
      throw new Error(`Recursion limit exceeded (${context.config.maxRecursionDepth})`)
    }

    // Start trace node for table roll
    beginTraceNode(context, 'table_roll', `Table: ${table.name || table.id}`, {
      raw: table.id,
      parsed: { type: table.type, name: table.name }
    })

    try {
      setCurrentTable(context, table.id)

      // Evaluate table-level shared variables (lazy evaluation)
      // evaluateTableLevelShared skips variables that already exist, handling inheritance
      // Multi-roll isolation is handled by isolated contexts in evaluateMultiRoll
      if (table.shared) {
        this.evaluator.evaluateTableLevelShared(table.shared, context, collectionId, table.id)
      }

      let result: { text: string; resultType?: string; assets?: Assets; placeholders?: EvaluatedSets; entryId?: string }

      if (table.type === 'simple') {
        result = this.rollSimple(table as SimpleTable, context, collectionId, options)
      } else if (table.type === 'composite') {
        result = this.rollComposite(table as CompositeTable, context, collectionId, options)
      } else if (table.type === 'collection') {
        result = this.rollCollection(table as CollectionTable, context, collectionId, options)
      } else {
        throw new Error(`Unknown table type: ${(table as Table).type}`)
      }

      // End trace node
      endTraceNode(context, { value: result.text })

      return result
    } catch (error) {
      // End trace node with error
      endTraceNode(context, { value: '', error: String(error) })
      throw error
    } finally {
      decrementRecursion(context)
    }
  }

  private rollSimple(
    table: SimpleTable,
    context: GenerationContext,
    collectionId: string,
    options: { unique?: boolean; excludeIds?: Set<string> }
  ): { text: string; resultType?: string; assets?: Assets; placeholders?: EvaluatedSets; entryId?: string } {
    // Resolve inheritance before rolling
    const resolvedTable = this.resolveTableInheritance(table, collectionId)

    // Build pool for trace metadata (before selection)
    const pool = buildWeightedPool(resolvedTable.entries, resolvedTable.id, options.excludeIds)
    const totalWeight = calculateTotalWeight(pool)

    const selected = rollSimpleTable(resolvedTable, context, options)

    if (!selected) {
      // Trace empty selection
      addTraceLeaf(context, 'entry_select', `No entry selected`, {
        raw: table.id,
      }, {
        value: '',
      }, {
        type: 'entry_select',
        tableId: table.id,
        entryId: '',
        selectedWeight: 0,
        totalWeight,
        probability: 0,
        poolSize: pool.length,
        unique: options.unique ?? false,
        excludedIds: options.excludeIds ? Array.from(options.excludeIds) : undefined,
      } as EntrySelectMetadata)
      return { text: '' }
    }

    // Get the weight of the selected entry from the pool
    const selectedPoolEntry = pool.find(p => p.id === selected.id)
    const selectedWeight = selectedPoolEntry?.weight ?? 1

    // Add entry selection trace
    addTraceLeaf(context, 'entry_select', `Selected: ${selected.id}`, {
      raw: table.id,
      parsed: { entryValue: selected.entry.value }
    }, {
      value: selected.entry.value,
    }, {
      type: 'entry_select',
      tableId: table.id,
      entryId: selected.id,
      selectedWeight,
      totalWeight,
      probability: totalWeight > 0 ? selectedWeight / totalWeight : 0,
      poolSize: pool.length,
      unique: options.unique ?? false,
      excludedIds: options.excludeIds ? Array.from(options.excludeIds) : undefined,
    } as EntrySelectMetadata)

    // Update context with entry info
    setCurrentTable(context, table.id, selected.id)

    // Store description and raw value in context for {{@self.description}} and {{@self.value}} access
    // Must be set BEFORE evaluating sets so they can reference these values
    setCurrentEntryDescription(context, selected.entry.description)
    setCurrentEntryValue(context, selected.entry.value)

    // Evaluate and merge placeholders
    // Set values containing {{patterns}} are evaluated at merge time for consistency
    let evaluatedSets: EvaluatedSets = selected.mergedSets
    if (Object.keys(selected.mergedSets).length > 0) {
      evaluatedSets = this.evaluator.evaluateSetValues(selected.mergedSets, context, collectionId, table.id)
      mergePlaceholderSets(context, table.id, evaluatedSets)
    }

    // Evaluate the entry value (may contain expressions)
    // Fallback to empty string if value is undefined (shouldn't happen with proper inheritance)
    const text = this.evaluator.evaluatePattern(selected.entry.value ?? '', context, collectionId)

    // Clear description and value from context after evaluation
    setCurrentEntryDescription(context, undefined)
    setCurrentEntryValue(context, undefined)

    // Capture description if present
    if (selected.entry.description) {
      const evaluatedDescription = this.evaluator.evaluatePattern(
        selected.entry.description,
        context,
        collectionId
      )
      addDescription(
        context,
        resolvedTable.name,
        resolvedTable.id,
        text,
        evaluatedDescription
      )
    }

    return {
      text,
      resultType: selected.resultType,
      assets: selected.assets,
      placeholders: evaluatedSets,
      entryId: selected.id,
    }
  }

  private rollComposite(
    table: CompositeTable,
    context: GenerationContext,
    collectionId: string,
    options: { unique?: boolean; excludeIds?: Set<string> }
  ): { text: string; resultType?: string; assets?: Assets; placeholders?: EvaluatedSets; entryId?: string } {
    // Build source pool for trace metadata
    const sourcePool = buildSourcePool(table.sources)
    const totalSourceWeight = calculateSourceWeight(sourcePool)

    // Select which source table to roll on
    const selection = selectSource(table)
    if (!selection) {
      return { text: '' }
    }

    // Add composite select trace
    addTraceLeaf(context, 'composite_select', `Source: ${selection.sourceTableId}`, {
      raw: table.id,
      parsed: { sourceCount: table.sources.length }
    }, {
      value: selection.sourceTableId,
    }, {
      type: 'composite_select',
      sources: sourcePool.map(ws => ({
        tableId: ws.source.tableId,
        weight: ws.weight,
        probability: totalSourceWeight > 0 ? ws.weight / totalSourceWeight : 0,
      })),
      selectedTableId: selection.sourceTableId,
    } as CompositeSelectMetadata)

    // Find and roll on the source table
    const sourceTable = this.getTable(selection.sourceTableId, collectionId)
    if (!sourceTable) {
      throw new Error(`Source table not found: ${selection.sourceTableId}`)
    }

    const result = this.rollTable(sourceTable, context, collectionId, options)

    // ResultType precedence: entry → source table → composite table
    return {
      ...result,
      resultType: result.resultType ?? sourceTable.resultType ?? table.resultType,
    }
  }

  private rollCollection(
    table: CollectionTable,
    context: GenerationContext,
    collectionId: string,
    options: { unique?: boolean; excludeIds?: Set<string> }
  ): { text: string; resultType?: string; assets?: Assets; placeholders?: EvaluatedSets; entryId?: string } {
    // Get source tables
    const getTables = (ids: string[]) => {
      const result: Array<{ id: string; table: SimpleTable }> = []
      for (const id of ids) {
        const t = this.getTable(id, collectionId)
        if (t && t.type === 'simple') {
          result.push({ id, table: t as SimpleTable })
        }
      }
      return result
    }

    // Get source tables for trace metadata
    const sourceTables = getTables(table.collections)

    // Calculate merged pool stats for trace
    let totalEntries = 0
    let totalWeight = 0
    for (const { table: sourceTable } of sourceTables) {
      const pool = buildWeightedPool(sourceTable.entries, sourceTable.id, options.excludeIds)
      totalEntries += pool.length
      totalWeight += calculateTotalWeight(pool)
    }

    // Add collection merge trace
    addTraceLeaf(context, 'collection_merge', `Merged ${table.collections.length} tables`, {
      raw: table.id,
      parsed: { sourceTableIds: table.collections }
    }, {
      value: `${totalEntries} entries`,
    }, {
      type: 'collection_merge',
      sourceTables: table.collections,
      totalEntries,
      totalWeight,
    } as CollectionMergeMetadata)

    const selected = rollCollectionTable(table, getTables, context, options)
    if (!selected) {
      return { text: '' }
    }

    // Add entry selection trace for collection
    addTraceLeaf(context, 'entry_select', `Selected: ${selected.id}`, {
      raw: table.id,
      parsed: { entryValue: selected.entry.value, sourceTableId: selected.sourceTableId }
    }, {
      value: selected.entry.value,
    }, {
      type: 'entry_select',
      tableId: table.id,
      entryId: selected.id,
      selectedWeight: 1, // Weight info not available from rollCollectionTable
      totalWeight,
      probability: totalWeight > 0 ? 1 / totalEntries : 0, // Approximate
      poolSize: totalEntries,
      unique: options.unique ?? false,
      excludedIds: options.excludeIds ? Array.from(options.excludeIds) : undefined,
    } as EntrySelectMetadata)

    // Update context
    setCurrentTable(context, table.id, selected.id)

    // Store description and raw value in context for {{@self.description}} and {{@self.value}} access
    // Must be set BEFORE evaluating sets so they can reference these values
    setCurrentEntryDescription(context, selected.entry.description)
    setCurrentEntryValue(context, selected.entry.value)

    // Evaluate and merge placeholders
    // Set values containing {{patterns}} are evaluated at merge time for consistency
    let evaluatedSets: EvaluatedSets = selected.mergedSets
    if (Object.keys(selected.mergedSets).length > 0) {
      evaluatedSets = this.evaluator.evaluateSetValues(selected.mergedSets, context, collectionId, table.id)
      mergePlaceholderSets(context, table.id, evaluatedSets)
    }

    // Evaluate the entry value
    // Fallback to empty string if value is undefined (shouldn't happen with proper inheritance)
    const text = this.evaluator.evaluatePattern(selected.entry.value ?? '', context, collectionId)

    // Clear description and value from context after evaluation
    setCurrentEntryDescription(context, undefined)
    setCurrentEntryValue(context, undefined)

    // Capture description if present
    if (selected.entry.description) {
      // Get source table name for attribution
      const sourceTable = this.getTable(selected.sourceTableId, collectionId)
      const tableName = sourceTable?.name ?? selected.sourceTableId

      const evaluatedDescription = this.evaluator.evaluatePattern(
        selected.entry.description,
        context,
        collectionId
      )
      addDescription(
        context,
        tableName,
        selected.sourceTableId,
        text,
        evaluatedDescription
      )
    }

    return {
      text,
      resultType: selected.resultType,
      assets: selected.assets,
      placeholders: evaluatedSets,
      entryId: selected.id,
    }
  }

}

// ==========================================================================
// Exports
// ==========================================================================

export { validateDocument } from './validator'
export { parseTemplate, extractExpressions } from './parser'
export { evaluateMath } from './math'
export { createContext } from './context'

// Re-export types
export type { ValidationResult, ValidationIssue } from './validator'
export type { ExpressionToken } from './parser'
export type { GenerationContext } from './context'
export type { RollTrace, TraceNode, TraceNodeType, TraceStats } from './trace'
