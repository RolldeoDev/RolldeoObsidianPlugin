/**
 * Expression Evaluator
 *
 * Evaluates template expressions ({{...}} syntax) within a generation context.
 * Handles all expression types: dice, math, variables, placeholders, tables, multi-rolls,
 * instances, captures, and collect operations.
 */

import type {
  Table,
  Template,
  LoadedCollection,
  RollResult,
  Sets,
  EvaluatedSets,
  CaptureItem,
  CaptureVariable,
  Assets,
} from '../types'

import { rollDice } from '../dice'
import {
  incrementRecursion,
  decrementRecursion,
  resolveVariable,
  getPlaceholder,
  getPlaceholderCaptureItem,
  setPlaceholders,
  setInstance,
  getInstance,
  getSharedVariable,
  setSharedVariable,
  hasSharedVariable,
  wouldShadowDocumentShared,
  getCaptureVariable,
  setCaptureVariable,
  hasVariableConflict,
  beginSetEvaluation,
  endSetEvaluation,
  type GenerationContext,
} from './context'
import {
  parseTemplate,
  parseExpression,
  extractExpressions,
  type ExpressionToken,
  type SwitchModifiers,
  type SwitchToken,
} from './parser'
import { evaluateMath } from './math'
import { evaluateWhenClause } from './conditionals'
import {
  beginTraceNode,
  endTraceNode,
  addTraceLeaf,
  type DiceRollMetadata,
  type VariableAccessMetadata,
  type PlaceholderAccessMetadata,
  type MultiRollMetadata,
  type InstanceMetadata,
  type CaptureMultiRollMetadata,
  type CaptureAccessMetadata,
  type CollectMetadata,
} from './trace'
import type { TableResolution, TemplateResolution } from './resolver'

// ============================================================================
// Types
// ============================================================================

/**
 * Result from rolling a table, used internally by the evaluator
 */
export interface TableRollResult {
  text: string
  resultType?: string
  assets?: Assets
  placeholders?: EvaluatedSets
  entryId?: string
}

/**
 * Dependencies required by the ExpressionEvaluator.
 * These are injected by the engine to avoid circular dependencies.
 */
export interface EvaluatorDependencies {
  /** Resolve a table reference to get the table and its collection ID */
  resolveTableRef: (ref: string, collectionId: string) => TableResolution | undefined

  /** Resolve a template reference to get the template and its collection ID */
  resolveTemplateRef: (ref: string, collectionId: string) => TemplateResolution | undefined

  /** Roll on a table and return the result */
  rollTable: (
    table: Table,
    context: GenerationContext,
    collectionId: string,
    options?: { unique?: boolean; excludeIds?: Set<string> }
  ) => TableRollResult

  /** Get a loaded collection by ID */
  getCollection: (id: string) => LoadedCollection | undefined

  /** Get a table by ID, optionally scoped to a collection */
  getTable: (tableId: string, collectionId?: string) => Table | undefined
}

// ============================================================================
// Expression Evaluator Class
// ============================================================================

/**
 * Evaluates template expressions within a generation context.
 */
export class ExpressionEvaluator {
  constructor(private deps: EvaluatorDependencies) {}

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Evaluate a pattern string, replacing all {{...}} expressions with their values.
   */
  evaluatePattern(pattern: string, context: GenerationContext, collectionId: string): string {
    const tokens = parseTemplate(pattern)
    return tokens.map((token) => this.evaluateToken(token, context, collectionId)).join('')
  }

  /**
   * Evaluate pattern and capture individual expression outputs for segment mapping.
   * Uses extractExpressions to identify expression positions and captures each output.
   */
  evaluatePatternWithOutputs(
    pattern: string,
    context: GenerationContext,
    collectionId: string
  ): { text: string; expressionOutputs: string[] } {
    const expressions = extractExpressions(pattern)
    const expressionOutputs: string[] = []
    let result = ''
    let lastIndex = 0

    for (const expr of expressions) {
      // Add literal text before this expression
      if (expr.start > lastIndex) {
        result += pattern.slice(lastIndex, expr.start)
      }

      // Parse and evaluate the expression
      const token = parseExpression(expr.expression)
      const output = this.evaluateToken(token, context, collectionId)

      result += output
      expressionOutputs.push(output)
      lastIndex = expr.end
    }

    // Add remaining literal text
    if (lastIndex < pattern.length) {
      result += pattern.slice(lastIndex)
    }

    return { text: result, expressionOutputs }
  }

  /**
   * Evaluate set values that contain patterns.
   * Set values are evaluated at merge time (when entry is selected) to ensure consistency.
   * Only values containing {{}} are evaluated; plain strings are returned as-is.
   * Uses cycle detection to prevent infinite loops from self-referential sets.
   *
   * Sets are evaluated in order and immediately merged into context, allowing later
   * sets to reference earlier ones via @tableId.setKey syntax.
   */
  evaluateSetValues(
    sets: Sets,
    context: GenerationContext,
    collectionId: string,
    tableId: string
  ): EvaluatedSets {
    const evaluated: EvaluatedSets = {}

    for (const [key, value] of Object.entries(sets)) {
      if (value.includes('{{')) {
        // This value contains a pattern - evaluate it
        const setKey = `${tableId}.${key}`

        if (!beginSetEvaluation(context, setKey)) {
          // Cycle detected - return raw value to prevent infinite loop
          evaluated[key] = value
          // Still merge into context so other sets can see it (even as raw value)
          setPlaceholders(context, tableId, { [key]: evaluated[key] })
          continue
        }

        try {
          // Check if this is a single table reference - if so, capture full result
          // This enables nested property access like {{$parent.@child.@grandchild}}
          const expressions = extractExpressions(value)
          if (expressions.length === 1 && value.trim() === expressions[0].raw) {
            const token = parseExpression(expressions[0].expression)
            if (token.type === 'table') {
              // Roll table and capture full result including nested sets
              const tableResult = this.deps.resolveTableRef(token.tableId, collectionId)
              if (tableResult) {
                const result = this.deps.rollTable(tableResult.table, context, tableResult.collectionId)
                evaluated[key] = {
                  value: result.text,
                  sets: result.placeholders ?? {},
                  description: undefined,
                }
                // Merge immediately so later sets can reference this one
                setPlaceholders(context, tableId, { [key]: evaluated[key] })
                continue
              }
            }
          }
          // Fallback: evaluate as string for complex expressions
          evaluated[key] = this.evaluatePattern(value, context, collectionId)
        } finally {
          endSetEvaluation(context, setKey)
        }
      } else {
        // Plain string value - use as-is
        evaluated[key] = value
      }

      // Merge each evaluated set immediately into context, enabling later sets
      // to reference earlier ones via @tableId.setKey syntax
      setPlaceholders(context, tableId, { [key]: evaluated[key] })
    }

    return evaluated
  }

  // ==========================================================================
  // Shared Variables Evaluation
  // ==========================================================================

  /**
   * Evaluate shared variables at generation start.
   * Processed in order - later variables can reference earlier ones.
   *
   * All shared variables store full results including sets.
   * This enables {{$varName.@prop}} access for any shared variable.
   * The $ prefix on keys is optional and accepted for backward compatibility.
   */
  evaluateSharedVariables(
    shared: Record<string, string>,
    context: GenerationContext,
    collectionId: string
  ): void {
    for (const [name, expression] of Object.entries(shared)) {
      // Strip $ prefix if present (for backward compatibility)
      const varName = name.startsWith('$') ? name.slice(1) : name
      // All shared variables capture full results
      this.evaluateSharedVariable(varName, expression, context, collectionId)
    }
  }

  /**
   * Evaluate a shared variable and capture its full result.
   * Captures the full roll result including sets for {{$varName.@prop}} access.
   */
  evaluateSharedVariable(
    varName: string,
    expression: string,
    context: GenerationContext,
    collectionId: string
  ): void {
    // Parse the expression to check if it's a simple table reference
    const expressions = extractExpressions(expression)

    // If it's a single expression that's a table or template reference, capture the full result
    if (expressions.length === 1) {
      const token = parseExpression(expressions[0].expression)

      if (token.type === 'table') {
        // Resolve and roll the table, capturing the result with sets
        const tableResult = this.deps.resolveTableRef(token.tableId, collectionId)
        if (tableResult) {
          // Track description count before roll to find new descriptions
          const descCountBefore = context.collectedDescriptions.length
          const result = this.deps.rollTable(tableResult.table, context, tableResult.collectionId)

          // Get the first description added by this roll (the entry's own description)
          // Nested rolls may add more, but the first new one is the direct entry description
          const newDescriptions = context.collectedDescriptions.slice(descCountBefore)
          const entryDescription = newDescriptions.length > 0 ? newDescriptions[0].description : undefined

          // Sets are already evaluated at merge time in evaluateSetValues()
          // Just use the placeholders directly
          setSharedVariable(context, varName, {
            value: result.text,
            sets: result.placeholders ?? {},
            description: entryDescription,
          })
          return
        }

        // Not a table - try template
        const templateResult = this.deps.resolveTemplateRef(token.tableId, collectionId)
        if (templateResult) {
          // Evaluate template and capture its shared variables
          const result = this.evaluateTemplateWithCapture(
            templateResult.template,
            templateResult.collectionId,
            context
          )
          setSharedVariable(context, varName, result)
          return
        }
      }

      // Handle capture access with properties - check if it references a nested CaptureItem
      // This enables chaining: "$situation": "{{$conflict.@situation}}" where @situation is a nested CaptureItem
      // Also supports deep chaining: "$deep": "{{$conflict.@situation.@focus}}"
      if (token.type === 'captureAccess' && token.properties && token.properties.length > 0) {
        const sourceCapture = getSharedVariable(context, token.varName)
        if (sourceCapture) {
          // Check if the final property is a terminal (value/count/description)
          const lastProp = token.properties[token.properties.length - 1]
          if (lastProp !== 'value' && lastProp !== 'count' && lastProp !== 'description') {
            // Try to get the nested CaptureItem at the end of the property chain
            const nestedItem = this.getNestedCaptureItem(sourceCapture, token.properties)
            if (nestedItem) {
              // It's a nested CaptureItem - store it directly to enable further chaining
              setSharedVariable(context, varName, nestedItem)
              return
            }
          }
        }
      }

      // Handle switch expressions - evaluate to find winning result, then check if it's a table
      if (token.type === 'switch') {
        const winningResultExpr = this.evaluateSwitchToResultExpr(token, context, collectionId)
        if (winningResultExpr) {
          // Try to parse the winning result as a table reference
          const resultExpr = winningResultExpr.trim()

          // Check if it's an unwrapped table reference (e.g., "wizardTable")
          if (!resultExpr.startsWith('"') && !resultExpr.startsWith("'") && !resultExpr.includes('{{')) {
            // Try to resolve as table reference
            const tableResult = this.deps.resolveTableRef(resultExpr, collectionId)
            if (tableResult) {
              // It's a table! Roll it and capture the full result
              const descCountBefore = context.collectedDescriptions.length
              const result = this.deps.rollTable(tableResult.table, context, tableResult.collectionId)

              const newDescriptions = context.collectedDescriptions.slice(descCountBefore)
              const entryDescription = newDescriptions.length > 0 ? newDescriptions[0].description : undefined

              setSharedVariable(context, varName, {
                value: result.text,
                sets: result.placeholders ?? {},
                description: entryDescription,
              })
              return
            }
          }

          // Check if it's a wrapped expression like {{maleHairStyle}}
          if (resultExpr.includes('{{')) {
            // Extract and parse expressions from the result
            const resultExpressions = extractExpressions(resultExpr)

            // If it's a single wrapped expression, check if it's a table or template reference
            if (resultExpressions.length === 1 && resultExpr.trim() === resultExpressions[0].raw) {
              const resultToken = parseExpression(resultExpressions[0].expression)

              if (resultToken.type === 'table') {
                // It's a wrapped table reference! Resolve and roll it
                const tableResult = this.deps.resolveTableRef(resultToken.tableId, collectionId)
                if (tableResult) {
                  const descCountBefore = context.collectedDescriptions.length
                  const result = this.deps.rollTable(tableResult.table, context, tableResult.collectionId)

                  const newDescriptions = context.collectedDescriptions.slice(descCountBefore)
                  const entryDescription = newDescriptions.length > 0 ? newDescriptions[0].description : undefined

                  setSharedVariable(context, varName, {
                    value: result.text,
                    sets: result.placeholders ?? {},
                    description: entryDescription,
                  })
                  return
                }

                // Not a table - try template
                const templateResult = this.deps.resolveTemplateRef(resultToken.tableId, collectionId)
                if (templateResult) {
                  const result = this.evaluateTemplateWithCapture(
                    templateResult.template,
                    templateResult.collectionId,
                    context
                  )
                  setSharedVariable(context, varName, result)
                  return
                }
              }
            }
          }

          // Not a simple table reference - evaluate the result expression normally
          const evaluated = this.evaluateSwitchResult(winningResultExpr, context, collectionId)
          setSharedVariable(context, varName, {
            value: evaluated,
            sets: {},
          })
          return
        }
      }
    }

    // Fallback: For complex expressions, evaluate and capture with empty sets
    // This supports patterns like "$result": "{{dice:1d6}} {{table}}"
    const evaluated = this.evaluatePattern(expression, context, collectionId)
    setSharedVariable(context, varName, {
      value: evaluated,
      sets: {},
    })
  }

  /**
   * Evaluate table/template-level shared variables at roll time.
   * Validates that names don't shadow document-level shared variables.
   * Processed in order - later variables can reference earlier ones.
   *
   * All shared variables store full results including sets.
   * The $ prefix on keys is optional and accepted for backward compatibility.
   */
  evaluateTableLevelShared(
    shared: Record<string, string>,
    context: GenerationContext,
    collectionId: string,
    sourceId: string
  ): void {
    for (const [name, expression] of Object.entries(shared)) {
      // Strip $ prefix if present (for backward compatibility)
      const varName = name.startsWith('$') ? name.slice(1) : name

      // Check for shadowing document-level shared (check both with and without $ prefix)
      if (wouldShadowDocumentShared(context, name) || wouldShadowDocumentShared(context, varName)) {
        throw new Error(
          `SHARED_SHADOW in ${sourceId}: Table/template-level shared variable '${name}' ` +
            `would shadow document-level shared variable. ` +
            `Document-level shared variables take precedence.`
        )
      }

      // Check for shadowing static variables
      if (context.staticVariables.has(varName)) {
        throw new Error(
          `SHARED_SHADOW in ${sourceId}: Shared variable '${name}' ` +
            `would shadow static variable.`
        )
      }

      // If already set by a parent table (propagated down), skip
      // This allows nested tables to inherit shared from parent without error
      if (hasSharedVariable(context, varName)) {
        continue
      }

      // All shared variables capture full results
      this.evaluateSharedVariable(varName, expression, context, collectionId)
    }
  }

  // ==========================================================================
  // Token Evaluation
  // ==========================================================================

  /**
   * Evaluate a single expression token.
   * If the token has switchModifiers attached, applies them after evaluating the base token.
   */
  evaluateToken(token: ExpressionToken, context: GenerationContext, collectionId: string): string {
    let result: string

    switch (token.type) {
      case 'literal':
        result = token.text
        break

      case 'dice':
        result = this.evaluateDice(token.expression, context)
        break

      case 'math': {
        const mathResult = evaluateMath(token.expression, context)
        result = mathResult !== null ? String(mathResult) : '[math error]'
        break
      }

      case 'variable':
        result = this.evaluateVariable(token, context)
        break

      case 'placeholder':
        result = this.evaluatePlaceholder(token, context, collectionId)
        break

      case 'table':
        result = this.evaluateTableRefExpr(token, context, collectionId)
        break

      case 'multiRoll':
        result = this.evaluateMultiRoll(token, context, collectionId)
        break

      case 'again':
        result = this.evaluateAgain(token, context, collectionId)
        break

      case 'instance':
        result = this.evaluateInstance(token, context, collectionId)
        break

      case 'captureMultiRoll':
        result = this.evaluateCaptureMultiRoll(token, context, collectionId)
        break

      case 'captureAccess':
        result = this.evaluateCaptureAccess(token, context)
        break

      case 'collect':
        result = this.evaluateCollect(token, context)
        break

      case 'switch':
        // Standalone switch - no base result, just evaluate the switch itself
        return this.evaluateSwitchExpression(token, context, collectionId)

      default:
        result = ''
    }

    // Check for attached switch modifiers and apply them
    const tokenWithSwitch = token as ExpressionToken & { switchModifiers?: SwitchModifiers }
    if (tokenWithSwitch.switchModifiers) {
      return this.evaluateSwitchModifiers(result, tokenWithSwitch.switchModifiers, context, collectionId)
    }

    return result
  }

  // ==========================================================================
  // Type-Specific Evaluation Methods
  // ==========================================================================

  private evaluateDice(expression: string, context: GenerationContext): string {
    const result = rollDice(expression, {
      maxExplodingDice: context.config.maxExplodingDice,
    })

    // Parse expression to extract modifier info for trace
    const modifierMatch = expression.match(/([+\-*])(\d+)$/)
    const modifier = modifierMatch
      ? {
          operator: modifierMatch[1] as '+' | '-' | '*',
          value: parseInt(modifierMatch[2], 10),
        }
      : undefined

    // Add dice roll trace with full breakdown
    addTraceLeaf(
      context,
      'dice_roll',
      `Dice: ${expression}`,
      {
        raw: expression,
      },
      {
        value: result.total,
      },
      {
        type: 'dice',
        expression: result.expression,
        rolls: result.rolls,
        kept: result.kept,
        modifier,
        exploded: result.rolls.length > (parseInt(expression.match(/^(\d+)d/)?.[1] || '1', 10)),
        breakdown: result.breakdown,
      } as DiceRollMetadata
    )

    return String(result.total)
  }

  private evaluateVariable(
    token: { name: string; alias?: string },
    context: GenerationContext
  ): string {
    // Check capture variables first (from >> $var syntax)
    // When $var is parsed as a variable (not capture access), we still want to
    // return all captured values if it's a capture variable
    const capture = getCaptureVariable(context, token.name)
    if (capture) {
      const values = capture.items.map((item) => item.value)
      const result = values.join(', ')

      addTraceLeaf(
        context,
        'variable_access',
        `$${token.alias ? token.alias + '.' : ''}${token.name}`,
        {
          raw: token.name,
          parsed: { alias: token.alias },
        },
        {
          value: result,
        },
        {
          type: 'variable',
          name: token.name,
          source: 'capture',
        } as VariableAccessMetadata
      )

      return result
    }

    // Check shared variables (which capture full results)
    const captureShared = getSharedVariable(context, token.name)
    if (captureShared) {
      // Add variable access trace
      addTraceLeaf(
        context,
        'variable_access',
        `$${token.alias ? token.alias + '.' : ''}${token.name}`,
        {
          raw: token.name,
          parsed: { alias: token.alias },
        },
        {
          value: captureShared.value,
        },
        {
          type: 'variable',
          name: token.name,
          source: 'captureShared',
        } as VariableAccessMetadata
      )

      return captureShared.value
    }

    const value = resolveVariable(context, token.name)
    const result = value !== undefined ? String(value) : ''

    // Determine variable source
    let source: 'static' | 'shared' | 'undefined' = 'undefined'
    if (hasSharedVariable(context, token.name)) {
      source = 'shared'
    } else if (context.staticVariables.has(token.name)) {
      source = 'static'
    }

    // Add variable access trace
    addTraceLeaf(
      context,
      'variable_access',
      `$${token.alias ? token.alias + '.' : ''}${token.name}`,
      {
        raw: token.name,
        parsed: { alias: token.alias },
      },
      {
        value: result,
      },
      {
        type: 'variable',
        name: token.name,
        source,
      } as VariableAccessMetadata
    )

    return result
  }

  private evaluatePlaceholder(
    token: { name: string; properties?: string[] },
    context: GenerationContext,
    collectionId: string
  ): string {
    // Build label for trace
    const label = token.properties && token.properties.length > 0
      ? `@${token.name}.${token.properties.map(p => p.startsWith('@') ? p : `@${p}`).join('.')}`
      : `@${token.name}`

    // Handle @self placeholder for current entry properties
    if (token.name === 'self') {
      const firstProp = token.properties?.[0]
      if (firstProp === 'description') {
        const rawDescription = context.currentEntryDescription ?? ''
        // Evaluate any expressions in the description
        const result = rawDescription ? this.evaluatePattern(rawDescription, context, collectionId) : ''

        // Add placeholder access trace
        addTraceLeaf(
          context,
          'placeholder_access',
          `@self.description`,
          {
            raw: 'self',
            parsed: { properties: token.properties },
          },
          {
            value: result,
          },
          {
            type: 'placeholder',
            name: 'self',
            property: 'description',
            found: rawDescription !== '',
          } as PlaceholderAccessMetadata
        )

        return result
      }
      if (firstProp === 'value') {
        // Return the raw entry value (before expression evaluation)
        const rawValue = context.currentEntryValue ?? ''

        // Add placeholder access trace
        addTraceLeaf(
          context,
          'placeholder_access',
          `@self.value`,
          {
            raw: 'self',
            parsed: { properties: token.properties },
          },
          {
            value: rawValue,
          },
          {
            type: 'placeholder',
            name: 'self',
            property: 'value',
            found: rawValue !== '',
          } as PlaceholderAccessMetadata
        )

        return rawValue
      }
      // Unknown @self property - return empty string
      return ''
    }

    // Handle chained property access (e.g., @person.culture.@maleName)
    if (token.properties && token.properties.length > 1) {
      // Get the first property as a CaptureItem for traversal
      const firstProp = token.properties[0]
      const captureItem = getPlaceholderCaptureItem(context, token.name, firstProp)

      if (captureItem) {
        // Traverse the rest of the property chain
        const remainingProps = token.properties.slice(1)
        const result = this.traversePropertyChain(captureItem, remainingProps, `@${token.name}.@${firstProp}`)

        addTraceLeaf(
          context,
          'placeholder_access',
          label,
          {
            raw: token.name,
            parsed: { properties: token.properties },
          },
          {
            value: result,
          },
          {
            type: 'placeholder',
            name: token.name,
            property: token.properties.join('.'),
            found: result !== '',
          } as PlaceholderAccessMetadata
        )

        return result
      }

      // First property is not a CaptureItem - can't chain
      console.warn(`Cannot chain through non-CaptureItem property: @${token.name}.${firstProp}`)
      addTraceLeaf(
        context,
        'placeholder_access',
        label,
        {
          raw: token.name,
          parsed: { properties: token.properties },
        },
        {
          value: '',
          error: 'Cannot chain through non-CaptureItem',
        },
        {
          type: 'placeholder',
          name: token.name,
          property: token.properties.join('.'),
          found: false,
        } as PlaceholderAccessMetadata
      )

      return ''
    }

    // Simple single-level access
    const firstProp = token.properties?.[0]
    const value = getPlaceholder(context, token.name, firstProp)
    const result = value ?? ''

    // Add placeholder access trace
    addTraceLeaf(
      context,
      'placeholder_access',
      label,
      {
        raw: token.name,
        parsed: { properties: token.properties },
      },
      {
        value: result,
      },
      {
        type: 'placeholder',
        name: token.name,
        property: firstProp,
        found: value !== undefined,
      } as PlaceholderAccessMetadata
    )

    return result
  }

  private evaluateTableRefExpr(
    token: { tableId: string; alias?: string; namespace?: string; properties?: string[] },
    context: GenerationContext,
    collectionId: string
  ): string {
    // Build full reference with namespace if provided
    let ref = token.tableId
    if (token.namespace) {
      ref = `${token.namespace}.${token.tableId}`
    } else if (token.alias) {
      ref = `${token.alias}.${token.tableId}`
    }

    // Try to resolve as a table first
    const tableResult = this.deps.resolveTableRef(ref, collectionId)
    if (tableResult) {
      // Use the collection ID where the table was found, not the original collection
      const result = this.deps.rollTable(tableResult.table, context, tableResult.collectionId)

      // If properties are specified, access them from the roll result's placeholders
      if (token.properties && token.properties.length > 0) {
        return this.accessPropertyFromPlaceholders(result.placeholders, token.properties, ref)
      }

      return result.text
    }

    // Fall back to template lookup
    const templateResult = this.deps.resolveTemplateRef(ref, collectionId)
    if (templateResult) {
      // For templates with properties, we need to evaluate and then access the property
      if (token.properties && token.properties.length > 0) {
        // Create a temporary capture to access properties
        const templateRollResult = this.evaluateTemplateForPropertyAccess(
          templateResult.template,
          templateResult.collectionId,
          context
        )
        return this.accessPropertyFromPlaceholders(templateRollResult.placeholders, token.properties, ref)
      }
      return this.evaluateTemplateInternal(templateResult.template, templateResult.collectionId, context)
    }

    return ''
  }

  /**
   * Access a property chain from placeholders (EvaluatedSets).
   * Handles both simple string values and nested CaptureItem values.
   */
  private accessPropertyFromPlaceholders(
    placeholders: Record<string, string | CaptureItem> | undefined,
    properties: string[],
    sourceRef: string
  ): string {
    if (!placeholders || properties.length === 0) {
      return ''
    }

    const firstProp = properties[0]
    const propValue = placeholders[firstProp]

    if (propValue === undefined) {
      console.warn(`Property @${firstProp} not found in ${sourceRef}`)
      return ''
    }

    // Single property access
    if (properties.length === 1) {
      if (typeof propValue === 'string') {
        return propValue
      }
      // It's a CaptureItem
      return propValue.value
    }

    // Multi-level property access - need to traverse through CaptureItem
    if (typeof propValue === 'string') {
      console.warn(`Cannot chain through string property: ${sourceRef}.@${firstProp}`)
      return ''
    }

    // Traverse the remaining properties through the CaptureItem
    return this.traversePropertyChain(propValue, properties.slice(1), `${sourceRef}.@${firstProp}`)
  }

  /**
   * Evaluate a template and return the full result including placeholders.
   * Used for property access on template results.
   */
  private evaluateTemplateForPropertyAccess(
    template: Template,
    collectionId: string,
    context: GenerationContext
  ): { text: string; placeholders?: Record<string, string | CaptureItem> } {
    // Check recursion limit
    if (!incrementRecursion(context)) {
      throw new Error(`Recursion limit exceeded (${context.config.maxRecursionDepth})`)
    }

    try {
      // Get the collection for context
      const collection = this.deps.getCollection(collectionId)
      if (!collection) {
        return { text: '' }
      }

      // Evaluate template shared variables first (they become placeholders)
      const templatePlaceholders: Record<string, string | CaptureItem> = {}

      if (template.shared) {
        for (const [key, pattern] of Object.entries(template.shared)) {
          const varName = key.startsWith('$') ? key.slice(1) : key

          // For shared variables, we need to capture
          // the full result with sets to enable chained property access like
          // {{templateName.@gang.@reputation}}
          if (key.startsWith('$')) {
            const expressions = extractExpressions(pattern)
            if (expressions.length === 1 && pattern.trim() === expressions[0].raw) {
              const token = parseExpression(expressions[0].expression)
              if (token.type === 'table') {
                // Try to resolve as a table and capture full result with sets
                const tableResult = this.deps.resolveTableRef(token.tableId, collectionId)
                if (tableResult) {
                  const result = this.deps.rollTable(tableResult.table, context, tableResult.collectionId)
                  templatePlaceholders[varName] = {
                    value: result.text,
                    sets: result.placeholders ?? {},
                    description: undefined,
                  }
                  continue
                }
              }
            }
          }

          // Fallback: evaluate as string for non-capture vars or complex expressions
          const evaluated = this.evaluatePattern(pattern, context, collectionId)
          templatePlaceholders[varName] = evaluated
        }
      }

      // Evaluate the pattern
      const text = this.evaluatePattern(template.pattern, context, collectionId)

      return { text, placeholders: templatePlaceholders }
    } finally {
      decrementRecursion(context)
    }
  }

  /**
   * Internal template evaluation for cross-collection template references.
   * Used when a template is referenced via import alias.
   */
  private evaluateTemplateInternal(
    template: Template,
    collectionId: string,
    context: GenerationContext
  ): string {
    // Check recursion limit
    if (!incrementRecursion(context)) {
      throw new Error(`Recursion limit exceeded (${context.config.maxRecursionDepth})`)
    }

    try {
      // Get the collection for context
      const collection = this.deps.getCollection(collectionId)
      if (!collection) {
        return ''
      }

      // Start trace node for template reference evaluation
      // This wraps the template's internal evaluations so the full result is captured
      beginTraceNode(context, 'template_ref', `Template: ${template.name || template.id}`, {
        raw: template.id,
        parsed: { collectionId, templateId: template.id, pattern: template.pattern },
      })

      // CRITICAL: Create isolated context for cross-collection template evaluation.
      // This prevents placeholders from imported templates leaking into the parent context.
      // Without isolation, table rolls in the imported collection add placeholder keys
      // that persist and pollute subsequent evaluations in the parent collection.
      //
      // We also isolate sharedVariables so that:
      // 1. The child template's shared variables are evaluated fresh
      // 2. Side effects (like populating placeholders from table rolls) happen properly
      // 3. Parent and child can have shared variables with the same name without conflict
      //
      // sharedVariables must also be copied to allow templates with shared variables
      // (like "race": "{{characterRaces}}") to be evaluated fresh each time
      // when used in multi-roll contexts like {{4*templateName}}.
      const isolatedContext: GenerationContext = {
        ...context,
        placeholders: new Map(), // Fresh placeholder map - prevents leakage
        sharedVariables: new Map(context.sharedVariables), // Copy for isolation in multi-roll
      }

      // Evaluate template-level shared variables (lazy evaluation)
      // For isolated template contexts, we need to re-evaluate shared variables even if
      // the parent has the same name, because the side effects (populating placeholders)
      // need to happen in the isolated context.
      if (template.shared) {
        for (const name of Object.keys(template.shared)) {
          // Clear any existing value for this shared variable so it gets re-evaluated
          // in this isolated context. This ensures that table rolls populate the
          // isolated placeholders map.
          // Strip $ prefix if present for the internal variable name
          const varName = name.startsWith('$') ? name.slice(1) : name
          isolatedContext.sharedVariables.delete(varName)
        }
        this.evaluateTableLevelShared(template.shared, isolatedContext, collectionId, template.id)
      }

      // Evaluate the template pattern using isolated context
      const text = this.evaluatePattern(template.pattern, isolatedContext, collectionId)

      // End trace node with full template result
      endTraceNode(context, { value: text })

      return text
    } finally {
      decrementRecursion(context)
    }
  }

  /**
   * Evaluate a template and capture its shared variables for content-aware access.
   * Returns a CaptureItem with the template's result and its shared variables as sets.
   * This enables syntax like {{$npc.@profession}} where $npc references a template.
   */
  private evaluateTemplateWithCapture(
    template: Template,
    collectionId: string,
    context: GenerationContext
  ): CaptureItem {
    // Check recursion limit
    if (!incrementRecursion(context)) {
      throw new Error(`Recursion limit exceeded (${context.config.maxRecursionDepth})`)
    }

    try {
      // Get the collection for context
      const collection = this.deps.getCollection(collectionId)
      if (!collection) {
        return { value: '', sets: {} }
      }

      // Start trace node for template reference evaluation
      beginTraceNode(context, 'template_ref', `Template: ${template.name || template.id}`, {
        raw: template.id,
        parsed: { collectionId, templateId: template.id, pattern: template.pattern },
      })

      // Create isolated context for template evaluation
      const isolatedContext: GenerationContext = {
        ...context,
        placeholders: new Map(),
        sharedVariables: new Map(context.sharedVariables),
      }

      // Evaluate template-level shared variables
      if (template.shared) {
        for (const name of Object.keys(template.shared)) {
          // Strip $ prefix if present for the internal variable name
          const varName = name.startsWith('$') ? name.slice(1) : name
          isolatedContext.sharedVariables.delete(varName)
        }
        this.evaluateTableLevelShared(template.shared, isolatedContext, collectionId, template.id)
      }

      // Evaluate the template pattern
      const text = this.evaluatePattern(template.pattern, isolatedContext, collectionId)

      // Build sets from the template's own shared variables
      // All shared variables are now CaptureItems
      const sets: Record<string, string | CaptureItem> = {}

      if (template.shared) {
        for (const name of Object.keys(template.shared)) {
          // Strip $ prefix if present for the internal variable name
          const varName = name.startsWith('$') ? name.slice(1) : name
          const captureItem = isolatedContext.sharedVariables.get(varName)
          if (captureItem) {
            sets[varName] = captureItem
          }
        }
      }

      // End trace node
      endTraceNode(context, { value: text })

      return {
        value: text,
        sets,
        description: undefined,
      }
    } finally {
      decrementRecursion(context)
    }
  }

  private evaluateMultiRoll(
    token: {
      count: number | string
      diceCount?: string
      tableId: string
      unique?: boolean
      separator?: string
    },
    context: GenerationContext,
    collectionId: string
  ): string {
    // Resolve count - can be a number, variable name, or dice expression
    let count: number
    let countSource: 'literal' | 'variable' | 'dice' = 'literal'

    if (token.diceCount) {
      // Roll dice to determine count
      const diceResult = rollDice(token.diceCount, {
        maxExplodingDice: context.config.maxExplodingDice,
      })
      count = diceResult.total
      countSource = 'dice'
    } else if (typeof token.count === 'number') {
      count = token.count
      countSource = 'literal'
    } else {
      // token.count is a string - could be a variable name or capture access (e.g., "group.count")
      let value: string | number | undefined

      // Check if it's a capture access pattern (contains '.')
      if (token.count.includes('.')) {
        const dotIndex = token.count.indexOf('.')
        const varName = token.count.slice(0, dotIndex)
        const property = token.count.slice(dotIndex + 1)

        // Try capture variable first
        const capture = getCaptureVariable(context, varName)
        if (capture) {
          if (property === 'count') {
            value = capture.count
          } else {
            // For other properties, this doesn't make sense as a count
            console.warn(`Cannot use capture property '$${token.count}' as multi-roll count`)
            value = 1
          }
        } else {
          // Try shared variable
          const captureShared = getSharedVariable(context, varName)
          if (captureShared) {
            if (property === 'count') {
              // Shared variable is always a single item
              value = 1
            } else {
              console.warn(`Cannot use capture property '$${token.count}' as multi-roll count`)
              value = 1
            }
          } else {
            // Fall back to regular variable resolution (for vars like "obj.prop")
            value = resolveVariable(context, token.count)
          }
        }
      } else {
        // Simple variable name
        value = resolveVariable(context, token.count)
      }

      count = typeof value === 'number' ? value : parseInt(String(value), 10) || 1
      countSource = 'variable'
    }

    // Try to resolve as a table first
    const table = this.deps.getTable(token.tableId, collectionId)

    // If not a table, check if it's a template
    if (!table) {
      const templateResult = this.deps.resolveTemplateRef(token.tableId, collectionId)
      if (templateResult) {
        // Handle template multi-roll
        return this.evaluateMultiRollTemplate(
          templateResult.template,
          templateResult.collectionId,
          count,
          countSource,
          token,
          context
        )
      }
      console.warn(`Table or template not found: ${token.tableId}`)
      return ''
    }

    // Start multi_roll trace node
    beginTraceNode(context, 'multi_roll', `${count}x ${token.tableId}`, {
      raw: `${token.count}*${token.tableId}`,
      parsed: { count, tableId: token.tableId, unique: token.unique },
    })

    const results: string[] = []
    const usedIds = new Set<string>()

    for (let i = 0; i < count; i++) {
      const result = this.deps.rollTable(table, context, collectionId, {
        unique: token.unique,
        excludeIds: token.unique ? usedIds : undefined,
      })

      if (result.text) {
        results.push(result.text)
        if (result.entryId) {
          usedIds.add(result.entryId)
        }
      }
    }

    const finalResult = results.join(token.separator ?? ', ')

    // End multi_roll trace node
    endTraceNode(
      context,
      { value: finalResult },
      {
        type: 'multi_roll',
        tableId: token.tableId,
        countSource,
        count,
        unique: token.unique ?? false,
        separator: token.separator ?? ', ',
      } as MultiRollMetadata
    )

    return finalResult
  }

  /**
   * Handle multi-roll for templates (e.g., {{4*simpleNpc}})
   * Note: 'unique' modifier is ignored for templates since they don't have entry IDs
   */
  private evaluateMultiRollTemplate(
    template: Template,
    templateCollectionId: string,
    count: number,
    countSource: 'literal' | 'variable' | 'dice',
    token: { tableId: string; unique?: boolean; separator?: string; count: number | string },
    context: GenerationContext
  ): string {
    // Start multi_roll trace node for template
    beginTraceNode(context, 'multi_roll', `${count}x ${token.tableId} (template)`, {
      raw: `${token.count}*${token.tableId}`,
      parsed: { count, tableId: token.tableId, unique: token.unique, isTemplate: true },
    })

    const results: string[] = []

    for (let i = 0; i < count; i++) {
      const result = this.evaluateTemplateInternal(template, templateCollectionId, context)
      if (result) {
        results.push(result)
      }
    }

    const finalResult = results.join(token.separator ?? ', ')

    // End multi_roll trace node
    endTraceNode(
      context,
      { value: finalResult },
      {
        type: 'multi_roll',
        tableId: token.tableId,
        countSource,
        count,
        unique: false, // unique not applicable for templates
        separator: token.separator ?? ', ',
      } as MultiRollMetadata
    )

    return finalResult
  }

  private evaluateAgain(
    token: { count?: number; unique?: boolean; separator?: string },
    context: GenerationContext,
    collectionId: string
  ): string {
    if (!context.currentTableId) {
      console.warn('{{again}} used outside of table context')
      return ''
    }

    const table = this.deps.getTable(context.currentTableId, collectionId)
    if (!table) {
      return ''
    }

    // Exclude the current entry to prevent infinite loops
    const excludeIds = new Set<string>()
    if (context.currentEntryId) {
      excludeIds.add(context.currentEntryId)
    }

    const count = token.count ?? 1
    const results: string[] = []

    for (let i = 0; i < count; i++) {
      const result = this.deps.rollTable(table, context, collectionId, {
        unique: token.unique,
        excludeIds,
      })

      if (result.text) {
        results.push(result.text)
        if (result.entryId && token.unique) {
          excludeIds.add(result.entryId)
        }
      }
    }

    return results.join(token.separator ?? ', ')
  }

  private evaluateInstance(
    token: { tableId: string; instanceName: string },
    context: GenerationContext,
    collectionId: string
  ): string {
    // Check if instance already exists
    const existing = getInstance(context, token.instanceName)
    if (existing) {
      // Add instance trace for cache hit
      addTraceLeaf(
        context,
        'instance',
        `Instance: ${token.instanceName} (cached)`,
        {
          raw: `${token.tableId}#${token.instanceName}`,
        },
        {
          value: existing.text,
          cached: true,
        },
        {
          type: 'instance',
          name: token.instanceName,
          cached: true,
          tableId: token.tableId,
        } as InstanceMetadata
      )

      return existing.text
    }

    // Roll and store the instance
    const table = this.deps.getTable(token.tableId, collectionId)
    if (!table) {
      console.warn(`Table not found: ${token.tableId}`)
      return ''
    }

    // Start instance trace node (new roll)
    beginTraceNode(context, 'instance', `Instance: ${token.instanceName}`, {
      raw: `${token.tableId}#${token.instanceName}`,
      parsed: { tableId: token.tableId, instanceName: token.instanceName },
    })

    const result = this.deps.rollTable(table, context, collectionId)

    const rollResult: RollResult = {
      text: result.text,
      resultType: result.resultType,
      assets: result.assets,
      placeholders: result.placeholders,
      metadata: {
        sourceId: token.tableId,
        collectionId,
        timestamp: Date.now(),
        entryId: result.entryId,
      },
    }

    setInstance(context, token.instanceName, rollResult)

    // End instance trace node
    endTraceNode(
      context,
      { value: result.text, cached: false },
      {
        type: 'instance',
        name: token.instanceName,
        cached: false,
        tableId: token.tableId,
      } as InstanceMetadata
    )

    return result.text
  }

  // ==========================================================================
  // Capture System Evaluation
  // ==========================================================================

  /**
   * Evaluate capture multi-roll: {{3*table >> $var}}
   * Captures each roll's value and resolved sets into a capture variable
   */
  private evaluateCaptureMultiRoll(
    token: {
      count: number | string
      diceCount?: string
      tableId: string
      alias?: string
      namespace?: string
      unique?: boolean
      captureVar: string
      separator?: string
      silent?: boolean
    },
    context: GenerationContext,
    collectionId: string
  ): string {
    // Check for variable name conflict
    const conflict = hasVariableConflict(context, token.captureVar)
    if (conflict) {
      console.warn(
        `Capture variable '$${token.captureVar}' overwrites existing ${conflict} variable`
      )
    }

    // Resolve count - can be a number, variable name, or dice expression
    let count: number

    if (token.diceCount) {
      // Roll dice to determine count
      const diceResult = rollDice(token.diceCount, {
        maxExplodingDice: context.config.maxExplodingDice,
      })
      count = diceResult.total
    } else if (typeof token.count === 'number') {
      count = token.count
    } else {
      // token.count is a string - could be a variable name or capture access (e.g., "group.count")
      let value: string | number | undefined

      // Check if it's a capture access pattern (contains '.')
      if (token.count.includes('.')) {
        const dotIndex = token.count.indexOf('.')
        const varName = token.count.slice(0, dotIndex)
        const property = token.count.slice(dotIndex + 1)

        // Try capture variable first
        const capture = getCaptureVariable(context, varName)
        if (capture) {
          if (property === 'count') {
            value = capture.count
          } else {
            // For other properties, this doesn't make sense as a count
            console.warn(`Cannot use capture property '$${token.count}' as multi-roll count`)
            value = 1
          }
        } else {
          // Try shared variable
          const captureShared = getSharedVariable(context, varName)
          if (captureShared) {
            if (property === 'count') {
              // Shared variable is always a single item
              value = 1
            } else {
              console.warn(`Cannot use capture property '$${token.count}' as multi-roll count`)
              value = 1
            }
          } else {
            // Fall back to regular variable resolution (for vars like "obj.prop")
            value = resolveVariable(context, token.count)
          }
        }
      } else {
        // Simple variable name
        value = resolveVariable(context, token.count)
      }

      count = typeof value === 'number' ? value : parseInt(String(value), 10) || 1
    }

    // Build full table reference with namespace if provided
    let tableRef = token.tableId
    if (token.namespace) {
      tableRef = `${token.namespace}.${token.tableId}`
    } else if (token.alias) {
      tableRef = `${token.alias}.${token.tableId}`
    }

    const tableResult = this.deps.resolveTableRef(tableRef, collectionId)
    if (!tableResult) {
      console.warn(`Table not found: ${tableRef}`)
      return ''
    }

    const { table, collectionId: resolvedCollectionId } = tableResult

    // Start capture_multi_roll trace node
    beginTraceNode(
      context,
      'capture_multi_roll',
      `${count}x ${token.tableId} >> $${token.captureVar}`,
      {
        raw: `${token.count}*${token.tableId} >> $${token.captureVar}`,
        parsed: {
          count,
          tableId: token.tableId,
          captureVar: token.captureVar,
          unique: token.unique,
          silent: token.silent,
        },
      }
    )

    const captureItems: CaptureItem[] = []
    const results: string[] = []
    const usedIds = new Set<string>()

    for (let i = 0; i < count; i++) {
      // Track description count before roll to find new descriptions
      const descCountBefore = context.collectedDescriptions.length
      const result = this.deps.rollTable(table, context, resolvedCollectionId, {
        unique: token.unique,
        excludeIds: token.unique ? usedIds : undefined,
      })

      if (result.text) {
        results.push(result.text)

        // Get the first description added by this roll (the entry's own description)
        const newDescriptions = context.collectedDescriptions.slice(descCountBefore)
        const entryDescription = newDescriptions.length > 0 ? newDescriptions[0].description : undefined

        // Sets are already evaluated at merge time in evaluateSetValues()
        // Just use the placeholders directly
        captureItems.push({
          value: result.text,
          sets: result.placeholders ?? {},
          description: entryDescription,
        })

        if (result.entryId) {
          usedIds.add(result.entryId)
        }
      }
    }

    // Store capture variable
    const captureVariable: CaptureVariable = {
      items: captureItems,
      count: captureItems.length,
    }
    setCaptureVariable(context, token.captureVar, captureVariable)

    // Determine output
    let finalResult: string
    if (token.silent) {
      finalResult = ''
    } else {
      finalResult = results.join(token.separator ?? ', ')
    }

    // End capture_multi_roll trace node
    endTraceNode(
      context,
      { value: finalResult },
      {
        type: 'capture_multi_roll',
        tableId: token.tableId,
        captureVar: token.captureVar,
        count: captureItems.length,
        unique: token.unique ?? false,
        silent: token.silent ?? false,
        separator: token.separator ?? ', ',
        capturedItems: captureItems.map((item) => ({
          value: item.value,
          sets: item.sets,
        })),
      } as CaptureMultiRollMetadata
    )

    return finalResult
  }

  /**
   * Evaluate capture access: {{$var}}, {{$var[0]}}, {{$var.count}}, {{$var[0].@prop}}
   * Also handles shared variables: {{$hero}}, {{$hero.@prop}}
   *
   * Dynamic table resolution: When accessing a property that contains a table ID,
   * the engine will roll on that table and return the result.
   */
  private evaluateCaptureAccess(
    token: {
      varName: string
      index?: number
      properties?: string[]
      separator?: string
    },
    context: GenerationContext
  ): string {
    // Try to get from capture variables first, then fall back to shared variables
    const capture = getCaptureVariable(context, token.varName)
    const captureShared = getSharedVariable(context, token.varName)

    // Build label for trace
    let label = `$${token.varName}`
    if (token.index !== undefined) label += `[${token.index}]`
    if (token.properties && token.properties.length > 0) {
      label += '.' + token.properties.map((p) => `@${p}`).join('.')
    }

    // Handle shared variables (single item, no index needed)
    if (!capture && captureShared) {
      return this.evaluateCaptureSharedAccess(token, captureShared, context, label)
    }

    if (!capture) {
      console.warn(`Capture variable not found: $${token.varName} (forward reference?)`)
      addTraceLeaf(
        context,
        'capture_access',
        label,
        { raw: label },
        { value: '', error: 'Variable not found' },
        {
          type: 'capture_access',
          varName: token.varName,
          index: token.index,
          property: token.properties?.[0] ?? 'value',
          found: false,
        } as CaptureAccessMetadata
      )
      return ''
    }

    let result: string
    const firstProp = token.properties?.[0]

    // Handle .count property (no index)
    if (firstProp === 'count' && token.index === undefined) {
      result = String(capture.count)
      addTraceLeaf(
        context,
        'capture_access',
        label,
        { raw: label },
        { value: result },
        {
          type: 'capture_access',
          varName: token.varName,
          property: 'count',
          found: true,
          totalItems: capture.items.length,
        } as CaptureAccessMetadata
      )
      return result
    }

    // Handle indexed access
    if (token.index !== undefined) {
      // Resolve negative index
      let resolvedIndex = token.index
      if (resolvedIndex < 0) {
        resolvedIndex = capture.items.length + resolvedIndex
      }

      // Check bounds
      if (resolvedIndex < 0 || resolvedIndex >= capture.items.length) {
        console.warn(
          `Capture access out of bounds: $${token.varName}[${token.index}] ` +
            `(length: ${capture.items.length})`
        )
        addTraceLeaf(
          context,
          'capture_access',
          label,
          { raw: label },
          { value: '', error: `Index out of bounds (${capture.items.length} items)` },
          {
            type: 'capture_access',
            varName: token.varName,
            index: token.index,
            property: firstProp ?? 'value',
            found: false,
            totalItems: capture.items.length,
          } as CaptureAccessMetadata
        )
        return ''
      }

      const item = capture.items[resolvedIndex]

      // Handle property chain access on indexed item
      if (token.properties && token.properties.length > 0) {
        result = this.traversePropertyChain(item, token.properties, `$${token.varName}[${token.index}]`)
      } else {
        // Just indexed access - return value
        result = item.value
      }

      addTraceLeaf(
        context,
        'capture_access',
        label,
        { raw: label },
        { value: result },
        {
          type: 'capture_access',
          varName: token.varName,
          index: token.index,
          property: firstProp ?? 'value',
          found: true,
          totalItems: capture.items.length,
        } as CaptureAccessMetadata
      )
      return result
    }

    // Handle property access without index (on all items)
    // For chained access, we only use the first property for collecting
    if (firstProp && firstProp !== 'value' && firstProp !== 'count') {
      // Collect this property from all items
      // For chained properties, traverse each item's property chain
      const values = capture.items.map((item) => {
        if (token.properties && token.properties.length > 0) {
          return this.traversePropertyChain(item, token.properties, `$${token.varName}`)
        }
        return item.value
      })
      result = values.filter((v) => v !== '').join(token.separator ?? ', ')
    } else {
      // Handle all values (no property or property is 'value')
      const values = capture.items.map((item) => item.value)
      result = values.join(token.separator ?? ', ')
    }

    addTraceLeaf(
      context,
      'capture_access',
      label,
      { raw: label },
      { value: result },
      {
        type: 'capture_access',
        varName: token.varName,
        property: firstProp ?? 'value',
        found: true,
        totalItems: capture.items.length,
      } as CaptureAccessMetadata
    )

    return result
  }

  /**
   * Traverse a chain of properties through nested CaptureItems.
   * Example: traversePropertyChain(item, ["situation", "focus"], "$conflict")
   * Returns the final string value, or empty string if chain breaks.
   */
  private traversePropertyChain(
    item: CaptureItem,
    properties: string[],
    pathPrefix: string
  ): string {
    let current: CaptureItem = item

    for (let i = 0; i < properties.length; i++) {
      const prop = properties[i]
      const currentPath = `${pathPrefix}.@${prop}`

      // Handle special properties
      if (prop === 'value') {
        // If more properties follow, this is invalid
        if (i < properties.length - 1) {
          console.warn(`Cannot access properties after .value: ${currentPath}`)
          return ''
        }
        return current.value
      }
      if (prop === 'count') {
        // count is always terminal - shared variable is always 1 item
        if (i < properties.length - 1) {
          console.warn(`Cannot access properties after .count: ${currentPath}`)
          return ''
        }
        return '1'
      }
      if (prop === 'description') {
        if (i < properties.length - 1) {
          console.warn(`Cannot access properties after .description: ${currentPath}`)
          return ''
        }
        return current.description ?? ''
      }

      // Regular property access
      const propValue = current.sets[prop]
      if (propValue === undefined) {
        console.warn(`Property not found: ${currentPath}`)
        return ''
      }

      // If this is the last property, return the value
      if (i === properties.length - 1) {
        if (typeof propValue === 'string') {
          return propValue
        } else {
          return propValue.value
        }
      }

      // Need to continue traversing - must be a nested CaptureItem
      if (typeof propValue === 'string') {
        console.warn(`Cannot chain through string property: ${currentPath}`)
        return ''
      }

      current = propValue
      pathPrefix = currentPath
    }

    return current.value
  }

  /**
   * Get a nested CaptureItem by traversing through property chain.
   * Returns null if any property in the chain is not a CaptureItem.
   * Used for storing intermediate captures in shared variables.
   */
  private getNestedCaptureItem(item: CaptureItem, properties: string[]): CaptureItem | null {
    let current = item
    for (const prop of properties) {
      // Terminal properties can't be traversed further
      if (prop === 'value' || prop === 'count' || prop === 'description') {
        return null
      }
      const propValue = current.sets[prop]
      if (!propValue || typeof propValue === 'string') {
        return null // Not a nested CaptureItem
      }
      current = propValue
    }
    return current
  }

  /**
   * Handle access to shared variables with property paths.
   * These are single items (not arrays), so no index is needed.
   * Supports chained property access: {{$var.@a.@b.@c}}
   */
  private evaluateCaptureSharedAccess(
    token: {
      varName: string
      index?: number
      properties?: string[]
      separator?: string
    },
    item: CaptureItem,
    context: GenerationContext,
    label: string
  ): string {
    let result: string

    // Handle property chain access
    if (token.properties && token.properties.length > 0) {
      result = this.traversePropertyChain(item, token.properties, `$${token.varName}`)
    } else {
      // No properties - return the value
      result = item.value
    }

    addTraceLeaf(
      context,
      'capture_access',
      label,
      { raw: label },
      { value: result },
      {
        type: 'capture_access',
        varName: token.varName,
        property: token.properties?.[0] ?? 'value',
        found: true,
        totalItems: 1,
        isCaptureShared: true,
      } as CaptureAccessMetadata
    )

    return result
  }

  /**
   * Evaluate collect expression: {{collect:$var.@prop}}
   * Aggregates a property across all captured items.
   * Also supports shared variables (though collect typically makes more sense for multi-roll captures).
   */
  private evaluateCollect(
    token: {
      varName: string
      property: string
      unique?: boolean
      separator?: string
    },
    context: GenerationContext
  ): string {
    const label = `collect:$${token.varName}.${token.property}${token.unique ? '|unique' : ''}`
    const capture = getCaptureVariable(context, token.varName)
    const captureShared = getSharedVariable(context, token.varName)

    // Handle shared variables (single item)
    // Sets are already evaluated at merge time, so just return the value
    if (!capture && captureShared) {
      let result: string
      if (token.property === 'value') {
        result = captureShared.value
      } else if (token.property === 'description') {
        result = captureShared.description ?? ''
      } else {
        const propValue = captureShared.sets[token.property]
        if (propValue === undefined) {
          result = ''
        } else if (typeof propValue === 'string') {
          result = propValue
        } else {
          // Nested CaptureItem - return its value string
          result = propValue.value
        }
      }

      addTraceLeaf(
        context,
        'collect',
        label,
        { raw: label },
        { value: result },
        {
          type: 'collect',
          varName: token.varName,
          property: token.property,
          unique: token.unique ?? false,
          separator: token.separator ?? ', ',
          allValues: [result].filter((v) => v !== ''),
          resultValues: [result].filter((v) => v !== ''),
        } as CollectMetadata
      )

      return result
    }

    if (!capture) {
      console.warn(`Capture variable not found: $${token.varName} (forward reference?)`)
      addTraceLeaf(
        context,
        'collect',
        label,
        { raw: label },
        { value: '', error: 'Variable not found' },
        {
          type: 'collect',
          varName: token.varName,
          property: token.property,
          unique: token.unique ?? false,
          separator: token.separator ?? ', ',
          allValues: [],
          resultValues: [],
        } as CollectMetadata
      )
      return ''
    }

    // Collect values from captured items
    // Sets are already evaluated at merge time, so just return the values
    let allValues: string[]

    if (token.property === 'value') {
      allValues = capture.items.map((item) => item.value)
    } else if (token.property === 'description') {
      // @description access
      allValues = capture.items.map((item) => item.description ?? '')
    } else {
      // @property access (property stored without @)
      // Handle nested CaptureItems - extract the value string
      allValues = capture.items.map((item) => {
        const propValue = item.sets[token.property]
        if (propValue === undefined) return ''
        if (typeof propValue === 'string') return propValue
        return propValue.value // Nested CaptureItem
      })
    }

    // Filter empty strings (as per design decision)
    let resultValues = allValues.filter((v) => v !== '')

    // Apply unique modifier
    if (token.unique) {
      resultValues = [...new Set(resultValues)]
    }

    const result = resultValues.join(token.separator ?? ', ')

    addTraceLeaf(
      context,
      'collect',
      label,
      { raw: label },
      { value: result },
      {
        type: 'collect',
        varName: token.varName,
        property: token.property,
        unique: token.unique ?? false,
        separator: token.separator ?? ', ',
        allValues: allValues.filter((v) => v !== ''), // Pre-filtered values
        resultValues,
      } as CollectMetadata
    )

    return result
  }

  // ==========================================================================
  // Switch Expression Evaluation
  // ==========================================================================

  /**
   * Evaluate a standalone switch expression: {{switch[condition:result].else[fallback]}}
   * Evaluates each clause's condition in order, returning the first matching result.
   */
  private evaluateSwitchExpression(
    token: SwitchToken,
    context: GenerationContext,
    collectionId: string
  ): string {
    // Evaluate each clause in order
    for (const clause of token.clauses) {
      if (this.evaluateSwitchCondition(clause.condition, undefined, context, collectionId)) {
        return this.evaluateSwitchResult(clause.resultExpr, context, collectionId)
      }
    }

    // No clause matched - use else if provided, otherwise return empty with warning
    if (token.elseExpr !== undefined) {
      return this.evaluateSwitchResult(token.elseExpr, context, collectionId)
    }

    console.warn('Switch expression: no clause matched and no else provided')
    return ''
  }

  /**
   * Evaluate a switch expression to determine the winning result expression (unevaluated).
   * Returns the raw result expression string of the first matching clause, or undefined if no match.
   * Used by shared variables to detect if the result is a table reference.
   */
  private evaluateSwitchToResultExpr(
    token: SwitchToken,
    context: GenerationContext,
    collectionId: string
  ): string | undefined {
    // Evaluate each clause in order
    for (const clause of token.clauses) {
      if (this.evaluateSwitchCondition(clause.condition, undefined, context, collectionId)) {
        return clause.resultExpr
      }
    }

    // No clause matched - use else if provided
    if (token.elseExpr !== undefined) {
      return token.elseExpr
    }

    return undefined
  }

  /**
   * Evaluate switch modifiers attached to a base expression.
   * The base result is available as $ in conditions.
   */
  private evaluateSwitchModifiers(
    baseResult: string,
    modifiers: SwitchModifiers,
    context: GenerationContext,
    collectionId: string
  ): string {
    // Evaluate each clause in order
    for (const clause of modifiers.clauses) {
      if (this.evaluateSwitchCondition(clause.condition, baseResult, context, collectionId)) {
        return this.evaluateSwitchResult(clause.resultExpr, context, collectionId)
      }
    }

    // No clause matched - use else if provided, otherwise return base result
    if (modifiers.elseExpr !== undefined) {
      return this.evaluateSwitchResult(modifiers.elseExpr, context, collectionId)
    }

    return baseResult
  }

  /**
   * Replace standalone $ in a condition string with the base result value.
   * Standalone $ is followed by a non-word character or end of string.
   * Does NOT match: $varName, $hero.@prop
   */
  private prepareConditionWithBaseValue(condition: string, baseResult: string): string {
    // Replace $ followed by non-word character or end of string
    // This matches: $==, $>, $<, $ &&, $ contains, $" ", end of string
    // Does NOT match: $varName, $hero.@prop
    return condition.replace(/\$(?![a-zA-Z_])/g, JSON.stringify(baseResult))
  }

  /**
   * Evaluate a switch condition expression.
   * If baseResult is provided, standalone $ in the condition refers to that value.
   */
  private evaluateSwitchCondition(
    condition: string,
    baseResult: string | undefined,
    context: GenerationContext,
    collectionId: string
  ): boolean {
    let preparedCondition = condition

    // Replace standalone $ with the base result value (if provided)
    if (baseResult !== undefined) {
      preparedCondition = this.prepareConditionWithBaseValue(condition, baseResult)
    }

    // Evaluate any {{expressions}} in the condition
    const evaluatedCondition = this.evaluatePattern(preparedCondition, context, collectionId)

    // Use existing conditional evaluation logic from conditionals.ts
    return evaluateWhenClause(evaluatedCondition, context)
  }

  /**
   * Evaluate a switch result expression.
   * Can be "literal", $var.@prop, @placeholder, or {{expression}}.
   * Quoted strings with {{}} inside are interpolated (like template literals).
   */
  private evaluateSwitchResult(
    resultExpr: string,
    context: GenerationContext,
    collectionId: string
  ): string {
    const trimmed = resultExpr.trim()

    // Handle quoted strings - check for interpolation
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      const inner = trimmed.slice(1, -1)
      // If contains {{}}, evaluate as pattern (interpolation)
      if (inner.includes('{{')) {
        return this.evaluatePattern(inner, context, collectionId)
      }
      // Pure literal - return as-is
      return inner
    }

    // Everything else is evaluated as a pattern (including $var.@prop, @placeholder, {{expr}})
    // Wrap in {{}} if not already wrapped for proper parsing
    if (!trimmed.includes('{{')) {
      return this.evaluatePattern(`{{${trimmed}}}`, context, collectionId)
    }

    return this.evaluatePattern(trimmed, context, collectionId)
  }
}
