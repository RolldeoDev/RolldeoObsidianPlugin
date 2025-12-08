/**
 * Simple Table Roller
 *
 * Handles rolling on simple tables with weighted entry selection.
 * Supports unique selection and range-to-weight conversion.
 */

import type { SimpleTable, Entry, Sets, Assets } from '../types'
import type { GenerationContext } from '../core/context'
import { getUsedEntries, markEntryUsed } from '../core/context'

// ============================================================================
// Types
// ============================================================================

export interface WeightedEntry {
  entry: Entry
  weight: number
  id: string // Entry ID or generated ID
}

export interface SelectedEntry {
  entry: Entry
  id: string
  /** Merged sets from defaultSets + entry.sets */
  mergedSets: Sets
  /** Assets from the entry */
  assets?: Assets
  /** ResultType from entry or table */
  resultType?: string
}

// ============================================================================
// Weight Calculation
// ============================================================================

/**
 * Convert an entry to a weighted entry.
 * Handles range-to-weight conversion.
 */
function toWeightedEntry(entry: Entry, index: number, tableId: string): WeightedEntry {
  // Generate ID if not provided
  const id = entry.id ?? `${tableId}${String(index).padStart(3, '0')}`

  // Calculate weight
  let weight: number
  if (entry.range) {
    // Range [min, max] → weight = max - min + 1
    weight = entry.range[1] - entry.range[0] + 1
  } else {
    weight = entry.weight ?? 1
  }

  return { entry, weight, id }
}

/**
 * Build a weighted pool from table entries.
 * Filters out entries with weight ≤ 0.
 */
export function buildWeightedPool(
  entries: Entry[],
  tableId: string,
  excludeIds?: Set<string>
): WeightedEntry[] {
  const pool: WeightedEntry[] = []

  for (let i = 0; i < entries.length; i++) {
    const weighted = toWeightedEntry(entries[i], i, tableId)

    // Skip zero-weight entries
    if (weighted.weight <= 0) continue

    // Skip excluded entries (for unique selection)
    if (excludeIds?.has(weighted.id)) continue

    pool.push(weighted)
  }

  return pool
}

/**
 * Calculate total weight of a pool
 */
export function calculateTotalWeight(pool: WeightedEntry[]): number {
  return pool.reduce((sum, entry) => sum + entry.weight, 0)
}

// ============================================================================
// Selection
// ============================================================================

/**
 * Select a random entry from a weighted pool.
 * Uses cumulative weight distribution.
 */
export function selectByWeight(pool: WeightedEntry[]): WeightedEntry | null {
  if (pool.length === 0) return null

  const totalWeight = calculateTotalWeight(pool)
  if (totalWeight === 0) return null

  // Generate random value in [0, totalWeight)
  const roll = Math.random() * totalWeight

  // Walk through entries until cumulative weight exceeds roll
  let cumulative = 0
  for (const entry of pool) {
    cumulative += entry.weight
    if (roll < cumulative) {
      return entry
    }
  }

  // Fallback to last entry (shouldn't happen with proper weights)
  return pool[pool.length - 1]
}

// ============================================================================
// Table Rolling
// ============================================================================

export interface RollOptions {
  /** Force unique selection (exclude previously selected entries) */
  unique?: boolean
  /** Additional entry IDs to exclude */
  excludeIds?: Set<string>
}

/**
 * Roll on a simple table.
 * Returns the selected entry with merged context.
 */
export function rollSimpleTable(
  table: SimpleTable,
  context: GenerationContext,
  options: RollOptions = {}
): SelectedEntry | null {
  // Get excluded IDs
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

  // Build weighted pool
  const pool = buildWeightedPool(table.entries, table.id, excludeIds)

  // Handle unique overflow
  if (pool.length === 0) {
    const behavior = context.config.uniqueOverflowBehavior

    if (behavior === 'error') {
      throw new Error(
        `Unique selection overflow: no more entries available in table '${table.id}'`
      )
    }

    if (behavior === 'cycle') {
      // Clear used entries and try again
      context.usedEntries.delete(table.id)
      // Build pool without exclusions to check if table has any valid entries
      const fullPool = buildWeightedPool(table.entries, table.id)
      if (fullPool.length === 0) {
        // Table has no entries with positive weight - can't cycle
        return null
      }
      return rollSimpleTable(table, context, { ...options, unique: false })
    }

    // 'stop' behavior: return null
    return null
  }

  // Select entry
  const selected = selectByWeight(pool)
  if (!selected) return null

  // Mark as used if unique selection
  if (options.unique) {
    markEntryUsed(context, table.id, selected.id)
  }

  // Merge sets: defaultSets → entry.sets, and include entry value
  const mergedSets: Sets = {
    ...(table.defaultSets ?? {}),
    ...(selected.entry.sets ?? {}),
    // Include the entry's value so @tableName.value works
    value: selected.entry.value,
  }

  // Determine resultType: entry → table
  const resultType = selected.entry.resultType ?? table.resultType

  return {
    entry: selected.entry,
    id: selected.id,
    mergedSets,
    assets: selected.entry.assets,
    resultType,
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get probability statistics for a table's entries
 */
export interface EntryProbability {
  id: string
  value: string
  weight: number
  probability: number // 0-1
  percentage: string  // "25.00%"
}

export function getTableProbabilities(table: SimpleTable): EntryProbability[] {
  const pool = buildWeightedPool(table.entries, table.id)
  const totalWeight = calculateTotalWeight(pool)

  if (totalWeight === 0) return []

  return pool.map((weighted) => {
    const probability = weighted.weight / totalWeight
    return {
      id: weighted.id,
      value: weighted.entry.value,
      weight: weighted.weight,
      probability,
      percentage: `${(probability * 100).toFixed(2)}%`,
    }
  })
}

/**
 * Validate a simple table's entries
 */
export interface ValidationIssue {
  type: 'error' | 'warning'
  message: string
  entryId?: string
}

export function validateSimpleTable(table: SimpleTable): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const seenIds = new Set<string>()

  for (let i = 0; i < table.entries.length; i++) {
    const entry = table.entries[i]
    const id = entry.id ?? `${table.id}${String(i).padStart(3, '0')}`

    // Check for duplicate IDs
    if (entry.id && seenIds.has(entry.id)) {
      issues.push({
        type: 'error',
        message: `Duplicate entry ID: ${entry.id}`,
        entryId: id,
      })
    }
    seenIds.add(id)

    // Check for both weight and range
    if (entry.weight !== undefined && entry.range !== undefined) {
      issues.push({
        type: 'error',
        message: 'Entry cannot have both weight and range',
        entryId: id,
      })
    }

    // Check for invalid range
    if (entry.range) {
      if (entry.range[0] > entry.range[1]) {
        issues.push({
          type: 'error',
          message: `Invalid range: ${entry.range[0]} > ${entry.range[1]}`,
          entryId: id,
        })
      }
    }

    // Check for negative weight
    if (entry.weight !== undefined && entry.weight < 0) {
      issues.push({
        type: 'error',
        message: `Negative weight: ${entry.weight}`,
        entryId: id,
      })
    }

    // Warning for zero weight (disabled entry)
    if (entry.weight === 0) {
      issues.push({
        type: 'warning',
        message: 'Entry has weight 0 (disabled)',
        entryId: id,
      })
    }
  }

  // Check if all entries have zero weight
  const pool = buildWeightedPool(table.entries, table.id)
  if (pool.length === 0 && table.entries.length > 0) {
    issues.push({
      type: 'error',
      message: 'All entries have zero weight - table cannot be rolled',
    })
  }

  return issues
}
