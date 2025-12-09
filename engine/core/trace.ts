/**
 * Trace Mode Module
 *
 * Captures execution traces for roll operations, enabling users to see
 * exactly how outputs are constructed including nested table rolls,
 * dice breakdowns, variable usage, and entry selection details.
 */

import type { GenerationContext } from './context'

// ============================================================================
// Core Types
// ============================================================================

/**
 * Represents a single traced operation in the roll execution tree.
 * Nodes form a tree structure via the `children` property.
 */
export interface TraceNode {
  /** Unique ID for this node (for React keys and referencing) */
  id: string

  /** Type of operation this node represents */
  type: TraceNodeType

  /** Human-readable label for display */
  label: string

  /** Timestamp when this operation started (ms) */
  startTime: number

  /** Duration of this operation (ms) - computed at completion */
  duration?: number

  /** The input to this operation */
  input: TraceInput

  /** The output/result of this operation */
  output: TraceOutput

  /** Child operations (for nested rolls, expression evaluations) */
  children: TraceNode[]

  /** Additional metadata specific to the operation type */
  metadata?: TraceMetadata
}

export type TraceNodeType =
  | 'root' // Top-level roll operation
  | 'table_roll' // Rolling on a table
  | 'template_roll' // Rolling on a template
  | 'template_ref' // Template reference evaluation
  | 'entry_select' // Entry selection (with weight info)
  | 'expression' // Expression token evaluation
  | 'dice_roll' // Dice roll with breakdown
  | 'math_eval' // Math expression evaluation
  | 'variable_access' // Variable resolution
  | 'placeholder_access' // Placeholder resolution
  | 'conditional' // Conditional evaluation
  | 'multi_roll' // Multi-roll loop
  | 'instance' // Instance creation/lookup
  | 'composite_select' // Composite table source selection
  | 'collection_merge' // Collection table pool merge
  | 'capture_multi_roll' // Capture multi-roll {{N*table >> $var}}
  | 'capture_access' // Capture variable access {{$var[0]}}
  | 'collect' // Collect aggregation {{collect:$var.@prop}}

export interface TraceInput {
  /** Raw input value/expression */
  raw: string
  /** Parsed/resolved form if different from raw */
  parsed?: unknown
}

export interface TraceOutput {
  /** The result value */
  value: string | number
  /** Was this a cached/memoized result? */
  cached?: boolean
  /** Error if operation failed */
  error?: string
}

// ============================================================================
// Type-Specific Metadata
// ============================================================================

export type TraceMetadata =
  | DiceRollMetadata
  | EntrySelectMetadata
  | VariableAccessMetadata
  | PlaceholderAccessMetadata
  | ConditionalMetadata
  | CompositeSelectMetadata
  | MultiRollMetadata
  | InstanceMetadata
  | CollectionMergeMetadata
  | CaptureMultiRollMetadata
  | CaptureAccessMetadata
  | CollectMetadata

export interface DiceRollMetadata {
  type: 'dice'
  /** The dice expression */
  expression: string
  /** Individual die results before modifications */
  rolls: number[]
  /** Dice kept after keep highest/lowest */
  kept: number[]
  /** Modifier applied (+5, -2, *3) */
  modifier?: {
    operator: '+' | '-' | '*'
    value: number
  }
  /** Whether dice exploded */
  exploded: boolean
  /** Breakdown string for display */
  breakdown: string
}

export interface EntrySelectMetadata {
  type: 'entry_select'
  /** Table ID */
  tableId: string
  /** Entry ID that was selected */
  entryId: string
  /** Weight of selected entry */
  selectedWeight: number
  /** Total weight of pool */
  totalWeight: number
  /** Probability of this selection (0-1) */
  probability: number
  /** Number of eligible entries */
  poolSize: number
  /** Was unique selection enforced? */
  unique: boolean
  /** Entry IDs that were excluded */
  excludedIds?: string[]
}

export interface VariableAccessMetadata {
  type: 'variable'
  /** Variable name */
  name: string
  /** Variable source: static, shared, capture, captureShared, or undefined */
  source: 'static' | 'shared' | 'capture' | 'captureShared' | 'undefined'
}

export interface PlaceholderAccessMetadata {
  type: 'placeholder'
  /** Placeholder name */
  name: string
  /** Property accessed */
  property?: string
  /** Whether the placeholder was found */
  found: boolean
}

export interface ConditionalMetadata {
  type: 'conditional'
  /** The when clause */
  when: string
  /** Whether condition matched */
  matched: boolean
  /** Action taken */
  action?: 'append' | 'prepend' | 'replace' | 'setVariable'
  /** Target of action */
  target?: string
}

export interface CompositeSelectMetadata {
  type: 'composite_select'
  /** All source tables with weights */
  sources: Array<{
    tableId: string
    weight: number
    probability: number
  }>
  /** Selected source table ID */
  selectedTableId: string
}

export interface MultiRollMetadata {
  type: 'multi_roll'
  /** Target table */
  tableId: string
  /** How count was determined */
  countSource: 'literal' | 'variable' | 'dice'
  /** The count value */
  count: number
  /** Whether unique was enforced */
  unique: boolean
  /** Separator used */
  separator: string
}

export interface InstanceMetadata {
  type: 'instance'
  /** Instance name */
  name: string
  /** Whether this was a cache hit */
  cached: boolean
  /** Table ID for the instance */
  tableId: string
}

export interface CollectionMergeMetadata {
  type: 'collection_merge'
  /** Source tables merged */
  sourceTables: string[]
  /** Total entries in merged pool */
  totalEntries: number
  /** Total weight of merged pool */
  totalWeight: number
}

export interface CaptureMultiRollMetadata {
  type: 'capture_multi_roll'
  /** Target table */
  tableId: string
  /** Capture variable name */
  captureVar: string
  /** Number of items captured */
  count: number
  /** Whether unique was enforced */
  unique: boolean
  /** Whether output was silenced */
  silent: boolean
  /** Separator used */
  separator: string
  /** Captured items summary */
  capturedItems: Array<{
    value: string
    sets: Record<string, string>
  }>
}

export interface CaptureAccessMetadata {
  type: 'capture_access'
  /** Variable name accessed */
  varName: string
  /** Index accessed (if any) */
  index?: number
  /** Property accessed */
  property: string
  /** Whether variable was found */
  found: boolean
  /** Total items in capture variable */
  totalItems?: number
  /** Whether this is a shared variable (not from >> capture syntax) */
  isSharedVariable?: boolean
}

export interface CollectMetadata {
  type: 'collect'
  /** Variable name collected from */
  varName: string
  /** Property collected */
  property: string
  /** Whether unique was applied */
  unique: boolean
  /** Separator used */
  separator: string
  /** Values before deduplication */
  allValues: string[]
  /** Values after filtering/deduplication */
  resultValues: string[]
}

// ============================================================================
// Trace Container
// ============================================================================

/**
 * Container for a complete trace of a roll operation.
 */
export interface RollTrace {
  /** Root node containing the entire trace tree */
  root: TraceNode

  /** Total execution time (ms) */
  totalTime: number

  /** Summary statistics */
  stats: TraceStats

  /** Trace format version for future compatibility */
  version: '1.0'
}

export interface TraceStats {
  /** Total number of trace nodes */
  nodeCount: number
  /** Maximum nesting depth reached */
  maxDepth: number
  /** Count by node type */
  typeBreakdown: Partial<Record<TraceNodeType, number>>
  /** Total dice rolled */
  diceRolled: number
  /** Tables accessed */
  tablesAccessed: string[]
  /** Variables accessed */
  variablesAccessed: string[]
}

// ============================================================================
// Trace Context (added to GenerationContext)
// ============================================================================

export interface TraceContext {
  /** Whether tracing is enabled for this generation */
  enabled: boolean

  /** Stack of parent nodes (for building tree structure) */
  nodeStack: TraceNode[]

  /** Counter for generating unique node IDs */
  idCounter: number

  /** Start time of the trace */
  startTime: number

  /** Reference to the root node (saved so we can extract it after stack is cleared) */
  rootNode?: TraceNode
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if tracing is enabled for this context
 */
export function isTraceEnabled(ctx: GenerationContext): boolean {
  return ctx.trace?.enabled ?? false
}

/**
 * Generate a unique node ID
 */
function generateNodeId(ctx: GenerationContext): string {
  if (!ctx.trace) return ''
  return `trace-${ctx.trace.idCounter++}`
}

/**
 * Start a new trace node and push it onto the stack.
 * Returns the node if tracing is enabled, null otherwise.
 */
export function beginTraceNode(
  ctx: GenerationContext,
  type: TraceNodeType,
  label: string,
  input: TraceInput
): TraceNode | null {
  if (!isTraceEnabled(ctx)) return null

  const node: TraceNode = {
    id: generateNodeId(ctx),
    type,
    label,
    startTime: Date.now(),
    input,
    output: { value: '' },
    children: [],
  }

  // Add to parent's children if stack is not empty
  const parent = ctx.trace!.nodeStack[ctx.trace!.nodeStack.length - 1]
  if (parent) {
    parent.children.push(node)
  } else {
    // This is the root node - save a reference so we can extract it later
    ctx.trace!.rootNode = node
  }

  // Push onto stack
  ctx.trace!.nodeStack.push(node)

  return node
}

/**
 * Complete a trace node with output and pop from stack
 */
export function endTraceNode(
  ctx: GenerationContext,
  output: TraceOutput,
  metadata?: TraceMetadata
): void {
  if (!isTraceEnabled(ctx)) return

  const node = ctx.trace!.nodeStack.pop()
  if (node) {
    node.duration = Date.now() - node.startTime
    node.output = output
    if (metadata) {
      node.metadata = metadata
    }
  }
}

/**
 * Add a leaf trace node (doesn't need push/pop).
 * Use this for simple operations that don't have nested children.
 */
export function addTraceLeaf(
  ctx: GenerationContext,
  type: TraceNodeType,
  label: string,
  input: TraceInput,
  output: TraceOutput,
  metadata?: TraceMetadata
): void {
  if (!isTraceEnabled(ctx)) return

  const node: TraceNode = {
    id: generateNodeId(ctx),
    type,
    label,
    startTime: Date.now(),
    duration: 0,
    input,
    output,
    children: [],
    metadata,
  }

  // Add to current parent
  const parent = ctx.trace!.nodeStack[ctx.trace!.nodeStack.length - 1]
  if (parent) {
    parent.children.push(node)
  }
}

/**
 * Create a fresh trace context
 */
export function createTraceContext(): TraceContext {
  return {
    enabled: true,
    nodeStack: [],
    idCounter: 0,
    startTime: Date.now(),
  }
}

/**
 * Extract the completed trace from context
 */
export function extractTrace(ctx: GenerationContext): RollTrace | null {
  if (!isTraceEnabled(ctx) || !ctx.trace!.rootNode) {
    return null
  }

  // Use the saved root node reference (stack may be empty after endTraceNode pops it)
  const root = ctx.trace!.rootNode
  const stats = computeTraceStats(root)

  return {
    root,
    totalTime: Date.now() - ctx.trace!.startTime,
    stats,
    version: '1.0',
  }
}

/**
 * Compute statistics for a trace tree
 */
function computeTraceStats(root: TraceNode): TraceStats {
  const stats: TraceStats = {
    nodeCount: 0,
    maxDepth: 0,
    typeBreakdown: {},
    diceRolled: 0,
    tablesAccessed: [],
    variablesAccessed: [],
  }

  function traverse(node: TraceNode, depth: number): void {
    stats.nodeCount++
    stats.maxDepth = Math.max(stats.maxDepth, depth)
    stats.typeBreakdown[node.type] = (stats.typeBreakdown[node.type] || 0) + 1

    if (node.type === 'dice_roll' && node.metadata) {
      const meta = node.metadata as DiceRollMetadata
      stats.diceRolled += meta.rolls?.length || 0
    }

    if (node.type === 'table_roll') {
      stats.tablesAccessed.push(node.label.replace(/^Table: /, ''))
    }

    if (node.type === 'variable_access' && node.metadata) {
      const meta = node.metadata as VariableAccessMetadata
      if (meta.name) {
        stats.variablesAccessed.push(meta.name)
      }
    }

    // Track capture variables
    if (node.type === 'capture_multi_roll' && node.metadata) {
      const meta = node.metadata as CaptureMultiRollMetadata
      if (meta.captureVar) {
        stats.variablesAccessed.push(`$${meta.captureVar}`)
      }
    }

    if (node.type === 'capture_access' && node.metadata) {
      const meta = node.metadata as CaptureAccessMetadata
      if (meta.varName) {
        stats.variablesAccessed.push(`$${meta.varName}`)
      }
    }

    if (node.type === 'collect' && node.metadata) {
      const meta = node.metadata as CollectMetadata
      if (meta.varName) {
        stats.variablesAccessed.push(`$${meta.varName}`)
      }
    }

    for (const child of node.children) {
      traverse(child, depth + 1)
    }
  }

  traverse(root, 0)

  // Deduplicate arrays
  stats.tablesAccessed = [...new Set(stats.tablesAccessed)]
  stats.variablesAccessed = [...new Set(stats.variablesAccessed)]

  return stats
}
