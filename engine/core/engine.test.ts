import { describe, it, expect, beforeEach } from 'vitest'
import { RandomTableEngine } from './index'
import type { RandomTableDocument } from '../types'

// Sample test document
const sampleDocument: RandomTableDocument = {
  metadata: {
    name: 'Test Tables',
    namespace: 'test.tables',
    version: '1.0.0',
    specVersion: '1.0',
  },
  tables: [
    {
      id: 'colors',
      name: 'Colors',
      type: 'simple',
      entries: [
        { id: 'red', value: 'Red', weight: 1 },
        { id: 'blue', value: 'Blue', weight: 1 },
        { id: 'green', value: 'Green', weight: 1 },
      ],
    },
    {
      id: 'sizes',
      name: 'Sizes',
      type: 'simple',
      entries: [
        { id: 'small', value: 'small', weight: 1 },
        { id: 'medium', value: 'medium', weight: 2 },
        { id: 'large', value: 'large', weight: 1 },
      ],
    },
    {
      id: 'weighted',
      name: 'Weighted Table',
      type: 'simple',
      entries: [
        { value: 'Common', weight: 10 },
        { value: 'Uncommon', weight: 5 },
        { value: 'Rare', weight: 1 },
      ],
    },
    {
      id: 'withDice',
      name: 'With Dice',
      type: 'simple',
      entries: [
        { value: 'You find {{dice:2d6}} gold pieces' },
      ],
    },
    {
      id: 'withTableRef',
      name: 'With Table Reference',
      type: 'simple',
      entries: [
        { value: 'A {{sizes}} {{colors}} gem' },
      ],
    },
    {
      id: 'allItems',
      name: 'All Items',
      type: 'collection',
      collections: ['colors', 'sizes'],
    },
    {
      id: 'compositeTest',
      name: 'Composite Test',
      type: 'composite',
      sources: [
        { tableId: 'colors', weight: 1 },
        { tableId: 'sizes', weight: 1 },
      ],
    },
  ],
  templates: [
    {
      id: 'description',
      name: 'Item Description',
      pattern: 'A {{sizes}} {{colors}} item',
    },
  ],
  variables: {
    setting: 'fantasy',
  },
}

describe('RandomTableEngine', () => {
  let engine: RandomTableEngine

  beforeEach(() => {
    engine = new RandomTableEngine()
    engine.loadCollection(sampleDocument, 'test')
  })

  describe('loading', () => {
    it('should load a collection', () => {
      expect(engine.hasCollection('test')).toBe(true)
    })

    it('should list collections', () => {
      const collections = engine.listCollections()
      expect(collections).toHaveLength(1)
      expect(collections[0].id).toBe('test')
      expect(collections[0].name).toBe('Test Tables')
    })

    it('should unload a collection', () => {
      engine.unloadCollection('test')
      expect(engine.hasCollection('test')).toBe(false)
    })

    it('should load from JSON string', () => {
      const json = JSON.stringify(sampleDocument)
      const result = engine.loadFromJson(json, 'test2')
      expect(result.valid).toBe(true)
      expect(engine.hasCollection('test2')).toBe(true)
    })
  })

  describe('table access', () => {
    it('should get a table by ID', () => {
      const table = engine.getTable('colors', 'test')
      expect(table).toBeDefined()
      expect(table?.name).toBe('Colors')
    })

    it('should return undefined for non-existent table', () => {
      const table = engine.getTable('nonexistent', 'test')
      expect(table).toBeUndefined()
    })

    it('should list tables', () => {
      const tables = engine.listTables('test')
      expect(tables.length).toBeGreaterThan(0)
      expect(tables.find((t) => t.id === 'colors')).toBeDefined()
    })

    it('should get a template', () => {
      const template = engine.getTemplate('description', 'test')
      expect(template).toBeDefined()
      expect(template?.name).toBe('Item Description')
    })

    it('should list templates', () => {
      const templates = engine.listTemplates('test')
      expect(templates).toHaveLength(1)
      expect(templates[0].id).toBe('description')
    })
  })

  describe('rolling', () => {
    it('should roll on a simple table', () => {
      const result = engine.roll('colors', 'test')
      expect(result.text).toMatch(/Red|Blue|Green/)
      expect(result.metadata.sourceId).toBe('colors')
      expect(result.metadata.collectionId).toBe('test')
    })

    it('should return consistent structure', () => {
      const result = engine.roll('colors', 'test')
      expect(result).toHaveProperty('text')
      expect(result).toHaveProperty('metadata')
      expect(result.metadata).toHaveProperty('timestamp')
    })

    it('should handle dice in entry values', () => {
      const result = engine.roll('withDice', 'test')
      expect(result.text).toMatch(/You find \d+ gold pieces/)
    })

    it('should handle table references in entry values', () => {
      const result = engine.roll('withTableRef', 'test')
      // Should have size and color
      expect(result.text).toMatch(/(small|medium|large) (Red|Blue|Green) gem/)
    })

    it('should roll on a composite table', () => {
      const result = engine.roll('compositeTest', 'test')
      // Should be either a color or a size
      expect(result.text).toMatch(/Red|Blue|Green|small|medium|large/)
    })

    it('should roll on a collection table', () => {
      const result = engine.roll('allItems', 'test')
      // Should be either a color or a size
      expect(result.text).toMatch(/Red|Blue|Green|small|medium|large/)
    })

    it('should roll on a template', () => {
      const result = engine.rollTemplate('description', 'test')
      expect(result.text).toMatch(/A (small|medium|large) (Red|Blue|Green) item/)
    })

    it('should throw for non-existent collection', () => {
      expect(() => engine.roll('colors', 'nonexistent')).toThrow()
    })

    it('should throw for non-existent table', () => {
      expect(() => engine.roll('nonexistent', 'test')).toThrow()
    })
  })

  describe('weighted selection', () => {
    it('should respect weights over many rolls', () => {
      const counts: Record<string, number> = { Common: 0, Uncommon: 0, Rare: 0 }
      const iterations = 1000

      for (let i = 0; i < iterations; i++) {
        const result = engine.roll('weighted', 'test')
        counts[result.text]++
      }

      // Common should appear most often (~62.5%)
      expect(counts['Common']).toBeGreaterThan(counts['Uncommon'])
      expect(counts['Uncommon']).toBeGreaterThan(counts['Rare'])
    })
  })

  describe('validation', () => {
    it('should validate a valid document', () => {
      const result = engine.validate(sampleDocument)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should catch missing metadata', () => {
      const invalid = {
        metadata: {
          name: '',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0' as const,
        },
        tables: [],
      }
      const result = engine.validate(invalid)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'MISSING_NAME')).toBe(true)
    })

    it('should catch invalid spec version', () => {
      const invalid = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Testing invalid input
          specVersion: '2.0' as any,
        },
        tables: [],
      }
      const result = engine.validate(invalid)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'INVALID_SPEC_VERSION')).toBe(true)
    })
  })
})

describe('RandomTableEngine edge cases', () => {
  it('should handle empty entry value', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: {
        name: 'Test',
        namespace: 'test',
        version: '1.0.0',
        specVersion: '1.0',
      },
      tables: [
        {
          id: 'empty',
          name: 'Empty',
          type: 'simple',
          entries: [{ value: '' }],
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.roll('empty', 'test')
    expect(result.text).toBe('')
  })

  it('should handle deeply nested table references', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: {
        name: 'Test',
        namespace: 'test',
        version: '1.0.0',
        specVersion: '1.0',
      },
      tables: [
        {
          id: 'level1',
          name: 'Level 1',
          type: 'simple',
          entries: [{ value: '{{level2}}' }],
        },
        {
          id: 'level2',
          name: 'Level 2',
          type: 'simple',
          entries: [{ value: '{{level3}}' }],
        },
        {
          id: 'level3',
          name: 'Level 3',
          type: 'simple',
          entries: [{ value: 'Deep!' }],
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.roll('level1', 'test')
    expect(result.text).toBe('Deep!')
  })

  it('should respect recursion limit', () => {
    const engine = new RandomTableEngine({ config: { maxRecursionDepth: 3 } })
    const doc: RandomTableDocument = {
      metadata: {
        name: 'Test',
        namespace: 'test',
        version: '1.0.0',
        specVersion: '1.0',
      },
      tables: [
        {
          id: 'recursive',
          name: 'Recursive',
          type: 'simple',
          entries: [{ value: '{{recursive}} again' }],
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    expect(() => engine.roll('recursive', 'test')).toThrow(/recursion/i)
  })
})

// ============================================================================
// Capture System Tests
// ============================================================================

describe('Roll Capture System', () => {
  describe('capture multi-roll', () => {
    it('should capture roll results into a variable', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'items',
            name: 'Items',
            type: 'simple',
            entries: [
              { id: 'sword', value: 'Sword' },
              { id: 'shield', value: 'Shield' },
              { id: 'bow', value: 'Bow' },
            ],
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern:
              '{{3*unique*items >> $loot|silent}}You found: {{$loot|"; "}}. Count: {{$loot.count}}.',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      // Should have 3 unique items
      expect(result.text).toMatch(/You found: .+\. Count: 3\./)
      expect(result.text).toContain('; ') // Custom separator
    })

    it('should support indexed access', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'items',
            name: 'Items',
            type: 'simple',
            entries: [{ value: 'Sword' }],
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern: '{{1*items >> $stuff|silent}}First: {{$stuff[0]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('First: Sword')
    })

    it('should support negative indexing', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'nums',
            name: 'Numbers',
            type: 'simple',
            entries: [
              { id: 'a', value: 'A' },
              { id: 'b', value: 'B' },
              { id: 'c', value: 'C' },
            ],
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern: '{{3*unique*nums >> $list|silent}}Last: {{$list[-1]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toMatch(/Last: [ABC]/)
    })

    it('should handle out of bounds gracefully', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'items',
            name: 'Items',
            type: 'simple',
            entries: [{ value: 'Sword' }],
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern: '{{1*items >> $stuff|silent}}Missing: [{{$stuff[5]}}]',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('Missing: []')
    })

    it('should access sets properties', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'enemies',
            name: 'Enemies',
            type: 'simple',
            entries: [
              { value: 'Goblin', sets: { cr: '1/4', type: 'humanoid' } },
            ],
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern:
              '{{1*enemies >> $foe|silent}}Enemy: {{$foe[0]}}, CR: {{$foe[0].@cr}}, Type: {{$foe[0].@type}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('Enemy: Goblin, CR: 1/4, Type: humanoid')
    })

    it('should output captured values when not silent', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'items',
            name: 'Items',
            type: 'simple',
            entries: [{ value: 'Sword' }],
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern: 'Found: {{1*items >> $loot}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('Found: Sword')
    })

    it('should use $capture.count as multi-roll count', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'races',
            name: 'Races',
            type: 'simple',
            entries: [
              { id: 'human', value: 'Human' },
              { id: 'elf', value: 'Elf' },
              { id: 'dwarf', value: 'Dwarf' },
            ],
          },
          {
            id: 'classes',
            name: 'Classes',
            type: 'simple',
            entries: [
              { id: 'warrior', value: 'Warrior' },
              { id: 'mage', value: 'Mage' },
              { id: 'rogue', value: 'Rogue' },
            ],
          },
        ],
        templates: [
          {
            id: 'party',
            name: 'Party',
            // First capture 2 races, then use that count to roll 2 classes
            pattern:
              '{{2*unique*races >> $members|silent}}Races: {{$members}}. Classes: {{$members.count*unique*classes}}.',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('party', 'test')
      // Should have 2 races and 2 classes
      const raceMatches = result.text.match(/Races: ([^.]+)\./)?.[1].split(', ') || []
      const classMatches = result.text.match(/Classes: ([^.]+)\./)?.[1].split(', ') || []
      expect(raceMatches.length).toBe(2)
      expect(classMatches.length).toBe(2)
    })
  })

  describe('collect aggregation', () => {
    it('should collect all values', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'enemies',
            name: 'Enemies',
            type: 'simple',
            entries: [
              { id: 'a', value: 'Goblin', sets: { type: 'humanoid' } },
              { id: 'b', value: 'Orc', sets: { type: 'humanoid' } },
              { id: 'c', value: 'Dragon', sets: { type: 'dragon' } },
            ],
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern:
              '{{3*unique*enemies >> $foes|silent}}Values: {{collect:$foes.value}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toMatch(/Values: .+/)
      // Should contain all three enemies
      expect(result.text).toContain('Goblin')
      expect(result.text).toContain('Orc')
      expect(result.text).toContain('Dragon')
    })

    it('should collect properties from all items', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'enemies',
            name: 'Enemies',
            type: 'simple',
            entries: [
              { id: 'a', value: 'Goblin', sets: { type: 'humanoid' } },
              { id: 'b', value: 'Orc', sets: { type: 'humanoid' } },
              { id: 'c', value: 'Dragon', sets: { type: 'dragon' } },
            ],
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern:
              '{{3*unique*enemies >> $foes|silent}}Types: {{collect:$foes.@type}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toMatch(/Types: .+/)
    })

    it('should deduplicate with unique modifier', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'enemies',
            name: 'Enemies',
            type: 'simple',
            entries: [
              { id: 'a', value: 'Goblin', sets: { type: 'humanoid' } },
              { id: 'b', value: 'Orc', sets: { type: 'humanoid' } },
            ],
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern:
              '{{2*unique*enemies >> $foes|silent}}Types: {{collect:$foes.@type|unique}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      // Both have type 'humanoid', so unique should give just one
      expect(result.text).toBe('Types: humanoid')
    })

    it('should use custom separator', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'items',
            name: 'Items',
            type: 'simple',
            entries: [
              { id: 'a', value: 'Sword' },
              { id: 'b', value: 'Shield' },
            ],
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern:
              '{{2*unique*items >> $stuff|silent}}Items: {{collect:$stuff.value|" and "}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toContain(' and ')
    })
  })

  describe('edge cases', () => {
    it('should handle empty capture (0 items)', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'items',
            name: 'Items',
            type: 'simple',
            entries: [{ value: 'Sword' }],
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern:
              '{{0*items >> $stuff|silent}}Count: {{$stuff.count}}, Values: [{{$stuff|"; "}}]',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('Count: 0, Values: []')
    })

    it('should handle missing property gracefully', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'items',
            name: 'Items',
            type: 'simple',
            entries: [{ value: 'Sword' }], // No sets
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern:
              '{{1*items >> $stuff|silent}}Type: [{{$stuff[0].@type}}]',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('Type: []')
    })

    it('should filter empty values in collect', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: {
          name: 'Test',
          namespace: 'test',
          version: '1.0.0',
          specVersion: '1.0',
        },
        tables: [
          {
            id: 'items',
            name: 'Items',
            type: 'simple',
            entries: [
              { id: 'a', value: 'Sword', sets: { bonus: '+1' } },
              { id: 'b', value: 'Shield' }, // No bonus
              { id: 'c', value: 'Bow', sets: { bonus: '+2' } },
            ],
          },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            pattern:
              '{{3*unique*items >> $stuff|silent}}Bonuses: {{collect:$stuff.@bonus}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      // Should not have empty string between values
      expect(result.text).not.toContain(', ,')
    })
  })
})

describe('Shared Variables with Property Access', () => {
  let engine: RandomTableEngine

  // Helper to create minimal test document with required metadata
  const createTestDoc = (
    tables: RandomTableDocument['tables'],
    templates: RandomTableDocument['templates']
  ): RandomTableDocument => ({
    metadata: {
      name: 'Test',
      namespace: 'test.capture',
      version: '1.0.0',
      specVersion: '1.0',
    },
    tables,
    templates,
  })

  beforeEach(() => {
    engine = new RandomTableEngine()
  })

  describe('basic shared variable property access', () => {
    it('should capture table roll with sets', () => {
      // With explicit {{}} syntax, patterns in sets are evaluated at merge time
      const doc = createTestDoc(
        [
          {
            id: 'race',
            name: 'Race',
            type: 'simple',
            entries: [
              // Use explicit {{}} syntax to roll name table at merge time
              { id: 'elf', value: 'Elf', sets: { name: '{{elfNames}}', size: 'Medium' } },
              { id: 'dwarf', value: 'Dwarf', sets: { name: '{{dwarfNames}}', size: 'Medium' } },
            ],
          },
          {
            id: 'elfNames',
            name: 'Elf Names',
            type: 'simple',
            entries: [{ value: 'Legolas' }, { value: 'Arwen' }, { value: 'Thranduil' }],
          },
          {
            id: 'dwarfNames',
            name: 'Dwarf Names',
            type: 'simple',
            entries: [{ value: 'Gimli' }, { value: 'Thorin' }, { value: 'Balin' }],
          },
        ],
        [
          {
            id: 'character',
            name: 'Character',
            shared: {
              '$hero': '{{race}}',
            },
            // Access pre-evaluated name from sets
            pattern: '{{$hero.@name}} the {{$hero}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('character', 'test')

      // The result should be a name from the appropriate name table followed by the race
      // e.g., "Legolas the Elf" or "Gimli the Dwarf"
      expect(result.text).toMatch(/^(Legolas|Arwen|Thranduil|Gimli|Thorin|Balin) the (Elf|Dwarf)$/)
    })

    it('should support multiple independent shared variables', () => {
      // With explicit {{}} syntax, patterns in sets are evaluated at merge time
      const doc = createTestDoc(
        [
          {
            id: 'race',
            name: 'Race',
            type: 'simple',
            entries: [
              // Use explicit {{}} syntax to roll name table at merge time
              { id: 'elf', value: 'Elf', sets: { name: '{{elfNames}}' } },
              { id: 'dwarf', value: 'Dwarf', sets: { name: '{{dwarfNames}}' } },
            ],
          },
          {
            id: 'elfNames',
            name: 'Elf Names',
            type: 'simple',
            entries: [{ value: 'Legolas' }],
          },
          {
            id: 'dwarfNames',
            name: 'Dwarf Names',
            type: 'simple',
            entries: [{ value: 'Gimli' }],
          },
        ],
        [
          {
            id: 'rivals',
            name: 'Rivals',
            shared: {
              '$hero': '{{race}}',
              '$enemy': '{{race}}',
            },
            // Access pre-evaluated name from sets
            pattern: '{{$hero.@name}} the {{$hero}} vs {{$enemy.@name}} the {{$enemy}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('rivals', 'test')

      // Both characters should have names appropriate to their race
      // The result could be "Legolas the Elf vs Gimli the Dwarf" or any combination
      expect(result.text).toMatch(/^(Legolas|Gimli) the (Elf|Dwarf) vs (Legolas|Gimli) the (Elf|Dwarf)$/)
    })

    it('should access captured value without property', () => {
      const doc = createTestDoc(
        [
          {
            id: 'color',
            name: 'Color',
            type: 'simple',
            entries: [{ value: 'Red', sets: { hex: '#FF0000' } }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$chosen': '{{color}}',
            },
            pattern: 'Color: {{$chosen}}, Hex: {{$chosen.@hex}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('Color: Red, Hex: #FF0000')
    })

    it('should return empty string for missing property', () => {
      const doc = createTestDoc(
        [
          {
            id: 'item',
            name: 'Item',
            type: 'simple',
            entries: [{ value: 'Sword', sets: { type: 'weapon' } }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$item': '{{item}}',
            },
            pattern: 'Item: {{$item}}, Missing: [{{$item.@nonexistent}}]',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('Item: Sword, Missing: []')
    })
  })

  describe('dynamic table resolution', () => {
    it('should evaluate pattern in set value at merge time', () => {
      // With explicit {{}} syntax, table rolls happen at merge time
      const doc = createTestDoc(
        [
          {
            id: 'characterType',
            name: 'Character Type',
            type: 'simple',
            entries: [
              // Use explicit {{}} syntax to roll weapon table at merge time
              { value: 'Warrior', sets: { weapon: '{{warriorWeapons}}' } },
              { value: 'Mage', sets: { weapon: '{{mageWeapons}}' } },
            ],
          },
          {
            id: 'warriorWeapons',
            name: 'Warrior Weapons',
            type: 'simple',
            entries: [{ value: 'Sword' }, { value: 'Axe' }],
          },
          {
            id: 'mageWeapons',
            name: 'Mage Weapons',
            type: 'simple',
            entries: [{ value: 'Staff' }, { value: 'Wand' }],
          },
        ],
        [
          {
            id: 'character',
            name: 'Character',
            shared: {
              '$char': '{{characterType}}',
            },
            // Access pre-evaluated weapon from sets
            pattern: '{{$char}} with {{$char.@weapon}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('character', 'test')

      // Warriors should get warrior weapons, mages should get mage weapons
      const isWarriorCombo = /^Warrior with (Sword|Axe)$/.test(result.text)
      const isMageCombo = /^Mage with (Staff|Wand)$/.test(result.text)
      expect(isWarriorCombo || isMageCombo).toBe(true)
    })

    it('should return value as-is when property is not a table ID', () => {
      const doc = createTestDoc(
        [
          {
            id: 'item',
            name: 'Item',
            type: 'simple',
            entries: [{ value: 'Potion', sets: { effect: 'Healing', power: '50' } }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$potion': '{{item}}',
            },
            pattern: '{{$potion}} of {{$potion.@effect}} (power: {{$potion.@power}})',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('Potion of Healing (power: 50)')
    })
  })

  describe('pattern evaluation in captured sets', () => {
    it('should evaluate patterns in set values for captured items', () => {
      // With explicit {{}} syntax, patterns are evaluated at merge time
      const doc = createTestDoc(
        [
          {
            id: 'enemy',
            name: 'Enemy',
            type: 'simple',
            entries: [
              // Use explicit {{}} syntax to roll loot table at merge time
              { value: 'Orc', sets: { loot: '{{orcLoot}}' } },
              { value: 'Goblin', sets: { loot: '{{goblinLoot}}' } },
            ],
          },
          {
            id: 'orcLoot',
            name: 'Orc Loot',
            type: 'simple',
            entries: [{ value: 'Orcish Blade' }],
          },
          {
            id: 'goblinLoot',
            name: 'Goblin Loot',
            type: 'simple',
            entries: [{ value: 'Rusty Dagger' }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            // Access pre-evaluated loot from sets
            pattern: '{{1*enemy >> $foe|silent}}Defeated {{$foe[0]}}, found {{$foe[0].@loot}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      const isOrcCombo = result.text === 'Defeated Orc, found Orcish Blade'
      const isGoblinCombo = result.text === 'Defeated Goblin, found Rusty Dagger'
      expect(isOrcCombo || isGoblinCombo).toBe(true)
    })

    it('should evaluate patterns in set values for collect', () => {
      // With explicit {{}} syntax, patterns are evaluated at merge time
      const doc = createTestDoc(
        [
          {
            id: 'character',
            name: 'Character',
            type: 'simple',
            entries: [
              // Use explicit {{}} syntax to roll greeting table at merge time
              { value: 'Fighter', sets: { greeting: '{{fighterGreeting}}' } },
              { value: 'Wizard', sets: { greeting: '{{wizardGreeting}}' } },
            ],
          },
          {
            id: 'fighterGreeting',
            name: 'Fighter Greeting',
            type: 'simple',
            entries: [{ value: 'Hail!' }],
          },
          {
            id: 'wizardGreeting',
            name: 'Wizard Greeting',
            type: 'simple',
            entries: [{ value: 'Greetings!' }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            // Access pre-evaluated greeting from sets via collect
            pattern: '{{2*unique*character >> $party|silent}}Greetings: {{collect:$party.@greeting}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      // Both Fighter and Wizard should have their greetings evaluated (order varies)
      expect(result.text).toMatch(/^Greetings: (Hail!, Greetings!|Greetings!, Hail!)$/)
    })
  })

  describe('fallback for complex expressions', () => {
    it('should handle complex expressions with empty sets', () => {
      const doc = createTestDoc(
        [
          {
            id: 'item',
            name: 'Item',
            type: 'simple',
            entries: [{ value: 'Gold' }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$result': '{{dice:1d6}} {{item}}',
            },
            pattern: 'Found: {{$result}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      // Complex expression (dice + table) should evaluate but sets will be empty
      expect(result.text).toMatch(/^Found: [1-6] Gold$/)
    })
  })

  describe('math expressions with capture access', () => {
    it('should support capture access syntax in math expressions', () => {
      // Test case matching the user's scenario:
      // $dexRoll => {{dice:4d6k3}}
      // $dexterity => {{math:$dexRoll + $race.@dexBonus}}
      const doc = createTestDoc(
        [
          {
            id: 'race',
            name: 'Race',
            type: 'simple',
            entries: [
              { value: 'Elf', sets: { dexBonus: '2' } },
              { value: 'Dwarf', sets: { dexBonus: '0' } },
              { value: 'Human', sets: { dexBonus: '1' } },
            ],
          },
        ],
        [
          {
            id: 'character',
            name: 'Character',
            shared: {
              '$race': '{{race}}',
              'dexRoll': '10', // Fixed value for testing
              'dexterity': '{{math:$dexRoll + $race.@dexBonus}}',
            },
            pattern: '{{$race}} with DEX {{$dexterity}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('character', 'test')

      // The result should be "Elf with DEX 12", "Dwarf with DEX 10", or "Human with DEX 11"
      expect(result.text).toMatch(/^(Elf with DEX 12|Dwarf with DEX 10|Human with DEX 11)$/)
    })

    it('should handle missing capture variable in math expression', () => {
      const doc = createTestDoc(
        [],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              'result': '{{math:$missing.@prop + 5}}',
            },
            pattern: 'Result: {{$result}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      // Missing variable should resolve to 0, so result is 5
      expect(result.text).toBe('Result: 5')
    })

    it('should handle missing property in capture access math expression', () => {
      const doc = createTestDoc(
        [
          {
            id: 'item',
            name: 'Item',
            type: 'simple',
            entries: [{ value: 'Sword', sets: { damage: '5' } }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$weapon': '{{item}}',
              'total': '{{math:$weapon.@nonexistent + 10}}',
            },
            pattern: 'Total: {{$total}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      // Missing property should resolve to 0, so result is 10
      expect(result.text).toBe('Total: 10')
    })
  })

  describe('nested property access (chained CaptureItems)', () => {
    it('should support chained shared variables', () => {
      // Test: $conflict -> @situation -> @focus chain
      // When @situation is a table reference, its result should preserve nested sets
      const doc = createTestDoc(
        [
          {
            id: 'conflictType',
            name: 'Conflict Type',
            type: 'simple',
            entries: [
              { value: 'Money', sets: { situation: '{{moneyConflict}}' } },
            ],
          },
          {
            id: 'moneyConflict',
            name: 'Money Conflict',
            type: 'simple',
            entries: [
              { value: 'Debt', sets: { focus: '{{debtFocus}}' } },
            ],
          },
          {
            id: 'debtFocus',
            name: 'Debt Focus',
            type: 'simple',
            entries: [{ value: 'Collection Agency' }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$conflict': '{{conflictType}}',
              '$situation': '{{$conflict.@situation}}',
            },
            pattern: 'Conflict: {{$conflict}}, Situation: {{$situation}}, Focus: {{$situation.@focus}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('Conflict: Money, Situation: Debt, Focus: Collection Agency')
    })

    it('should handle static strings in nested property access gracefully', () => {
      // When @situation is a plain string (not a table reference), chaining should still work
      // but the nested property access should return empty string
      const doc = createTestDoc(
        [
          {
            id: 'conflictType',
            name: 'Conflict Type',
            type: 'simple',
            entries: [
              { value: 'Money', sets: { situation: 'Static situation text' } },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$conflict': '{{conflictType}}',
              '$situation': '{{$conflict.@situation}}',
            },
            pattern: 'Situation: {{$situation}}, Focus: [{{$situation.@focus}}]',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      // @situation is a plain string, so $situation has no nested sets
      // @focus should return empty string
      expect(result.text).toBe('Situation: Static situation text, Focus: []')
    })

    it('should support three levels of nesting', () => {
      // Test: $a -> @b -> @c -> @d
      const doc = createTestDoc(
        [
          {
            id: 'levelA',
            name: 'Level A',
            type: 'simple',
            entries: [
              { value: 'A', sets: { childB: '{{levelB}}' } },
            ],
          },
          {
            id: 'levelB',
            name: 'Level B',
            type: 'simple',
            entries: [
              { value: 'B', sets: { childC: '{{levelC}}' } },
            ],
          },
          {
            id: 'levelC',
            name: 'Level C',
            type: 'simple',
            entries: [
              { value: 'C', sets: { childD: '{{levelD}}' } },
            ],
          },
          {
            id: 'levelD',
            name: 'Level D',
            type: 'simple',
            entries: [{ value: 'D-Final' }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$a': '{{levelA}}',
              '$b': '{{$a.@childB}}',
              '$c': '{{$b.@childC}}',
            },
            pattern: 'A={{$a}}, B={{$b}}, C={{$c}}, D={{$c.@childD}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('A=A, B=B, C=C, D=D-Final')
    })

    it('should work with multi-roll capture accessing nested properties', () => {
      // Test that the >> capture operator also captures nested CaptureItems
      const doc = createTestDoc(
        [
          {
            id: 'enemy',
            name: 'Enemy',
            type: 'simple',
            entries: [
              { value: 'Orc', sets: { weapon: '{{orcWeapon}}' } },
              { value: 'Goblin', sets: { weapon: '{{goblinWeapon}}' } },
            ],
          },
          {
            id: 'orcWeapon',
            name: 'Orc Weapon',
            type: 'simple',
            entries: [
              { value: 'Axe', sets: { damage: '2d6' } },
            ],
          },
          {
            id: 'goblinWeapon',
            name: 'Goblin Weapon',
            type: 'simple',
            entries: [
              { value: 'Dagger', sets: { damage: '1d4' } },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            pattern: '{{1*enemy >> $foe|silent}}Enemy: {{$foe[0]}}, Weapon: {{$foe[0].@weapon}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      // Should get either "Enemy: Orc, Weapon: Axe" or "Enemy: Goblin, Weapon: Dagger"
      const isOrcCombo = result.text === 'Enemy: Orc, Weapon: Axe'
      const isGoblinCombo = result.text === 'Enemy: Goblin, Weapon: Dagger'
      expect(isOrcCombo || isGoblinCombo).toBe(true)
    })

    it('should access deeply nested damage property via intermediate captures', () => {
      // Same as above but accessing the nested damage property
      const doc = createTestDoc(
        [
          {
            id: 'enemy',
            name: 'Enemy',
            type: 'simple',
            entries: [
              { value: 'Orc', sets: { weapon: '{{orcWeapon}}' } },
            ],
          },
          {
            id: 'orcWeapon',
            name: 'Orc Weapon',
            type: 'simple',
            entries: [
              { value: 'Axe', sets: { damage: '2d6' } },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$enemy': '{{enemy}}',
              '$weapon': '{{$enemy.@weapon}}',
            },
            pattern: '{{$enemy}} wields {{$weapon}} ({{$weapon.@damage}} damage)',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('Orc wields Axe (2d6 damage)')
    })
  })

  describe('direct chained property access syntax', () => {
    // These tests verify the {{$var.@a.@b.@c}} direct syntax without intermediate variables

    it('should support two-level chained access: {{$var.@a.@b}}', () => {
      // Direct access: $conflict.@situation.@focus
      const doc = createTestDoc(
        [
          {
            id: 'conflictType',
            name: 'Conflict Type',
            type: 'simple',
            entries: [
              { value: 'Money', sets: { situation: '{{moneyConflict}}' } },
            ],
          },
          {
            id: 'moneyConflict',
            name: 'Money Conflict',
            type: 'simple',
            entries: [
              { value: 'Debt', sets: { focus: 'Collection Agency' } },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$conflict': '{{conflictType}}',
            },
            // Direct chained access: no intermediate $situation variable needed
            pattern: 'Conflict: {{$conflict}}, Focus: {{$conflict.@situation.@focus}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('Conflict: Money, Focus: Collection Agency')
    })

    it('should support three-level chained access: {{$var.@a.@b.@c}}', () => {
      // Direct access: $a.@b.@c.@d
      const doc = createTestDoc(
        [
          {
            id: 'levelA',
            name: 'Level A',
            type: 'simple',
            entries: [
              { value: 'A', sets: { childB: '{{levelB}}' } },
            ],
          },
          {
            id: 'levelB',
            name: 'Level B',
            type: 'simple',
            entries: [
              { value: 'B', sets: { childC: '{{levelC}}' } },
            ],
          },
          {
            id: 'levelC',
            name: 'Level C',
            type: 'simple',
            entries: [
              { value: 'C', sets: { deepValue: 'DeepValueHere' } },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$a': '{{levelA}}',
            },
            // Direct three-level chained access
            pattern: 'A={{$a}}, Deep={{$a.@childB.@childC.@deepValue}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('A=A, Deep=DeepValueHere')
    })

    it('should support four-level chained access: {{$var.@a.@b.@c.@d}}', () => {
      // Deep nesting test: $a.@b.@c.@d.@e
      const doc = createTestDoc(
        [
          {
            id: 'levelA',
            name: 'Level A',
            type: 'simple',
            entries: [
              { value: 'A', sets: { b: '{{levelB}}' } },
            ],
          },
          {
            id: 'levelB',
            name: 'Level B',
            type: 'simple',
            entries: [
              { value: 'B', sets: { c: '{{levelC}}' } },
            ],
          },
          {
            id: 'levelC',
            name: 'Level C',
            type: 'simple',
            entries: [
              { value: 'C', sets: { d: '{{levelD}}' } },
            ],
          },
          {
            id: 'levelD',
            name: 'Level D',
            type: 'simple',
            entries: [
              { value: 'D', sets: { finalValue: 'FINAL' } },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$root': '{{levelA}}',
            },
            // Four levels deep
            pattern: 'Result: {{$root.@b.@c.@d.@finalValue}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('Result: FINAL')
    })

    it('should handle chain breaking at string property gracefully', () => {
      // When @situation is a plain string, attempting to chain further should return empty
      const doc = createTestDoc(
        [
          {
            id: 'conflictType',
            name: 'Conflict Type',
            type: 'simple',
            entries: [
              { value: 'Money', sets: { situation: 'Static Text' } },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$conflict': '{{conflictType}}',
            },
            // @situation is a plain string, not a CaptureItem, so @focus should fail
            pattern: 'Situation: {{$conflict.@situation}}, Focus: [{{$conflict.@situation.@focus}}]',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      // First property returns the string, second property returns empty
      expect(result.text).toBe('Situation: Static Text, Focus: []')
    })

    it('should handle missing property in chain gracefully', () => {
      // When a property doesn't exist in the chain
      const doc = createTestDoc(
        [
          {
            id: 'item',
            name: 'Item',
            type: 'simple',
            entries: [
              { value: 'Sword', sets: { damage: '1d8' } },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$item': '{{item}}',
            },
            // @nonexistent doesn't exist
            pattern: 'Item: {{$item}}, Missing: [{{$item.@nonexistent.@deep}}]',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('Item: Sword, Missing: []')
    })

    it('should work with indexed capture access: {{$var[0].@a.@b}}', () => {
      // Chained access on indexed item from multi-roll capture
      const doc = createTestDoc(
        [
          {
            id: 'enemy',
            name: 'Enemy',
            type: 'simple',
            entries: [
              { value: 'Orc', sets: { weapon: '{{orcWeapon}}' } },
            ],
          },
          {
            id: 'orcWeapon',
            name: 'Orc Weapon',
            type: 'simple',
            entries: [
              { value: 'Axe', sets: { damage: '2d6', material: 'Iron' } },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            // Capture with >> and then access nested properties on indexed item
            pattern: '{{1*enemy >> $foes|silent}}Enemy: {{$foes[0]}}, Material: {{$foes[0].@weapon.@material}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('Enemy: Orc, Material: Iron')
    })

    it('should still support intermediate variable pattern (backward compatibility)', () => {
      // Ensure the old pattern still works
      const doc = createTestDoc(
        [
          {
            id: 'conflictType',
            name: 'Conflict Type',
            type: 'simple',
            entries: [
              { value: 'Money', sets: { situation: '{{moneyConflict}}' } },
            ],
          },
          {
            id: 'moneyConflict',
            name: 'Money Conflict',
            type: 'simple',
            entries: [
              { value: 'Debt', sets: { focus: 'Collection Agency' } },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$conflict': '{{conflictType}}',
              '$situation': '{{$conflict.@situation}}', // Intermediate variable (old pattern)
            },
            pattern: 'Focus via intermediate: {{$situation.@focus}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('Focus via intermediate: Collection Agency')
    })

    it('should support mixed access patterns in the same template', () => {
      // Mix direct chained and intermediate variable patterns
      const doc = createTestDoc(
        [
          {
            id: 'person',
            name: 'Person',
            type: 'simple',
            entries: [
              { value: 'Alice', sets: { job: '{{jobs}}', hobby: '{{hobbies}}' } },
            ],
          },
          {
            id: 'jobs',
            name: 'Jobs',
            type: 'simple',
            entries: [
              { value: 'Engineer', sets: { salary: 'High', field: 'Technology' } },
            ],
          },
          {
            id: 'hobbies',
            name: 'Hobbies',
            type: 'simple',
            entries: [
              { value: 'Gaming', sets: { cost: 'Medium' } },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$person': '{{person}}',
              '$job': '{{$person.@job}}', // Intermediate for job
            },
            // Mix: direct access for hobby.cost, intermediate for job.field
            pattern: 'Field: {{$job.@field}}, Hobby Cost: {{$person.@hobby.@cost}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('Field: Technology, Hobby Cost: Medium')
    })

    it('should handle .value as terminal in chain', () => {
      const doc = createTestDoc(
        [
          {
            id: 'item',
            name: 'Item',
            type: 'simple',
            entries: [
              { value: 'Sword', sets: { child: '{{childItem}}' } },
            ],
          },
          {
            id: 'childItem',
            name: 'Child Item',
            type: 'simple',
            entries: [
              { value: 'ChildValue', sets: { deep: 'DeepValue' } },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: { '$item': '{{item}}' },
            // Access .value explicitly at end of chain
            pattern: 'Child value: {{$item.@child.value}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('Child value: ChildValue')
    })

    it('should support nested property access on template references: {{templateName.@a.@b}}', () => {
      // Tests the pattern {{gangProfile.@gang.@reputation}} where gangProfile is a template
      // that has a $gang shared variable referencing a table with sets
      const doc = createTestDoc(
        [
          {
            id: 'streetGangs',
            name: 'Street Gangs',
            type: 'simple',
            entries: [
              {
                value: 'Iron Wolves',
                sets: {
                  territory: 'Downtown',
                  style: 'Biker',
                  reputation: 'Feared'
                }
              },
            ],
          },
        ],
        [
          {
            id: 'gangProfile',
            name: 'Gang Profile',
            shared: {
              '$gang': '{{streetGangs}}',
            },
            pattern: '## {{$gang}}\n\n**Territory:** {{$gang.@territory}}\n\n**Reputation:** {{$gang.@reputation}}',
          },
          {
            id: 'test',
            name: 'Test',
            // Access nested property through template reference
            pattern: 'Gang reputation: {{gangProfile.@gang.@reputation}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('Gang reputation: Feared')
    })

    it('should support deeply nested property access on template references', () => {
      // Tests chaining multiple levels through a template reference
      const doc = createTestDoc(
        [
          {
            id: 'cultures',
            name: 'Cultures',
            type: 'simple',
            entries: [
              {
                value: 'Nordic',
                sets: {
                  naming: '{{nordicNames}}'
                }
              },
            ],
          },
          {
            id: 'nordicNames',
            name: 'Nordic Names',
            type: 'simple',
            entries: [
              {
                value: 'Bjorn',
                sets: {
                  meaning: 'Bear',
                  origin: 'Old Norse'
                }
              },
            ],
          },
        ],
        [
          {
            id: 'culturalProfile',
            name: 'Cultural Profile',
            shared: {
              '$culture': '{{cultures}}',
            },
            pattern: 'Culture: {{$culture}}',
          },
          {
            id: 'test',
            name: 'Test',
            // Access three levels deep through template reference
            pattern: 'Name origin: {{culturalProfile.@culture.@naming.@origin}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')

      expect(result.text).toBe('Name origin: Old Norse')
    })
  })
})

describe('Explicit Pattern Syntax in Sets', () => {
  let engine: RandomTableEngine

  const createTestDoc = (
    tables: import('../types').Table[],
    templates: import('../types').Template[]
  ): import('../types').RandomTableDocument => ({
    metadata: {
      name: 'Test',
      namespace: 'test.sets.explicit',
      version: '1.0.0',
      specVersion: '1.0',
    },
    tables,
    templates,
  })

  beforeEach(() => {
    engine = new RandomTableEngine()
  })

  describe('pattern evaluation in sets', () => {
    it('should evaluate {{tableName}} patterns in sets at merge time', () => {
      const doc = createTestDoc(
        [
          {
            id: 'character',
            name: 'Character',
            type: 'simple',
            entries: [
              {
                value: 'Warrior',
                sets: {
                  // Explicit pattern - evaluated at merge time
                  weapon: '{{weapons}}',
                },
              },
            ],
          },
          {
            id: 'weapons',
            name: 'Weapons',
            type: 'simple',
            entries: [{ value: 'Sword' }, { value: 'Axe' }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: { _init: '{{character}}' },
            pattern: '{{@character}} with {{@character.weapon}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toMatch(/^Warrior with (Sword|Axe)$/)
    })

    it('should evaluate {{dice:}} patterns in sets at merge time', () => {
      const doc = createTestDoc(
        [
          {
            id: 'monster',
            name: 'Monster',
            type: 'simple',
            entries: [
              {
                value: 'Dragon',
                sets: {
                  hp: '{{dice:4d10+20}}',
                  ac: '18',
                },
              },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: { _init: '{{monster}}' },
            pattern: '{{@monster}}: HP={{@monster.hp}}, AC={{@monster.ac}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      // HP should be a number between 24-60, AC should be literal "18"
      expect(result.text).toMatch(/^Dragon: HP=\d+, AC=18$/)
      const hpMatch = result.text.match(/HP=(\d+)/)
      expect(hpMatch).not.toBeNull()
      const hp = parseInt(hpMatch![1], 10)
      expect(hp).toBeGreaterThanOrEqual(24)
      expect(hp).toBeLessThanOrEqual(60)
    })

    it('should support mixed content in set values', () => {
      const doc = createTestDoc(
        [
          {
            id: 'item',
            name: 'Item',
            type: 'simple',
            entries: [
              {
                value: 'Potion',
                sets: {
                  // Mixed literal and pattern content
                  description: 'A {{adjective}} potion worth {{dice:1d6*10}} gold',
                },
              },
            ],
          },
          {
            id: 'adjective',
            name: 'Adjective',
            type: 'simple',
            entries: [{ value: 'glowing' }, { value: 'bubbling' }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: { _init: '{{item}}' },
            pattern: '{{@item.description}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toMatch(/^A (glowing|bubbling) potion worth \d+ gold$/)
    })

    it('should keep literal strings as literals even if they match table IDs', () => {
      const doc = createTestDoc(
        [
          {
            id: 'creature',
            name: 'Creature',
            type: 'simple',
            entries: [
              {
                value: 'Dragon',
                sets: {
                  // This is a literal string, not a table reference
                  type: 'weapons', // "weapons" table exists but shouldn't be rolled
                },
              },
            ],
          },
          {
            id: 'weapons',
            name: 'Weapons',
            type: 'simple',
            entries: [{ value: 'Sword' }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: { _init: '{{creature}}' },
            pattern: 'Type: {{@creature.type}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      // Should return "weapons" as literal, NOT "Sword"
      expect(result.text).toBe('Type: weapons')
    })
  })

  describe('cycle detection', () => {
    it('should handle self-referential table rolls gracefully', () => {
      // A set value that references the same table should work (recursion tracking)
      // The table recursion limit (default 50) will catch truly infinite cases
      const doc = createTestDoc(
        [
          {
            id: 'items',
            name: 'Items',
            type: 'simple',
            entries: [
              {
                value: 'Chest',
                sets: {
                  // Contains another roll of the same table
                  // This creates a chain but is not truly self-referential
                  contents: '{{items}}',
                },
              },
              {
                value: 'Gold',
                sets: {
                  contents: 'nothing',
                },
              },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: { _init: '{{items}}' },
            pattern: 'Found: {{@items}}, Contains: {{@items.contents}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      // Should get either "Chest" with nested roll, or "Gold" with "nothing"
      expect(result.text).toMatch(/^Found: (Chest|Gold), Contains: (Chest|Gold|nothing)$/)
    })

    it('should not re-evaluate set key during same evaluation', () => {
      // If a set value pattern is being evaluated, another attempt to evaluate
      // the same key should return the raw pattern (cycle detection)
      const doc = createTestDoc(
        [
          {
            id: 'table1',
            name: 'Table 1',
            type: 'simple',
            entries: [
              {
                value: 'Value1',
                sets: {
                  // This pattern will try to roll table2
                  prop1: '{{table2}}',
                },
              },
            ],
          },
          {
            id: 'table2',
            name: 'Table 2',
            type: 'simple',
            entries: [
              {
                value: 'Value2',
                sets: {
                  // During evaluation of table1.prop1, this would try to evaluate
                  // table1.prop1 again, triggering cycle detection
                  prop2: '{{@table1.prop1}}',
                },
              },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: { _init: '{{table1}}' },
            // Access the nested property
            pattern: 'Result: {{@table1.prop1}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      // The inner set evaluation of table1.prop1 happens at merge time,
      // which rolls table2, which stores its sets including prop2.
      // At the template level, @table1.prop1 returns "Value2" (the evaluated result)
      expect(result.text).toBe('Result: Value2')
    })

    it('should handle nested table rolls in sets without cycles', () => {
      // Nested patterns should work fine when there are no cycles
      const doc = createTestDoc(
        [
          {
            id: 'outer',
            name: 'Outer',
            type: 'simple',
            entries: [
              {
                value: 'Outer',
                sets: {
                  nested: '{{inner}}',
                },
              },
            ],
          },
          {
            id: 'inner',
            name: 'Inner',
            type: 'simple',
            entries: [{ value: 'InnerValue' }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: { _init: '{{outer}}' },
            pattern: 'Nested: {{@outer.nested}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('Nested: InnerValue')
    })
  })

  describe('defaultSets with patterns', () => {
    it('should evaluate patterns in defaultSets', () => {
      const doc = createTestDoc(
        [
          {
            id: 'character',
            name: 'Character',
            type: 'simple',
            defaultSets: {
              // Default set with pattern
              baseHp: '{{dice:2d6}}',
            },
            entries: [
              { value: 'Warrior' },
              { value: 'Mage' },
            ],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: { _init: '{{character}}' },
            pattern: '{{@character}} has {{@character.baseHp}} HP',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toMatch(/^(Warrior|Mage) has \d+ HP$/)
    })

    it('should allow entry sets to override defaultSets patterns', () => {
      const doc = createTestDoc(
        [
          {
            id: 'character',
            name: 'Character',
            type: 'simple',
            defaultSets: {
              weapon: '{{commonWeapons}}', // Default pattern
            },
            entries: [
              { value: 'Warrior' }, // Uses default
              { value: 'Mage', sets: { weapon: '{{mageWeapons}}' } }, // Override
            ],
          },
          {
            id: 'commonWeapons',
            name: 'Common Weapons',
            type: 'simple',
            entries: [{ value: 'Sword' }],
          },
          {
            id: 'mageWeapons',
            name: 'Mage Weapons',
            type: 'simple',
            entries: [{ value: 'Staff' }],
          },
        ],
        [
          {
            id: 'test',
            name: 'Test',
            shared: { _init: '{{character}}' },
            pattern: '{{@character}} with {{@character.weapon}}',
          },
        ]
      )

      engine.loadCollection(doc, 'test')
      // Roll multiple times to verify both paths work
      let foundWarrior = false
      let foundMage = false
      for (let i = 0; i < 20; i++) {
        const result = engine.rollTemplate('test', 'test')
        if (result.text === 'Warrior with Sword') foundWarrior = true
        if (result.text === 'Mage with Staff') foundMage = true
        expect(result.text).toMatch(/^(Warrior with Sword|Mage with Staff)$/)
      }
      // With enough rolls, we should have seen both
      expect(foundWarrior || foundMage).toBe(true)
    })
  })
})

describe('Again keyword with separator', () => {
  it('should use custom separator for again rolls', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: {
        name: 'Test Again',
        namespace: 'test',
        version: '1.0.0',
        specVersion: '1.0',
      },
      tables: [
        {
          id: 'colors',
          name: 'Colors',
          type: 'simple',
          entries: [
            { id: 'red', value: 'Red' },
            { id: 'blue', value: 'Blue' },
            { id: 'green', value: 'Green' },
            { id: 'yellow', value: 'Yellow' },
            { id: 'combo', value: '{{2*unique*again|" and "}}' },
          ],
        },
      ],
    }
    engine.loadCollection(doc, 'test')

    // Roll until we get the combo entry
    let foundCombo = false
    for (let i = 0; i < 50; i++) {
      const result = engine.roll('colors', 'test')
      if (result.text && result.text.includes(' and ')) {
        foundCombo = true
        // Should have the " and " separator
        expect(result.text).toMatch(/(Red|Blue|Green|Yellow) and (Red|Blue|Green|Yellow)/)
        // Should not have ", " (default separator)
        expect(result.text).not.toContain(', ')
        break
      }
    }
    expect(foundCombo).toBe(true)
  })

  it('should use default separator when none specified', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: {
        name: 'Test Again Default',
        namespace: 'test',
        version: '1.0.0',
        specVersion: '1.0',
      },
      tables: [
        {
          id: 'items',
          name: 'Items',
          type: 'simple',
          entries: [
            { id: 'sword', value: 'Sword' },
            { id: 'shield', value: 'Shield' },
            { id: 'helm', value: 'Helm' },
            { id: 'armor', value: 'Armor' },
            { id: 'multi', value: '{{2*unique*again}}' },
          ],
        },
      ],
    }
    engine.loadCollection(doc, 'test')

    // Roll until we get the multi entry
    let foundMulti = false
    for (let i = 0; i < 50; i++) {
      const result = engine.roll('items', 'test')
      if (result.text && result.text.includes(', ')) {
        foundMulti = true
        // Should have the default ", " separator
        expect(result.text).toMatch(/(Sword|Shield|Helm|Armor), (Sword|Shield|Helm|Armor)/)
        break
      }
    }
    expect(foundMulti).toBe(true)
  })
})

describe('@self.description placeholder', () => {
  it('should access current entry description', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'items',
          name: 'Items',
          type: 'simple',
          entries: [
            {
              id: 'sword',
              value: 'Silver Sword ({{@self.description}})',
              description: 'A gleaming blade of pure silver',
            },
          ],
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.roll('items', 'test')
    expect(result.text).toBe('Silver Sword (A gleaming blade of pure silver)')
  })

  it('should return empty string when no description', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'items',
          name: 'Items',
          type: 'simple',
          entries: [
            {
              id: 'sword',
              value: 'Silver Sword{{@self.description}}',
            },
          ],
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.roll('items', 'test')
    expect(result.text).toBe('Silver Sword')
  })

  it('should evaluate expressions in description', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'items',
          name: 'Items',
          type: 'simple',
          entries: [
            {
              id: 'sword',
              value: '{{@self.description}}',
              description: 'Damage: {{dice:1d6}}',
            },
          ],
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.roll('items', 'test')
    // Should match "Damage: X" where X is 1-6
    expect(result.text).toMatch(/^Damage: [1-6]$/)
  })

  it('should work with collection tables', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'weapons',
          name: 'Weapons',
          type: 'collection',
          collections: ['swords'],
        },
        {
          id: 'swords',
          name: 'Swords',
          type: 'simple',
          entries: [
            {
              id: 'longsword',
              value: '{{@self.description}} Longsword',
              description: 'Steel',
            },
          ],
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.roll('weapons', 'test')
    expect(result.text).toBe('Steel Longsword')
  })
})

describe('@self.value placeholder', () => {
  it('should access current entry raw value', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'items',
          name: 'Items',
          type: 'simple',
          entries: [
            {
              id: 'sword',
              value: 'Silver Sword ({{@self.value}})',
            },
          ],
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.roll('items', 'test')
    // @self.value returns the raw unevaluated string
    expect(result.text).toBe('Silver Sword (Silver Sword ({{@self.value}}))')
  })

  it('should access raw value in defaultSets', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'scents',
          name: 'Scents',
          type: 'simple',
          defaultSets: {
            smell: 'smells like {{@self.value}}',
          },
          entries: [
            {
              id: 'pine',
              value: 'pine resin',
            },
          ],
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.roll('scents', 'test')
    expect(result.text).toBe('pine resin')
    // Placeholders are flat - not nested by table ID
    expect(result.placeholders?.smell).toBe('smells like pine resin')
  })

  it('should return empty string when value is not yet set', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'items',
          name: 'Items',
          type: 'simple',
          entries: [
            {
              id: 'sword',
              value: 'Silver Sword',
            },
          ],
        },
      ],
      templates: [
        {
          id: 'test',
          name: 'Test',
          pattern: 'Self value: {{@self.value}}',
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    // Templates don't have "entries" with values, so @self.value should be empty
    const result = engine.rollTemplate('test', 'test')
    expect(result.text).toBe('Self value: ')
  })

  it('should return raw value without evaluating expressions', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'items',
          name: 'Items',
          type: 'simple',
          defaultSets: {
            rawValue: '{{@self.value}}',
          },
          entries: [
            {
              id: 'sword',
              value: 'Sword {{dice:1d6}}',
            },
          ],
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.roll('items', 'test')
    // @self.value returns the RAW value, not the evaluated value
    expect(result.placeholders?.rawValue).toBe('Sword {{dice:1d6}}')
    // But the main result should be evaluated
    expect(result.text).toMatch(/^Sword [1-6]$/)
  })

  it('should work with collection tables', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'weapons',
          name: 'Weapons',
          type: 'collection',
          defaultSets: {
            selfValue: '{{@self.value}}',
          },
          collections: ['swords'],
        },
        {
          id: 'swords',
          name: 'Swords',
          type: 'simple',
          entries: [
            {
              id: 'longsword',
              value: 'Steel Longsword',
            },
          ],
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.roll('weapons', 'test')
    expect(result.text).toBe('Steel Longsword')
    expect(result.placeholders?.selfValue).toBe('Steel Longsword')
  })
})

describe('$var.@description access via shared variables', () => {
  it('should access entry description via $var.@description in template', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'worldTag',
          name: 'World Tag',
          type: 'simple',
          entries: [
            {
              id: 'abandoned',
              value: 'Abandoned Colony',
              description: 'The world once hosted a colony until disaster struck.',
              sets: {
                enemy: 'Raiders',
                friend: 'Survivors',
              },
            },
          ],
        },
      ],
      templates: [
        {
          id: 'worldTagTemplate',
          name: 'World Tag Template',
          pattern: '# {{$worldTag}}\n\n{{$worldTag.@description}}\n\nFriend: {{$worldTag.@friend}}',
          shared: {
            '$worldTag': '{{worldTag}}',
          },
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.rollTemplate('worldTagTemplate', 'test')
    expect(result.text).toBe('# Abandoned Colony\n\nThe world once hosted a colony until disaster struck.\n\nFriend: Survivors')
  })

  it('should return empty string when entry has no description', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'items',
          name: 'Items',
          type: 'simple',
          entries: [
            {
              id: 'sword',
              value: 'Sword',
            },
          ],
        },
      ],
      templates: [
        {
          id: 'itemTemplate',
          name: 'Item Template',
          pattern: '{{$item}} - {{$item.@description}}',
          shared: {
            '$item': '{{items}}',
          },
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.rollTemplate('itemTemplate', 'test')
    expect(result.text).toBe('Sword - ')
  })

  it('should access description via multi-roll capture with index', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'items',
          name: 'Items',
          type: 'simple',
          entries: [
            {
              id: 'sword',
              value: 'Sword',
              description: 'A sharp blade',
            },
          ],
        },
      ],
      templates: [
        {
          id: 'lootTemplate',
          name: 'Loot Template',
          pattern: '{{1*items >> $loot|silent}}Item: {{$loot[0]}} ({{$loot[0].@description}})',
        },
      ],
    }
    engine.loadCollection(doc, 'test')
    const result = engine.rollTemplate('lootTemplate', 'test')
    expect(result.text).toBe('Item: Sword (A sharp blade)')
  })
})

// ============================================================================
// Template Multi-Roll Isolation Tests
// ============================================================================

describe('Template Multi-Roll Isolation', () => {
  it('should re-evaluate shared variables for each template invocation', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'races',
          name: 'Races',
          type: 'simple',
          entries: [
            { id: 'human', value: 'Human', sets: { firstName: 'John' } },
            { id: 'elf', value: 'Elf', sets: { firstName: 'Legolas' } },
            { id: 'dwarf', value: 'Dwarf', sets: { firstName: 'Gimli' } },
            { id: 'orc', value: 'Orc', sets: { firstName: 'Thrall' } },
            { id: 'gnome', value: 'Gnome', sets: { firstName: 'Fizz' } },
            { id: 'halfling', value: 'Halfling', sets: { firstName: 'Sam' } },
            { id: 'tiefling', value: 'Tiefling', sets: { firstName: 'Mira' } },
            { id: 'dragonborn', value: 'Dragonborn', sets: { firstName: 'Kriv' } },
          ],
        },
      ],
      templates: [
        {
          id: 'npc',
          name: 'NPC',
          shared: {
            // Capture-aware shared variable - should be re-evaluated for each template roll
            '$race': '{{races}}',
          },
          pattern: '{{$race.@firstName}} the {{$race}}',
        },
        {
          id: 'partyTest',
          name: 'Party Test',
          // Roll the npc template 4 times
          pattern: '{{4*npc|" | "}}',
        },
      ],
    }
    engine.loadCollection(doc, 'test')

    // Run multiple times to verify that results can vary
    // (Without isolation, all 4 NPCs would always be identical)
    let sawVariation = false
    for (let i = 0; i < 10; i++) {
      const result = engine.rollTemplate('partyTest', 'test')
      const npcs = result.text.split(' | ')
      expect(npcs.length).toBe(4)

      // Extract names
      const names = npcs.map(npc => npc.split(' ')[0])
      const uniqueNames = new Set(names)

      // If we see more than 1 unique name, isolation is working
      if (uniqueNames.size > 1) {
        sawVariation = true
        break
      }
    }

    // With 8 races and 4 rolls, the probability of getting all same is very low
    // If we see variation in any of 10 runs, isolation is working
    expect(sawVariation).toBe(true)
  })

  it('should isolate shared variables between template invocations', () => {
    const engine = new RandomTableEngine()
    const doc: RandomTableDocument = {
      metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
      tables: [
        {
          id: 'items',
          name: 'Items',
          type: 'simple',
          entries: [
            { id: 'a', value: 'Apple' },
            { id: 'b', value: 'Banana' },
            { id: 'c', value: 'Cherry' },
            { id: 'd', value: 'Date' },
            { id: 'e', value: 'Elderberry' },
            { id: 'f', value: 'Fig' },
          ],
        },
      ],
      templates: [
        {
          id: 'picker',
          name: 'Picker',
          shared: {
            '$item': '{{items}}',
          },
          pattern: '{{$item}}',
        },
        {
          id: 'multiPick',
          name: 'Multi Pick',
          pattern: '{{3*picker|", "}}',
        },
      ],
    }
    engine.loadCollection(doc, 'test')

    // Run multiple times to verify isolation (results can vary)
    let sawVariation = false
    for (let i = 0; i < 10; i++) {
      const result = engine.rollTemplate('multiPick', 'test')
      const items = result.text.split(', ')
      expect(items.length).toBe(3)

      const uniqueItems = new Set(items)
      if (uniqueItems.size > 1) {
        sawVariation = true
        break
      }
    }

    // With 6 items and 3 rolls, probability of all same is very low
    expect(sawVariation).toBe(true)
  })
})

// ============================================================================
// Switch Expression Tests
// ============================================================================

describe('Switch Expressions', () => {
  describe('standalone switch', () => {
    it('should evaluate first matching condition', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [],
        templates: [
          {
            id: 'test',
            name: 'Test',
            shared: { gender: 'male' },
            pattern: '{{switch[$gender=="male":"he"].switch[$gender=="female":"she"].else["they"]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('he')
    })

    it('should fall through to else when no match', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [],
        templates: [
          {
            id: 'test',
            name: 'Test',
            shared: { gender: 'other' },
            pattern: '{{switch[$gender=="male":"he"].switch[$gender=="female":"she"].else["they"]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('they')
    })

    it('should access capture properties in result', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [
          {
            id: 'race',
            name: 'Race',
            type: 'simple',
            entries: [
              {
                id: 'elf',
                value: 'Elf',
                sets: { maleName: 'Legolas', femaleName: 'Arwen' },
              },
            ],
          },
        ],
        templates: [
          {
            id: 'person',
            name: 'Person',
            shared: {
              gender: 'female',
              '$race': '{{race}}',
            },
            pattern:
              '{{switch[$gender=="male":$race.@maleName].switch[$gender=="female":$race.@femaleName].else[$race.@maleName]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('person', 'test')
      expect(result.text).toBe('Arwen')
    })

    it('should evaluate nested table expressions in result', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [
          {
            id: 'spellBook',
            name: 'Spell Book',
            type: 'simple',
            entries: [{ value: 'Fireball Tome' }],
          },
          {
            id: 'gear',
            name: 'Gear',
            type: 'simple',
            entries: [{ value: 'Sword' }],
          },
        ],
        templates: [
          {
            id: 'equipment',
            name: 'Equipment',
            shared: { class: 'wizard' },
            pattern: '{{switch[$class=="wizard":{{spellBook}}].else[{{gear}}]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('equipment', 'test')
      expect(result.text).toBe('Fireball Tome')
    })
  })

  describe('attached switch', () => {
    it('should apply switch to dice result using implicit subject', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [],
        templates: [
          {
            id: 'attack',
            name: 'Attack',
            // Using 1d1 to get deterministic result of 1
            pattern: '{{dice:1d1.switch[$>=20:"Critical!"].switch[$>=10:"Hit"].else["Miss"]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('attack', 'test')
      expect(result.text).toBe('Miss') // 1 is less than 10, so "Miss"
    })

    it('should apply switch to table result', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [
          {
            id: 'mood',
            name: 'Mood',
            type: 'simple',
            entries: [{ value: 'angry' }],
          },
        ],
        templates: [
          {
            id: 'reaction',
            name: 'Reaction',
            pattern: '{{mood.switch[$=="angry":"raging"].else["calm"]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('reaction', 'test')
      expect(result.text).toBe('raging')
    })

    it('should apply switch to variable and return base result when no match and no else', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [],
        templates: [
          {
            id: 'test',
            name: 'Test',
            shared: { value: 'original' },
            pattern: '{{$value.switch[$=="changed":"modified"]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('original') // No match, no else, returns base
    })

    it('should apply switch to capture property access', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [
          {
            id: 'character',
            name: 'Character',
            type: 'simple',
            entries: [
              {
                value: 'Hero',
                sets: { class: 'wizard' },
              },
            ],
          },
        ],
        templates: [
          {
            id: 'title',
            name: 'Title',
            shared: { '$hero': '{{character}}' },
            pattern: '{{$hero.@class.switch[$=="wizard":"Mage"].else["Warrior"]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('title', 'test')
      expect(result.text).toBe('Mage')
    })
  })

  describe('complex conditions', () => {
    it('should handle logical AND in conditions', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [],
        templates: [
          {
            id: 'power',
            name: 'Power',
            shared: { class: 'wizard', level: '5' },
            pattern: '{{switch[$class=="wizard" && $level>=5:"Archmage"].else["Apprentice"]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('power', 'test')
      expect(result.text).toBe('Archmage')
    })

    it('should handle contains operator in conditions', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [],
        templates: [
          {
            id: 'title',
            name: 'Title',
            shared: { name: 'Gandalf the Grey' },
            pattern: '{{switch[$name contains "the":"titled"].else["common"]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('title', 'test')
      expect(result.text).toBe('titled')
    })
  })

  describe('gender/race name selection use case', () => {
    it('should select appropriate name based on gender and race', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [
          {
            id: 'gender',
            name: 'Gender',
            type: 'simple',
            entries: [{ value: 'female' }],
          },
          {
            id: 'race',
            name: 'Race',
            type: 'simple',
            entries: [
              {
                value: 'Elf',
                sets: {
                  maleEnglishName: 'Elrond',
                  femaleEnglishName: 'Galadriel',
                  maleChineseName: 'Wei',
                  femaleChineseName: 'Mei',
                },
              },
            ],
          },
        ],
        templates: [
          {
            id: 'person',
            name: 'Person Generator',
            shared: {
              '$gender': '{{gender}}',
              '$race': '{{race}}',
              culture: 'english',
            },
            pattern:
              'A {{$gender}} {{$race}} named {{switch[$gender=="male" && $culture=="english":$race.@maleEnglishName].switch[$gender=="female" && $culture=="english":$race.@femaleEnglishName].switch[$gender=="male" && $culture=="chinese":$race.@maleChineseName].switch[$gender=="female" && $culture=="chinese":$race.@femaleChineseName].else[$race.@maleEnglishName]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('person', 'test')
      expect(result.text).toBe('A female Elf named Galadriel')
    })
  })

  describe('dynamic content in switch results', () => {
    it('should support template syntax {{}} in unquoted switch results', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        shared: {
          '$building': '{{buildingType}}',
        },
        tables: [
          {
            id: 'buildingType',
            name: 'Building',
            type: 'simple',
            entries: [{ value: 'Tower', sets: { glowColor: 'amber' } }],
          },
        ],
        templates: [
          {
            id: 'description',
            name: 'Building Description',
            // Unquoted result with {{}} template syntax
            pattern:
              '{{switch[$building.@glowColor=="none":no glow].else[glowing with a {{$building.@glowColor}} light]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('description', 'test')
      expect(result.text).toBe('glowing with a amber light')
    })

    it('should interpolate {{}} inside quoted strings (like template literals)', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        shared: {
          '$building': '{{buildingType}}',
        },
        tables: [
          {
            id: 'buildingType',
            name: 'Building',
            type: 'simple',
            entries: [{ value: 'Tower', sets: { glowColor: 'amber' } }],
          },
        ],
        templates: [
          {
            id: 'description',
            name: 'Building Description',
            // Quoted string with {{}} - should interpolate
            pattern:
              '{{switch[$building.@glowColor=="none":", lacking any glow"].else[", glowing with a {{$building.@glowColor}} light"]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('description', 'test')
      expect(result.text).toBe(', glowing with a amber light')
    })

    it('should handle pure quoted strings without {{}} as literals', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        shared: {
          testVar: 'foo',
        },
        tables: [
          { id: 'dummy', name: 'Dummy', type: 'simple', entries: [{ value: 'x' }] },
        ],
        templates: [
          {
            id: 'test',
            name: 'Test',
            // Quoted strings without {{}} are pure literals
            pattern: '{{switch[$testVar=="foo":"simple literal"].else["other"]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      expect(result.text).toBe('simple literal')
    })

    it('should resolve $var.@property in switch conditions', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        shared: {
          '$inhabitant': '{{feyInhabitant}}',
        },
        tables: [
          {
            id: 'feyInhabitant',
            name: 'Fey Inhabitant',
            type: 'simple',
            entries: [
              {
                value: 'Pixie',
                sets: { mood: 'mischievous' },
              },
            ],
          },
        ],
        templates: [
          {
            id: 'greeting',
            name: 'Greeting',
            // Test that $inhabitant.@mood is resolved in switch condition
            pattern:
              '{{$inhabitant.@mood}} - {{switch[$inhabitant.@mood=="mischievous":"Beware!"].switch[$inhabitant.@mood=="serene":"Peace."].else["Hello."]}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('greeting', 'test')
      expect(result.text).toBe('mischievous - Beware!')
    })

    it('should capture full table result with sets when switch result is a table reference', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [
          {
            id: 'wizardTable',
            name: 'Wizard',
            type: 'simple',
            entries: [
              {
                value: 'Wizard',
                sets: { spell: 'Fireball', weapon: 'Staff' },
              },
            ],
          },
          {
            id: 'warriorTable',
            name: 'Warrior',
            type: 'simple',
            entries: [
              {
                value: 'Warrior',
                sets: { skill: 'Sword Strike', weapon: 'Sword' },
              },
            ],
          },
        ],
        templates: [
          {
            id: 'character',
            name: 'Character',
            shared: {
              class: 'wizard',
              // This switch should capture the full table result including sets
              '$chosen': '{{switch[$class=="wizard":wizardTable].else[warriorTable]}}',
            },
            pattern: 'Class: {{$chosen}}, Weapon: {{$chosen.@weapon}}, Special: {{$chosen.@spell}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('character', 'test')
      // Should access @weapon and @spell from the captured table's sets
      expect(result.text).toBe('Class: Wizard, Weapon: Staff, Special: Fireball')
    })

    it('should capture full table result when switch result is a table (else branch)', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [
          {
            id: 'wizardTable',
            name: 'Wizard',
            type: 'simple',
            entries: [
              {
                value: 'Wizard',
                sets: { spell: 'Fireball', weapon: 'Staff' },
              },
            ],
          },
          {
            id: 'warriorTable',
            name: 'Warrior',
            type: 'simple',
            entries: [
              {
                value: 'Warrior',
                sets: { skill: 'Sword Strike', weapon: 'Sword' },
              },
            ],
          },
        ],
        templates: [
          {
            id: 'character',
            name: 'Character',
            shared: {
              class: 'warrior',
              // This should fall through to else and capture the full warriorTable result
              '$chosen': '{{switch[$class=="wizard":wizardTable].else[warriorTable]}}',
            },
            pattern: 'Class: {{$chosen}}, Weapon: {{$chosen.@weapon}}, Special: {{$chosen.@skill}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('character', 'test')
      // Should access @weapon and @skill from the captured table's sets
      expect(result.text).toBe('Class: Warrior, Weapon: Sword, Special: Sword Strike')
    })

    it('should capture full table result when switch uses wrapped {{table}} syntax', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [
          {
            id: 'maleHairStyle',
            name: 'Male Hair',
            type: 'simple',
            entries: [
              {
                value: 'Short',
                sets: { hairStyleDesc: 'Cropped short', hairColor: 'brown' },
              },
            ],
          },
          {
            id: 'femaleHairStyle',
            name: 'Female Hair',
            type: 'simple',
            entries: [
              {
                value: 'Long',
                sets: { hairStyleDesc: 'Flowing long locks', hairColor: 'blonde' },
              },
            ],
          },
        ],
        templates: [
          {
            id: 'character',
            name: 'Character',
            shared: {
              gender: 'male',
              // Using wrapped {{table}} syntax in switch results
              '$hairStyle': '{{switch[$gender=="male":{{maleHairStyle}}].else[{{femaleHairStyle}}]}}',
            },
            pattern: 'Hair: {{$hairStyle}}, Description: {{$hairStyle.@hairStyleDesc}}, Color: {{$hairStyle.@hairColor}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('character', 'test')
      // Should access @hairStyleDesc and @hairColor from the captured table's sets
      expect(result.text).toBe('Hair: Short, Description: Cropped short, Color: brown')
    })

    it('should capture full table result when switch uses wrapped {{table}} syntax (else branch)', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [
          {
            id: 'maleHairStyle',
            name: 'Male Hair',
            type: 'simple',
            entries: [
              {
                value: 'Short',
                sets: { hairStyleDesc: 'Cropped short', hairColor: 'brown' },
              },
            ],
          },
          {
            id: 'femaleHairStyle',
            name: 'Female Hair',
            type: 'simple',
            entries: [
              {
                value: 'Long',
                sets: { hairStyleDesc: 'Flowing long locks', hairColor: 'blonde' },
              },
            ],
          },
        ],
        templates: [
          {
            id: 'character',
            name: 'Character',
            shared: {
              gender: 'female',
              // Using wrapped {{table}} syntax in switch results, should fall through to else
              '$hairStyle': '{{switch[$gender=="male":{{maleHairStyle}}].else[{{femaleHairStyle}}]}}',
            },
            pattern: 'Hair: {{$hairStyle}}, Description: {{$hairStyle.@hairStyleDesc}}, Color: {{$hairStyle.@hairColor}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('character', 'test')
      // Should access @hairStyleDesc and @hairColor from the captured table's sets
      expect(result.text).toBe('Hair: Long, Description: Flowing long locks, Color: blonde')
    })
  })

  describe('template variable capture', () => {
    it('should capture template shared variables for property access', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [],
        templates: [
          {
            id: 'npcComplete',
            name: 'NPC Complete',
            shared: {
              profession: 'Blacksmith',
              age: '45',
              hometown: 'Riverdale',
            },
            pattern: 'A {{$age}} year old {{$profession}} from {{$hometown}}',
          },
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$npc': '{{npcComplete}}',
            },
            pattern: 'NPC: {{$npc}}, Profession: {{$npc.@profession}}, Age: {{$npc.@age}}, Hometown: {{$npc.@hometown}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      // Should access shared variables from the captured template
      expect(result.text).toBe('NPC: A 45 year old Blacksmith from Riverdale, Profession: Blacksmith, Age: 45, Hometown: Riverdale')
    })

    it('should capture template with shared variables', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [
          {
            id: 'race',
            name: 'Race',
            type: 'simple',
            entries: [
              {
                value: 'Elf',
                sets: { bonus: 'Dexterity', penalty: 'Constitution' },
              },
            ],
          },
        ],
        templates: [
          {
            id: 'character',
            name: 'Character',
            shared: {
              name: 'Legolas',
              '$race': '{{race}}',
            },
            pattern: '{{$name}} the {{$race}}',
          },
          {
            id: 'test',
            name: 'Test',
            shared: {
              '$npc': '{{character}}',
            },
            pattern: 'Character: {{$npc}}, Name: {{$npc.@name}}, Race: {{$npc.@race}}, Bonus: {{$npc.@race.@bonus}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      // Should access nested shared variables
      expect(result.text).toBe('Character: Legolas the Elf, Name: Legolas, Race: Elf, Bonus: Dexterity')
    })

    it('should work with switch expressions that resolve to templates', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [],
        templates: [
          {
            id: 'wizardNpc',
            name: 'Wizard NPC',
            shared: {
              profession: 'Wizard',
              power: 'Arcane Magic',
            },
            pattern: 'A {{$profession}} wielding {{$power}}',
          },
          {
            id: 'warriorNpc',
            name: 'Warrior NPC',
            shared: {
              profession: 'Warrior',
              power: 'Brute Strength',
            },
            pattern: 'A {{$profession}} wielding {{$power}}',
          },
          {
            id: 'test',
            name: 'Test',
            shared: {
              class: 'wizard',
              '$npc': '{{switch[$class=="wizard":{{wizardNpc}}].else[{{warriorNpc}}]}}',
            },
            pattern: 'Character: {{$npc}}, Profession: {{$npc.@profession}}, Power: {{$npc.@power}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      // Should access shared variables from the template resolved by switch
      expect(result.text).toBe('Character: A Wizard wielding Arcane Magic, Profession: Wizard, Power: Arcane Magic')
    })

    it('should work with switch else branch resolving to templates', () => {
      const engine = new RandomTableEngine()
      const doc: RandomTableDocument = {
        metadata: { name: 'Test', namespace: 'test', version: '1.0.0', specVersion: '1.0' },
        tables: [],
        templates: [
          {
            id: 'wizardNpc',
            name: 'Wizard NPC',
            shared: {
              profession: 'Wizard',
              power: 'Arcane Magic',
            },
            pattern: 'A {{$profession}} wielding {{$power}}',
          },
          {
            id: 'warriorNpc',
            name: 'Warrior NPC',
            shared: {
              profession: 'Warrior',
              power: 'Brute Strength',
            },
            pattern: 'A {{$profession}} wielding {{$power}}',
          },
          {
            id: 'test',
            name: 'Test',
            shared: {
              class: 'warrior',
              '$npc': '{{switch[$class=="wizard":{{wizardNpc}}].else[{{warriorNpc}}]}}',
            },
            pattern: 'Character: {{$npc}}, Profession: {{$npc.@profession}}, Power: {{$npc.@power}}',
          },
        ],
      }
      engine.loadCollection(doc, 'test')
      const result = engine.rollTemplate('test', 'test')
      // Should access shared variables from the template resolved by switch else
      expect(result.text).toBe('Character: A Warrior wielding Brute Strength, Profession: Warrior, Power: Brute Strength')
    })
  })
})

describe('Intra-set references', () => {
  let engine: RandomTableEngine

  const createTestDoc = (
    tables: import('../types').Table[],
    templates: import('../types').Template[]
  ): import('../types').RandomTableDocument => ({
    metadata: {
      name: 'Test',
      namespace: 'test.intraset',
      version: '1.0.0',
      specVersion: '1.0',
    },
    tables,
    templates,
  })

  beforeEach(() => {
    engine = new RandomTableEngine()
  })

  it('should allow later sets to reference earlier sets via @tableId.setKey', () => {
    const doc = createTestDoc(
      [
        {
          id: 'myTable',
          name: 'My Table',
          type: 'simple',
          entries: [
            {
              value: 'result',
              sets: {
                first: 'hello',
                second: '{{@myTable.first}} world',
              },
            },
          ],
        },
      ],
      [
        {
          id: 'test',
          name: 'Test',
          pattern: '{{myTable}} - first: {{@myTable.first}}, second: {{@myTable.second}}',
        },
      ]
    )

    engine.loadCollection(doc, 'test')
    const result = engine.rollTemplate('test', 'test')
    expect(result.text).toBe('result - first: hello, second: hello world')
  })

  it('should support expression evaluation in sets that reference earlier sets', () => {
    const doc = createTestDoc(
      [
        {
          id: 'character',
          name: 'Character',
          type: 'simple',
          entries: [
            {
              value: 'Hero',
              sets: {
                level: '5',
                bonus: '{{math:@character.level * 2}}',
              },
            },
          ],
        },
      ],
      [
        {
          id: 'test',
          name: 'Test',
          shared: { _init: '{{character}}' },
          pattern: 'Level {{@character.level}} with bonus {{@character.bonus}}',
        },
      ]
    )

    engine.loadCollection(doc, 'test')
    const result = engine.rollTemplate('test', 'test')
    expect(result.text).toBe('Level 5 with bonus 10')
  })

  it('should support chained intra-set references (a references b, c references a)', () => {
    const doc = createTestDoc(
      [
        {
          id: 'myTable',
          name: 'My Table',
          type: 'simple',
          entries: [
            {
              value: 'output',
              sets: {
                base: 'BASE',
                middle: '[{{@myTable.base}}]',
                final: '{{@myTable.middle}} END',
              },
            },
          ],
        },
      ],
      [
        {
          id: 'test',
          name: 'Test',
          shared: { _init: '{{myTable}}' },
          pattern: '{{@myTable.final}}',
        },
      ]
    )

    engine.loadCollection(doc, 'test')
    const result = engine.rollTemplate('test', 'test')
    expect(result.text).toBe('[BASE] END')
  })

  it('should handle self-referential sets gracefully without infinite loop', () => {
    const doc = createTestDoc(
      [
        {
          id: 'myTable',
          name: 'My Table',
          type: 'simple',
          entries: [
            {
              value: 'result',
              sets: {
                // Self-referential - should be detected and not cause infinite loop
                selfRef: '{{@myTable.selfRef}}',
              },
            },
          ],
        },
      ],
      [
        {
          id: 'test',
          name: 'Test',
          pattern: '{{myTable}} - done',
        },
      ]
    )

    engine.loadCollection(doc, 'test')
    // Should complete without hanging (cycle detection prevents infinite loop)
    const result = engine.rollTemplate('test', 'test')
    expect(result.text).toBe('result - done')
  })

  it('should support switch expressions that reference earlier sets', () => {
    const doc = createTestDoc(
      [
        {
          id: 'character',
          name: 'Character',
          type: 'simple',
          entries: [
            {
              value: 'Hero',
              sets: {
                gender: 'male',
                title: '{{switch[@character.gender=="male":"King"].else["Queen"]}}',
              },
            },
          ],
        },
      ],
      [
        {
          id: 'test',
          name: 'Test',
          shared: { _init: '{{character}}' },
          pattern: '{{@character.title}} Hero',
        },
      ]
    )

    engine.loadCollection(doc, 'test')
    const result = engine.rollTemplate('test', 'test')
    expect(result.text).toBe('King Hero')
  })

  it('should support table rolls in sets that reference earlier sets for selection', () => {
    const doc = createTestDoc(
      [
        {
          id: 'maleNames',
          name: 'Male Names',
          type: 'simple',
          entries: [{ value: 'John' }],
        },
        {
          id: 'femaleNames',
          name: 'Female Names',
          type: 'simple',
          entries: [{ value: 'Jane' }],
        },
        {
          id: 'character',
          name: 'Character',
          type: 'simple',
          entries: [
            {
              value: 'Person',
              sets: {
                gender: 'male',
                name: '{{switch[@character.gender=="male":{{maleNames}}].else[{{femaleNames}}]}}',
              },
            },
          ],
        },
      ],
      [
        {
          id: 'test',
          name: 'Test',
          shared: { _init: '{{character}}' },
          pattern: '{{@character.name}} ({{@character.gender}})',
        },
      ]
    )

    engine.loadCollection(doc, 'test')
    const result = engine.rollTemplate('test', 'test')
    expect(result.text).toBe('John (male)')
  })

  it('should work with defaultSets and entry sets together', () => {
    const doc = createTestDoc(
      [
        {
          id: 'character',
          name: 'Character',
          type: 'simple',
          defaultSets: {
            baseHP: '10',
          },
          entries: [
            {
              value: 'Warrior',
              sets: {
                bonus: '5',
                totalHP: '{{math:@character.baseHP + @character.bonus}}',
              },
            },
          ],
        },
      ],
      [
        {
          id: 'test',
          name: 'Test',
          shared: { _init: '{{character}}' },
          pattern: '{{@character}} has {{@character.totalHP}} HP',
        },
      ]
    )

    engine.loadCollection(doc, 'test')
    const result = engine.rollTemplate('test', 'test')
    expect(result.text).toBe('Warrior has 15 HP')
  })

  it('should support nested CaptureItem access in switch within sets', () => {
    // This mirrors the user's test.test.json scenario
    // Uses chained placeholder access: @person.culture.@maleName
    const doc = createTestDoc(
      [
        {
          id: 'gender',
          name: 'Gender',
          type: 'simple',
          entries: [{ value: 'male' }], // Fixed to male for deterministic test
        },
        {
          id: 'maleNames',
          name: 'Male Names',
          type: 'simple',
          entries: [{ value: 'Ron' }],
        },
        {
          id: 'femaleNames',
          name: 'Female Names',
          type: 'simple',
          entries: [{ value: 'Jane' }],
        },
        {
          id: 'culture',
          name: 'Culture',
          type: 'simple',
          entries: [
            {
              value: 'Big Namer',
              sets: {
                maleName: '{{maleNames}}',
                femaleName: '{{femaleNames}}',
              },
            },
          ],
        },
        {
          id: 'person',
          name: 'Person',
          type: 'simple',
          defaultSets: {
            gender: '{{gender}}',
            culture: '{{culture}}',
            // Chained placeholder access: @person.culture.@maleName
            name: '{{switch[@person.gender=="male":{{@person.culture.@maleName}}].else[{{@person.culture.@femaleName}}]}}',
          },
          entries: [{ value: '{{@person.name}}' }],
        },
      ],
      [
        {
          id: 'test',
          name: 'Test',
          shared: { '$person': '{{person}}' },
          pattern: 'Name: {{$person.@name}}, Gender: {{$person.@gender}}, Culture: {{$person.@culture}}',
        },
      ]
    )

    engine.loadCollection(doc, 'test')
    const result = engine.rollTemplate('test', 'test')
    expect(result.text).toBe('Name: Ron, Gender: male, Culture: Big Namer')
  })
})
