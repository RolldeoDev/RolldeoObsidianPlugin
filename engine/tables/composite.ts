/**
 * Composite Table Handler
 *
 * A composite table selects which source table to roll on using weighted probability,
 * then rolls once on that selected table.
 */

import type { CompositeTable, CompositeSource } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface WeightedSource {
  source: CompositeSource
  weight: number
}

export interface CompositeSelection {
  /** The selected source table ID */
  sourceTableId: string
  /** The weight of the selected source */
  weight: number
}

// ============================================================================
// Source Selection
// ============================================================================

/**
 * Build a weighted pool of source tables
 */
export function buildSourcePool(sources: CompositeSource[]): WeightedSource[] {
  return sources
    .map((source) => ({
      source,
      weight: source.weight ?? 1,
    }))
    .filter((ws) => ws.weight > 0)
}

/**
 * Calculate total weight of source pool
 */
export function calculateSourceWeight(pool: WeightedSource[]): number {
  return pool.reduce((sum, ws) => sum + ws.weight, 0)
}

/**
 * Select a source table from the composite table
 */
export function selectSource(table: CompositeTable): CompositeSelection | null {
  const pool = buildSourcePool(table.sources)

  if (pool.length === 0) {
    return null
  }

  const totalWeight = calculateSourceWeight(pool)
  if (totalWeight === 0) {
    return null
  }

  // Generate random value in [0, totalWeight)
  const roll = Math.random() * totalWeight

  // Walk through sources until cumulative weight exceeds roll
  let cumulative = 0
  for (const ws of pool) {
    cumulative += ws.weight
    if (roll < cumulative) {
      return {
        sourceTableId: ws.source.tableId,
        weight: ws.weight,
      }
    }
  }

  // Fallback to last source
  const last = pool[pool.length - 1]
  return {
    sourceTableId: last.source.tableId,
    weight: last.weight,
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get probability statistics for source tables
 */
export interface SourceProbability {
  tableId: string
  weight: number
  probability: number
  percentage: string
}

export function getSourceProbabilities(table: CompositeTable): SourceProbability[] {
  const pool = buildSourcePool(table.sources)
  const totalWeight = calculateSourceWeight(pool)

  if (totalWeight === 0) return []

  return pool.map((ws) => {
    const probability = ws.weight / totalWeight
    return {
      tableId: ws.source.tableId,
      weight: ws.weight,
      probability,
      percentage: `${(probability * 100).toFixed(2)}%`,
    }
  })
}

/**
 * Get all source table IDs referenced by a composite table
 */
export function getSourceTableIds(table: CompositeTable): string[] {
  return table.sources.map((s) => s.tableId)
}

/**
 * Validate a composite table
 */
export interface CompositeValidationIssue {
  type: 'error' | 'warning'
  message: string
  sourceIndex?: number
}

export function validateCompositeTable(
  table: CompositeTable,
  tableExists: (id: string) => boolean
): CompositeValidationIssue[] {
  const issues: CompositeValidationIssue[] = []

  if (table.sources.length === 0) {
    issues.push({
      type: 'error',
      message: 'Composite table has no sources',
    })
    return issues
  }

  for (let i = 0; i < table.sources.length; i++) {
    const source = table.sources[i]

    // Check weight
    if (source.weight !== undefined && source.weight < 0) {
      issues.push({
        type: 'error',
        message: `Source has negative weight: ${source.weight}`,
        sourceIndex: i,
      })
    }

    if (source.weight === 0) {
      issues.push({
        type: 'warning',
        message: `Source '${source.tableId}' has weight 0 (disabled)`,
        sourceIndex: i,
      })
    }

    // Check if source table exists
    if (!tableExists(source.tableId)) {
      issues.push({
        type: 'error',
        message: `Source table not found: ${source.tableId}`,
        sourceIndex: i,
      })
    }
  }

  // Check if all sources are disabled
  const pool = buildSourcePool(table.sources)
  if (pool.length === 0) {
    issues.push({
      type: 'error',
      message: 'All sources have zero weight - table cannot be rolled',
    })
  }

  return issues
}
