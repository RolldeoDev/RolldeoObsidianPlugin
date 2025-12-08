/**
 * Math Expression Evaluator
 *
 * Parses and evaluates {{math:...}} expressions.
 * Supports operators, variables, placeholders, and inline dice.
 */

import type { GenerationContext } from './context'
import { resolveVariable, getPlaceholder, getSharedVariable } from './context'
import { rollDice } from '../dice'

// ============================================================================
// Types
// ============================================================================

type TokenType =
  | 'NUMBER'
  | 'OPERATOR'
  | 'LPAREN'
  | 'RPAREN'
  | 'VARIABLE'
  | 'PLACEHOLDER'
  | 'CAPTURE_ACCESS'
  | 'DICE'
  | 'EOF'

interface Token {
  type: TokenType
  value: string | number
}

// ============================================================================
// Tokenizer
// ============================================================================

/**
 * Tokenize a math expression into tokens
 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < expr.length) {
    const char = expr[i]

    // Skip whitespace
    if (/\s/.test(char)) {
      i++
      continue
    }

    // Number
    if (/\d/.test(char)) {
      let num = ''
      while (i < expr.length && /\d/.test(expr[i])) {
        num += expr[i]
        i++
      }
      tokens.push({ type: 'NUMBER', value: parseInt(num, 10) })
      continue
    }

    // Operators
    if ('+-*/'.includes(char)) {
      tokens.push({ type: 'OPERATOR', value: char })
      i++
      continue
    }

    // Parentheses
    if (char === '(') {
      tokens.push({ type: 'LPAREN', value: '(' })
      i++
      continue
    }

    if (char === ')') {
      tokens.push({ type: 'RPAREN', value: ')' })
      i++
      continue
    }

    // Variable or Capture Access: $varName or $varName.@property
    if (char === '$') {
      let name = ''
      i++ // Skip $
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
        name += expr[i]
        i++
      }

      // Check for capture access syntax: .@property or .@property.@nested
      if (i < expr.length - 1 && expr[i] === '.' && expr[i + 1] === '@') {
        const properties: string[] = []

        // Parse all .@property chains
        while (i < expr.length - 1 && expr[i] === '.' && expr[i + 1] === '@') {
          i += 2 // Skip .@
          let prop = ''
          while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
            prop += expr[i]
            i++
          }
          if (prop) {
            properties.push(prop)
          }
        }

        if (properties.length > 0) {
          // Store as "varName:prop1:prop2" for parsing
          tokens.push({ type: 'CAPTURE_ACCESS', value: `${name}:${properties.join(':')}` })
          continue
        }
      }

      tokens.push({ type: 'VARIABLE', value: name })
      continue
    }

    // Placeholder: @name or @name.property
    if (char === '@') {
      let placeholder = ''
      i++ // Skip @
      while (i < expr.length && /[a-zA-Z0-9_.]/.test(expr[i])) {
        placeholder += expr[i]
        i++
      }
      tokens.push({ type: 'PLACEHOLDER', value: placeholder })
      continue
    }

    // Dice: dice:XdY...
    if (expr.slice(i, i + 5) === 'dice:') {
      i += 5 // Skip 'dice:'
      let diceExpr = ''
      // Read until we hit a space, operator, or end
      while (i < expr.length && !/[\s+\-*/()]/.test(expr[i])) {
        diceExpr += expr[i]
        i++
      }
      tokens.push({ type: 'DICE', value: diceExpr })
      continue
    }

    // Unknown character - skip it
    i++
  }

  tokens.push({ type: 'EOF', value: '' })
  return tokens
}

// ============================================================================
// Parser (Recursive Descent)
// ============================================================================

class MathParser {
  private tokens: Token[]
  private pos: number
  private context: GenerationContext

  constructor(tokens: Token[], context: GenerationContext) {
    this.tokens = tokens
    this.pos = 0
    this.context = context
  }

  private current(): Token {
    return this.tokens[this.pos] ?? { type: 'EOF', value: '' }
  }

  private advance(): Token {
    const token = this.current()
    if (token.type !== 'EOF') {
      this.pos++
    }
    return token
  }

  private expect(type: TokenType): Token {
    const token = this.current()
    if (token.type !== type) {
      throw new Error(`Expected ${type}, got ${token.type}`)
    }
    return this.advance()
  }

  /**
   * Parse the expression
   * Grammar:
   *   expr     → term (('+' | '-') term)*
   *   term     → factor (('*' | '/') factor)*
   *   factor   → primary | '(' expr ')'
   *   primary  → NUMBER | VARIABLE | PLACEHOLDER | DICE
   */
  parse(): number {
    const result = this.parseExpression()
    if (this.current().type !== 'EOF') {
      throw new Error(`Unexpected token: ${this.current().value}`)
    }
    return result
  }

  private parseExpression(): number {
    let left = this.parseTerm()

    while (this.current().type === 'OPERATOR' && '+-'.includes(this.current().value as string)) {
      const op = this.advance().value as string
      const right = this.parseTerm()

      if (op === '+') {
        left = left + right
      } else {
        left = left - right
      }
    }

    return left
  }

  private parseTerm(): number {
    let left = this.parseFactor()

    while (this.current().type === 'OPERATOR' && '*/'.includes(this.current().value as string)) {
      const op = this.advance().value as string
      const right = this.parseFactor()

      if (op === '*') {
        left = left * right
      } else {
        // Integer division, handle division by zero
        // Per spec 14.2.6: "round toward zero" (truncate, not floor)
        if (right === 0) {
          console.warn('Division by zero in math expression, returning 0')
          left = 0
        } else {
          left = Math.trunc(left / right)
        }
      }
    }

    return left
  }

  private parseFactor(): number {
    const token = this.current()

    // Handle unary minus
    if (token.type === 'OPERATOR' && token.value === '-') {
      this.advance()
      return -this.parseFactor()
    }

    // Handle parentheses
    if (token.type === 'LPAREN') {
      this.advance() // Skip (
      const result = this.parseExpression()
      this.expect('RPAREN')
      return result
    }

    return this.parsePrimary()
  }

  private parsePrimary(): number {
    const token = this.advance()

    switch (token.type) {
      case 'NUMBER':
        return token.value as number

      case 'VARIABLE': {
        const value = resolveVariable(this.context, token.value as string)
        return this.coerceToNumber(value, `$${token.value}`)
      }

      case 'PLACEHOLDER': {
        const placeholder = token.value as string
        const [name, property] = placeholder.split('.')
        const value = getPlaceholder(this.context, name, property)
        return this.coerceToNumber(value, `@${placeholder}`)
      }

      case 'DICE': {
        const result = rollDice(token.value as string, {
          maxExplodingDice: this.context.config.maxExplodingDice,
        })
        return result.total
      }

      case 'CAPTURE_ACCESS': {
        // Format: "varName:prop1:prop2"
        const parts = (token.value as string).split(':')
        const varName = parts[0]
        const properties = parts.slice(1)

        const captureItem = getSharedVariable(this.context, varName)
        if (!captureItem) {
          console.warn(`Capture variable not found: $${varName}`)
          return 0
        }

        // Traverse the property chain
        let current = captureItem
        for (let i = 0; i < properties.length; i++) {
          const prop = properties[i]
          const propValue = current.sets[prop]

          if (propValue === undefined) {
            console.warn(`Property not found: $${varName}.@${properties.slice(0, i + 1).join('.@')}`)
            return 0
          }

          // If this is the last property, coerce to number
          if (i === properties.length - 1) {
            if (typeof propValue === 'string') {
              return this.coerceToNumber(propValue, `$${varName}.@${properties.join('.@')}`)
            } else {
              // Nested CaptureItem - return its value
              return this.coerceToNumber(propValue.value, `$${varName}.@${properties.join('.@')}`)
            }
          }

          // Need to continue traversing - must be a nested CaptureItem
          if (typeof propValue === 'string') {
            console.warn(`Cannot chain through string property: $${varName}.@${properties.slice(0, i + 1).join('.@')}`)
            return 0
          }

          current = propValue
        }

        // Shouldn't reach here
        return 0
      }

      default:
        throw new Error(`Unexpected token type: ${token.type}`)
    }
  }

  private coerceToNumber(value: string | number | undefined, source: string): number {
    if (value === undefined) {
      console.warn(`Undefined value for ${source}, using 0`)
      return 0
    }

    if (typeof value === 'number') {
      return value
    }

    const num = parseInt(value, 10)
    if (isNaN(num)) {
      console.warn(`Non-numeric value "${value}" for ${source}, using 0`)
      return 0
    }

    return num
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Evaluate a math expression
 *
 * @returns The evaluated number, or null if evaluation failed
 *
 * @example
 * evaluateMath('2 + 3 * 4', context)  // 14
 * evaluateMath('$count + 5', context)  // depends on $count
 * evaluateMath('dice:2d6 * 10', context)  // random
 */
export function evaluateMath(expr: string, context: GenerationContext): number | null {
  try {
    const tokens = tokenize(expr)
    const parser = new MathParser(tokens, context)
    return parser.parse()
  } catch (error) {
    console.error(`Math evaluation error: ${expr}`, error)
    return null
  }
}

/**
 * Check if an expression is a valid math expression
 */
export function isValidMathExpression(expr: string): boolean {
  try {
    tokenize(expr)
    return true
  } catch {
    return false
  }
}
