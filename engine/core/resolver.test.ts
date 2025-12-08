/**
 * Resolver Tests
 *
 * Tests for table and template reference resolution including
 * simple references, namespace resolution, and import aliases.
 */

import { describe, it, expect } from 'vitest'
import { resolveTableRef, resolveTemplateRef, type ResolverContext } from './resolver'
import type { LoadedCollection, RandomTableDocument, Table, Template } from '../types'

// ============================================================================
// Helper Functions
// ============================================================================

function createCollection(
  id: string,
  namespace: string,
  tables: Table[] = [],
  templates: Template[] = [],
  imports: Map<string, LoadedCollection> = new Map()
): LoadedCollection {
  const doc: RandomTableDocument = {
    metadata: {
      name: `Collection ${id}`,
      namespace,
      version: '1.0.0',
      specVersion: '1.0',
    },
    tables,
    templates,
  }

  const tableIndex = new Map<string, Table>()
  for (const table of tables) {
    tableIndex.set(table.id, table)
  }

  const templateIndex = new Map<string, Template>()
  for (const template of templates) {
    templateIndex.set(template.id, template)
  }

  return {
    id,
    document: doc,
    tableIndex,
    templateIndex,
    imports,
    isPreloaded: false,
    source: 'test',
  }
}

function createTable(id: string, name?: string): Table {
  return {
    id,
    name: name ?? `Table ${id}`,
    type: 'simple',
    entries: [{ value: 'Entry' }],
  }
}

function createTemplate(id: string, name?: string): Template {
  return {
    id,
    name: name ?? `Template ${id}`,
    pattern: 'Pattern',
  }
}

// ============================================================================
// Table Resolution Tests
// ============================================================================

describe('resolveTableRef', () => {
  describe('simple table ID resolution', () => {
    it('should resolve table in current collection', () => {
      const table = createTable('weapons')
      const collection = createCollection('main', 'test.namespace', [table])
      const ctx: ResolverContext = {
        collections: new Map([['main', collection]]),
      }

      const result = resolveTableRef('weapons', 'main', ctx)
      expect(result).toBeDefined()
      expect(result?.table.id).toBe('weapons')
      expect(result?.collectionId).toBe('main')
    })

    it('should return undefined for non-existent table', () => {
      const collection = createCollection('main', 'test.namespace')
      const ctx: ResolverContext = {
        collections: new Map([['main', collection]]),
      }

      const result = resolveTableRef('nonexistent', 'main', ctx)
      expect(result).toBeUndefined()
    })

    it('should prioritize current collection over others', () => {
      const tableInMain = createTable('weapons', 'Weapons (Main)')
      const tableInOther = createTable('weapons', 'Weapons (Other)')
      const mainCollection = createCollection('main', 'test.main', [tableInMain])
      const otherCollection = createCollection('other', 'test.other', [tableInOther])

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['other', otherCollection],
        ]),
      }

      const result = resolveTableRef('weapons', 'main', ctx)
      expect(result?.table.name).toBe('Weapons (Main)')
      expect(result?.collectionId).toBe('main')
    })

    it('should fall back to other collections if not in current', () => {
      const table = createTable('weapons')
      const mainCollection = createCollection('main', 'test.main')
      const otherCollection = createCollection('other', 'test.other', [table])

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['other', otherCollection],
        ]),
      }

      const result = resolveTableRef('weapons', 'main', ctx)
      expect(result?.table.id).toBe('weapons')
      expect(result?.collectionId).toBe('other')
    })
  })

  describe('alias resolution', () => {
    it('should resolve table via import alias', () => {
      const table = createTable('sword')
      const weaponsCollection = createCollection('weapons-collection', 'game.weapons', [table])
      const mainCollection = createCollection(
        'main',
        'game.main',
        [],
        [],
        new Map([['weapons', weaponsCollection]])
      )

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['weapons-collection', weaponsCollection],
        ]),
      }

      const result = resolveTableRef('weapons.sword', 'main', ctx)
      expect(result).toBeDefined()
      expect(result?.table.id).toBe('sword')
      expect(result?.collectionId).toBe('weapons-collection')
    })

    it('should return undefined for unknown alias', () => {
      const mainCollection = createCollection('main', 'test.main')
      const ctx: ResolverContext = {
        collections: new Map([['main', mainCollection]]),
      }

      const result = resolveTableRef('unknown.table', 'main', ctx)
      expect(result).toBeUndefined()
    })

    it('should prioritize alias over namespace', () => {
      const tableViaAlias = createTable('item', 'Item via Alias')
      const tableViaNamespace = createTable('item', 'Item via Namespace')

      const importedCollection = createCollection('imported', 'items', [tableViaAlias])
      const namespaceCollection = createCollection('namespace', 'items', [tableViaNamespace])
      const mainCollection = createCollection(
        'main',
        'test.main',
        [],
        [],
        new Map([['items', importedCollection]])
      )

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['imported', importedCollection],
          ['namespace', namespaceCollection],
        ]),
      }

      const result = resolveTableRef('items.item', 'main', ctx)
      expect(result?.table.name).toBe('Item via Alias')
      expect(result?.collectionId).toBe('imported')
    })
  })

  describe('namespace resolution', () => {
    it('should resolve table via namespace', () => {
      const table = createTable('sword')
      const weaponsCollection = createCollection('weapons-collection', 'game.weapons', [table])
      const mainCollection = createCollection('main', 'game.main')

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['weapons-collection', weaponsCollection],
        ]),
      }

      const result = resolveTableRef('game.weapons.sword', 'main', ctx)
      expect(result).toBeDefined()
      expect(result?.table.id).toBe('sword')
      expect(result?.collectionId).toBe('weapons-collection')
    })

    it('should handle multi-level namespace', () => {
      const table = createTable('fireball')
      const collection = createCollection('spells', 'game.magic.spells', [table])
      const mainCollection = createCollection('main', 'game.main')

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['spells', collection],
        ]),
      }

      const result = resolveTableRef('game.magic.spells.fireball', 'main', ctx)
      expect(result).toBeDefined()
      expect(result?.table.id).toBe('fireball')
    })

    it('should return undefined for non-matching namespace', () => {
      const table = createTable('sword')
      const collection = createCollection('weapons', 'game.weapons', [table])
      const mainCollection = createCollection('main', 'game.main')

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['weapons', collection],
        ]),
      }

      const result = resolveTableRef('game.armor.shield', 'main', ctx)
      expect(result).toBeUndefined()
    })
  })

  describe('import fallback resolution', () => {
    it('should resolve via document imports when imports map is not resolved', () => {
      const table = createTable('potion')
      const itemsCollection = createCollection('items-collection', 'game.items', [table])

      const mainDoc: RandomTableDocument = {
        metadata: {
          name: 'Main',
          namespace: 'game.main',
          version: '1.0.0',
          specVersion: '1.0',
        },
        imports: [{ alias: 'items', path: 'game.items' }],
        tables: [],
      }

      const mainCollection: LoadedCollection = {
        id: 'main',
        document: mainDoc,
        tableIndex: new Map(),
        templateIndex: new Map(),
        imports: new Map(), // Not resolved
        isPreloaded: false,
        source: 'test',
      }

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['items-collection', itemsCollection],
        ]),
      }

      const result = resolveTableRef('items.potion', 'main', ctx)
      expect(result).toBeDefined()
      expect(result?.table.id).toBe('potion')
      expect(result?.collectionId).toBe('items-collection')
    })

    it('should resolve via document imports by collection ID', () => {
      const table = createTable('armor')
      const armorCollection = createCollection('armor-id', 'different.namespace', [table])

      const mainDoc: RandomTableDocument = {
        metadata: {
          name: 'Main',
          namespace: 'game.main',
          version: '1.0.0',
          specVersion: '1.0',
        },
        imports: [{ alias: 'gear', path: 'armor-id' }],
        tables: [],
      }

      const mainCollection: LoadedCollection = {
        id: 'main',
        document: mainDoc,
        tableIndex: new Map(),
        templateIndex: new Map(),
        imports: new Map(),
        isPreloaded: false,
        source: 'test',
      }

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['armor-id', armorCollection],
        ]),
      }

      const result = resolveTableRef('gear.armor', 'main', ctx)
      expect(result).toBeDefined()
      expect(result?.table.id).toBe('armor')
    })
  })

  describe('edge cases', () => {
    it('should handle empty collections map', () => {
      const ctx: ResolverContext = {
        collections: new Map(),
      }

      const result = resolveTableRef('anything', 'nonexistent', ctx)
      expect(result).toBeUndefined()
    })

    it('should handle non-existent collection ID', () => {
      const collection = createCollection('main', 'test', [createTable('test')])
      const ctx: ResolverContext = {
        collections: new Map([['main', collection]]),
      }

      const result = resolveTableRef('test', 'nonexistent', ctx)
      // Should still find via fallback search
      expect(result).toBeDefined()
      expect(result?.collectionId).toBe('main')
    })

    it('should handle table ID with periods (not namespace)', () => {
      // Even though the ref contains dots, if no alias/namespace matches,
      // it should not find anything
      const collection = createCollection('main', 'test')
      const ctx: ResolverContext = {
        collections: new Map([['main', collection]]),
      }

      const result = resolveTableRef('some.dotted.ref', 'main', ctx)
      expect(result).toBeUndefined()
    })
  })
})

// ============================================================================
// Template Resolution Tests
// ============================================================================

describe('resolveTemplateRef', () => {
  describe('simple template ID resolution', () => {
    it('should resolve template in current collection', () => {
      const template = createTemplate('character')
      const collection = createCollection('main', 'test.namespace', [], [template])
      const ctx: ResolverContext = {
        collections: new Map([['main', collection]]),
      }

      const result = resolveTemplateRef('character', 'main', ctx)
      expect(result).toBeDefined()
      expect(result?.template.id).toBe('character')
      expect(result?.collectionId).toBe('main')
    })

    it('should return undefined for non-existent template', () => {
      const collection = createCollection('main', 'test.namespace')
      const ctx: ResolverContext = {
        collections: new Map([['main', collection]]),
      }

      const result = resolveTemplateRef('nonexistent', 'main', ctx)
      expect(result).toBeUndefined()
    })

    it('should prioritize current collection over others', () => {
      const templateInMain = createTemplate('character', 'Character (Main)')
      const templateInOther = createTemplate('character', 'Character (Other)')
      const mainCollection = createCollection('main', 'test.main', [], [templateInMain])
      const otherCollection = createCollection('other', 'test.other', [], [templateInOther])

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['other', otherCollection],
        ]),
      }

      const result = resolveTemplateRef('character', 'main', ctx)
      expect(result?.template.name).toBe('Character (Main)')
      expect(result?.collectionId).toBe('main')
    })

    it('should fall back to other collections if not in current', () => {
      const template = createTemplate('npc')
      const mainCollection = createCollection('main', 'test.main')
      const otherCollection = createCollection('other', 'test.other', [], [template])

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['other', otherCollection],
        ]),
      }

      const result = resolveTemplateRef('npc', 'main', ctx)
      expect(result?.template.id).toBe('npc')
      expect(result?.collectionId).toBe('other')
    })
  })

  describe('alias resolution', () => {
    it('should resolve template via import alias', () => {
      const template = createTemplate('hero')
      const charactersCollection = createCollection('characters-collection', 'game.characters', [], [template])
      const mainCollection = createCollection(
        'main',
        'game.main',
        [],
        [],
        new Map([['chars', charactersCollection]])
      )

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['characters-collection', charactersCollection],
        ]),
      }

      const result = resolveTemplateRef('chars.hero', 'main', ctx)
      expect(result).toBeDefined()
      expect(result?.template.id).toBe('hero')
      expect(result?.collectionId).toBe('characters-collection')
    })

    it('should prioritize alias over namespace', () => {
      const templateViaAlias = createTemplate('npc', 'NPC via Alias')
      const templateViaNamespace = createTemplate('npc', 'NPC via Namespace')

      const importedCollection = createCollection('imported', 'npcs', [], [templateViaAlias])
      const namespaceCollection = createCollection('namespace', 'npcs', [], [templateViaNamespace])
      const mainCollection = createCollection(
        'main',
        'test.main',
        [],
        [],
        new Map([['npcs', importedCollection]])
      )

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['imported', importedCollection],
          ['namespace', namespaceCollection],
        ]),
      }

      const result = resolveTemplateRef('npcs.npc', 'main', ctx)
      expect(result?.template.name).toBe('NPC via Alias')
    })
  })

  describe('namespace resolution', () => {
    it('should resolve template via namespace', () => {
      const template = createTemplate('encounter')
      const encountersCollection = createCollection('encounters', 'game.encounters', [], [template])
      const mainCollection = createCollection('main', 'game.main')

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['encounters', encountersCollection],
        ]),
      }

      const result = resolveTemplateRef('game.encounters.encounter', 'main', ctx)
      expect(result).toBeDefined()
      expect(result?.template.id).toBe('encounter')
    })

    it('should handle multi-level namespace', () => {
      const template = createTemplate('wizard')
      const collection = createCollection('chars', 'game.characters.classes', [], [template])
      const mainCollection = createCollection('main', 'game.main')

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['chars', collection],
        ]),
      }

      const result = resolveTemplateRef('game.characters.classes.wizard', 'main', ctx)
      expect(result).toBeDefined()
      expect(result?.template.id).toBe('wizard')
    })
  })

  describe('import fallback resolution', () => {
    it('should resolve via document imports when imports map is not resolved', () => {
      const template = createTemplate('villain')
      const npcsCollection = createCollection('npcs-collection', 'game.npcs', [], [template])

      const mainDoc: RandomTableDocument = {
        metadata: {
          name: 'Main',
          namespace: 'game.main',
          version: '1.0.0',
          specVersion: '1.0',
        },
        imports: [{ alias: 'npcs', path: 'game.npcs' }],
        tables: [],
        templates: [],
      }

      const mainCollection: LoadedCollection = {
        id: 'main',
        document: mainDoc,
        tableIndex: new Map(),
        templateIndex: new Map(),
        imports: new Map(),
        isPreloaded: false,
        source: 'test',
      }

      const ctx: ResolverContext = {
        collections: new Map([
          ['main', mainCollection],
          ['npcs-collection', npcsCollection],
        ]),
      }

      const result = resolveTemplateRef('npcs.villain', 'main', ctx)
      expect(result).toBeDefined()
      expect(result?.template.id).toBe('villain')
    })
  })

  describe('edge cases', () => {
    it('should handle empty collections map', () => {
      const ctx: ResolverContext = {
        collections: new Map(),
      }

      const result = resolveTemplateRef('anything', 'nonexistent', ctx)
      expect(result).toBeUndefined()
    })

    it('should handle collection with both tables and templates', () => {
      const table = createTable('race')
      const template = createTemplate('character')
      const collection = createCollection('main', 'test', [table], [template])

      const ctx: ResolverContext = {
        collections: new Map([['main', collection]]),
      }

      // Should find template, not table
      const templateResult = resolveTemplateRef('character', 'main', ctx)
      expect(templateResult?.template.id).toBe('character')

      // Should find table via table resolver
      const tableResult = resolveTableRef('race', 'main', ctx)
      expect(tableResult?.table.id).toBe('race')
    })
  })
})

// ============================================================================
// Cross-Reference Tests
// ============================================================================

describe('Cross-collection resolution', () => {
  it('should support complex multi-collection scenario', () => {
    const weaponTable = createTable('sword')
    const armorTable = createTable('shield')
    const characterTemplate = createTemplate('hero')

    const weaponsCollection = createCollection('weapons', 'game.items.weapons', [weaponTable])
    const armorCollection = createCollection('armor', 'game.items.armor', [armorTable])
    const charactersCollection = createCollection('characters', 'game.characters', [], [characterTemplate])

    const mainCollection = createCollection(
      'main',
      'game.main',
      [],
      [],
      new Map([
        ['weapons', weaponsCollection],
        ['armor', armorCollection],
        ['chars', charactersCollection],
      ])
    )

    const ctx: ResolverContext = {
      collections: new Map([
        ['main', mainCollection],
        ['weapons', weaponsCollection],
        ['armor', armorCollection],
        ['characters', charactersCollection],
      ]),
    }

    // Via alias
    expect(resolveTableRef('weapons.sword', 'main', ctx)?.table.id).toBe('sword')
    expect(resolveTableRef('armor.shield', 'main', ctx)?.table.id).toBe('shield')
    expect(resolveTemplateRef('chars.hero', 'main', ctx)?.template.id).toBe('hero')

    // Via namespace
    expect(resolveTableRef('game.items.weapons.sword', 'main', ctx)?.table.id).toBe('sword')
    expect(resolveTemplateRef('game.characters.hero', 'main', ctx)?.template.id).toBe('hero')
  })

  it('should handle same ID in multiple collections', () => {
    const weaponTable = createTable('item', 'Weapon Item')
    const armorTable = createTable('item', 'Armor Item')

    const weaponsCollection = createCollection('weapons', 'game.weapons', [weaponTable])
    const armorCollection = createCollection('armor', 'game.armor', [armorTable])

    const mainCollection = createCollection(
      'main',
      'game.main',
      [],
      [],
      new Map([
        ['weapons', weaponsCollection],
        ['armor', armorCollection],
      ])
    )

    const ctx: ResolverContext = {
      collections: new Map([
        ['main', mainCollection],
        ['weapons', weaponsCollection],
        ['armor', armorCollection],
      ]),
    }

    // Should resolve to correct collection based on alias
    expect(resolveTableRef('weapons.item', 'main', ctx)?.table.name).toBe('Weapon Item')
    expect(resolveTableRef('armor.item', 'main', ctx)?.table.name).toBe('Armor Item')
  })
})
