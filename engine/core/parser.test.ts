import { describe, it, expect } from 'vitest'
import {
  parseTemplate,
  parseExpression,
  extractExpressions,
  hasExpressions,
  getReferencedTables,
  getReferencedVariables,
} from './parser'

describe('extractExpressions', () => {
  it('should extract single expression', () => {
    const matches = extractExpressions('Hello {{name}}!')
    expect(matches).toHaveLength(1)
    expect(matches[0].expression).toBe('name')
    expect(matches[0].start).toBe(6)
    expect(matches[0].end).toBe(14) // {{name}} is 8 chars, 6 + 8 = 14
  })

  it('should extract multiple expressions', () => {
    const matches = extractExpressions('{{a}} and {{b}}')
    expect(matches).toHaveLength(2)
    expect(matches[0].expression).toBe('a')
    expect(matches[1].expression).toBe('b')
  })

  it('should handle escaped braces', () => {
    const matches = extractExpressions('\\{{not an expression}}')
    expect(matches).toHaveLength(0)
  })

  it('should handle no expressions', () => {
    const matches = extractExpressions('Just plain text')
    expect(matches).toHaveLength(0)
  })

  it('should handle expression at start', () => {
    const matches = extractExpressions('{{start}} of text')
    expect(matches).toHaveLength(1)
    expect(matches[0].start).toBe(0)
  })

  it('should handle expression at end', () => {
    const matches = extractExpressions('text at {{end}}')
    expect(matches).toHaveLength(1)
    expect(matches[0].expression).toBe('end')
  })
})

describe('parseExpression', () => {
  describe('table references', () => {
    it('should parse simple table reference', () => {
      const token = parseExpression('tableName')
      expect(token.type).toBe('table')
      if (token.type === 'table') {
        expect(token.tableId).toBe('tableName')
        expect(token.alias).toBeUndefined()
      }
    })

    it('should parse alias.tableId reference', () => {
      const token = parseExpression('alias.tableName')
      expect(token.type).toBe('table')
      if (token.type === 'table') {
        expect(token.tableId).toBe('tableName')
        expect(token.alias).toBe('alias')
      }
    })

    it('should parse namespace.tableId reference', () => {
      const token = parseExpression('fantasy.core.weapons')
      expect(token.type).toBe('table')
      if (token.type === 'table') {
        expect(token.tableId).toBe('weapons')
        expect(token.namespace).toBe('fantasy.core')
      }
    })
  })

  describe('dice expressions', () => {
    it('should parse dice expression', () => {
      const token = parseExpression('dice:2d6+5')
      expect(token.type).toBe('dice')
      if (token.type === 'dice') {
        expect(token.expression).toBe('2d6+5')
      }
    })

    it('should parse complex dice expression', () => {
      const token = parseExpression('dice:4d6k3')
      expect(token.type).toBe('dice')
      if (token.type === 'dice') {
        expect(token.expression).toBe('4d6k3')
      }
    })
  })

  describe('math expressions', () => {
    it('should parse math expression', () => {
      const token = parseExpression('math:$count + 5')
      expect(token.type).toBe('math')
      if (token.type === 'math') {
        expect(token.expression).toBe('$count + 5')
      }
    })
  })

  describe('variables', () => {
    it('should parse simple variable', () => {
      const token = parseExpression('$varName')
      expect(token.type).toBe('variable')
      if (token.type === 'variable') {
        expect(token.name).toBe('varName')
        expect(token.alias).toBeUndefined()
      }
    })

    it('should parse aliased variable', () => {
      const token = parseExpression('$alias.varName')
      expect(token.type).toBe('variable')
      if (token.type === 'variable') {
        expect(token.name).toBe('varName')
        expect(token.alias).toBe('alias')
      }
    })
  })

  describe('placeholders', () => {
    it('should parse simple placeholder', () => {
      const token = parseExpression('@race')
      expect(token.type).toBe('placeholder')
      if (token.type === 'placeholder') {
        expect(token.name).toBe('race')
        expect(token.properties).toBeUndefined()
      }
    })

    it('should parse placeholder with property', () => {
      const token = parseExpression('@race.value')
      expect(token.type).toBe('placeholder')
      if (token.type === 'placeholder') {
        expect(token.name).toBe('race')
        expect(token.properties).toEqual(['value'])
      }
    })

    it('should parse @self.description placeholder', () => {
      const token = parseExpression('@self.description')
      expect(token.type).toBe('placeholder')
      if (token.type === 'placeholder') {
        expect(token.name).toBe('self')
        expect(token.properties).toEqual(['description'])
      }
    })

    it('should parse chained placeholder access', () => {
      const token = parseExpression('@person.culture.@maleName')
      expect(token.type).toBe('placeholder')
      if (token.type === 'placeholder') {
        expect(token.name).toBe('person')
        expect(token.properties).toEqual(['culture', 'maleName'])
      }
    })
  })

  describe('again keyword', () => {
    it('should parse simple again', () => {
      const token = parseExpression('again')
      expect(token.type).toBe('again')
      if (token.type === 'again') {
        expect(token.count).toBeUndefined()
        expect(token.unique).toBeUndefined()
      }
    })

    it('should parse N*again', () => {
      const token = parseExpression('3*again')
      expect(token.type).toBe('again')
      if (token.type === 'again') {
        expect(token.count).toBe(3)
      }
    })

    it('should parse N*unique*again', () => {
      const token = parseExpression('3*unique*again')
      expect(token.type).toBe('again')
      if (token.type === 'again') {
        expect(token.count).toBe(3)
        expect(token.unique).toBe(true)
      }
    })

    it('should parse again with separator', () => {
      const token = parseExpression('again|" and "')
      expect(token.type).toBe('again')
      if (token.type === 'again') {
        expect(token.separator).toBe(' and ')
      }
    })

    it('should parse N*again with separator', () => {
      const token = parseExpression('3*again|"; "')
      expect(token.type).toBe('again')
      if (token.type === 'again') {
        expect(token.count).toBe(3)
        expect(token.separator).toBe('; ')
      }
    })

    it('should parse N*unique*again with separator', () => {
      const token = parseExpression('2*unique*again|" combined with "')
      expect(token.type).toBe('again')
      if (token.type === 'again') {
        expect(token.count).toBe(2)
        expect(token.unique).toBe(true)
        expect(token.separator).toBe(' combined with ')
      }
    })

    it('should parse again with separator with space after pipe', () => {
      const token = parseExpression('2*unique*again| " combined with "')
      expect(token.type).toBe('again')
      if (token.type === 'again') {
        expect(token.count).toBe(2)
        expect(token.unique).toBe(true)
        expect(token.separator).toBe(' combined with ')
      }
    })
  })

  describe('multi-roll', () => {
    it('should parse simple multi-roll', () => {
      const token = parseExpression('3*tableName')
      expect(token.type).toBe('multiRoll')
      if (token.type === 'multiRoll') {
        expect(token.count).toBe(3)
        expect(token.tableId).toBe('tableName')
        expect(token.unique).toBe(false)
      }
    })

    it('should parse unique multi-roll', () => {
      const token = parseExpression('3*unique*tableName')
      expect(token.type).toBe('multiRoll')
      if (token.type === 'multiRoll') {
        expect(token.count).toBe(3)
        expect(token.tableId).toBe('tableName')
        expect(token.unique).toBe(true)
      }
    })

    it('should parse multi-roll with separator', () => {
      const token = parseExpression('3*tableName|" and "')
      expect(token.type).toBe('multiRoll')
      if (token.type === 'multiRoll') {
        expect(token.count).toBe(3)
        expect(token.tableId).toBe('tableName')
        expect(token.separator).toBe(' and ')
      }
    })

    it('should parse multi-roll with # in separator (not instance reference)', () => {
      const token = parseExpression('3*tableName|"# "')
      expect(token.type).toBe('multiRoll')
      if (token.type === 'multiRoll') {
        expect(token.count).toBe(3)
        expect(token.tableId).toBe('tableName')
        expect(token.separator).toBe('# ')
      }
    })

    it('should parse multi-roll with markdown header in separator', () => {
      const token = parseExpression('3*tableName|"\\n## "')
      expect(token.type).toBe('multiRoll')
      if (token.type === 'multiRoll') {
        expect(token.count).toBe(3)
        expect(token.tableId).toBe('tableName')
        expect(token.separator).toBe('\\n## ')
      }
    })

    it('should parse variable count multi-roll', () => {
      const token = parseExpression('$count*tableName')
      expect(token.type).toBe('multiRoll')
      if (token.type === 'multiRoll') {
        expect(token.count).toBe('count')
        expect(token.tableId).toBe('tableName')
      }
    })
  })

  describe('instance references', () => {
    it('should parse instance reference', () => {
      const token = parseExpression('npc#leader')
      expect(token.type).toBe('instance')
      if (token.type === 'instance') {
        expect(token.tableId).toBe('npc')
        expect(token.instanceName).toBe('leader')
      }
    })
  })
})

describe('parseTemplate', () => {
  it('should parse template with mixed content', () => {
    const tokens = parseTemplate('You found {{dice:2d6*10}} gold pieces')
    expect(tokens).toHaveLength(3)
    expect(tokens[0]).toEqual({ type: 'literal', text: 'You found ' })
    expect(tokens[1]).toEqual({ type: 'dice', expression: '2d6*10' })
    expect(tokens[2]).toEqual({ type: 'literal', text: ' gold pieces' })
  })

  it('should parse template with multiple expressions', () => {
    const tokens = parseTemplate('A {{race}} {{class}}')
    expect(tokens).toHaveLength(4)
    expect(tokens[0].type).toBe('literal')
    expect(tokens[1].type).toBe('table')
    expect(tokens[2].type).toBe('literal')
    expect(tokens[3].type).toBe('table')
  })

  it('should handle plain text', () => {
    const tokens = parseTemplate('Just plain text')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({ type: 'literal', text: 'Just plain text' })
  })

  it('should handle expression only', () => {
    const tokens = parseTemplate('{{tableName}}')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].type).toBe('table')
  })

  it('should handle escaped braces', () => {
    const tokens = parseTemplate('Use \\{{this}} syntax')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({ type: 'literal', text: 'Use {{this}} syntax' })
  })
})

describe('hasExpressions', () => {
  it('should return true for text with expressions', () => {
    expect(hasExpressions('Hello {{world}}')).toBe(true)
  })

  it('should return false for plain text', () => {
    expect(hasExpressions('Hello world')).toBe(false)
  })

  it('should return false for escaped braces', () => {
    expect(hasExpressions('Hello \\{{world}}')).toBe(false)
  })
})

describe('getReferencedTables', () => {
  it('should extract table references', () => {
    const tables = getReferencedTables('A {{race}} with {{3*traits}}')
    expect(tables).toContain('race')
    expect(tables).toContain('traits')
    expect(tables).toHaveLength(2)
  })

  it('should handle no tables', () => {
    const tables = getReferencedTables('Just {{dice:2d6}} gold')
    expect(tables).toHaveLength(0)
  })
})

describe('getReferencedVariables', () => {
  it('should extract variable references', () => {
    const vars = getReferencedVariables('Count is {{$count}} and {{$total}}')
    expect(vars).toContain('count')
    expect(vars).toContain('total')
  })

  it('should extract variable from multi-roll count', () => {
    const vars = getReferencedVariables('{{$n*tableName}}')
    expect(vars).toContain('n')
  })

  it('should extract capture variables', () => {
    const vars = getReferencedVariables('{{3*items >> $stuff}}')
    expect(vars).toContain('stuff')
  })

  it('should extract capture access variables', () => {
    const vars = getReferencedVariables('{{$items[0]}} and {{$items.count}}')
    expect(vars).toContain('items')
  })

  it('should extract collect variables', () => {
    const vars = getReferencedVariables('{{collect:$items.@type}}')
    expect(vars).toContain('items')
  })
})

// ============================================================================
// Capture System Tests
// ============================================================================

describe('capture multi-roll', () => {
  it('should parse basic capture syntax', () => {
    const token = parseExpression('3*enemies >> $foes')
    expect(token.type).toBe('captureMultiRoll')
    if (token.type === 'captureMultiRoll') {
      expect(token.count).toBe(3)
      expect(token.tableId).toBe('enemies')
      expect(token.captureVar).toBe('foes')
      expect(token.unique).toBeFalsy()
      expect(token.silent).toBeFalsy()
    }
  })

  it('should parse unique capture', () => {
    const token = parseExpression('3*unique*enemies >> $foes')
    expect(token.type).toBe('captureMultiRoll')
    if (token.type === 'captureMultiRoll') {
      expect(token.count).toBe(3)
      expect(token.unique).toBe(true)
      expect(token.captureVar).toBe('foes')
    }
  })

  it('should parse silent capture', () => {
    const token = parseExpression('3*enemies >> $foes|silent')
    expect(token.type).toBe('captureMultiRoll')
    if (token.type === 'captureMultiRoll') {
      expect(token.count).toBe(3)
      expect(token.silent).toBe(true)
      expect(token.separator).toBeUndefined()
    }
  })

  it('should parse capture with separator', () => {
    const token = parseExpression('3*enemies >> $foes|"; "')
    expect(token.type).toBe('captureMultiRoll')
    if (token.type === 'captureMultiRoll') {
      expect(token.separator).toBe('; ')
      expect(token.silent).toBeFalsy()
    }
  })

  it('should parse variable count capture', () => {
    const token = parseExpression('$n*enemies >> $foes')
    expect(token.type).toBe('captureMultiRoll')
    if (token.type === 'captureMultiRoll') {
      expect(token.count).toBe('n')
      expect(token.captureVar).toBe('foes')
    }
  })

  it('should parse dice count capture', () => {
    const token = parseExpression('dice:1d4*enemies >> $foes')
    expect(token.type).toBe('captureMultiRoll')
    if (token.type === 'captureMultiRoll') {
      expect(token.diceCount).toBe('1d4')
      expect(token.captureVar).toBe('foes')
    }
  })

  it('should parse dice count with unique capture', () => {
    const token = parseExpression('dice:1d4*unique*enemies >> $foes')
    expect(token.type).toBe('captureMultiRoll')
    if (token.type === 'captureMultiRoll') {
      expect(token.diceCount).toBe('1d4')
      expect(token.unique).toBe(true)
      expect(token.captureVar).toBe('foes')
    }
  })

  it('should parse capture with namespace', () => {
    const token = parseExpression('3*fantasy.core.enemies >> $foes')
    expect(token.type).toBe('captureMultiRoll')
    if (token.type === 'captureMultiRoll') {
      expect(token.tableId).toBe('enemies')
      expect(token.namespace).toBe('fantasy.core')
      expect(token.captureVar).toBe('foes')
    }
  })

  it('should parse capture with alias (single segment)', () => {
    const token = parseExpression('4*unique*aliens.speciesName >> $species|silent')
    expect(token.type).toBe('captureMultiRoll')
    if (token.type === 'captureMultiRoll') {
      expect(token.count).toBe(4)
      expect(token.unique).toBe(true)
      expect(token.alias).toBe('aliens')
      expect(token.tableId).toBe('speciesName')
      expect(token.captureVar).toBe('species')
      expect(token.silent).toBe(true)
    }
  })
})

describe('capture access', () => {
  it('should parse simple capture access (all values)', () => {
    const token = parseExpression('$foes')
    // This should fall through to regular variable since no capture pattern
    expect(token.type).toBe('variable')
  })

  it('should parse capture access with separator', () => {
    const token = parseExpression('$foes|"; "')
    expect(token.type).toBe('captureAccess')
    if (token.type === 'captureAccess') {
      expect(token.varName).toBe('foes')
      expect(token.separator).toBe('; ')
      expect(token.index).toBeUndefined()
    }
  })

  it('should parse indexed access', () => {
    const token = parseExpression('$foes[0]')
    expect(token.type).toBe('captureAccess')
    if (token.type === 'captureAccess') {
      expect(token.varName).toBe('foes')
      expect(token.index).toBe(0)
    }
  })

  it('should parse negative indexed access', () => {
    const token = parseExpression('$foes[-1]')
    expect(token.type).toBe('captureAccess')
    if (token.type === 'captureAccess') {
      expect(token.varName).toBe('foes')
      expect(token.index).toBe(-1)
    }
  })

  it('should parse count property', () => {
    const token = parseExpression('$foes.count')
    expect(token.type).toBe('captureAccess')
    if (token.type === 'captureAccess') {
      expect(token.varName).toBe('foes')
      expect(token.properties).toEqual(['count'])
      expect(token.index).toBeUndefined()
    }
  })

  it('should parse value property', () => {
    const token = parseExpression('$foes.value')
    expect(token.type).toBe('captureAccess')
    if (token.type === 'captureAccess') {
      expect(token.varName).toBe('foes')
      expect(token.properties).toEqual(['value'])
    }
  })

  it('should parse indexed value access', () => {
    const token = parseExpression('$foes[0].value')
    expect(token.type).toBe('captureAccess')
    if (token.type === 'captureAccess') {
      expect(token.varName).toBe('foes')
      expect(token.index).toBe(0)
      expect(token.properties).toEqual(['value'])
    }
  })

  it('should parse indexed property access', () => {
    const token = parseExpression('$foes[0].@enemy')
    expect(token.type).toBe('captureAccess')
    if (token.type === 'captureAccess') {
      expect(token.varName).toBe('foes')
      expect(token.index).toBe(0)
      expect(token.properties).toEqual(['enemy']) // stored without @
    }
  })

  it('should parse property access without index', () => {
    const token = parseExpression('$foes.@enemy')
    expect(token.type).toBe('captureAccess')
    if (token.type === 'captureAccess') {
      expect(token.varName).toBe('foes')
      expect(token.properties).toEqual(['enemy'])
      expect(token.index).toBeUndefined()
    }
  })

  it('should parse chained property access', () => {
    const token = parseExpression('$conflict.@situation.@focus')
    expect(token.type).toBe('captureAccess')
    if (token.type === 'captureAccess') {
      expect(token.varName).toBe('conflict')
      expect(token.properties).toEqual(['situation', 'focus'])
      expect(token.index).toBeUndefined()
    }
  })

  it('should parse deep chained property access', () => {
    const token = parseExpression('$root.@a.@b.@c.@d')
    expect(token.type).toBe('captureAccess')
    if (token.type === 'captureAccess') {
      expect(token.varName).toBe('root')
      expect(token.properties).toEqual(['a', 'b', 'c', 'd'])
    }
  })

  it('should parse indexed access with chained properties', () => {
    const token = parseExpression('$items[0].@weapon.@damage')
    expect(token.type).toBe('captureAccess')
    if (token.type === 'captureAccess') {
      expect(token.varName).toBe('items')
      expect(token.index).toBe(0)
      expect(token.properties).toEqual(['weapon', 'damage'])
    }
  })
})

describe('collect', () => {
  it('should parse basic collect value', () => {
    const token = parseExpression('collect:$foes.value')
    expect(token.type).toBe('collect')
    if (token.type === 'collect') {
      expect(token.varName).toBe('foes')
      expect(token.property).toBe('value')
      expect(token.unique).toBeFalsy()
    }
  })

  it('should parse collect with property', () => {
    const token = parseExpression('collect:$foes.@enemy')
    expect(token.type).toBe('collect')
    if (token.type === 'collect') {
      expect(token.varName).toBe('foes')
      expect(token.property).toBe('enemy') // stored without @
    }
  })

  it('should parse unique collect', () => {
    const token = parseExpression('collect:$foes.@type|unique')
    expect(token.type).toBe('collect')
    if (token.type === 'collect') {
      expect(token.unique).toBe(true)
      expect(token.separator).toBeUndefined()
    }
  })

  it('should parse collect with separator', () => {
    const token = parseExpression('collect:$foes.value|"; "')
    expect(token.type).toBe('collect')
    if (token.type === 'collect') {
      expect(token.separator).toBe('; ')
      expect(token.unique).toBeFalsy()
    }
  })

  it('should parse collect with unique and separator', () => {
    const token = parseExpression('collect:$foes.@type|unique|"; "')
    expect(token.type).toBe('collect')
    if (token.type === 'collect') {
      expect(token.unique).toBe(true)
      expect(token.separator).toBe('; ')
    }
  })
})

describe('getReferencedTables with captures', () => {
  it('should extract table from capture multi-roll', () => {
    const tables = getReferencedTables('{{3*enemies >> $foes}}')
    expect(tables).toContain('enemies')
  })
})

// ============================================================================
// Switch Expression Tests
// ============================================================================

describe('switch expressions', () => {
  describe('standalone switch', () => {
    it('should parse simple switch with else', () => {
      const token = parseExpression('switch[$x=="a":"A"].else["B"]')
      expect(token.type).toBe('switch')
      if (token.type === 'switch') {
        expect(token.clauses).toHaveLength(1)
        expect(token.clauses[0].condition).toBe('$x=="a"')
        expect(token.clauses[0].resultExpr).toBe('"A"')
        expect(token.elseExpr).toBe('"B"')
      }
    })

    it('should parse multiple switch clauses', () => {
      const token = parseExpression('switch[$x=="a":"A"].switch[$x=="b":"B"].else["C"]')
      expect(token.type).toBe('switch')
      if (token.type === 'switch') {
        expect(token.clauses).toHaveLength(2)
        expect(token.clauses[0].condition).toBe('$x=="a"')
        expect(token.clauses[0].resultExpr).toBe('"A"')
        expect(token.clauses[1].condition).toBe('$x=="b"')
        expect(token.clauses[1].resultExpr).toBe('"B"')
        expect(token.elseExpr).toBe('"C"')
      }
    })

    it('should parse switch without else', () => {
      const token = parseExpression('switch[$x=="a":"A"]')
      expect(token.type).toBe('switch')
      if (token.type === 'switch') {
        expect(token.clauses).toHaveLength(1)
        expect(token.elseExpr).toBeUndefined()
      }
    })

    it('should parse switch with capture property access result', () => {
      const token = parseExpression('switch[$gender=="male":$race.@maleName].else[$race.@femaleName]')
      expect(token.type).toBe('switch')
      if (token.type === 'switch') {
        expect(token.clauses[0].resultExpr).toBe('$race.@maleName')
        expect(token.elseExpr).toBe('$race.@femaleName')
      }
    })

    it('should parse switch with nested expression result', () => {
      const token = parseExpression('switch[$class=="wizard":{{spellBook}}].else[{{gear}}]')
      expect(token.type).toBe('switch')
      if (token.type === 'switch') {
        expect(token.clauses[0].resultExpr).toBe('{{spellBook}}')
        expect(token.elseExpr).toBe('{{gear}}')
      }
    })

    it('should parse switch with logical operators in condition', () => {
      const token = parseExpression('switch[$a=="1" && $b=="2":$c.@prop].else["default"]')
      expect(token.type).toBe('switch')
      if (token.type === 'switch') {
        expect(token.clauses[0].condition).toBe('$a=="1" && $b=="2"')
      }
    })

    it('should parse switch with nested brackets in condition', () => {
      const token = parseExpression('switch[($a || $b) && $c:"match"].else["no"]')
      expect(token.type).toBe('switch')
      if (token.type === 'switch') {
        expect(token.clauses[0].condition).toBe('($a || $b) && $c')
        expect(token.clauses[0].resultExpr).toBe('"match"')
      }
    })

    it('should parse switch with contains operator', () => {
      const token = parseExpression('switch[$name contains "the":"titled"].else["common"]')
      expect(token.type).toBe('switch')
      if (token.type === 'switch') {
        expect(token.clauses[0].condition).toBe('$name contains "the"')
      }
    })

    it('should parse switch with numeric comparison', () => {
      const token = parseExpression('switch[$level>=5:"high"].switch[$level>=3:"mid"].else["low"]')
      expect(token.type).toBe('switch')
      if (token.type === 'switch') {
        expect(token.clauses).toHaveLength(2)
        expect(token.clauses[0].condition).toBe('$level>=5')
        expect(token.clauses[1].condition).toBe('$level>=3')
      }
    })
  })

  describe('attached switch', () => {
    it('should parse dice expression with switch', () => {
      const token = parseExpression('dice:1d20.switch[$>=10:"hit"].else["miss"]')
      expect(token.type).toBe('dice')
      if (token.type === 'dice') {
        expect(token.expression).toBe('1d20')
      }
      const tokenWithSwitch = token as typeof token & { switchModifiers?: { clauses: Array<{ condition: string; resultExpr: string }>; elseExpr?: string } }
      expect(tokenWithSwitch.switchModifiers).toBeDefined()
      expect(tokenWithSwitch.switchModifiers!.clauses).toHaveLength(1)
      expect(tokenWithSwitch.switchModifiers!.clauses[0].condition).toBe('$>=10')
      expect(tokenWithSwitch.switchModifiers!.elseExpr).toBe('"miss"')
    })

    it('should parse table with switch', () => {
      const token = parseExpression('mood.switch[$=="angry":"rage"].else["calm"]')
      expect(token.type).toBe('table')
      if (token.type === 'table') {
        expect(token.tableId).toBe('mood')
      }
      const tokenWithSwitch = token as typeof token & { switchModifiers?: { clauses: Array<{ condition: string; resultExpr: string }>; elseExpr?: string } }
      expect(tokenWithSwitch.switchModifiers).toBeDefined()
      expect(tokenWithSwitch.switchModifiers!.clauses[0].condition).toBe('$=="angry"')
    })

    it('should parse capture access with switch', () => {
      const token = parseExpression('$race.switch[$gender=="male":$race.@maleName].else[$race.@femaleName]')
      // This should be parsed as a variable with switch modifiers
      // But since $race without special patterns falls through to variable...
      expect(token.type).toBe('variable')
      const tokenWithSwitch = token as typeof token & { switchModifiers?: { clauses: Array<{ condition: string; resultExpr: string }>; elseExpr?: string } }
      expect(tokenWithSwitch.switchModifiers).toBeDefined()
      expect(tokenWithSwitch.switchModifiers!.clauses).toHaveLength(1)
    })

    it('should parse capture property access with switch', () => {
      const token = parseExpression('$hero.@class.switch[$=="wizard":"mage"].else["warrior"]')
      expect(token.type).toBe('captureAccess')
      if (token.type === 'captureAccess') {
        expect(token.varName).toBe('hero')
        expect(token.properties).toEqual(['class'])
      }
      const tokenWithSwitch = token as typeof token & { switchModifiers?: { clauses: Array<{ condition: string; resultExpr: string }>; elseExpr?: string } }
      expect(tokenWithSwitch.switchModifiers).toBeDefined()
    })

    it('should parse multiple switch clauses on expression', () => {
      const token = parseExpression('dice:1d20.switch[$>=20:"crit"].switch[$>=10:"hit"].else["miss"]')
      expect(token.type).toBe('dice')
      const tokenWithSwitch = token as typeof token & { switchModifiers?: { clauses: Array<{ condition: string; resultExpr: string }>; elseExpr?: string } }
      expect(tokenWithSwitch.switchModifiers!.clauses).toHaveLength(2)
      expect(tokenWithSwitch.switchModifiers!.clauses[0].condition).toBe('$>=20')
      expect(tokenWithSwitch.switchModifiers!.clauses[1].condition).toBe('$>=10')
    })

    it('should parse variable with switch without else', () => {
      const token = parseExpression('$x.switch[$=="a":"A"]')
      expect(token.type).toBe('variable')
      const tokenWithSwitch = token as typeof token & { switchModifiers?: { clauses: Array<{ condition: string; resultExpr: string }>; elseExpr?: string } }
      expect(tokenWithSwitch.switchModifiers).toBeDefined()
      expect(tokenWithSwitch.switchModifiers!.clauses).toHaveLength(1)
      expect(tokenWithSwitch.switchModifiers!.elseExpr).toBeUndefined()
    })
  })

  describe('switch with complex content', () => {
    it('should preserve quotes in conditions', () => {
      const token = parseExpression('switch[$name=="John Doe":"found"].else["not found"]')
      expect(token.type).toBe('switch')
      if (token.type === 'switch') {
        expect(token.clauses[0].condition).toBe('$name=="John Doe"')
      }
    })

    it('should handle colons inside quoted strings', () => {
      const token = parseExpression('switch[$time=="12:00":"noon"].else["other"]')
      expect(token.type).toBe('switch')
      if (token.type === 'switch') {
        expect(token.clauses[0].condition).toBe('$time=="12:00"')
        expect(token.clauses[0].resultExpr).toBe('"noon"')
      }
    })

    it('should handle nested brackets in result', () => {
      const token = parseExpression('switch[$x=="a":{{table[0]}}].else["b"]')
      expect(token.type).toBe('switch')
      if (token.type === 'switch') {
        expect(token.clauses[0].resultExpr).toBe('{{table[0]}}')
      }
    })
  })

  describe('switch error handling', () => {
    it('should throw on missing colon in switch clause', () => {
      expect(() => parseExpression('switch[$x=="a"]["A"].else["B"]')).toThrow(/missing colon/)
    })

    it('should throw on empty switch expression', () => {
      expect(() => parseExpression('switch[]')).toThrow()
    })
  })
})
