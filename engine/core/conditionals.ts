/**
 * Condition Expression Evaluation
 *
 * Implements condition expression parsing and evaluation for switch expressions.
 * Supports comparison operators and logical operators.
 */

import type { GenerationContext } from './context'
import { resolveVariable, getPlaceholder, getSharedVariable } from './context'

// ============================================================================
// Types
// ============================================================================

type ComparisonOperator = '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'matches'

// ============================================================================
// Expression Parsing
// ============================================================================

/**
 * Tokenize a when-clause expression
 */
function tokenize(expr: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''

  for (let i = 0; i < expr.length; i++) {
    const char = expr[i]

    if (inQuote) {
      if (char === quoteChar) {
        tokens.push(current)
        current = ''
        inQuote = false
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      if (current) tokens.push(current)
      current = ''
      inQuote = true
      quoteChar = char
    } else if (char === ' ' || char === '\t') {
      if (current) tokens.push(current)
      current = ''
    } else if (char === '(' || char === ')') {
      if (current) tokens.push(current)
      tokens.push(char)
      current = ''
    } else if (char === '&' && expr[i + 1] === '&') {
      if (current) tokens.push(current)
      tokens.push('&&')
      current = ''
      i++ // Skip next &
    } else if (char === '|' && expr[i + 1] === '|') {
      if (current) tokens.push(current)
      tokens.push('||')
      current = ''
      i++ // Skip next |
    } else if (char === '!' && expr[i + 1] !== '=') {
      if (current) tokens.push(current)
      tokens.push('!')
      current = ''
    } else if (char === '=' && expr[i + 1] === '=') {
      if (current) tokens.push(current)
      tokens.push('==')
      current = ''
      i++ // Skip next =
    } else if (char === '!' && expr[i + 1] === '=') {
      if (current) tokens.push(current)
      tokens.push('!=')
      current = ''
      i++ // Skip next =
    } else if (char === '>' && expr[i + 1] === '=') {
      if (current) tokens.push(current)
      tokens.push('>=')
      current = ''
      i++ // Skip next =
    } else if (char === '<' && expr[i + 1] === '=') {
      if (current) tokens.push(current)
      tokens.push('<=')
      current = ''
      i++ // Skip next =
    } else if (char === '>' || char === '<') {
      if (current) tokens.push(current)
      tokens.push(char)
      current = ''
    } else {
      current += char
    }
  }

  if (current) tokens.push(current)
  return tokens.filter(t => t.length > 0)
}

// ============================================================================
// Value Resolution
// ============================================================================

/**
 * Resolve a value reference from the context
 * Handles @placeholder.property, $variable, and $var.@property syntax
 */
function resolveValue(
  ref: string,
  context: GenerationContext
): string | number | undefined {
  if (ref.startsWith('@')) {
    // Placeholder: @name or @name.property
    const parts = ref.slice(1).split('.')
    const name = parts[0]
    const property = parts[1]
    return getPlaceholder(context, name, property)
  } else if (ref.startsWith('$')) {
    // Check for shared variable with property access: $var.@property
    const propMatch = ref.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)\.@([a-zA-Z_][a-zA-Z0-9_]*)$/)
    if (propMatch) {
      const varName = propMatch[1]
      const propName = propMatch[2]
      const captureShared = getSharedVariable(context, varName)
      if (captureShared) {
        // Access the property from the captured sets
        const propValue = captureShared.sets[propName]
        if (propValue !== undefined) {
          // Handle nested CaptureItem (when set value was a table reference)
          if (typeof propValue === 'object' && 'value' in propValue) {
            return propValue.value
          }
          return propValue
        }
        return undefined
      }
    }
    // Regular variable: $name
    const name = ref.slice(1)
    return resolveVariable(context, name)
  } else {
    // Literal value - try to parse as number
    const num = parseFloat(ref)
    if (!isNaN(num) && isFinite(num)) {
      return num
    }
    return ref
  }
}

// ============================================================================
// Comparison Evaluation
// ============================================================================

function compare(
  left: string | number | undefined,
  operator: ComparisonOperator,
  right: string | number | undefined
): boolean {
  // Handle undefined
  if (left === undefined) left = ''
  if (right === undefined) right = ''

  switch (operator) {
    case '==':
      return String(left) === String(right)

    case '!=':
      return String(left) !== String(right)

    case '>':
      return Number(left) > Number(right)

    case '<':
      return Number(left) < Number(right)

    case '>=':
      return Number(left) >= Number(right)

    case '<=':
      return Number(left) <= Number(right)

    case 'contains':
      return String(left).toLowerCase().includes(String(right).toLowerCase())

    case 'matches':
      try {
        const regex = new RegExp(String(right), 'i')
        return regex.test(String(left))
      } catch {
        return false
      }

    default:
      return false
  }
}

// ============================================================================
// Expression Evaluation
// ============================================================================

/**
 * Evaluate a when-clause expression (used by switch expressions)
 */
export function evaluateWhenClause(
  when: string,
  context: GenerationContext
): boolean {
  const tokens = tokenize(when)
  return evaluateTokens(tokens, context)
}

function evaluateTokens(tokens: string[], context: GenerationContext): boolean {
  if (tokens.length === 0) return false

  // Handle NOT operator
  if (tokens[0] === '!') {
    return !evaluateTokens(tokens.slice(1), context)
  }

  // Handle parentheses
  if (tokens[0] === '(') {
    let depth = 1
    let i = 1
    while (i < tokens.length && depth > 0) {
      if (tokens[i] === '(') depth++
      if (tokens[i] === ')') depth--
      i++
    }
    const inner = tokens.slice(1, i - 1)
    const innerResult = evaluateTokens(inner, context)

    // Continue with rest of expression
    const rest = tokens.slice(i)
    if (rest.length === 0) return innerResult

    if (rest[0] === '&&') {
      return innerResult && evaluateTokens(rest.slice(1), context)
    } else if (rest[0] === '||') {
      return innerResult || evaluateTokens(rest.slice(1), context)
    }
    return innerResult
  }

  // Find logical operators at the top level (outside parentheses)
  let depth = 0
  let orIndex = -1
  let andIndex = -1

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '(') depth++
    else if (tokens[i] === ')') depth--
    else if (depth === 0) {
      if (tokens[i] === '||' && orIndex === -1) orIndex = i
      else if (tokens[i] === '&&' && andIndex === -1) andIndex = i
    }
  }

  // Evaluate OR first (lower precedence)
  if (orIndex !== -1) {
    const left = evaluateTokens(tokens.slice(0, orIndex), context)
    const right = evaluateTokens(tokens.slice(orIndex + 1), context)
    return left || right
  }

  // Then AND
  if (andIndex !== -1) {
    const left = evaluateTokens(tokens.slice(0, andIndex), context)
    const right = evaluateTokens(tokens.slice(andIndex + 1), context)
    return left && right
  }

  // Simple comparison: left operator right
  if (tokens.length >= 3) {
    const left = tokens[0]
    const operator = tokens[1] as ComparisonOperator
    const right = tokens.slice(2).join(' ')

    const leftValue = resolveValue(left, context)
    const rightValue = resolveValue(right, context)

    return compare(leftValue, operator, rightValue)
  }

  // Single value - check if truthy
  if (tokens.length === 1) {
    const value = resolveValue(tokens[0], context)
    return Boolean(value)
  }

  return false
}
