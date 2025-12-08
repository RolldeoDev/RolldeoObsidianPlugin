/**
 * Reference Resolver
 *
 * Pure functions for resolving table and template references.
 * Handles namespace, alias, and import resolution.
 */

import type { Table, Template, LoadedCollection } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface ResolverContext {
  /** Map of collection IDs to loaded collections */
  collections: Map<string, LoadedCollection>
}

export interface TableResolution {
  table: Table
  collectionId: string
}

export interface TemplateResolution {
  template: Template
  collectionId: string
}

// ============================================================================
// Table Resolution
// ============================================================================

/**
 * Resolve a table reference that may include namespace or alias.
 * Format: tableId, alias.tableId, or namespace.tableId
 * Returns both the table and the collection ID where it was found.
 */
export function resolveTableRef(
  ref: string,
  collectionId: string,
  ctx: ResolverContext
): TableResolution | undefined {
  const { collections } = ctx

  // Check for namespace/alias format (contains a dot)
  if (ref.includes('.')) {
    const parts = ref.split('.')
    if (parts.length >= 2) {
      // First part could be an alias or namespace prefix
      const aliasOrNamespace = parts[0]
      // Last part is the tableId
      const tableId = parts[parts.length - 1]

      // Check imports/aliases first (takes priority)
      const currentCollection = collections.get(collectionId)

      if (currentCollection?.imports.has(aliasOrNamespace)) {
        const importedCollection = currentCollection.imports.get(aliasOrNamespace)!
        const table = importedCollection.tableIndex.get(tableId)
        if (table) {
          return { table, collectionId: importedCollection.id }
        }
      }

      // Fall back to namespace matching
      const namespace = parts.slice(0, -1).join('.')
      for (const collection of collections.values()) {
        if (collection.document.metadata.namespace === namespace) {
          const table = collection.tableIndex.get(tableId)
          if (table) return { table, collectionId: collection.id }
        }
      }

      // Fallback: If the alias matches a document import alias but imports weren't resolved,
      // use the import's path to find the correct collection.
      if (currentCollection?.document.imports) {
        const importDef = currentCollection.document.imports.find(
          (imp) => imp.alias === aliasOrNamespace
        )
        if (importDef) {
          // The import alias exists in the document, but wasn't resolved.
          // Use the import's path to find the target collection by namespace or ID.
          for (const collection of collections.values()) {
            if (collection.id !== collectionId) {
              // Match by namespace (path is usually the namespace)
              if (collection.document.metadata.namespace === importDef.path) {
                const table = collection.tableIndex.get(tableId)
                if (table) {
                  return { table, collectionId: collection.id }
                }
              }
              // Match by collection ID
              if (collection.id === importDef.path) {
                const table = collection.tableIndex.get(tableId)
                if (table) {
                  return { table, collectionId: collection.id }
                }
              }
            }
          }
        }
      }
    }
  }

  // Simple tableId - look in current collection first
  const currentCollection = collections.get(collectionId)
  if (currentCollection) {
    const table = currentCollection.tableIndex.get(ref)
    if (table) return { table, collectionId }
  }

  // Search all collections as fallback
  for (const collection of collections.values()) {
    const table = collection.tableIndex.get(ref)
    if (table) return { table, collectionId: collection.id }
  }

  return undefined
}

// ============================================================================
// Template Resolution
// ============================================================================

/**
 * Resolve a template reference that may include namespace or alias.
 * Format: templateId, alias.templateId, or namespace.templateId
 * Returns both the template and the collection ID where it was found.
 */
export function resolveTemplateRef(
  ref: string,
  collectionId: string,
  ctx: ResolverContext
): TemplateResolution | undefined {
  const { collections } = ctx

  // Check for namespace/alias format (contains a dot)
  if (ref.includes('.')) {
    const parts = ref.split('.')
    if (parts.length >= 2) {
      // First part could be an alias or namespace prefix
      const aliasOrNamespace = parts[0]
      // Last part is the templateId
      const templateId = parts[parts.length - 1]

      // Check imports/aliases first (takes priority)
      const currentCollection = collections.get(collectionId)

      if (currentCollection?.imports.has(aliasOrNamespace)) {
        const importedCollection = currentCollection.imports.get(aliasOrNamespace)!
        const template = importedCollection.templateIndex.get(templateId)
        if (template) {
          return { template, collectionId: importedCollection.id }
        }
      }

      // Fall back to namespace matching
      const namespace = parts.slice(0, -1).join('.')
      for (const collection of collections.values()) {
        if (collection.document.metadata.namespace === namespace) {
          const template = collection.templateIndex.get(templateId)
          if (template) return { template, collectionId: collection.id }
        }
      }

      // Fallback: If the alias matches a document import alias but imports weren't resolved,
      // use the import's path to find the correct collection.
      if (currentCollection?.document.imports) {
        const importDef = currentCollection.document.imports.find(
          (imp) => imp.alias === aliasOrNamespace
        )
        if (importDef) {
          // The import alias exists in the document, but wasn't resolved.
          // Use the import's path to find the target collection by namespace or ID.
          for (const collection of collections.values()) {
            if (collection.id !== collectionId) {
              // Match by namespace (path is usually the namespace)
              if (collection.document.metadata.namespace === importDef.path) {
                const template = collection.templateIndex.get(templateId)
                if (template) {
                  return { template, collectionId: collection.id }
                }
              }
              // Match by collection ID
              if (collection.id === importDef.path) {
                const template = collection.templateIndex.get(templateId)
                if (template) {
                  return { template, collectionId: collection.id }
                }
              }
            }
          }
        }
      }
    }
  }

  // Simple templateId - look in current collection first
  const currentCollection = collections.get(collectionId)
  if (currentCollection) {
    const template = currentCollection.templateIndex.get(ref)
    if (template) return { template, collectionId }
  }

  // Search all collections as fallback
  for (const collection of collections.values()) {
    const template = collection.templateIndex.get(ref)
    if (template) return { template, collectionId: collection.id }
  }

  return undefined
}
