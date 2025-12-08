/**
 * Dice Roller Module
 *
 * Parses and evaluates dice notation following the spec:
 * - XdY: Roll X dice with Y sides
 * - +Z, -Z, *Z: Add, subtract, or multiply by Z
 * - kN or khN: Keep highest N dice
 * - klN: Keep lowest N dice
 * - !: Exploding dice (max value re-rolls)
 */

export interface DiceResult {
  /** Final total after all modifiers */
  total: number
  /** Individual dice results before keeps/drops */
  rolls: number[]
  /** Dice kept after keep highest/lowest */
  kept: number[]
  /** The original dice expression */
  expression: string
  /** Breakdown of the roll for display */
  breakdown: string
}

export interface DiceConfig {
  /** Maximum exploding dice re-rolls (default: 100) */
  maxExplodingDice: number
  /** Maximum number of dice that can be rolled at once (default: 1000) */
  maxDiceCount?: number
}

const DEFAULT_CONFIG: DiceConfig = {
  maxExplodingDice: 100,
  maxDiceCount: 1000,
}

/**
 * Parses and rolls a dice expression
 *
 * @example
 * rollDice('3d6')        // Roll 3 six-sided dice
 * rollDice('4d6k3')      // Roll 4d6, keep highest 3
 * rollDice('2d6+5')      // Roll 2d6, add 5
 * rollDice('1d6!')       // Exploding d6
 * rollDice('2d10kl1')    // Roll 2d10, keep lowest 1
 */
export function rollDice(expression: string, config: DiceConfig = DEFAULT_CONFIG): DiceResult {
  const parsed = parseDiceExpression(expression)
  return evaluateDice(parsed, config)
}

// ============================================================================
// Parser
// ============================================================================

interface ParsedDice {
  count: number
  sides: number
  keepHighest?: number
  keepLowest?: number
  exploding: boolean
  modifier: {
    type: '+' | '-' | '*' | null
    value: number
  }
}

/**
 * Regex breakdown:
 * (\d+)d(\d+)     - XdY (count and sides)
 * (k[hl]?\d+)?    - Optional keep: k3, kh3, kl2
 * (!)?            - Optional exploding
 * ([+\-*]\d+)?    - Optional modifier: +5, -2, *10
 */
const DICE_REGEX = /^(\d+)d(\d+)(k[hl]?\d+)?(!)?([+\-*]\d+)?$/i

function parseDiceExpression(expression: string): ParsedDice {
  const cleaned = expression.replace(/\s/g, '').toLowerCase()
  const match = cleaned.match(DICE_REGEX)

  if (!match) {
    throw new Error(`Invalid dice expression: ${expression}`)
  }

  const [, countStr, sidesStr, keepStr, explodingStr, modifierStr] = match

  const count = parseInt(countStr, 10)
  const sides = parseInt(sidesStr, 10)

  if (count < 1 || sides < 1) {
    throw new Error(`Invalid dice: ${count}d${sides} - count and sides must be positive`)
  }

  if (count > 10000) {
    throw new Error(`Too many dice: ${count}d${sides} - maximum 10,000 dice per roll`)
  }

  if (sides > 10000) {
    throw new Error(`Dice sides too large: ${count}d${sides} - maximum 10,000 sides`)
  }

  // Parse keep modifier
  let keepHighest: number | undefined
  let keepLowest: number | undefined

  if (keepStr) {
    const keepMatch = keepStr.match(/k(h|l)?(\d+)/)
    if (keepMatch) {
      const [, type, valueStr] = keepMatch
      const value = parseInt(valueStr, 10)

      if (value < 1 || value > count) {
        throw new Error(`Cannot keep ${value} dice from ${count}d${sides}`)
      }

      if (type === 'l') {
        keepLowest = value
      } else {
        // 'h' or no type means keep highest
        keepHighest = value
      }
    }
  }

  // Parse modifier
  let modifierType: '+' | '-' | '*' | null = null
  let modifierValue = 0

  if (modifierStr) {
    const op = modifierStr[0] as '+' | '-' | '*'
    modifierType = op
    modifierValue = parseInt(modifierStr.slice(1), 10)
  }

  return {
    count,
    sides,
    keepHighest,
    keepLowest,
    exploding: explodingStr === '!',
    modifier: {
      type: modifierType,
      value: modifierValue,
    },
  }
}

// ============================================================================
// Evaluator
// ============================================================================

function evaluateDice(parsed: ParsedDice, config: DiceConfig): DiceResult {
  const { count, sides, keepHighest, keepLowest, exploding, modifier } = parsed

  // Roll all dice
  const rolls: number[] = []
  let explosionCount = 0

  for (let i = 0; i < count; i++) {
    let roll = randomInt(1, sides)
    rolls.push(roll)

    // Handle exploding dice
    if (exploding) {
      while (roll === sides && explosionCount < config.maxExplodingDice) {
        roll = randomInt(1, sides)
        rolls.push(roll)
        explosionCount++
      }
    }
  }

  // Determine which dice to keep
  let kept: number[]

  if (keepHighest !== undefined) {
    // Sort descending and take top N
    kept = [...rolls].sort((a, b) => b - a).slice(0, keepHighest)
  } else if (keepLowest !== undefined) {
    // Sort ascending and take bottom N
    kept = [...rolls].sort((a, b) => a - b).slice(0, keepLowest)
  } else {
    kept = rolls
  }

  // Calculate base total
  let total = kept.reduce((sum, n) => sum + n, 0)

  // Apply modifier
  if (modifier.type === '+') {
    total += modifier.value
  } else if (modifier.type === '-') {
    total -= modifier.value
  } else if (modifier.type === '*') {
    total *= modifier.value
  }

  // Build expression string
  let expression = `${parsed.count}d${parsed.sides}`
  if (parsed.keepHighest) expression += `kh${parsed.keepHighest}`
  if (parsed.keepLowest) expression += `kl${parsed.keepLowest}`
  if (parsed.exploding) expression += '!'
  if (modifier.type) expression += `${modifier.type}${modifier.value}`

  // Build breakdown string for display
  let breakdown = `[${rolls.join(', ')}]`
  if (keepHighest !== undefined || keepLowest !== undefined) {
    breakdown += ` → keep [${kept.join(', ')}]`
  }
  if (modifier.type) {
    const base = kept.reduce((sum, n) => sum + n, 0)
    breakdown += ` → ${base} ${modifier.type} ${modifier.value}`
  }
  breakdown += ` = ${total}`

  return {
    total,
    rolls,
    kept,
    expression,
    breakdown,
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generates a random integer between min and max (inclusive)
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Validates a dice expression without rolling
 */
export function isValidDiceExpression(expression: string): boolean {
  try {
    parseDiceExpression(expression)
    return true
  } catch {
    return false
  }
}

/**
 * Extracts all dice expressions from a template string
 */
export function extractDiceExpressions(template: string): string[] {
  const regex = /\{\{dice:([^}]+)\}\}/g
  const matches: string[] = []
  let match

  while ((match = regex.exec(template)) !== null) {
    matches.push(match[1])
  }

  return matches
}
