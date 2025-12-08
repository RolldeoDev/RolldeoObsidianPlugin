/**
 * Tests for the Template Expression Parser
 */

import {
  parseExpression,
  parseTemplate,
  extractExpressions,
  hasExpressions,
  getReferencedTables,
  getReferencedVariables,
} from '../engine/core/parser';

describe('Parser', () => {
  describe('extractExpressions', () => {
    it('should extract single expression', () => {
      const matches = extractExpressions('Hello {{world}}!');
      expect(matches).toHaveLength(1);
      expect(matches[0].expression).toBe('world');
      expect(matches[0].start).toBe(6);
      expect(matches[0].end).toBe(17);
    });

    it('should extract multiple expressions', () => {
      const matches = extractExpressions('{{a}} and {{b}} and {{c}}');
      expect(matches).toHaveLength(3);
      expect(matches[0].expression).toBe('a');
      expect(matches[1].expression).toBe('b');
      expect(matches[2].expression).toBe('c');
    });

    it('should handle escaped braces', () => {
      const matches = extractExpressions('\\{{not an expression}}');
      expect(matches).toHaveLength(0);
    });

    it('should handle nested braces', () => {
      const matches = extractExpressions('{{outer {{inner}} outer}}');
      expect(matches).toHaveLength(1);
      expect(matches[0].expression).toBe('outer {{inner}} outer');
    });

    it('should return empty array for null/undefined', () => {
      expect(extractExpressions(null)).toEqual([]);
      expect(extractExpressions(undefined)).toEqual([]);
    });

    it('should return empty array for no expressions', () => {
      expect(extractExpressions('Just plain text')).toEqual([]);
    });
  });

  describe('parseExpression - Table References', () => {
    it('should parse simple table reference', () => {
      const token = parseExpression('colorTable');
      expect(token.type).toBe('table');
      if (token.type === 'table') {
        expect(token.tableId).toBe('colorTable');
        expect(token.alias).toBeUndefined();
      }
    });

    it('should parse aliased table reference', () => {
      const token = parseExpression('core.colorTable');
      expect(token.type).toBe('table');
      if (token.type === 'table') {
        expect(token.alias).toBe('core');
        expect(token.tableId).toBe('colorTable');
      }
    });

    it('should parse namespaced table reference', () => {
      const token = parseExpression('fantasy.creatures.dragons');
      expect(token.type).toBe('table');
      if (token.type === 'table') {
        expect(token.namespace).toBe('fantasy.creatures');
        expect(token.tableId).toBe('dragons');
      }
    });

    it('should parse table with property access', () => {
      const token = parseExpression('personTable.@name');
      expect(token.type).toBe('table');
      if (token.type === 'table') {
        expect(token.tableId).toBe('personTable');
        expect(token.properties).toEqual(['name']);
      }
    });
  });

  describe('parseExpression - Dice', () => {
    it('should parse dice expression', () => {
      const token = parseExpression('dice:2d6+5');
      expect(token.type).toBe('dice');
      if (token.type === 'dice') {
        expect(token.expression).toBe('2d6+5');
      }
    });

    it('should parse complex dice expression', () => {
      const token = parseExpression('dice:4d6kh3');
      expect(token.type).toBe('dice');
      if (token.type === 'dice') {
        expect(token.expression).toBe('4d6kh3');
      }
    });
  });

  describe('parseExpression - Math', () => {
    it('should parse math expression', () => {
      const token = parseExpression('math:2+2');
      expect(token.type).toBe('math');
      if (token.type === 'math') {
        expect(token.expression).toBe('2+2');
      }
    });

    it('should parse complex math expression', () => {
      const token = parseExpression('math:(10 + 5) * 2');
      expect(token.type).toBe('math');
      if (token.type === 'math') {
        expect(token.expression).toBe('(10 + 5) * 2');
      }
    });
  });

  describe('parseExpression - Variables', () => {
    it('should parse simple variable', () => {
      const token = parseExpression('$myVar');
      expect(token.type).toBe('variable');
      if (token.type === 'variable') {
        expect(token.name).toBe('myVar');
      }
    });

    it('should parse aliased variable', () => {
      const token = parseExpression('$alias.varName');
      expect(token.type).toBe('variable');
      if (token.type === 'variable') {
        expect(token.alias).toBe('alias');
        expect(token.name).toBe('varName');
      }
    });
  });

  describe('parseExpression - Placeholders', () => {
    it('should parse simple placeholder', () => {
      const token = parseExpression('@name');
      expect(token.type).toBe('placeholder');
      if (token.type === 'placeholder') {
        expect(token.name).toBe('name');
      }
    });

    it('should parse placeholder with property', () => {
      const token = parseExpression('@person.firstName');
      expect(token.type).toBe('placeholder');
      if (token.type === 'placeholder') {
        expect(token.name).toBe('person');
        expect(token.properties).toEqual(['firstName']);
      }
    });

    it('should parse chained placeholder properties', () => {
      const token = parseExpression('@person.@culture.@name');
      expect(token.type).toBe('placeholder');
      if (token.type === 'placeholder') {
        expect(token.name).toBe('person');
        expect(token.properties).toEqual(['culture', 'name']);
      }
    });
  });

  describe('parseExpression - Multi-Roll', () => {
    it('should parse simple multi-roll', () => {
      const token = parseExpression('3*colorTable');
      expect(token.type).toBe('multiRoll');
      if (token.type === 'multiRoll') {
        expect(token.count).toBe(3);
        expect(token.tableId).toBe('colorTable');
        expect(token.unique).toBeFalsy();
      }
    });

    it('should parse unique multi-roll', () => {
      const token = parseExpression('5*unique*colorTable');
      expect(token.type).toBe('multiRoll');
      if (token.type === 'multiRoll') {
        expect(token.count).toBe(5);
        expect(token.tableId).toBe('colorTable');
        expect(token.unique).toBe(true);
      }
    });

    it('should parse multi-roll with separator', () => {
      const token = parseExpression('3*colorTable|", and "');
      expect(token.type).toBe('multiRoll');
      if (token.type === 'multiRoll') {
        expect(token.count).toBe(3);
        expect(token.separator).toBe(', and ');
      }
    });

    it('should parse multi-roll with variable count', () => {
      const token = parseExpression('$count*colorTable');
      expect(token.type).toBe('multiRoll');
      if (token.type === 'multiRoll') {
        expect(token.count).toBe('count');
        expect(token.tableId).toBe('colorTable');
      }
    });

    it('should parse multi-roll with dice count', () => {
      const token = parseExpression('dice:1d4*colorTable');
      expect(token.type).toBe('multiRoll');
      if (token.type === 'multiRoll') {
        expect(token.diceCount).toBe('1d4');
        expect(token.tableId).toBe('colorTable');
      }
    });
  });

  describe('parseExpression - Again', () => {
    it('should parse simple again', () => {
      const token = parseExpression('again');
      expect(token.type).toBe('again');
    });

    it('should parse again with count', () => {
      const token = parseExpression('2*again');
      expect(token.type).toBe('again');
      if (token.type === 'again') {
        expect(token.count).toBe(2);
      }
    });

    it('should parse unique again', () => {
      const token = parseExpression('3*unique*again');
      expect(token.type).toBe('again');
      if (token.type === 'again') {
        expect(token.count).toBe(3);
        expect(token.unique).toBe(true);
      }
    });

    it('should parse again with separator', () => {
      const token = parseExpression('again|"; "');
      expect(token.type).toBe('again');
      if (token.type === 'again') {
        expect(token.separator).toBe('; ');
      }
    });
  });

  describe('parseExpression - Instance', () => {
    it('should parse instance reference', () => {
      const token = parseExpression('npcTable#hero');
      expect(token.type).toBe('instance');
      if (token.type === 'instance') {
        expect(token.tableId).toBe('npcTable');
        expect(token.instanceName).toBe('hero');
      }
    });
  });

  describe('parseExpression - Capture Multi-Roll', () => {
    it('should parse basic capture multi-roll', () => {
      const token = parseExpression('3*colorTable >> $colors');
      expect(token.type).toBe('captureMultiRoll');
      if (token.type === 'captureMultiRoll') {
        expect(token.count).toBe(3);
        expect(token.tableId).toBe('colorTable');
        expect(token.captureVar).toBe('colors');
      }
    });

    it('should parse unique capture multi-roll', () => {
      const token = parseExpression('5*unique*items >> $inventory');
      expect(token.type).toBe('captureMultiRoll');
      if (token.type === 'captureMultiRoll') {
        expect(token.count).toBe(5);
        expect(token.unique).toBe(true);
        expect(token.captureVar).toBe('inventory');
      }
    });

    it('should parse silent capture multi-roll', () => {
      const token = parseExpression('3*table >> $var|silent');
      expect(token.type).toBe('captureMultiRoll');
      if (token.type === 'captureMultiRoll') {
        expect(token.silent).toBe(true);
      }
    });

    it('should parse capture multi-roll with separator', () => {
      const token = parseExpression('3*table >> $var|"; "');
      expect(token.type).toBe('captureMultiRoll');
      if (token.type === 'captureMultiRoll') {
        expect(token.separator).toBe('; ');
      }
    });
  });

  describe('parseExpression - Capture Access', () => {
    it('should parse simple capture access', () => {
      const token = parseExpression('$myVar');
      // Note: simple $var without index or properties is parsed as variable
      // Capture access needs index, .count, .value, or .@prop
      expect(token.type).toBe('variable');
    });

    it('should parse indexed capture access', () => {
      const token = parseExpression('$colors[0]');
      expect(token.type).toBe('captureAccess');
      if (token.type === 'captureAccess') {
        expect(token.varName).toBe('colors');
        expect(token.index).toBe(0);
      }
    });

    it('should parse negative indexed capture access', () => {
      const token = parseExpression('$colors[-1]');
      expect(token.type).toBe('captureAccess');
      if (token.type === 'captureAccess') {
        expect(token.index).toBe(-1);
      }
    });

    it('should parse .count access', () => {
      const token = parseExpression('$items.count');
      expect(token.type).toBe('captureAccess');
      if (token.type === 'captureAccess') {
        expect(token.varName).toBe('items');
        expect(token.properties).toEqual(['count']);
      }
    });

    it('should parse property access', () => {
      const token = parseExpression('$person.@name');
      expect(token.type).toBe('captureAccess');
      if (token.type === 'captureAccess') {
        expect(token.varName).toBe('person');
        expect(token.properties).toEqual(['name']);
      }
    });

    it('should parse chained property access', () => {
      const token = parseExpression('$person.@culture.@name');
      expect(token.type).toBe('captureAccess');
      if (token.type === 'captureAccess') {
        expect(token.properties).toEqual(['culture', 'name']);
      }
    });

    it('should parse indexed access with property', () => {
      const token = parseExpression('$items[0].@name');
      expect(token.type).toBe('captureAccess');
      if (token.type === 'captureAccess') {
        expect(token.index).toBe(0);
        expect(token.properties).toEqual(['name']);
      }
    });

    it('should parse capture access with separator', () => {
      const token = parseExpression('$colors|"; "');
      expect(token.type).toBe('captureAccess');
      if (token.type === 'captureAccess') {
        expect(token.separator).toBe('; ');
      }
    });
  });

  describe('parseExpression - Collect', () => {
    it('should parse collect value', () => {
      const token = parseExpression('collect:$items.value');
      expect(token.type).toBe('collect');
      if (token.type === 'collect') {
        expect(token.varName).toBe('items');
        expect(token.property).toBe('value');
      }
    });

    it('should parse collect property', () => {
      const token = parseExpression('collect:$npcs.@name');
      expect(token.type).toBe('collect');
      if (token.type === 'collect') {
        expect(token.varName).toBe('npcs');
        expect(token.property).toBe('name');
      }
    });

    it('should parse unique collect', () => {
      const token = parseExpression('collect:$items.@type|unique');
      expect(token.type).toBe('collect');
      if (token.type === 'collect') {
        expect(token.unique).toBe(true);
      }
    });

    it('should parse collect with separator', () => {
      const token = parseExpression('collect:$items.@name|", and "');
      expect(token.type).toBe('collect');
      if (token.type === 'collect') {
        expect(token.separator).toBe(', and ');
      }
    });
  });

  describe('parseExpression - Switch', () => {
    it('should parse standalone switch expression', () => {
      const token = parseExpression('switch[$gender=="male":"he"].else["they"]');
      expect(token.type).toBe('switch');
      if (token.type === 'switch') {
        expect(token.clauses).toHaveLength(1);
        expect(token.clauses[0].condition).toBe('$gender=="male"');
        expect(token.clauses[0].resultExpr).toBe('"he"');
        expect(token.elseExpr).toBe('"they"');
      }
    });

    it('should parse chained switch expression', () => {
      const token = parseExpression(
        'switch[$x==1:"one"].switch[$x==2:"two"].else["other"]'
      );
      expect(token.type).toBe('switch');
      if (token.type === 'switch') {
        expect(token.clauses).toHaveLength(2);
        expect(token.clauses[0].condition).toBe('$x==1');
        expect(token.clauses[1].condition).toBe('$x==2');
      }
    });

    it('should parse attached switch modifier', () => {
      const token = parseExpression('colorTable.switch[$rare:goldTable].else[silverTable]');
      expect(token.type).toBe('table');
      expect('switchModifiers' in token).toBe(true);
      const tokenWithSwitch = token as typeof token & { switchModifiers?: { clauses: unknown[]; elseExpr?: string } };
      expect(tokenWithSwitch.switchModifiers?.clauses).toHaveLength(1);
      expect(tokenWithSwitch.switchModifiers?.elseExpr).toBe('silverTable');
    });
  });

  describe('parseTemplate', () => {
    it('should parse template with mixed content', () => {
      const tokens = parseTemplate('Hello {{name}}, you rolled {{dice:1d20}}!');
      expect(tokens).toHaveLength(4);
      expect(tokens[0].type).toBe('literal');
      expect(tokens[1].type).toBe('table');
      expect(tokens[2].type).toBe('literal');
      expect(tokens[3].type).toBe('dice');
    });

    it('should handle template with only expressions', () => {
      const tokens = parseTemplate('{{a}}{{b}}{{c}}');
      expect(tokens).toHaveLength(3);
      expect(tokens.every((t) => t.type === 'table')).toBe(true);
    });

    it('should handle template with no expressions', () => {
      const tokens = parseTemplate('Just plain text');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('literal');
    });

    it('should unescape braces in literals', () => {
      const tokens = parseTemplate('Show \\{{this}} as literal');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('literal');
      if (tokens[0].type === 'literal') {
        expect(tokens[0].text).toContain('{{this}}');
      }
    });
  });

  describe('hasExpressions', () => {
    it('should return true when expressions exist', () => {
      expect(hasExpressions('Hello {{world}}')).toBe(true);
    });

    it('should return false when no expressions', () => {
      expect(hasExpressions('Just plain text')).toBe(false);
    });

    it('should return false for escaped expressions', () => {
      expect(hasExpressions('\\{{not an expression}}')).toBe(false);
    });
  });

  describe('getReferencedTables', () => {
    it('should extract table references', () => {
      const tables = getReferencedTables('{{colorTable}} and {{sizeTable}}');
      expect(tables).toContain('colorTable');
      expect(tables).toContain('sizeTable');
    });

    it('should extract table from multi-roll', () => {
      const tables = getReferencedTables('{{3*colorTable}}');
      expect(tables).toContain('colorTable');
    });

    it('should extract table from instance', () => {
      const tables = getReferencedTables('{{npcTable#hero}}');
      expect(tables).toContain('npcTable');
    });

    it('should deduplicate tables', () => {
      const tables = getReferencedTables('{{table}} {{table}} {{table}}');
      expect(tables).toHaveLength(1);
    });
  });

  describe('getReferencedVariables', () => {
    it('should extract variable references', () => {
      const vars = getReferencedVariables('{{$name}} and {{$age}}');
      expect(vars).toContain('name');
      expect(vars).toContain('age');
    });

    it('should extract variable from multi-roll count', () => {
      const vars = getReferencedVariables('{{$count*table}}');
      expect(vars).toContain('count');
    });

    it('should extract capture variable', () => {
      const vars = getReferencedVariables('{{3*table >> $items}}');
      expect(vars).toContain('items');
    });

    it('should extract from capture access', () => {
      const vars = getReferencedVariables('{{$items[0].@name}}');
      expect(vars).toContain('items');
    });

    it('should extract from collect', () => {
      const vars = getReferencedVariables('{{collect:$npcs.@name}}');
      expect(vars).toContain('npcs');
    });
  });
});
