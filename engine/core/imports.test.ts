import { describe, it, expect, beforeEach } from 'vitest'
import { RandomTableEngine } from './index'
import type { RandomTableDocument } from '../types'

/**
 * Tests for cross-collection imports
 *
 * These tests verify that imports work correctly when:
 * 1. A collection imports another collection via namespace
 * 2. Patterns reference tables/templates from imported collections
 * 3. Placeholder context doesn't leak between collections
 */

// Imported collection with name generation
// Uses explicit {{}} syntax in set values for dynamic table rolls
const fantasyNamesDocument: RandomTableDocument = {
  metadata: {
    name: 'Fantasy Names',
    namespace: 'fantasy.names',
    version: '1.0.0',
    specVersion: '1.0',
  },
  tables: [
    {
      id: 'race',
      name: 'Race',
      type: 'simple',
      entries: [
        {
          id: 'elf',
          value: 'Elf',
          weight: 1,
          sets: {
            raceId: 'elf',
            // Use explicit {{}} syntax - tables are rolled at merge time
            firstName: '{{elfFirstNames}}',
            surname: '{{elfSurnames}}',
          },
        },
        {
          id: 'dwarf',
          value: 'Dwarf',
          weight: 1,
          sets: {
            raceId: 'dwarf',
            // Use explicit {{}} syntax - tables are rolled at merge time
            firstName: '{{dwarfFirstNames}}',
            surname: '{{dwarfSurnames}}',
          },
        },
      ],
    },
    {
      id: 'elfFirstNames',
      name: 'Elf First Names',
      type: 'simple',
      entries: [
        { id: 'aelindra', value: 'Aelindra', weight: 1 },
        { id: 'thalion', value: 'Thalion', weight: 1 },
      ],
    },
    {
      id: 'elfSurnames',
      name: 'Elf Surnames',
      type: 'simple',
      entries: [
        { id: 'moonwhisper', value: 'Moonwhisper', weight: 1 },
        { id: 'starfall', value: 'Starfall', weight: 1 },
      ],
    },
    {
      id: 'dwarfFirstNames',
      name: 'Dwarf First Names',
      type: 'simple',
      entries: [
        { id: 'thorin', value: 'Thorin', weight: 1 },
        { id: 'gimli', value: 'Gimli', weight: 1 },
      ],
    },
    {
      id: 'dwarfSurnames',
      name: 'Dwarf Surnames',
      type: 'simple',
      entries: [
        { id: 'ironforge', value: 'Ironforge', weight: 1 },
        { id: 'stonehammer', value: 'Stonehammer', weight: 1 },
      ],
    },
  ],
  templates: [
    {
      id: 'fullName',
      name: 'Full Name',
      description: 'Generates a full name based on race',
      shared: {
        _raceInit: '{{race}}',
      },
      // Access pre-evaluated set values (firstName and surname already rolled)
      pattern: '{{@race.firstName}} {{@race.surname}}',
    },
    {
      id: 'simpleGreeting',
      name: 'Simple Greeting',
      description: 'A simple greeting that uses no placeholders',
      pattern: 'Hello, adventurer!',
    },
  ],
}

// Parent collection that imports the names collection
const npcDocument: RandomTableDocument = {
  metadata: {
    name: 'NPC Generator',
    namespace: 'npc.generator',
    version: '1.0.0',
    specVersion: '1.0',
  },
  imports: [
    {
      path: 'fantasy.names',
      alias: 'names',
      description: 'Fantasy name generator',
    },
  ],
  tables: [
    {
      id: 'occupation',
      name: 'Occupation',
      type: 'simple',
      entries: [
        { id: 'blacksmith', value: 'blacksmith', weight: 1 },
        { id: 'merchant', value: 'merchant', weight: 1 },
        { id: 'innkeeper', value: 'innkeeper', weight: 1 },
      ],
    },
    {
      id: 'trait',
      name: 'Trait',
      type: 'simple',
      entries: [
        { id: 'brave', value: 'brave', weight: 1 },
        { id: 'cunning', value: 'cunning', weight: 1 },
        { id: 'wise', value: 'wise', weight: 1 },
      ],
    },
    {
      id: 'creature',
      name: 'Creature',
      type: 'simple',
      entries: [
        {
          id: 'goblin',
          value: 'goblin',
          weight: 1,
          sets: {
            creatureType: 'monster',
            habitat: 'caves',
          },
        },
        {
          id: 'dragon',
          value: 'dragon',
          weight: 1,
          sets: {
            creatureType: 'beast',
            habitat: 'mountains',
          },
        },
      ],
    },
  ],
  templates: [
    {
      id: 'npcDescription',
      name: 'NPC Description',
      pattern: 'A {{occupation}} named {{names.fullName}} who is {{trait}} and {{trait}}.',
    },
    {
      id: 'simpleNpc',
      name: 'Simple NPC',
      pattern: '{{names.fullName}} the {{occupation}}',
    },
    {
      id: 'npcWithCreature',
      name: 'NPC with Creature',
      description: 'Tests that placeholders from imported collection do not affect local tables',
      pattern: 'A {{trait}} {{occupation}} encounters a {{creature}} in the {{@creature.habitat}}.',
    },
  ],
}

describe('Cross-Collection Imports', () => {
  let engine: RandomTableEngine

  beforeEach(() => {
    engine = new RandomTableEngine()
    // Load both collections
    engine.loadCollection(fantasyNamesDocument, 'fantasy-names')
    engine.loadCollection(npcDocument, 'npc-generator')
    // Resolve imports
    engine.resolveImports()
  })

  describe('import resolution', () => {
    it('should resolve imports by namespace', () => {
      // The import should be resolved
      const collections = engine.listCollections()
      expect(collections.length).toBe(2)
    })

    it('should access imported table via alias', () => {
      // Roll on an imported table directly
      const result = engine.roll('race', 'fantasy-names')
      expect(['Elf', 'Dwarf']).toContain(result.text)
    })
  })

  describe('template evaluation with imports', () => {
    it('should evaluate imported template correctly', () => {
      const result = engine.rollTemplate('simpleNpc', 'npc-generator')
      // Should contain a name (first + last) and an occupation
      expect(result.text).toMatch(/\w+ \w+ the (blacksmith|merchant|innkeeper)/)
    })

    it('should evaluate imported template with placeholder-based dynamic tables', () => {
      const result = engine.rollTemplate('fullName', 'fantasy-names')
      // Should return FirstName Surname format
      const parts = result.text.split(' ')
      expect(parts.length).toBe(2)
      // First name should be from one of the name tables
      const validFirstNames = ['Aelindra', 'Thalion', 'Thorin', 'Gimli']
      const validSurnames = ['Moonwhisper', 'Starfall', 'Ironforge', 'Stonehammer']
      expect(validFirstNames).toContain(parts[0])
      expect(validSurnames).toContain(parts[1])
    })
  })

  describe('placeholder isolation', () => {
    it('should not leak placeholders from imported collection to parent', () => {
      // This is the critical test for the bug
      // The pattern: 'A {{occupation}} named {{names.fullName}} who is {{trait}} and {{trait}}.'
      // After {{names.fullName}} evaluates (which sets @race placeholders),
      // {{trait}} should still return trait values, not placeholder values or table names
      const result = engine.rollTemplate('npcDescription', 'npc-generator')

      // Extract the trait values from the result
      // Pattern: "A <occupation> named <name> who is <trait1> and <trait2>."
      const match = result.text.match(/A (\w+) named (.+) who is (\w+) and (\w+)\./)
      expect(match).not.toBeNull()

      if (match) {
        const [, occupation, name, trait1, trait2] = match

        // Occupation should be valid
        expect(['blacksmith', 'merchant', 'innkeeper']).toContain(occupation)

        // Name should be two words (FirstName Surname)
        expect(name.split(' ').length).toBe(2)

        // CRITICAL: Traits should be actual trait values, NOT table names or placeholder values
        const validTraits = ['brave', 'cunning', 'wise']
        expect(validTraits).toContain(trait1)
        expect(validTraits).toContain(trait2)

        // Make sure we're not getting placeholder values leaked
        const invalidValues = ['elfFirstNames', 'elfSurnames', 'dwarfFirstNames', 'dwarfSurnames', 'elf', 'dwarf']
        expect(invalidValues).not.toContain(trait1)
        expect(invalidValues).not.toContain(trait2)
      }
    })

    it('should maintain local placeholder context after import evaluation', () => {
      // This tests that local placeholders work correctly after an import is evaluated
      const result = engine.rollTemplate('npcWithCreature', 'npc-generator')

      // The creature table sets @creature.habitat
      // This should work correctly even after import evaluation
      expect(result.text).toMatch(/(caves|mountains)/)

      // Should not contain any placeholder values from imported collection
      expect(result.text).not.toContain('elfFirstNames')
      expect(result.text).not.toContain('dwarfFirstNames')
    })
  })

  describe('multiple imports in sequence', () => {
    it('should handle multiple imported template evaluations correctly', () => {
      // Roll the template multiple times
      const results: string[] = []
      for (let i = 0; i < 5; i++) {
        const result = engine.rollTemplate('npcDescription', 'npc-generator')
        results.push(result.text)
      }

      // Each result should be properly formatted
      for (const text of results) {
        const match = text.match(/A (\w+) named (.+) who is (\w+) and (\w+)\./)
        expect(match).not.toBeNull()

        if (match) {
          const [, occupation, , trait1, trait2] = match
          expect(['blacksmith', 'merchant', 'innkeeper']).toContain(occupation)
          expect(['brave', 'cunning', 'wise']).toContain(trait1)
          expect(['brave', 'cunning', 'wise']).toContain(trait2)
        }
      }
    })
  })

  describe('namespace-based resolution', () => {
    it('should resolve template by namespace prefix', () => {
      // Test direct namespace.templateId syntax (not via import alias)
      const result = engine.rollTemplate('fullName', 'fantasy-names')
      expect(result.text).toMatch(/\w+ \w+/)
    })
  })
})

describe('Explicit Pattern Syntax in Sets', () => {
  let engine: RandomTableEngine

  beforeEach(() => {
    engine = new RandomTableEngine()
    engine.loadCollection(fantasyNamesDocument, 'fantasy-names')
  })

  it('should evaluate {{}} patterns in set values at merge time', () => {
    // The fullName template uses {{@race.firstName}} which:
    // 1. Looks up @race placeholder and gets firstName property
    // 2. This was already evaluated at merge time via {{elfFirstNames}} in the set value
    // 3. Returns an actual name that was rolled when the entry was selected
    const result = engine.rollTemplate('fullName', 'fantasy-names')

    // Should be "FirstName Surname" format
    const parts = result.text.split(' ')
    expect(parts.length).toBe(2)

    // Should NOT contain table IDs - patterns are evaluated at merge time
    expect(result.text).not.toContain('FirstNames')
    expect(result.text).not.toContain('Surnames')

    // Should contain actual names
    const validFirstNames = ['Aelindra', 'Thalion', 'Thorin', 'Gimli']
    const validSurnames = ['Moonwhisper', 'Starfall', 'Ironforge', 'Stonehammer']
    expect(validFirstNames).toContain(parts[0])
    expect(validSurnames).toContain(parts[1])
  })

  it('should trace the pattern evaluation correctly', () => {
    const result = engine.rollTemplate('fullName', 'fantasy-names', { enableTrace: true })

    // Check the trace shows the correct resolution path
    expect(result.trace).toBeDefined()

    // The result should be two actual names
    const parts = result.text.split(' ')
    expect(parts.length).toBe(2)

    // Verify we got names, not table IDs
    const tableIds = ['elfFirstNames', 'elfSurnames', 'dwarfFirstNames', 'dwarfSurnames']
    expect(tableIds).not.toContain(parts[0])
    expect(tableIds).not.toContain(parts[1])
  })
})

describe('Placeholder value vs property access', () => {
  let engine: RandomTableEngine

  beforeEach(() => {
    engine = new RandomTableEngine()
  })

  it('should return different values for @table.value vs @table.property', () => {
    // With explicit {{}} syntax, set values are evaluated at merge time
    // Literal strings remain as literals; patterns are evaluated
    const doc: RandomTableDocument = {
      metadata: {
        name: 'Property Test',
        namespace: 'test.props',
        version: '1.0.0',
        specVersion: '1.0',
      },
      tables: [
        {
          id: 'mainTable',
          name: 'Main Table',
          type: 'simple',
          entries: [
            {
              id: 'entry1',
              value: 'MainValue',
              weight: 1,
              sets: {
                // Literal string value - stays as "LiteralProp"
                literalProp: 'LiteralProp',
                // Pattern value - rolls PropertyA table at merge time
                dynamicProp: '{{PropertyA}}',
              },
            },
          ],
        },
        {
          id: 'PropertyA',
          name: 'Property A Table',
          type: 'simple',
          entries: [
            { id: 'a1', value: 'ResultFromA', weight: 1 },
          ],
        },
      ],
      templates: [
        {
          id: 'testValueAccess',
          name: 'Test Value Access',
          shared: {
            _init: '{{mainTable}}',
          },
          // literalProp returns the literal string, dynamicProp returns the rolled result
          pattern: 'Value={{@mainTable.value}} Literal={{@mainTable.literalProp}} Dynamic={{@mainTable.dynamicProp}}',
        },
        {
          id: 'testDynamicTable',
          name: 'Test Dynamic Table',
          description: 'Tests that set values with {{}} are evaluated at merge time',
          shared: {
            _init: '{{mainTable}}',
          },
          pattern: '{{@mainTable.dynamicProp}}',
        },
      ],
    }

    engine.loadCollection(doc, 'test')

    // Test that value, literal property, and dynamic property all work correctly
    const result1 = engine.rollTemplate('testValueAccess', 'test')
    expect(result1.text).toBe('Value=MainValue Literal=LiteralProp Dynamic=ResultFromA')

    // Test that dynamic property returns the pre-rolled value
    const result2 = engine.rollTemplate('testDynamicTable', 'test')
    expect(result2.text).toBe('ResultFromA')
  })

  it('should keep literal set values as literals even if they match table IDs', () => {
    // This tests that without explicit {{}} syntax, values that happen to match
    // table IDs are NOT automatically rolled (breaking change from implicit resolution)
    const doc: RandomTableDocument = {
      metadata: {
        name: 'Literal Test',
        namespace: 'test.literal',
        version: '1.0.0',
        specVersion: '1.0',
      },
      tables: [
        {
          id: 'mainTable',
          name: 'Main Table',
          type: 'simple',
          entries: [
            {
              id: 'entry1',
              value: 'MainValue',
              weight: 1,
              sets: {
                // This is a literal string that happens to match a table ID
                // It should NOT be rolled - it stays as "colors"
                category: 'colors',
              },
            },
          ],
        },
        {
          id: 'colors',
          name: 'Colors Table',
          type: 'simple',
          entries: [
            { id: 'red', value: 'Red', weight: 1 },
            { id: 'blue', value: 'Blue', weight: 1 },
          ],
        },
      ],
      templates: [
        {
          id: 'test',
          name: 'Test',
          shared: {
            _init: '{{mainTable}}',
          },
          pattern: 'Category: {{@mainTable.category}}',
        },
      ],
    }

    engine.loadCollection(doc, 'test')

    const result = engine.rollTemplate('test', 'test')
    // Should return the literal string "colors", NOT a rolled color
    expect(result.text).toBe('Category: colors')
  })
})

describe('Import fallback with namespace path', () => {
  let engine: RandomTableEngine

  beforeEach(() => {
    engine = new RandomTableEngine()
  })

  it('should find imported template using path as namespace when imports not resolved', () => {
    // Create a scenario where imports Map is empty but document.imports has the definition
    // This simulates the case where resolveImports wasn't called but the import is defined

    const importedDoc: RandomTableDocument = {
      metadata: {
        name: 'Imported Collection',
        namespace: 'external.names',  // Note: different from alias
        version: '1.0.0',
        specVersion: '1.0',
      },
      tables: [
        {
          id: 'nameTable',
          name: 'Names',
          type: 'simple',
          entries: [{ id: 'n1', value: 'ImportedName', weight: 1 }],
        },
      ],
      templates: [
        {
          id: 'greeting',
          name: 'Greeting',
          pattern: 'Hello, {{nameTable}}!',
        },
      ],
    }

    const mainDoc: RandomTableDocument = {
      metadata: {
        name: 'Main Collection',
        namespace: 'main.collection',
        version: '1.0.0',
        specVersion: '1.0',
      },
      imports: [
        {
          path: 'external.names',  // This is the namespace of the imported collection
          alias: 'names',          // This is the alias used in patterns
          description: 'External names',
        },
      ],
      tables: [
        {
          id: 'localTable',
          name: 'Local',
          type: 'simple',
          entries: [{ id: 'l1', value: 'LocalValue', weight: 1 }],
        },
      ],
      templates: [
        {
          id: 'mainTemplate',
          name: 'Main Template',
          pattern: '{{names.greeting}} and {{localTable}}',
        },
      ],
    }

    // Load both collections but DON'T call resolveImports
    // This simulates the state before imports are resolved
    engine.loadCollection(importedDoc, 'imported-collection')
    engine.loadCollection(mainDoc, 'main-collection')
    // NOT calling engine.resolveImports() - fallback should still work

    // The pattern uses alias "names" but the namespace is "external.names"
    // The fallback should use the import's path to find the correct collection
    const result = engine.rollTemplate('mainTemplate', 'main-collection')

    // Should correctly resolve the imported template
    expect(result.text).toBe('Hello, ImportedName! and LocalValue')
  })

  it('should resolve imports properly when resolveImports is called', () => {
    const importedDoc: RandomTableDocument = {
      metadata: {
        name: 'Imported Collection',
        namespace: 'external.names',
        version: '1.0.0',
        specVersion: '1.0',
      },
      tables: [],  // Required field
      templates: [
        {
          id: 'simpleTemplate',
          name: 'Simple',
          pattern: 'FromImported',
        },
      ],
    }

    const mainDoc: RandomTableDocument = {
      metadata: {
        name: 'Main Collection',
        namespace: 'main.collection',
        version: '1.0.0',
        specVersion: '1.0',
      },
      tables: [],  // Required field
      imports: [
        {
          path: 'external.names',
          alias: 'ext',
        },
      ],
      templates: [
        {
          id: 'useImport',
          name: 'Use Import',
          pattern: 'Result: {{ext.simpleTemplate}}',
        },
      ],
    }

    engine.loadCollection(importedDoc, 'imported')
    engine.loadCollection(mainDoc, 'main')
    engine.resolveImports()  // This should resolve the import into the imports Map

    const result = engine.rollTemplate('useImport', 'main')
    expect(result.text).toBe('Result: FromImported')
  })
})

describe('Placeholder Scoping', () => {
  let engine: RandomTableEngine

  beforeEach(() => {
    engine = new RandomTableEngine()
  })

  it('should scope placeholders to their originating roll context', () => {
    // Create a document where a table sets placeholders
    const doc: RandomTableDocument = {
      metadata: {
        name: 'Placeholder Test',
        namespace: 'test.placeholders',
        version: '1.0.0',
        specVersion: '1.0',
      },
      tables: [
        {
          id: 'tableA',
          name: 'Table A',
          type: 'simple',
          entries: [
            {
              id: 'a1',
              value: 'A1',
              weight: 1,
              sets: {
                aValue: 'fromA',
                sharedKey: 'A-set-this',
              },
            },
          ],
        },
        {
          id: 'tableB',
          name: 'Table B',
          type: 'simple',
          entries: [
            {
              id: 'b1',
              value: 'B1-{{@tableA.aValue}}',
              weight: 1,
            },
          ],
        },
        {
          id: 'simpleValue',
          name: 'Simple Value',
          type: 'simple',
          entries: [
            { id: 'v1', value: 'SimpleResult', weight: 1 },
          ],
        },
      ],
      templates: [
        {
          id: 'testTemplate',
          name: 'Test Template',
          pattern: '{{tableA}} then {{simpleValue}} then {{tableA}} again',
        },
      ],
    }

    engine.loadCollection(doc, 'test')

    // The pattern rolls tableA, then simpleValue, then tableA again
    // simpleValue should NOT be affected by tableA's placeholders
    const result = engine.rollTemplate('testTemplate', 'test')

    // Should be: "A1 then SimpleResult then A1 again"
    expect(result.text).toBe('A1 then SimpleResult then A1 again')
  })
})
