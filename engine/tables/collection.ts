/**
 * Collection Table Handler
 *
 * A collection table merges all entries from multiple source tables
 * into a single unified pool for rolling.
 */

import type { CollectionTable, SimpleTable } from '../types'
import type { GenerationContext } from '../core/context'
import { buildWeightedPool, type WeightedEntry, type SelectedEntry } from './simple'
import { getUsedEntries, markEntryUsed } from '../core/context'

// ============================================================================
// Types
// ============================================================================

export interface CollectionEntry extends WeightedEntry {
  /** Original table ID this entry came from */
  sourceTableId: string
}

export interface MergedPool {
  entries: CollectionEntry[]
  totalWeight: number
}

// ============================================================================
// Pool Merging
// ============================================================================

/**
 * Merge entries from multiple simple tables into a unified pool.
 * Entry IDs are prefixed with source table ID to avoid collisions.
 */
export function mergeTableEntries(
  tables: Array<{ id: string; table: SimpleTable }>,
  excludeIds?: Set<string>
): MergedPool {
  const entries: CollectionEntry[] = []

  for (const { id: sourceTableId, table } of tables) {
    // Build weighted pool for this table
    const pool = buildWeightedPool(table.entries, sourceTableId)

    for (const weighted of pool) {
      // Create prefixed ID to avoid collision
      const prefixedId = `${sourceTableId}.${weighted.id}`

      // Skip if excluded
      if (excludeIds?.has(prefixedId)) continue

      entries.push({
        ...weighted,
        id: prefixedId,
        sourceTableId,
      })
    }
  }

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0)

  return { entries, totalWeight }
}

// ============================================================================
// Selection
// ============================================================================

/**
 * Select a random entry from a merged collection pool
 */
export function selectFromPool(pool: MergedPool): CollectionEntry | null {
  if (pool.entries.length === 0 || pool.totalWeight === 0) {
    return null
  }

  // Generate random value in [0, totalWeight)
  const roll = Math.random() * pool.totalWeight

  // Walk through entries until cumulative weight exceeds roll
  let cumulative = 0
  for (const entry of pool.entries) {
    cumulative += entry.weight
    if (roll < cumulative) {
      return entry
    }
  }

  // Fallback to last entry
  return pool.entries[pool.entries.length - 1]
}

// ============================================================================
// Collection Rolling
// ============================================================================

export interface CollectionRollOptions {
  /** Force unique selection */
  unique?: boolean
  /** Additional entry IDs to exclude */
  excludeIds?: Set<string>
}

export interface CollectionSelectedEntry extends SelectedEntry {
  /** The source table this entry came from */
  sourceTableId: string
}

/**
 * Roll on a collection table.
 *
 * @param table The collection table definition
 * @param getTables Function to resolve table IDs to SimpleTable instances
 * @param context Generation context
 * @param options Roll options
 */
export function rollCollectionTable(
  table: CollectionTable,
  getTables: (ids: string[]) => Array<{ id: string; table: SimpleTable }>,
  context: GenerationContext,
  options: CollectionRollOptions = {}
): CollectionSelectedEntry | null {
  // Resolve source tables
  const sourceTables = getTables(table.collections)

  if (sourceTables.length === 0) {
    return null
  }

  // Build exclude set
  const excludeIds = new Set<string>()

  if (options.excludeIds) {
    for (const id of options.excludeIds) {
      excludeIds.add(id)
    }
  }

  if (options.unique) {
    const used = getUsedEntries(context, table.id)
    for (const id of used) {
      excludeIds.add(id)
    }
  }

  // Merge all entries
  const pool = mergeTableEntries(sourceTables, excludeIds)

  // Handle unique overflow
  if (pool.entries.length === 0) {
    const behavior = context.config.uniqueOverflowBehavior

    if (behavior === 'error') {
      throw new Error(
        `Unique selection overflow: no more entries available in collection '${table.id}'`
      )
    }

    if (behavior === 'cycle') {
      // Clear used entries and try again
      context.usedEntries.delete(table.id)
      return rollCollectionTable(table, getTables, context, { ...options, unique: false })
    }

    // 'stop' behavior
    return null
  }

  // Select entry
  const selected = selectFromPool(pool)
  if (!selected) return null

  // Mark as used if unique selection
  if (options.unique) {
    markEntryUsed(context, table.id, selected.id)
  }

  // Find the source table for defaultSets
  const sourceTable = sourceTables.find((t) => t.id === selected.sourceTableId)

  // Merge sets: sourceTable.defaultSets → collection.defaultSets → entry.sets, and include entry value
  const mergedSets = {
    ...(sourceTable?.table.defaultSets ?? {}),
    ...(table.defaultSets ?? {}),
    ...(selected.entry.sets ?? {}),
    // Include the entry's value so @tableName.value works
    value: selected.entry.value,
  }

  // Determine resultType: entry → source table → collection table
  const resultType =
    selected.entry.resultType ??
    sourceTable?.table.resultType ??
    table.resultType

  return {
    entry: selected.entry,
    id: selected.id,
    mergedSets,
    assets: selected.entry.assets,
    resultType,
    sourceTableId: selected.sourceTableId,
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get probability statistics for a collection table
 */
export interface CollectionEntryProbability {
  id: string
  sourceTableId: string
  value: string
  weight: number
  probability: number
  percentage: string
}

export function getCollectionProbabilities(
  table: CollectionTable,
  getTables: (ids: string[]) => Array<{ id: string; table: SimpleTable }>
): CollectionEntryProbability[] {
  const sourceTables = getTables(table.collections)
  const pool = mergeTableEntries(sourceTables)

  if (pool.totalWeight === 0) return []

  return pool.entries.map((entry) => {
    const probability = entry.weight / pool.totalWeight
    return {
      id: entry.id,
      sourceTableId: entry.sourceTableId,
      value: entry.entry.value,
      weight: entry.weight,
      probability,
      percentage: `${(probability * 100).toFixed(2)}%`,
    }
  })
}

/**
 * Validate a collection table
 */
export interface CollectionValidationIssue {
  type: 'error' | 'warning'
  message: string
  tableId?: string
}

export function validateCollectionTable(
  table: CollectionTable,
  tableExists: (id: string) => boolean,
  isSimple: (id: string) => boolean
): CollectionValidationIssue[] {
  const issues: CollectionValidationIssue[] = []

  if (table.collections.length === 0) {
    issues.push({
      type: 'error',
      message: 'Collection table has no source tables',
    })
    return issues
  }

  for (const tableId of table.collections) {
    if (!tableExists(tableId)) {
      issues.push({
        type: 'error',
        message: `Source table not found: ${tableId}`,
        tableId,
      })
    } else if (!isSimple(tableId)) {
      issues.push({
        type: 'error',
        message: `Source table must be a simple table: ${tableId}`,
        tableId,
      })
    }
  }

  return issues
}
