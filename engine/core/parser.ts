/**
 * Template Expression Parser
 *
 * Parses {{...}} syntax into typed tokens for evaluation.
 * Supports all expression types from the Random Table Spec v1.0
 */

// ============================================================================
// Token Types
// ============================================================================

export type ExpressionToken =
  | LiteralToken
  | TableToken
  | DiceToken
  | MathToken
  | VariableToken
  | PlaceholderToken
  | AgainToken
  | MultiRollToken
  | InstanceToken
  | CaptureMultiRollToken
  | CaptureAccessToken
  | CollectToken
  | SwitchToken

export interface LiteralToken {
  type: 'literal'
  text: string
}

export interface TableToken {
  type: 'table'
  tableId: string
  alias?: string
  namespace?: string
  /** Property chain for accessing set values (e.g., @colors, @name.@subprop) */
  properties?: string[]
}

export interface DiceToken {
  type: 'dice'
  expression: string
}

export interface MathToken {
  type: 'math'
  expression: string
}

export interface VariableToken {
  type: 'variable'
  name: string
  alias?: string
}

export interface PlaceholderToken {
  type: 'placeholder'
  name: string
  properties?: string[] // chain of properties (without @ prefix), e.g. ["culture", "maleName"]
}

export interface AgainToken {
  type: 'again'
  count?: number
  unique?: boolean
  separator?: string
}

export interface MultiRollToken {
  type: 'multiRoll'
  count: number | string // number or variable name
  diceCount?: string // dice expression for count (e.g., "1d4", "2d6+1")
  tableId: string
  alias?: string
  namespace?: string
  unique?: boolean
  separator?: string
}

export interface InstanceToken {
  type: 'instance'
  tableId: string
  instanceName: string
}

/**
 * Token for multi-roll with capture: {{3*table >> $var}}
 */
export interface CaptureMultiRollToken {
  type: 'captureMultiRoll'
  count: number | string // number or variable name
  diceCount?: string // dice expression for count
  tableId: string
  alias?: string
  namespace?: string
  unique?: boolean
  captureVar: string // variable name (without $)
  separator?: string // custom output separator
  silent?: boolean // true if |silent modifier
}

/**
 * Token for capture access: {{$var}}, {{$var[0]}}, {{$var.count}}, {{$var.@a.@b}}
 * Supports chained property access through nested CaptureItems
 */
export interface CaptureAccessToken {
  type: 'captureAccess'
  varName: string // variable name (without $)
  index?: number // array index (supports negative)
  properties?: string[] // chain of properties (without @ prefix), e.g. ["situation", "focus"]
  separator?: string // custom separator for all values
}

/**
 * Token for collect aggregation: {{collect:$var.@prop}}
 */
export interface CollectToken {
  type: 'collect'
  varName: string // variable name (without $)
  property: string // .value or @propName (stored without @)
  unique?: boolean // |unique modifier
  separator?: string // custom separator
}

/**
 * A single switch clause: condition and result expression
 */
export interface SwitchClause {
  condition: string // e.g., '$gender=="male"'
  resultExpr: string // e.g., '$race.@maleName'
}

/**
 * Switch modifiers that can be attached to any expression.
 * For attached switch: {{expr.switch[condition:result].else[fallback]}}
 */
export interface SwitchModifiers {
  clauses: SwitchClause[] // Evaluated in order, first match wins
  elseExpr?: string // Fallback if no match
}

/**
 * Token for standalone switch expression:
 * {{switch[condition:result].switch[condition2:result2].else[fallback]}}
 */
export interface SwitchToken {
  type: 'switch'
  clauses: SwitchClause[] // Evaluated in order, first match wins
  elseExpr?: string // Fallback if no match
}

/**
 * Extended token type that includes optional switch modifiers.
 * Any token can have switch modifiers attached.
 */
export type ExpressionTokenWithSwitch = ExpressionToken & {
  switchModifiers?: SwitchModifiers
}

// ============================================================================
// Expression Extraction
// ============================================================================

interface ExpressionMatch {
  start: number
  end: number
  expression: string
  raw: string
}

/**
 * Extract all {{...}} expressions from a template string.
 * Handles escaped braces: \{{ and \}}
 */
export function extractExpressions(text: string | undefined | null): ExpressionMatch[] {
  if (!text) return []

  const matches: ExpressionMatch[] = []
  let i = 0

  while (i < text.length) {
    // Check for escaped opening brace
    if (text[i] === '\\' && text.slice(i + 1, i + 3) === '{{') {
      i += 3 // Skip escaped brace
      continue
    }

    // Check for opening braces
    if (text.slice(i, i + 2) === '{{') {
      const start = i
      i += 2 // Move past {{

      // Find matching }}
      let depth = 1
      const exprStart = i

      while (i < text.length && depth > 0) {
        if (text[i] === '\\' && text.slice(i + 1, i + 3) === '}}') {
          i += 3 // Skip escaped closing brace
          continue
        }

        if (text.slice(i, i + 2) === '{{') {
          depth++
          i += 2
        } else if (text.slice(i, i + 2) === '}}') {
          depth--
          if (depth === 0) {
            matches.push({
              start,
              end: i + 2,
              expression: text.slice(exprStart, i).trim(),
              raw: text.slice(start, i + 2),
            })
          }
          i += 2
        } else {
          i++
        }
      }
    } else {
      i++
    }
  }

  return matches
}

// ============================================================================
// Expression Parsing
// ============================================================================

/**
 * Parse a single expression (content inside {{...}}) into a token.
 * Returns ExpressionTokenWithSwitch to support attached switch modifiers on any token type.
 */
export function parseExpression(expr: string): ExpressionTokenWithSwitch {
  const trimmed = expr.trim()

  // ==== SWITCH EXPRESSION - Check first ====

  // Standalone switch: switch[condition:result].switch[...].else[fallback]
  if (trimmed.startsWith('switch[')) {
    return parseSwitchExpression(trimmed)
  }

  // Check for attached switch modifiers: expr.switch[...].else[...]
  // Extract them first, then parse the base expression
  const { baseExpr, switchModifiers } = extractSwitchModifiers(trimmed)
  if (switchModifiers) {
    const baseToken = parseBaseExpression(baseExpr)
    return { ...baseToken, switchModifiers }
  }

  // No switch modifiers, parse normally
  return parseBaseExpression(trimmed)
}

/**
 * Parse a base expression (without switch modifiers)
 */
function parseBaseExpression(expr: string): ExpressionToken {
  const trimmed = expr.trim()

  // ==== CAPTURE SYSTEM - Check these first ====

  // Collect expression: collect:$var.value or collect:$var.@prop
  if (trimmed.startsWith('collect:')) {
    return parseCollect(trimmed)
  }

  // Capture multi-roll: contains >> $ (capture operator)
  if (trimmed.includes(' >> $') || trimmed.includes('>>$')) {
    return parseCaptureMultiRoll(trimmed)
  }

  // Capture access: $var[N], $var.count, $var.value, $var|"sep", $var[N].@prop
  // Must distinguish from regular variable and multi-roll with var count
  if (trimmed.startsWith('$') && !trimmed.includes('*')) {
    if (isCaptureAccessPattern(trimmed)) {
      return parseCaptureAccess(trimmed)
    }
    // Fall through to regular variable parsing below
  }

  // ==== END CAPTURE SYSTEM ====

  // Dice expression: dice:XdY...
  // But check if it's actually a multi-roll with dice count: dice:1d4*tableName
  if (trimmed.startsWith('dice:')) {
    const afterDice = trimmed.slice(5).trim()
    // Check if this is a multi-roll expression (contains * followed by a table reference)
    // Pattern: dice:XdY*tableName or dice:XdY*unique*tableName
    // Also check for capture: dice:1d4*table >> $var
    if (/^[^*]+\*[a-zA-Z]/.test(afterDice)) {
      // Check if this is a capture multi-roll
      if (afterDice.includes(' >> $') || afterDice.includes('>>$')) {
        return parseCaptureMultiRoll(trimmed)
      }
      // This is a multi-roll with dice count - parse the inner expression
      return parseMultiRollWithDiceCount(afterDice)
    }
    return {
      type: 'dice',
      expression: afterDice,
    }
  }

  // Math expression: math:...
  if (trimmed.startsWith('math:')) {
    return {
      type: 'math',
      expression: trimmed.slice(5).trim(),
    }
  }

  // Variable: $varName or $alias.varName
  // But NOT if it's $var*table (multi-roll with variable count)
  if (trimmed.startsWith('$') && !trimmed.includes('*')) {
    const varExpr = trimmed.slice(1)
    const dotIndex = varExpr.indexOf('.')

    if (dotIndex > 0) {
      return {
        type: 'variable',
        alias: varExpr.slice(0, dotIndex),
        name: varExpr.slice(dotIndex + 1),
      }
    }

    return {
      type: 'variable',
      name: varExpr,
    }
  }

  // Placeholder: @name or @name.property or @name.property.@nested (chained access)
  if (trimmed.startsWith('@')) {
    const placeholderExpr = trimmed.slice(1)
    const dotIndex = placeholderExpr.indexOf('.')

    if (dotIndex > 0) {
      const name = placeholderExpr.slice(0, dotIndex)
      const propPart = placeholderExpr.slice(dotIndex + 1)
      // Use parsePropertyChain for chained property access (handles @-prefixed properties)
      const properties = parsePropertyChain(propPart)
      return {
        type: 'placeholder',
        name,
        properties,
      }
    }

    return {
      type: 'placeholder',
      name: placeholderExpr,
    }
  }

  // Again keyword: again, N*again, N*unique*again, with optional separator
  if (
    trimmed === 'again' ||
    trimmed.startsWith('again|') ||
    /\*again(\|\s*"[^"]*")?$/.test(trimmed)
  ) {
    return parseAgain(trimmed)
  }

  // Instance reference: tableId#instanceName
  // Only match if # is outside of a quoted separator (i.e., not after |")
  if (trimmed.includes('#')) {
    // Check if # appears before any separator (|") - if so, it's an instance ref
    const separatorStart = trimmed.indexOf('|"')
    const hashIndex = trimmed.indexOf('#')

    // Only treat as instance if # is before separator or there's no separator
    if (separatorStart === -1 || hashIndex < separatorStart) {
      const [tableId, instanceName] = trimmed.split('#')
      return {
        type: 'instance',
        tableId: tableId.trim(),
        instanceName: instanceName.trim(),
      }
    }
  }

  // Multi-roll: N*tableId, N*unique*tableId, or with separator: N*tableId|"sep"
  // Also supports $var*table (variable count) and $var.count*table (capture access count)
  if (/^\d+\*/.test(trimmed) || /^\$\w+(\.\w+)?\*/.test(trimmed)) {
    return parseMultiRoll(trimmed)
  }

  // Table reference: tableId, alias.tableId, or namespace.tableId
  return parseTableReference(trimmed)
}

/**
 * Parse {{again}} variants
 * Supports: again, N*again, N*unique*again, with optional separator |"sep" or | "sep"
 */
function parseAgain(expr: string): AgainToken {
  // Check for separator: expr|"separator" or expr| "separator" (with optional space)
  let separator: string | undefined
  let mainExpr = expr

  const separatorMatch = expr.match(/\|\s*"([^"]*)"$/)
  if (separatorMatch) {
    separator = separatorMatch[1]
    mainExpr = expr.slice(0, expr.indexOf('|'))
  }

  if (mainExpr === 'again') {
    return { type: 'again', separator }
  }

  // Parse N*again or N*unique*again
  const parts = mainExpr.split('*')
  const token: AgainToken = { type: 'again', separator }

  if (parts.length >= 2) {
    const countPart = parts[0]
    if (/^\d+$/.test(countPart)) {
      token.count = parseInt(countPart, 10)
    }

    if (parts.includes('unique')) {
      token.unique = true
    }
  }

  return token
}

/**
 * Parse multi-roll expressions with dice-based count like:
 * - dice:1d4*tableName
 * - dice:2d6+1*unique*tableName
 * - dice:1d4*tableName|", "
 */
function parseMultiRollWithDiceCount(expr: string): MultiRollToken {
  // Check for separator: expr|"separator"
  let separator: string | undefined
  let mainExpr = expr

  const separatorMatch = expr.match(/\|"([^"]*)"$/)
  if (separatorMatch) {
    separator = separatorMatch[1]
    mainExpr = expr.slice(0, expr.indexOf('|'))
  }

  const parts = mainExpr.split('*')
  const diceExpr = parts[0] // The dice expression (e.g., "1d4", "2d6+1")
  const unique = parts.includes('unique')

  // Find the table reference (last non-unique part)
  let tableExpr = parts[parts.length - 1]
  if (tableExpr === 'unique' && parts.length > 2) {
    tableExpr = parts[parts.length - 2]
  }
  // Handle case where tableId is 'again'
  if (tableExpr === 'again') {
    tableExpr = 'again'
  }

  // Parse the table reference
  const tableRef = parseTableReference(tableExpr)

  return {
    type: 'multiRoll',
    count: 0, // Will be replaced by dice roll at runtime
    diceCount: diceExpr,
    tableId: tableRef.tableId,
    alias: tableRef.alias,
    namespace: tableRef.namespace,
    unique,
    separator,
  }
}

/**
 * Parse multi-roll expressions like:
 * - 3*tableName
 * - $count*tableName
 * - 3*unique*tableName
 * - 3*tableName|", "
 */
function parseMultiRoll(expr: string): MultiRollToken {
  // Check for separator: expr|"separator"
  let separator: string | undefined
  let mainExpr = expr

  const separatorMatch = expr.match(/\|"([^"]*)"$/)
  if (separatorMatch) {
    separator = separatorMatch[1]
    mainExpr = expr.slice(0, expr.indexOf('|'))
  }

  const parts = mainExpr.split('*')
  const countPart = parts[0]
  const unique = parts.includes('unique')

  // Find the table reference (last non-unique part)
  let tableExpr = parts[parts.length - 1]
  if (tableExpr === 'unique' && parts.length > 2) {
    tableExpr = parts[parts.length - 2]
  }

  // Count can be a number or variable
  let count: number | string
  if (/^\d+$/.test(countPart)) {
    count = parseInt(countPart, 10)
  } else if (countPart.startsWith('$')) {
    count = countPart.slice(1) // Variable name without $
  } else {
    count = 1 // Default
  }

  // Parse the table reference
  const tableRef = parseTableReference(tableExpr)

  return {
    type: 'multiRoll',
    count,
    tableId: tableRef.tableId,
    alias: tableRef.alias,
    namespace: tableRef.namespace,
    unique,
    separator,
  }
}

/**
 * Parse a table reference:
 * - tableId
 * - alias.tableId
 * - namespace.segment.tableId
 */
function parseTableReference(expr: string): TableToken {
  const parts = expr.split('.')

  if (parts.length === 1) {
    return {
      type: 'table',
      tableId: parts[0],
    }
  }

  // Check if any part starts with @ (indicating property access)
  // Format: tableName.@prop or alias.tableName.@prop or tableName.@prop1.@prop2
  const firstAtIndex = parts.findIndex(p => p.startsWith('@'))

  if (firstAtIndex !== -1) {
    // Everything from firstAtIndex onward is property access
    const properties = parts.slice(firstAtIndex).map(p => p.startsWith('@') ? p.slice(1) : p)
    const tableParts = parts.slice(0, firstAtIndex)

    if (tableParts.length === 0) {
      // Invalid: just @prop with no table
      return {
        type: 'table',
        tableId: expr, // Will fail at runtime, but keeps backward compat
      }
    }

    if (tableParts.length === 1) {
      return {
        type: 'table',
        tableId: tableParts[0],
        properties,
      }
    }

    if (tableParts.length === 2) {
      return {
        type: 'table',
        alias: tableParts[0],
        tableId: tableParts[1],
        properties,
      }
    }

    // Multiple segments before @prop: namespace.segment.tableId.@prop
    return {
      type: 'table',
      namespace: tableParts.slice(0, -1).join('.'),
      tableId: tableParts[tableParts.length - 1],
      properties,
    }
  }

  if (parts.length === 2) {
    // Could be alias.tableId or namespace.tableId
    // We treat it as alias.tableId - the engine resolves the difference
    return {
      type: 'table',
      alias: parts[0],
      tableId: parts[1],
    }
  }

  // Multiple segments: namespace.segment.tableId
  return {
    type: 'table',
    namespace: parts.slice(0, -1).join('.'),
    tableId: parts[parts.length - 1],
  }
}

// ============================================================================
// Capture System Parsing
// ============================================================================

/**
 * Check if expression matches capture access patterns.
 * Capture access patterns include: $var[N], $var.count, $var.value, $var|"sep", $var[N].@prop
 */
function isCaptureAccessPattern(expr: string): boolean {
  const afterDollar = expr.slice(1)
  // Matches various capture access patterns
  return (
    /\[/.test(afterDollar) || // indexed access: $var[0]
    /\.count$/.test(afterDollar) || // .count accessor: $var.count
    /\.value$/.test(afterDollar) || // .value accessor: $var.value
    /\|"/.test(afterDollar) || // separator: $var|", "
    /\.@/.test(afterDollar) // property access: $var[0].@prop or $var.@prop
  )
}

/**
 * Parse capture multi-roll expression: {{3*table >> $var|silent}} or {{3*table >> $var|"; "}}
 * Also handles: dice:1d4*table >> $var, $count*table >> $var, 3*unique*table >> $var
 */
function parseCaptureMultiRoll(expr: string): CaptureMultiRollToken {
  // Split on >> to get [multiRoll part, capture part]
  const captureMatch = expr.match(/(.+?)\s*>>\s*\$(\w+)(.*)$/)
  if (!captureMatch) {
    throw new Error(`Invalid capture multi-roll syntax: ${expr}`)
  }

  const [, multiRollPart, captureVar, modifierPart] = captureMatch

  // Parse modifiers: |silent or |"separator"
  let separator: string | undefined
  let silent = false

  if (modifierPart) {
    const trimmedMod = modifierPart.trim()
    if (trimmedMod === '|silent' || trimmedMod.includes('|silent')) {
      silent = true
    }
    const sepMatch = trimmedMod.match(/\|"([^"]*)"/)
    if (sepMatch) {
      separator = sepMatch[1]
    }
  }

  // Parse the multi-roll part (reuse existing logic)
  const trimmedMultiRoll = multiRollPart.trim()

  // Handle dice: prefix
  let diceCount: string | undefined
  let mainExpr = trimmedMultiRoll

  if (trimmedMultiRoll.startsWith('dice:')) {
    mainExpr = trimmedMultiRoll.slice(5).trim()
    // Extract dice expression (everything before first *)
    const starIndex = mainExpr.indexOf('*')
    if (starIndex > 0) {
      diceCount = mainExpr.slice(0, starIndex)
      mainExpr = mainExpr.slice(starIndex + 1)
    }
  }

  // Split by * to get count, unique flag, and table reference
  const parts = mainExpr.split('*')
  const unique = parts.includes('unique')

  // Find count and table parts
  let count: number | string = 0
  let tableExpr: string

  if (diceCount) {
    // Dice-based count
    count = 0 // Will be replaced by dice roll at runtime
    // Table is in parts
    tableExpr = parts.filter((p) => p !== 'unique').pop() || ''
  } else {
    const countPart = parts[0]
    // Count can be a number or variable
    if (/^\d+$/.test(countPart)) {
      count = parseInt(countPart, 10)
    } else if (countPart.startsWith('$')) {
      count = countPart.slice(1) // Variable name without $
    } else {
      count = 1 // Default
    }
    // Table is last non-unique part
    tableExpr = parts[parts.length - 1]
    if (tableExpr === 'unique' && parts.length > 2) {
      tableExpr = parts[parts.length - 2]
    }
  }

  // Parse the table reference
  const tableRef = parseTableReference(tableExpr)

  return {
    type: 'captureMultiRoll',
    count,
    diceCount,
    tableId: tableRef.tableId,
    alias: tableRef.alias,
    namespace: tableRef.namespace,
    unique,
    captureVar,
    separator: silent ? undefined : separator,
    silent,
  }
}

/**
 * Parse a chain of properties like "@situation.@focus" or "value.@prop"
 * Returns array of property names (without @ prefix)
 */
function parsePropertyChain(propPart: string): string[] {
  // Split by . and handle @-prefixed properties
  const parts = propPart.split('.')
  return parts.map((part) => (part.startsWith('@') ? part.slice(1) : part))
}

/**
 * Parse capture access expression:
 * - {{$var}} - all values
 * - {{$var|"; "}} - all values with separator
 * - {{$var.count}} - item count
 * - {{$var[0]}} - indexed access
 * - {{$var[-1]}} - negative index
 * - {{$var[0].value}} - explicit value access
 * - {{$var[0].@prop}} - property access
 * - {{$var.@a.@b.@c}} - chained property access through nested CaptureItems
 */
function parseCaptureAccess(expr: string): CaptureAccessToken {
  // Remove leading $
  const content = expr.slice(1)

  // Check for separator modifier first: $var|"sep"
  let separator: string | undefined
  let mainContent = content
  const sepMatch = content.match(/^(.+?)\|"([^"]*)"$/)
  if (sepMatch) {
    mainContent = sepMatch[1]
    separator = sepMatch[2]
  }

  // Parse indexed access: varName[index].property.property...?
  const indexMatch = mainContent.match(/^(\w+)\[(-?\d+)\](?:\.(.+))?$/)
  if (indexMatch) {
    const [, varName, indexStr, propPart] = indexMatch
    const index = parseInt(indexStr, 10)
    const properties = propPart ? parsePropertyChain(propPart) : undefined
    return { type: 'captureAccess', varName, index, properties, separator }
  }

  // Parse property access without index: varName.property.property...
  const propMatch = mainContent.match(/^(\w+)\.(.+)$/)
  if (propMatch) {
    const [, varName, propPart] = propMatch
    const properties = parsePropertyChain(propPart)
    return { type: 'captureAccess', varName, properties, separator }
  }

  // Simple case: just $var (all values)
  const simpleMatch = mainContent.match(/^(\w+)$/)
  if (simpleMatch) {
    return { type: 'captureAccess', varName: simpleMatch[1], separator }
  }

  throw new Error(`Invalid capture access syntax: ${expr}`)
}

/**
 * Parse collect expression:
 * - {{collect:$var.value}} - collect all values
 * - {{collect:$var.@prop}} - collect property from all items
 * - {{collect:$var.@prop|unique}} - deduplicated
 * - {{collect:$var.@prop|"; "}} - custom separator
 * - {{collect:$var.@prop|unique|"; "}} - both
 */
function parseCollect(expr: string): CollectToken {
  // Remove 'collect:' prefix
  const content = expr.slice(8).trim()

  // Parse: $varName.property|modifiers
  const match = content.match(/^\$(\w+)\.(@?\w+)(.*)$/)
  if (!match) {
    throw new Error(`Invalid collect syntax: ${expr}`)
  }

  const [, varName, propPart, modifierPart] = match

  // Property is either 'value' or '@propName'
  let property: string
  if (propPart.startsWith('@')) {
    property = propPart.slice(1) // Store without @
  } else {
    property = propPart
  }

  // Parse modifiers
  let unique = false
  let separator: string | undefined

  if (modifierPart) {
    if (modifierPart.includes('|unique')) {
      unique = true
    }
    const sepMatch = modifierPart.match(/\|"([^"]*)"/)
    if (sepMatch) {
      separator = sepMatch[1]
    }
  }

  return { type: 'collect', varName, property, unique, separator }
}

// ============================================================================
// Full Template Parsing
// ============================================================================

/**
 * Parse a full template pattern into a sequence of tokens.
 * Handles mixed literal text and {{...}} expressions.
 */
export function parseTemplate(pattern: string): ExpressionToken[] {
  const tokens: ExpressionToken[] = []
  const expressions = extractExpressions(pattern)

  let lastEnd = 0

  for (const match of expressions) {
    // Add literal text before this expression
    if (match.start > lastEnd) {
      const literalText = unescapeBraces(pattern.slice(lastEnd, match.start))
      if (literalText) {
        tokens.push({ type: 'literal', text: literalText })
      }
    }

    // Add the parsed expression
    tokens.push(parseExpression(match.expression))

    lastEnd = match.end
  }

  // Add any remaining literal text
  if (lastEnd < pattern.length) {
    const literalText = unescapeBraces(pattern.slice(lastEnd))
    if (literalText) {
      tokens.push({ type: 'literal', text: literalText })
    }
  }

  return tokens
}

/**
 * Convert escaped braces back to literal braces
 */
function unescapeBraces(text: string): string {
  return text.replace(/\\{{/g, '{{').replace(/\\}}/g, '}}')
}

// ============================================================================
// Switch Expression Parsing
// ============================================================================

/**
 * Find the first colon that is not inside quotes or nested brackets.
 * Used to split switch clauses into condition and result.
 */
function findUnquotedColon(str: string): number {
  let depth = 0
  let inQuote = false
  let quoteChar = ''

  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    const prevChar = i > 0 ? str[i - 1] : ''

    if (inQuote) {
      // Check for closing quote (not escaped)
      if (char === quoteChar && prevChar !== '\\') {
        inQuote = false
      }
    } else if (char === '"' || char === "'") {
      inQuote = true
      quoteChar = char
    } else if (char === '[' || char === '(' || char === '{') {
      depth++
    } else if (char === ']' || char === ')' || char === '}') {
      depth--
    } else if (char === ':' && depth === 0) {
      return i
    }
  }

  return -1
}

/**
 * Extract a trailing modifier like .switch[content] or .else[content]
 * Handles nested brackets properly using depth tracking.
 * Returns null if modifier not found at end of expression.
 */
function extractTrailingModifier(
  expr: string,
  modifierName: string
): { content: string; remaining: string } | null {
  const suffix = `.${modifierName}[`

  // Search from end to find the modifier
  let searchPos = expr.length
  while (searchPos > 0) {
    const modStart = expr.lastIndexOf(suffix, searchPos - 1)
    if (modStart === -1) return null

    // Find matching closing bracket using depth tracking
    let depth = 1
    let i = modStart + suffix.length
    let inQuote = false
    let quoteChar = ''

    while (i < expr.length && depth > 0) {
      const char = expr[i]
      const prevChar = i > 0 ? expr[i - 1] : ''

      if (inQuote) {
        if (char === quoteChar && prevChar !== '\\') {
          inQuote = false
        }
      } else if (char === '"' || char === "'") {
        inQuote = true
        quoteChar = char
      } else if (char === '[') {
        depth++
      } else if (char === ']') {
        depth--
      }
      i++
    }

    // Check if this modifier extends to end of expression
    if (depth === 0 && i === expr.length) {
      return {
        content: expr.slice(modStart + suffix.length, i - 1),
        remaining: expr.slice(0, modStart),
      }
    }

    // This modifier doesn't extend to end, search for another
    searchPos = modStart
  }

  return null
}

/**
 * Extract switch modifiers from an expression string.
 * Returns the base expression and any switch/else modifiers found.
 */
function extractSwitchModifiers(expr: string): {
  baseExpr: string
  switchModifiers?: SwitchModifiers
} {
  const clauses: SwitchClause[] = []
  let elseExpr: string | undefined
  let remaining = expr

  // Extract .else[...] first (if at end)
  const elseMatch = extractTrailingModifier(remaining, 'else')
  if (elseMatch) {
    elseExpr = elseMatch.content
    remaining = elseMatch.remaining
  }

  // Extract .switch[...] clauses (in reverse order to preserve left-to-right)
  while (true) {
    const switchMatch = extractTrailingModifier(remaining, 'switch')
    if (!switchMatch) break

    const colonIndex = findUnquotedColon(switchMatch.content)
    if (colonIndex === -1) {
      throw new Error(`Invalid switch syntax - missing colon: .switch[${switchMatch.content}]`)
    }

    clauses.unshift({
      condition: switchMatch.content.slice(0, colonIndex).trim(),
      resultExpr: switchMatch.content.slice(colonIndex + 1).trim(),
    })
    remaining = switchMatch.remaining
  }

  if (clauses.length === 0 && !elseExpr) {
    return { baseExpr: expr }
  }

  return {
    baseExpr: remaining,
    switchModifiers: { clauses, elseExpr },
  }
}

/**
 * Parse a standalone switch expression: switch[condition:result].switch[...].else[fallback]
 * Called when expression starts with "switch["
 */
function parseSwitchExpression(expr: string): SwitchToken {
  const clauses: SwitchClause[] = []
  let elseExpr: string | undefined
  let remaining = expr

  // Extract .else[...] first (if at end)
  const elseMatch = extractTrailingModifier(remaining, 'else')
  if (elseMatch) {
    elseExpr = elseMatch.content
    remaining = elseMatch.remaining
  }

  // Extract chained .switch[...] clauses (in reverse order)
  while (true) {
    const switchMatch = extractTrailingModifier(remaining, 'switch')
    if (!switchMatch) break

    const colonIndex = findUnquotedColon(switchMatch.content)
    if (colonIndex === -1) {
      throw new Error(`Invalid switch syntax - missing colon: .switch[${switchMatch.content}]`)
    }

    clauses.unshift({
      condition: switchMatch.content.slice(0, colonIndex).trim(),
      resultExpr: switchMatch.content.slice(colonIndex + 1).trim(),
    })
    remaining = switchMatch.remaining
  }

  // Parse the initial switch[...] (no leading dot)
  const initialMatch = remaining.match(/^switch\[(.+)\]$/)
  if (initialMatch) {
    const colonIndex = findUnquotedColon(initialMatch[1])
    if (colonIndex === -1) {
      throw new Error(`Invalid switch syntax - missing colon: switch[${initialMatch[1]}]`)
    }

    clauses.unshift({
      condition: initialMatch[1].slice(0, colonIndex).trim(),
      resultExpr: initialMatch[1].slice(colonIndex + 1).trim(),
    })
  } else if (remaining !== '') {
    throw new Error(`Invalid switch expression: ${expr}`)
  }

  if (clauses.length === 0) {
    throw new Error(`Switch expression has no clauses: ${expr}`)
  }

  return {
    type: 'switch',
    clauses,
    elseExpr,
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if a string contains any {{...}} expressions
 */
export function hasExpressions(text: string): boolean {
  return extractExpressions(text).length > 0
}

/**
 * Get all table IDs referenced in a template
 */
export function getReferencedTables(pattern: string): string[] {
  const tokens = parseTemplate(pattern)
  const tableIds: Set<string> = new Set()

  for (const token of tokens) {
    if (token.type === 'table') {
      tableIds.add(token.tableId)
    } else if (token.type === 'multiRoll') {
      tableIds.add(token.tableId)
    } else if (token.type === 'instance') {
      tableIds.add(token.tableId)
    } else if (token.type === 'captureMultiRoll') {
      tableIds.add(token.tableId)
    }
  }

  return Array.from(tableIds)
}

/**
 * Get all variable names referenced in a template
 */
export function getReferencedVariables(pattern: string): string[] {
  const tokens = parseTemplate(pattern)
  const variables: Set<string> = new Set()

  for (const token of tokens) {
    if (token.type === 'variable') {
      variables.add(token.name)
    } else if (token.type === 'multiRoll' && typeof token.count === 'string') {
      variables.add(token.count)
    } else if (token.type === 'captureMultiRoll') {
      // Add both the count variable (if any) and the capture variable
      if (typeof token.count === 'string') {
        variables.add(token.count)
      }
      variables.add(token.captureVar)
    } else if (token.type === 'captureAccess') {
      variables.add(token.varName)
    } else if (token.type === 'collect') {
      variables.add(token.varName)
    }
  }

  return Array.from(variables)
}
