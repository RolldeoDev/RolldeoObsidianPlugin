/**
 * Random Table JSON Template Specification v1.0 - TypeScript Types
 *
 * These types match the JSON schema defined in public/schemas/random-table-spec-v1.0.json
 */

// ============================================================================
// Root Document
// ============================================================================

export interface RandomTableDocument {
  metadata: Metadata
  imports?: Import[]
  tables: Table[]
  templates?: Template[]
  variables?: Variables
  shared?: SharedVariables
}

// ============================================================================
// Metadata
// ============================================================================

export interface Metadata {
  /** Name of the table collection */
  name: string
  /** Unique namespace (e.g., 'fantasy.core') */
  namespace: string
  /** Semantic version (e.g., '1.0.0') */
  version: string
  /** Spec version - must be '1.0' */
  specVersion: '1.0'
  /** Author name or organization */
  author?: string
  /** Markdown-formatted description */
  description?: string
  /** Usage instructions in Markdown */
  instructions?: string
  /** Tags for categorization */
  tags?: string[]
  /** ISO 8601 creation date */
  created?: string
  /** ISO 8601 last update date */
  updated?: string
  /** Source attribution */
  source?: MetadataSource
  /** Rights & permissions */
  rights?: Rights
  /** Max recursion depth (default: 50) */
  maxRecursionDepth?: number
  /** Max exploding dice re-rolls (default: 100) */
  maxExplodingDice?: number
  /** Max inheritance chain depth (default: 5) */
  maxInheritanceDepth?: number
  /** Behavior when unique selection exceeds entries */
  uniqueOverflowBehavior?: 'stop' | 'cycle' | 'error'
}

export interface MetadataSource {
  /** Source book name */
  book?: string
  /** Publisher name */
  publisher?: string
  /** Page number(s) or range (e.g., '47', '47-89', '12, 45-67') */
  pages?: string
  /** ISBN */
  isbn?: string
  /** URL to source */
  url?: string
  /** License (e.g., 'OGL 1.0a', 'CC BY 4.0') */
  license?: string
  /** Copyright notice (string or structured object) */
  copyright?: string | StructuredCopyright
}

/** Structured copyright information for publishers */
export interface StructuredCopyright {
  /** Copyright year or range (e.g., '2024' or '2020-2024') */
  year?: string
  /** Legal entity name that holds the copyright */
  holder?: string
  /** Full copyright notice text */
  notice?: string
}

/** Intellectual property rights, usage permissions, and legal contact */
export interface Rights {
  /** Content classification: 'proprietary', 'open-content', 'fan-content', or 'licensed' */
  type?: 'proprietary' | 'open-content' | 'fan-content' | 'licensed'
  /** Whether this is official publisher content (vs. fan-made) */
  official?: boolean
  /** List of Product Identity elements (names, characters, logos, etc.) */
  productIdentity?: string[]
  /** Trademark notices (e.g., 'Kobold Press®', 'Tome of Beasts™') */
  trademarks?: string[]
  /** Required compatibility/non-affiliation statement */
  compatibilityNotice?: string
  /** Usage permissions */
  permissions?: RightsPermissions
  /** Legal contact information */
  contact?: RightsContact
  /** URL to full terms of use */
  termsUrl?: string
  /** URL to fan content/community use policy */
  communityPolicyUrl?: string
}

/** Explicit permissions for how content may be used */
export interface RightsPermissions {
  /** Whether content may be used in commercial products */
  commercialUse?: boolean
  /** Whether content may be modified or adapted */
  modification?: boolean
  /** Whether content may be redistributed */
  redistribution?: boolean
  /** Whether derivative works may be created */
  derivativeWorks?: boolean
  /** Whether attribution is required when using content */
  attributionRequired?: boolean
}

/** Legal contact information */
export interface RightsContact {
  /** Email or URL for licensing inquiries */
  licensing?: string
  /** DMCA agent contact for takedown requests */
  dmca?: string
  /** General legal contact */
  general?: string
}

// ============================================================================
// Imports
// ============================================================================

export interface Import {
  /** Relative path or URL to external JSON file */
  path: string
  /** Local alias for referencing (must be unique, no periods) */
  alias: string
  /** Description of what this import provides */
  description?: string
}

// ============================================================================
// Tables
// ============================================================================

export type Table = SimpleTable | CompositeTable | CollectionTable

export interface BaseTable {
  /** Unique ID (no periods) */
  id: string
  /** Display name */
  name: string
  /** Table type */
  type: 'simple' | 'composite' | 'collection'
  /** Markdown description */
  description?: string
  /** Tags for organization */
  tags?: string[]
  /** If true, hidden from UI lists */
  hidden?: boolean
  /** ID of parent table to inherit from */
  extends?: string
  /** Default placeholder values for all entries */
  defaultSets?: Sets
  /** Classification of output type */
  resultType?: string
  /** Table-specific source attribution */
  source?: TableSource
  /** Table-level shared variables (evaluated lazily when rolled) */
  shared?: SharedVariables
}

export interface SimpleTable extends BaseTable {
  type: 'simple'
  /** Array of entries */
  entries: Entry[]
}

export interface CompositeTable extends BaseTable {
  type: 'composite'
  /** Source tables to select from */
  sources: CompositeSource[]
}

export interface CollectionTable extends BaseTable {
  type: 'collection'
  /** Table IDs to merge */
  collections: string[]
}

export interface TableSource {
  /** Source book name */
  book?: string
  /** Page number or range */
  page?: number | string
  /** Section or chapter */
  section?: string
  /** URL to source */
  url?: string
  /** License override */
  license?: string
}

export interface CompositeSource {
  /** Table ID to pull from */
  tableId: string
  /** Selection weight (default: 1) */
  weight?: number
}

// ============================================================================
// Entries
// ============================================================================

export interface Entry {
  /** Unique ID within table (required for inheritance) */
  id?: string
  /** Output text (supports Markdown and {{...}} syntax) */
  value: string
  /** Selection weight (default: 1, 0 disables) */
  weight?: number
  /** Range for d100-style tables [min, max] */
  range?: [number, number]
  /** Markdown description */
  description?: string
  /** Tags for this entry */
  tags?: string[]
  /** Placeholder values set when selected */
  sets?: Sets
  /** Associated assets */
  assets?: Assets
  /** ResultType override for this entry */
  resultType?: string
}

/** Key-value pairs for placeholder values (input from JSON - string values only) */
export type Sets = Record<string, string>

/**
 * Evaluated sets with resolved placeholder values.
 * Values can be strings OR nested CaptureItems for chained property access.
 * When a set value is a single table reference (e.g., "{{childTable}}"),
 * the full result including nested sets is captured as a CaptureItem.
 */
export type EvaluatedSets = Record<string, string | CaptureItem>

/** Key-value pairs for asset paths */
export type Assets = Record<string, string>

// ============================================================================
// Templates
// ============================================================================

export interface Template {
  /** Unique ID */
  id: string
  /** Display name */
  name: string
  /** Pattern string with {{...}} syntax */
  pattern: string
  /** Markdown description */
  description?: string
  /** Tags for organization */
  tags?: string[]
  /** Result type classification */
  resultType?: string
  /** Template-level shared variables (evaluated lazily when rolled) */
  shared?: SharedVariables
}

// ============================================================================
// Variables
// ============================================================================

/** Static variables loaded at engine init */
export type Variables = Record<string, string>

/** Generation-time variables evaluated per-roll */
export type SharedVariables = Record<string, string>

// ============================================================================
// Capture Variables (Roll Capture System)
// ============================================================================

/**
 * Represents a single captured item from a roll.
 * Contains the resolved output text and all merged sets properties.
 */
export interface CaptureItem {
  /** The resolved output text from the roll */
  value: string
  /**
   * The merged sets (defaultSets + entry sets), fully resolved.
   * Values can be strings OR nested CaptureItems for chained property access.
   * When a set value is a single table reference (e.g., "{{childTable}}"),
   * the full result including nested sets is captured as a CaptureItem.
   */
  sets: Record<string, string | CaptureItem>
  /** The entry's description, if present */
  description?: string
}

/**
 * Represents a capture variable containing multiple captured items.
 * Created by the capture operator: {{N*table >> $var}}
 */
export interface CaptureVariable {
  /** Array of captured items */
  items: CaptureItem[]
  /** Number of captured items (items.length) */
  count: number
}

// ============================================================================
// Engine Types (Internal)
// ============================================================================

/** Represents a loaded and validated table collection */
export interface LoadedCollection {
  /** Unique identifier for this collection */
  id: string
  /** The parsed document */
  document: RandomTableDocument
  /** Resolved imports */
  imports: Map<string, LoadedCollection>
  /** Whether this is a pre-loaded collection */
  isPreloaded: boolean
  /** Source (file path or 'preloaded') */
  source: string
  /** Index for O(1) table lookup by ID */
  tableIndex: Map<string, Table>
  /** Index for O(1) template lookup by ID */
  templateIndex: Map<string, Template>
}

// Import trace type (circular import safe since it's just a type)
import type { RollTrace } from '../core/trace'

/**
 * Description information for a selected entry during a roll.
 * Captured when entries with descriptions are selected.
 */
export interface EntryDescription {
  /** Display name of the table this entry came from */
  tableName: string
  /** Table ID for reference */
  tableId: string
  /** The resolved rolled value (what was selected) */
  rolledValue: string
  /** The evaluated description text (markdown format) */
  description: string
  /** Depth level at which description was captured (for ordering: lower = higher level/parent) */
  depth?: number
}

/** Result from rolling on a table or template */
export interface RollResult {
  /** The generated text */
  text: string
  /** Result type classification */
  resultType?: string
  /** Assets from the selected entry */
  assets?: Assets
  /** Placeholder values that were set (may contain nested CaptureItems for chained access) */
  placeholders?: EvaluatedSets
  /** Roll metadata */
  metadata: {
    /** Table/template ID that was rolled */
    sourceId: string
    /** Collection ID */
    collectionId: string
    /** Timestamp */
    timestamp: number
    /** Entry ID if from a simple table */
    entryId?: string
  }
  /** Execution trace - only present when trace mode was enabled */
  trace?: RollTrace
  /** Capture variables from the roll - only present when captures were used */
  captures?: Record<string, CaptureVariable>
  /** Entry descriptions collected during roll - only present when descriptions exist */
  descriptions?: EntryDescription[]
  /** Expression outputs in pattern order - for editor preview segment mapping */
  expressionOutputs?: string[]
}

/** Engine configuration */
export interface EngineConfig {
  maxRecursionDepth: number
  maxExplodingDice: number
  maxInheritanceDepth: number
  uniqueOverflowBehavior: 'stop' | 'cycle' | 'error'
}

/** Default engine configuration */
export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  maxRecursionDepth: 50,
  maxExplodingDice: 100,
  maxInheritanceDepth: 5,
  uniqueOverflowBehavior: 'stop',
}

// ============================================================================
// Error Types
// ============================================================================

export type ErrorType =
  | 'VALIDATION_ERROR'
  | 'IMPORT_ERROR'
  | 'IMPORT_CYCLE'
  | 'INHERITANCE_ERROR'
  | 'INHERITANCE_ID_ERROR'
  | 'REFERENCE_ERROR'
  | 'CIRCULAR_REFERENCE'
  | 'RECURSION_LIMIT'
  | 'PARSE_ERROR'
  | 'UNIQUE_OVERFLOW'
  | 'INVALID_AGAIN'
  | 'INVALID_RANGE'
  | 'WEIGHT_RANGE_CONFLICT'
  | 'SHARED_FORWARD_REF'
  | 'SHARED_SHADOW'
  | 'MATH_SYNTAX_ERROR'
  | 'DIVISION_BY_ZERO'
  | 'COERCION_FAILURE'
  | 'CAPTURE_FORWARD_REF'
  | 'CAPTURE_NAME_CONFLICT'
  | 'CAPTURE_OVERWRITE_WARNING'
  | 'CAPTURE_INDEX_OUT_OF_BOUNDS'
  | 'CAPTURE_MISSING_PROPERTY'

export interface EngineError {
  type: ErrorType
  message: string
  location?: {
    file?: string
    tableId?: string
    entryId?: string
    templateId?: string
    line?: number
    column?: number
  }
  suggestion?: string
}

// ============================================================================
// Type Guards
// ============================================================================

export function isSimpleTable(table: Table): table is SimpleTable {
  return table.type === 'simple'
}

export function isCompositeTable(table: Table): table is CompositeTable {
  return table.type === 'composite'
}

export function isCollectionTable(table: Table): table is CollectionTable {
  return table.type === 'collection'
}
