import {
  App,
  Component,
  Editor,
  MarkdownRenderer,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
  TFile,
  TAbstractFile,
  ItemView,
  FuzzySuggestModal,
  debounce,
  setIcon,
} from 'obsidian';

import { RandomTableEngine, TableInfo, TemplateInfo, RollOptions } from './engine/core';
import type { RandomTableDocument, RollResult } from './engine/types';
import type { RollTrace, TraceNode, TraceNodeType } from './engine/core/trace';

// ============================================================================
// Constants
// ============================================================================

export const VIEW_TYPE_ROLLER = 'rolldeo-roller-view';

/** Delay in ms to wait for view to be ready after opening a file */
const VIEW_READY_DELAY_MS = 100;

// ============================================================================
// Settings
// ============================================================================

interface RolldeoSettings {
  tablesFolder: string;
  historyLength: number;
  enableTrace: boolean;
  showDescriptions: boolean;
}

const DEFAULT_SETTINGS: RolldeoSettings = {
  tablesFolder: '',
  historyLength: 50,
  enableTrace: false,
  showDescriptions: true,
};

// ============================================================================
// Roll History Entry
// ============================================================================

interface RollHistoryEntry {
  timestamp: number;
  tableName: string;
  tableId: string;
  collectionId: string;
  collectionName: string;
  text: string;
  descriptions?: Array<{
    tableName: string;
    tableId: string;
    rolledValue: string;
    description: string;
  }>;
}

// ============================================================================
// Cursor Position Tracking
// ============================================================================

interface LastCursorPosition {
  file: TFile;
  line: number;
  ch: number;
}

// ============================================================================
// Main Plugin Class
// ============================================================================

export default class RolldeoPlugin extends Plugin {
  settings!: RolldeoSettings;
  engine!: RandomTableEngine;
  rollHistory: RollHistoryEntry[] = [];
  lastCursorPosition: LastCursorPosition | null = null;

  async onload() {
    await this.loadSettings();

    // Initialize the random table engine
    this.engine = new RandomTableEngine();

    // Register the roller view
    this.registerView(VIEW_TYPE_ROLLER, (leaf) => new RollerView(leaf, this));

    // Add ribbon icon
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Rolldeo is a brand name
    this.addRibbonIcon('dice', 'Open Rolldeo roller', () => {
      void this.activateView();
    });

    // Load collections from vault
    await this.loadCollectionsFromVault();

    // Watch for file changes
    this.registerEvent(
      this.app.vault.on('modify', (file) => this.onFileModify(file))
    );
    this.registerEvent(
      this.app.vault.on('create', (file) => this.onFileCreate(file))
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => this.onFileDelete(file))
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => this.onFileRename(file, oldPath))
    );

    // Track cursor position - save before switching away from markdown view
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        // Save position from the PREVIOUS active view before it changes
        // This is called AFTER the change, so we need to check all markdown leaves
        this.updateLastMarkdownLeaf();
      })
    );

    // Save position when editor content changes
    this.registerEvent(
      this.app.workspace.on('editor-change', (editor: Editor) => {
        this.saveCursorPositionFromEditor(editor);
      })
    );

    // Save position when file is opened
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file) {
          this.saveCursorPosition();
        }
      })
    );

    // Save position when layout changes (e.g., opening side panel)
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.updateLastMarkdownLeaf();
      })
    );

    // Add commands
    this.addCommand({
      id: 'open-roller',
      name: 'Open roller panel',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'roll-table',
      name: 'Roll on a table',
      callback: () => this.showTablePicker(),
    });

    this.addCommand({
      id: 'roll-and-insert',
      name: 'Roll table and insert at cursor',
      editorCallback: (editor: Editor) => {
        this.showTablePicker((result) => {
          editor.replaceSelection(result.text);
        });
      },
    });

    this.addCommand({
      id: 'reload-collections',
      name: 'Reload all table collections',
      callback: async () => {
        await this.loadCollectionsFromVault();
        new Notice('Rolldeo collections reloaded');
      },
    });

    // Add settings tab
    this.addSettingTab(new RolldeoSettingTab(this.app, this));

    // Save initial cursor position if we're in an editor
    this.saveCursorPosition();
  }

  onunload() {
    // Cleanup is handled automatically by Obsidian:
    // - Views registered with registerView() are cleaned up
    // - Events registered with registerEvent() are unsubscribed
    // - The engine instance will be garbage collected
  }

  // ==========================================================================
  // Cursor Position Tracking
  // ==========================================================================

  private saveCursorPosition() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file && view.editor) {
      const cursor = view.editor.getCursor();
      this.lastCursorPosition = {
        file: view.file,
        line: cursor.line,
        ch: cursor.ch,
      };
    }
  }

  private saveCursorPositionFromEditor(editor: Editor) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file) {
      const cursor = editor.getCursor();
      this.lastCursorPosition = {
        file: view.file,
        line: cursor.line,
        ch: cursor.ch,
      };
    }
  }

  /**
   * Scan all markdown leaves and update cursor position from any that have focus
   */
  private updateLastMarkdownLeaf() {
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    for (const leaf of leaves) {
      const view = leaf.view as MarkdownView;
      if (view && view.file && view.editor) {
        // Save from each markdown view we find - the most recent one matters
        const cursor = view.editor.getCursor();
        this.lastCursorPosition = {
          file: view.file,
          line: cursor.line,
          ch: cursor.ch,
        };
        // Don't break - we want the last one in the list which is often more recent
      }
    }
  }

  /**
   * Find the first available markdown editor (for when we don't have a saved position)
   */
  private findAnyMarkdownEditor(): { leaf: WorkspaceLeaf; view: MarkdownView } | null {
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    for (const leaf of leaves) {
      const view = leaf.view as MarkdownView;
      if (view && view.editor) {
        return { leaf, view };
      }
    }
    return null;
  }

  /**
   * Insert text at the last known cursor position, or copy to clipboard if unknown
   */
  async insertAtLastPosition(text: string): Promise<boolean> {
    // First, try the currently active editor
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.editor) {
      activeView.editor.replaceSelection(text);
      new Notice('Inserted at cursor');
      return true;
    }

    // Try to use the last known cursor position
    if (this.lastCursorPosition) {
      const { file, line, ch } = this.lastCursorPosition;

      // Find the leaf containing this file
      const leaves = this.app.workspace.getLeavesOfType('markdown');
      for (const leaf of leaves) {
        const view = leaf.view as MarkdownView;
        if (view && view.file?.path === file.path && view.editor) {
          // Found the file, set cursor and insert
          const pos = { line, ch };
          view.editor.setCursor(pos);
          view.editor.replaceSelection(text);
          new Notice('Inserted at last position');
          return true;
        }
      }

      // File might be closed, try to open it
      const leaf = this.app.workspace.getLeaf(false);
      if (leaf) {
        await leaf.openFile(file);

        // Small delay to ensure the view is ready
        await new Promise(resolve => setTimeout(resolve, VIEW_READY_DELAY_MS));

        const view = leaf.view as MarkdownView;
        if (view && view.editor) {
          const pos = { line, ch };
          view.editor.setCursor(pos);
          view.editor.replaceSelection(text);
          new Notice('Inserted at last position');
          return true;
        }
      }
    }

    // Try to find ANY open markdown editor as a last resort
    const anyEditor = this.findAnyMarkdownEditor();
    if (anyEditor) {
      anyEditor.view.editor.replaceSelection(text);
      new Notice('Inserted in open document');
      return true;
    }

    // Fallback: copy to clipboard
    await navigator.clipboard.writeText(text);
    new Notice('No editor found - copied to clipboard');
    return false;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ==========================================================================
  // Collection Management
  // ==========================================================================

  async loadCollectionsFromVault() {
    // Clear existing collections
    const existingIds = this.engine.listCollections().map((c) => c.id);
    for (const id of existingIds) {
      this.engine.unloadCollection(id);
    }

    // Get all JSON files
    const files = this.app.vault.getFiles().filter((f) => f.extension === 'json');

    // Filter by folder if configured
    const filteredFiles = this.settings.tablesFolder
      ? files.filter((f) => f.path.startsWith(this.settings.tablesFolder))
      : files;

    // Build path-to-ID map for import resolution
    const pathToIdMap = new Map<string, string>();

    for (const file of filteredFiles) {
      try {
        const content = await this.app.vault.read(file);
        const doc = JSON.parse(content) as RandomTableDocument;

        if (this.isRandomTableDocument(doc)) {
          this.engine.loadCollection(doc, file.path);
          pathToIdMap.set(file.path, file.path);

          // Also map by namespace for cross-file imports
          if (doc.metadata?.namespace) {
            pathToIdMap.set(doc.metadata.namespace, file.path);
          }
        }
      } catch {
        // Skip invalid files silently
      }
    }

    // Resolve imports between collections
    this.engine.resolveImports(pathToIdMap);
  }

  isRandomTableDocument(obj: unknown): obj is RandomTableDocument {
    if (
      typeof obj !== 'object' ||
      obj === null ||
      !('metadata' in obj) ||
      !('tables' in obj)
    ) {
      return false;
    }
    const metadata = (obj as { metadata: unknown }).metadata;
    return (
      typeof metadata === 'object' &&
      metadata !== null &&
      'specVersion' in metadata &&
      (metadata as { specVersion: unknown }).specVersion === '1.0'
    );
  }

  async onFileModify(file: TAbstractFile) {
    if (!(file instanceof TFile) || file.extension !== 'json') return;
    if (this.settings.tablesFolder && !file.path.startsWith(this.settings.tablesFolder)) return;

    try {
      const content = await this.app.vault.read(file);
      const doc = JSON.parse(content) as RandomTableDocument;

      if (this.isRandomTableDocument(doc)) {
        if (this.engine.hasCollection(file.path)) {
          this.engine.updateDocument(file.path, doc);
        } else {
          this.engine.loadCollection(doc, file.path);
        }
        this.engine.resolveImports();
        this.refreshView();
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  async onFileCreate(file: TAbstractFile) {
    if (!(file instanceof TFile) || file.extension !== 'json') return;
    if (this.settings.tablesFolder && !file.path.startsWith(this.settings.tablesFolder)) return;

    try {
      const content = await this.app.vault.read(file);
      const doc = JSON.parse(content) as RandomTableDocument;

      if (this.isRandomTableDocument(doc)) {
        this.engine.loadCollection(doc, file.path);
        this.engine.resolveImports();
        this.refreshView();
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  onFileDelete(file: TAbstractFile) {
    if (!(file instanceof TFile) || file.extension !== 'json') return;

    if (this.engine.hasCollection(file.path)) {
      this.engine.unloadCollection(file.path);
      this.engine.resolveImports();
      this.refreshView();
    }
  }

  async onFileRename(file: TAbstractFile, oldPath: string) {
    if (!(file instanceof TFile) || file.extension !== 'json') return;

    // Remove old collection
    if (this.engine.hasCollection(oldPath)) {
      this.engine.unloadCollection(oldPath);
    }

    // Add new collection
    try {
      const content = await this.app.vault.read(file);
      const doc = JSON.parse(content) as RandomTableDocument;

      if (this.isRandomTableDocument(doc)) {
        this.engine.loadCollection(doc, file.path);
        this.engine.resolveImports();
        this.refreshView();
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  // ==========================================================================
  // View Management
  // ==========================================================================

  async activateView() {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_ROLLER)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({ type: VIEW_TYPE_ROLLER, active: true });
      }
    }

    if (leaf) {
      void workspace.revealLeaf(leaf);
    }
  }

  refreshView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ROLLER);
    for (const leaf of leaves) {
      const view = leaf.view as RollerView;
      if (view && view.refresh) {
        view.refresh();
      }
    }
  }

  // ==========================================================================
  // Rolling
  // ==========================================================================

  roll(tableId: string, collectionId: string): RollResult {
    const options: RollOptions = {
      enableTrace: this.settings.enableTrace,
    };

    const result = this.engine.roll(tableId, collectionId, options);

    // Get collection name for history
    const collection = this.engine.getCollection(collectionId);
    const collectionName = collection?.document.metadata.name ?? collectionId;

    // Get table name for history
    const table = this.engine.getTable(tableId, collectionId);
    const tableName = table?.name ?? tableId;

    // Add to history
    this.addToHistory({
      timestamp: Date.now(),
      tableName,
      tableId,
      collectionId,
      collectionName,
      text: result.text,
      descriptions: result.descriptions,
    });

    return result;
  }

  rollTemplate(templateId: string, collectionId: string): RollResult {
    const options: RollOptions = {
      enableTrace: this.settings.enableTrace,
    };

    const result = this.engine.rollTemplate(templateId, collectionId, options);

    // Get collection name for history
    const collection = this.engine.getCollection(collectionId);
    const collectionName = collection?.document.metadata.name ?? collectionId;

    // Get template name for history
    const template = this.engine.getTemplate(templateId, collectionId);
    const templateName = template?.name ?? templateId;

    // Add to history
    this.addToHistory({
      timestamp: Date.now(),
      tableName: templateName,
      tableId: templateId,
      collectionId,
      collectionName,
      text: result.text,
      descriptions: result.descriptions,
    });

    return result;
  }

  addToHistory(entry: RollHistoryEntry) {
    this.rollHistory.unshift(entry);
    if (this.rollHistory.length > this.settings.historyLength) {
      this.rollHistory.pop();
    }
    this.refreshView();
  }

  // ==========================================================================
  // Table Picker
  // ==========================================================================

  showTablePicker(onSelect?: (result: RollResult) => void) {
    new TablePickerModal(this.app, this, onSelect).open();
  }
}

// ============================================================================
// Roller View (Side Panel)
// ============================================================================

class RollerView extends ItemView {
  plugin: RolldeoPlugin;
  private containerEl_content!: HTMLElement;
  private searchQuery: string = '';
  private expandedCollections: Set<string> = new Set(); // Collections are collapsed by default
  private expandedTableSections: Set<string> = new Set(); // Tables are collapsed by default
  private activeTab: 'browser' | 'history' = 'browser';
  private component: Component;

  constructor(leaf: WorkspaceLeaf, plugin: RolldeoPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.component = new Component();
  }

  getViewType(): string {
    return VIEW_TYPE_ROLLER;
  }

  getDisplayText(): string {
    return 'Rolldeo roller';
  }

  getIcon(): string {
    return 'dice';
  }

  async onOpen() {
    this.containerEl_content = this.containerEl.children[1] as HTMLElement;
    this.containerEl_content.empty();
    this.containerEl_content.addClass('rolldeo-view');
    this.component.load();

    this.render();
  }

  async onClose() {
    this.component.unload();
    this.containerEl_content.empty();
  }

  refresh() {
    this.render();
  }

  private render() {
    const container = this.containerEl_content;
    container.empty();

    // Header with tabs
    const header = container.createDiv({ cls: 'rolldeo-header' });

    const tabBar = header.createDiv({ cls: 'rolldeo-tabs' });

    const browserTab = tabBar.createDiv({
      cls: `rolldeo-tab ${this.activeTab === 'browser' ? 'is-active' : ''}`,
      text: 'Tables'
    });
    browserTab.onclick = () => {
      this.activeTab = 'browser';
      this.render();
    };

    const historyTab = tabBar.createDiv({
      cls: `rolldeo-tab ${this.activeTab === 'history' ? 'is-active' : ''}`,
    });
    historyTab.createSpan({ text: 'History' });
    if (this.plugin.rollHistory.length > 0) {
      historyTab.createSpan({
        cls: 'rolldeo-tab-badge',
        text: String(this.plugin.rollHistory.length)
      });
    }
    historyTab.onclick = () => {
      this.activeTab = 'history';
      this.render();
    };

    // Quick roll button in header
    const quickRollBtn = header.createEl('button', {
      cls: 'rolldeo-quick-roll-btn',
    });
    setIcon(quickRollBtn, 'search');
    quickRollBtn.createSpan({ text: ' Search & Roll' });
    quickRollBtn.onclick = () => this.plugin.showTablePicker();

    // Content area
    const content = container.createDiv({ cls: 'rolldeo-content' });

    if (this.activeTab === 'browser') {
      this.renderBrowserTab(content);
    } else {
      this.renderHistoryTab(content);
    }
  }

  private renderBrowserTab(container: HTMLElement) {
    // Search/filter input
    const searchContainer = container.createDiv({ cls: 'rolldeo-search-container' });
    const searchInput = searchContainer.createEl('input', {
      cls: 'rolldeo-search-input',
      attr: {
        type: 'text',
        placeholder: 'Filter tables...',
        value: this.searchQuery,
      },
    });

    const clearBtn = searchContainer.createDiv({ cls: 'rolldeo-search-clear' });
    setIcon(clearBtn, 'x');
    clearBtn.style.display = this.searchQuery ? 'flex' : 'none';
    clearBtn.onclick = () => {
      this.searchQuery = '';
      this.render();
    };

    searchInput.oninput = debounce((e: Event) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      this.renderCollectionBrowser(browserContent, this.searchQuery);
      clearBtn.style.display = this.searchQuery ? 'flex' : 'none';
    }, 150, true);

    // Browser content
    const browserContent = container.createDiv({ cls: 'rolldeo-browser' });
    this.renderCollectionBrowser(browserContent, this.searchQuery);
  }

  private renderCollectionBrowser(container: HTMLElement, filterQuery: string = '') {
    container.empty();

    const collections = this.plugin.engine.listCollections();
    const query = filterQuery.toLowerCase().trim();

    if (collections.length === 0) {
      const emptyState = container.createDiv({ cls: 'rolldeo-empty-state' });
      const icon = emptyState.createDiv({ cls: 'rolldeo-empty-icon' });
      setIcon(icon, 'folder-open');
      emptyState.createEl('p', { text: 'No table collections found' });
      emptyState.createEl('p', {
        cls: 'rolldeo-empty-hint',
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- specVersion is a JSON property name
        text: 'Add .json files with specVersion: "1.0" to your vault'
      });
      return;
    }

    let hasResults = false;

    for (const collection of collections) {
      const tables = this.plugin.engine.listTables(collection.id);
      const templates = this.plugin.engine.listTemplates(collection.id);

      // Filter tables and templates based on query
      const filteredTables = query
        ? tables.filter(t =>
            t.name.toLowerCase().includes(query) ||
            t.id.toLowerCase().includes(query) ||
            t.description?.toLowerCase().includes(query) ||
            t.tags?.some(tag => tag.toLowerCase().includes(query))
          )
        : tables;

      const filteredTemplates = query
        ? templates.filter(t =>
            t.name.toLowerCase().includes(query) ||
            t.id.toLowerCase().includes(query) ||
            t.description?.toLowerCase().includes(query) ||
            t.tags?.some(tag => tag.toLowerCase().includes(query))
          )
        : templates;

      // Skip collection if no matches
      if (query && filteredTables.length === 0 && filteredTemplates.length === 0) {
        continue;
      }

      hasResults = true;
      const isCollapsed = !this.expandedCollections.has(collection.id);

      const collectionDiv = container.createDiv({ cls: 'rolldeo-collection' });

      // Collection header
      const collectionHeader = collectionDiv.createDiv({ cls: 'rolldeo-collection-header' });

      const collapseIcon = collectionHeader.createSpan({ cls: 'rolldeo-collapse-icon' });
      setIcon(collapseIcon, isCollapsed ? 'chevron-right' : 'chevron-down');

      const headerInfo = collectionHeader.createDiv({ cls: 'rolldeo-collection-info' });
      headerInfo.createSpan({ cls: 'rolldeo-collection-name', text: collection.name });

      const counts = [];
      if (filteredTables.length > 0) counts.push(`${filteredTables.length} table${filteredTables.length !== 1 ? 's' : ''}`);
      if (filteredTemplates.length > 0) counts.push(`${filteredTemplates.length} template${filteredTemplates.length !== 1 ? 's' : ''}`);

      headerInfo.createSpan({
        cls: 'rolldeo-collection-count',
        text: counts.join(', ')
      });

      // Collection content
      const collectionContent = collectionDiv.createDiv({
        cls: 'rolldeo-collection-content',
      });
      collectionContent.style.display = isCollapsed ? 'none' : 'block';

      // Templates section (shown first, no header needed)
      if (filteredTemplates.length > 0) {
        for (const template of filteredTemplates) {
          this.renderTableItem(collectionContent, template, collection.id, 'template');
        }
      }

      // Tables section (collapsible, collapsed by default)
      if (filteredTables.length > 0) {
        const tablesKey = `${collection.id}:tables`;
        // Tables are collapsed by default - only show if explicitly expanded
        const tablesCollapsed = !this.expandedTableSections.has(tablesKey);

        const tablesSection = collectionContent.createDiv({ cls: 'rolldeo-tables-section' });

        const tablesHeader = tablesSection.createDiv({ cls: 'rolldeo-tables-header' });
        const tablesCollapseIcon = tablesHeader.createSpan({ cls: 'rolldeo-collapse-icon' });
        setIcon(tablesCollapseIcon, tablesCollapsed ? 'chevron-right' : 'chevron-down');
        tablesHeader.createSpan({
          cls: 'rolldeo-tables-header-text',
          text: `Tables (${filteredTables.length})`
        });

        const tablesContent = tablesSection.createDiv({ cls: 'rolldeo-tables-content' });
        tablesContent.style.display = tablesCollapsed ? 'none' : 'block';

        for (const table of filteredTables) {
          this.renderTableItem(tablesContent, table, collection.id, 'table');
        }

        tablesHeader.onclick = (e) => {
          e.stopPropagation();
          if (this.expandedTableSections.has(tablesKey)) {
            this.expandedTableSections.delete(tablesKey);
          } else {
            this.expandedTableSections.add(tablesKey);
          }
          this.render();
        };
      }

      // Toggle collapse
      collectionHeader.onclick = () => {
        if (this.expandedCollections.has(collection.id)) {
          this.expandedCollections.delete(collection.id);
        } else {
          this.expandedCollections.add(collection.id);
        }
        this.render();
      };
    }

    // No results state
    if (!hasResults && query) {
      const noResults = container.createDiv({ cls: 'rolldeo-no-results' });
      noResults.createEl('p', { text: `No tables matching "${query}"` });
      const clearLink = noResults.createEl('a', { text: 'Clear filter' });
      clearLink.onclick = () => {
        this.searchQuery = '';
        this.render();
      };
    }
  }

  private renderTableItem(
    container: HTMLElement,
    item: TableInfo | TemplateInfo,
    collectionId: string,
    type: 'table' | 'template'
  ) {
    const tableItem = container.createDiv({ cls: 'rolldeo-table-item' });

    // Roll icon (left side) - rolls and shows result modal
    const rollIcon = tableItem.createDiv({
      cls: 'rolldeo-table-roll-icon',
      attr: { title: 'Roll and view result' }
    });
    setIcon(rollIcon, 'dices');
    rollIcon.onclick = (e) => {
      e.stopPropagation();
      try {
        const result = type === 'template'
          ? this.plugin.rollTemplate(item.id, collectionId)
          : this.plugin.roll(item.id, collectionId);

        // Get collection name for the modal
        const collection = this.plugin.engine.getCollection(collectionId);
        const collectionName = collection?.document.metadata.name ?? collectionId;

        new RollResultModal(
          this.plugin.app,
          this.plugin,
          result,
          item.name,
          collectionName,
          item.id,
          collectionId,
          type === 'template'
        ).open();
      } catch (error) {
        console.error('Rolldeo: Error rolling table', error);
        new Notice(`Error rolling "${item.name}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };

    // Info
    const info = tableItem.createDiv({ cls: 'rolldeo-table-info' });
    info.createDiv({ cls: 'rolldeo-table-name', text: item.name });

    if (item.description) {
      info.createDiv({
        cls: 'rolldeo-table-desc',
        text: item.description
      });
    }

    // Tags
    if (item.tags && item.tags.length > 0) {
      const tagsDiv = info.createDiv({ cls: 'rolldeo-table-tags' });
      for (const tag of item.tags.slice(0, 3)) {
        tagsDiv.createSpan({ cls: 'rolldeo-tag', text: tag });
      }
      if (item.tags.length > 3) {
        tagsDiv.createSpan({ cls: 'rolldeo-tag-more', text: `+${item.tags.length - 3}` });
      }
    }

    // Insert button (right side) - rolls and inserts at last cursor position
    const insertBtn = tableItem.createEl('button', {
      cls: 'rolldeo-insert-btn',
      attr: { title: 'Roll and insert at cursor' }
    });
    setIcon(insertBtn, 'text-cursor-input');

    insertBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        const result = type === 'template'
          ? this.plugin.rollTemplate(item.id, collectionId)
          : this.plugin.roll(item.id, collectionId);
        await this.plugin.insertAtLastPosition(result.text);
      } catch (error) {
        console.error('Rolldeo: Error rolling table', error);
        new Notice(`Error rolling "${item.name}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
  }

  private renderHistoryTab(container: HTMLElement) {
    if (this.plugin.rollHistory.length === 0) {
      const emptyState = container.createDiv({ cls: 'rolldeo-empty-state' });
      const icon = emptyState.createDiv({ cls: 'rolldeo-empty-icon' });
      setIcon(icon, 'history');
      emptyState.createEl('p', { text: 'No rolls yet' });
      emptyState.createEl('p', {
        cls: 'rolldeo-empty-hint',
        text: 'Roll on a table to see results here'
      });
      return;
    }

    // Clear history button
    const historyHeader = container.createDiv({ cls: 'rolldeo-history-header' });
    const clearBtn = historyHeader.createEl('button', {
      cls: 'rolldeo-clear-history-btn',
      text: 'Clear history',
    });
    clearBtn.onclick = () => {
      this.plugin.rollHistory = [];
      this.render();
    };

    const historyList = container.createDiv({ cls: 'rolldeo-history-list' });

    for (const entry of this.plugin.rollHistory) {
      void this.renderHistoryItem(historyList, entry);
    }
  }

  private async renderHistoryItem(container: HTMLElement, entry: RollHistoryEntry) {
    const historyItem = container.createDiv({ cls: 'rolldeo-history-item' });

    // Header
    const header = historyItem.createDiv({ cls: 'rolldeo-history-item-header' });

    const titleArea = header.createDiv({ cls: 'rolldeo-history-title' });
    const icon = titleArea.createSpan({ cls: 'rolldeo-history-icon' });
    setIcon(icon, 'dices');
    titleArea.createSpan({ cls: 'rolldeo-history-table-name', text: entry.tableName });
    titleArea.createSpan({ cls: 'rolldeo-history-collection', text: entry.collectionName });

    header.createSpan({
      cls: 'rolldeo-history-time',
      text: this.formatTime(entry.timestamp),
    });

    // Result text - render as markdown
    const resultDiv = historyItem.createDiv({ cls: 'rolldeo-history-result' });
    await MarkdownRenderer.render(
      this.plugin.app,
      entry.text,
      resultDiv,
      '',
      this.component
    );

    // Descriptions (rendered as markdown)
    if (this.plugin.settings.showDescriptions && entry.descriptions && entry.descriptions.length > 0) {
      const descriptionsDiv = historyItem.createDiv({ cls: 'rolldeo-history-descriptions' });

      for (const desc of entry.descriptions) {
        const descItem = descriptionsDiv.createDiv({ cls: 'rolldeo-description-item' });

        const descHeader = descItem.createDiv({ cls: 'rolldeo-description-header' });
        descHeader.createSpan({ cls: 'rolldeo-description-table', text: desc.tableName });
        descHeader.createSpan({ cls: 'rolldeo-description-value', text: desc.rolledValue });

        const descContent = descItem.createDiv({ cls: 'rolldeo-description-content' });
        await MarkdownRenderer.render(
          this.plugin.app,
          desc.description,
          descContent,
          '',
          this.component
        );
      }
    }

    // Actions
    const actions = historyItem.createDiv({ cls: 'rolldeo-history-actions' });

    const rerollBtn = actions.createEl('button', {
      cls: 'rolldeo-action-btn',
      attr: { title: 'Roll again' },
    });
    setIcon(rerollBtn, 'rotate-ccw');
    rerollBtn.onclick = () => {
      try {
        const result = this.plugin.roll(entry.tableId, entry.collectionId);
        new Notice(result.text);
      } catch (error) {
        console.error('Rolldeo: Error re-rolling table', error);
        new Notice(`Error re-rolling "${entry.tableName}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };

    const copyBtn = actions.createEl('button', {
      cls: 'rolldeo-action-btn',
      attr: { title: 'Copy to clipboard' },
    });
    setIcon(copyBtn, 'copy');
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(entry.text);
        new Notice('Copied to clipboard');
      } catch (error) {
        console.error('Rolldeo: Error copying to clipboard', error);
        new Notice('Error copying to clipboard');
      }
    };

    const insertBtn = actions.createEl('button', {
      cls: 'rolldeo-action-btn',
      attr: { title: 'Insert at last cursor position (or copy to clipboard)' },
    });
    setIcon(insertBtn, 'text-cursor-input');
    insertBtn.onclick = async () => {
      try {
        await this.plugin.insertAtLastPosition(entry.text);
      } catch (error) {
        console.error('Rolldeo: Error inserting text', error);
        new Notice(`Error inserting text: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
  }

  private formatTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    // Less than a minute
    if (diff < 60000) {
      return 'Just now';
    }

    // Less than an hour
    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
    }

    // Less than a day
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }

    // Show date
    const date = new Date(timestamp);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

// ============================================================================
// Table Picker Modal
// ============================================================================

// ============================================================================
// Roll Result Modal
// ============================================================================

class RollResultModal extends Modal {
  private plugin: RolldeoPlugin;
  private result: RollResult;
  private tableName: string;
  private collectionName: string;
  private tableId: string;
  private collectionId: string;
  private isTemplate: boolean;
  private component: Component;
  private activeTab: 'descriptions' | 'trace' | null = 'descriptions';
  private expandedTraceNodes: Set<string> = new Set();
  private allTraceExpanded: boolean = false;
  private traceTreeContainer: HTMLElement | null = null;

  constructor(
    app: App,
    plugin: RolldeoPlugin,
    result: RollResult,
    tableName: string,
    collectionName: string,
    tableId: string,
    collectionId: string,
    isTemplate: boolean
  ) {
    super(app);
    this.plugin = plugin;
    this.result = result;
    this.tableName = tableName;
    this.collectionName = collectionName;
    this.tableId = tableId;
    this.collectionId = collectionId;
    this.isTemplate = isTemplate;
    this.component = new Component();
  }

  async onOpen() {
    this.component.load();
    await this.renderModal();
  }

  private async renderModal() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('rolldeo-result-modal');

    // Header
    const header = contentEl.createDiv({ cls: 'rolldeo-result-header' });
    const titleArea = header.createDiv({ cls: 'rolldeo-result-title' });
    const icon = titleArea.createSpan({ cls: 'rolldeo-result-icon' });
    setIcon(icon, 'dices');
    titleArea.createSpan({ cls: 'rolldeo-result-table-name', text: this.tableName });
    header.createSpan({ cls: 'rolldeo-result-collection', text: this.collectionName });

    // Result content - rendered as markdown
    const resultContent = contentEl.createDiv({ cls: 'rolldeo-result-content' });
    await MarkdownRenderer.render(
      this.app,
      this.result.text,
      resultContent,
      '',
      this.component
    );

    // Check if we have descriptions or trace to show tabs
    const hasDescriptions = this.plugin.settings.showDescriptions &&
      this.result.descriptions && this.result.descriptions.length > 0;
    const hasTrace = this.plugin.settings.enableTrace && this.result.trace;

    // Auto-switch to trace tab if no descriptions but trace is available
    if (!hasDescriptions && hasTrace && this.activeTab === 'descriptions') {
      this.activeTab = 'trace';
    }

    // Tabs (only show if we have either descriptions or trace)
    if (hasDescriptions || hasTrace) {
      const tabsContainer = contentEl.createDiv({ cls: 'rolldeo-result-tabs' });

      if (hasDescriptions) {
        const descTab = tabsContainer.createDiv({
          cls: `rolldeo-result-tab ${this.activeTab === 'descriptions' ? 'is-active' : ''}`,
        });
        const descIcon = descTab.createSpan({ cls: 'rolldeo-result-tab-icon' });
        setIcon(descIcon, 'list');
        descTab.createSpan({ text: 'Descriptions' });
        const descCount = tabsContainer.createSpan({
          cls: 'rolldeo-result-tab-badge',
          text: String(this.result.descriptions?.length || 0)
        });
        descTab.appendChild(descCount);
        descTab.onclick = () => {
          // Toggle: collapse if already active, otherwise switch to this tab
          this.activeTab = this.activeTab === 'descriptions' ? null : 'descriptions';
          void this.renderModal();
        };
      }

      if (hasTrace) {
        const traceTab = tabsContainer.createDiv({
          cls: `rolldeo-result-tab ${this.activeTab === 'trace' ? 'is-active' : ''}`,
        });
        const traceIcon = traceTab.createSpan({ cls: 'rolldeo-result-tab-icon' });
        setIcon(traceIcon, 'git-branch');
        traceTab.createSpan({ text: 'Trace' });
        const traceCount = traceTab.createSpan({
          cls: 'rolldeo-result-tab-badge',
          text: String(this.result.trace?.stats.nodeCount || 0)
        });
        traceTab.appendChild(traceCount);
        traceTab.onclick = () => {
          // Toggle: collapse if already active, otherwise switch to this tab
          this.activeTab = this.activeTab === 'trace' ? null : 'trace';
          void this.renderModal();
        };
      }

      // Tab content (only render if a tab is active)
      if (this.activeTab !== null) {
        const tabContent = contentEl.createDiv({ cls: 'rolldeo-result-tab-content' });

        if (this.activeTab === 'descriptions' && hasDescriptions) {
          await this.renderDescriptionsTab(tabContent);
        } else if (this.activeTab === 'trace' && hasTrace) {
          this.renderTraceTab(tabContent, this.result.trace!);
        }
      }
    }

    // Actions
    const actions = contentEl.createDiv({ cls: 'rolldeo-result-actions' });

    // Re-roll button
    const rerollBtn = actions.createEl('button', { cls: 'rolldeo-result-action-btn' });
    setIcon(rerollBtn, 'rotate-ccw');
    rerollBtn.createSpan({ text: ' Roll Again' });
    rerollBtn.onclick = async () => {
      try {
        const newResult = this.isTemplate
          ? this.plugin.rollTemplate(this.tableId, this.collectionId)
          : this.plugin.roll(this.tableId, this.collectionId);
        this.result = newResult;
        this.expandedTraceNodes.clear();
        this.allTraceExpanded = false;
        await this.renderModal();
      } catch (error) {
        console.error('Rolldeo: Error re-rolling', error);
        new Notice(`Error re-rolling: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };

    // Copy button
    const copyBtn = actions.createEl('button', { cls: 'rolldeo-result-action-btn' });
    setIcon(copyBtn, 'copy');
    copyBtn.createSpan({ text: ' Copy' });
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(this.result.text);
        new Notice('Copied to clipboard');
      } catch (error) {
        console.error('Rolldeo: Error copying to clipboard', error);
        new Notice('Error copying to clipboard');
      }
    };

    // Insert button
    const insertBtn = actions.createEl('button', { cls: 'rolldeo-result-action-btn mod-cta' });
    setIcon(insertBtn, 'text-cursor-input');
    insertBtn.createSpan({ text: ' Insert' });
    insertBtn.onclick = async () => {
      try {
        await this.plugin.insertAtLastPosition(this.result.text);
        this.close();
      } catch (error) {
        console.error('Rolldeo: Error inserting text', error);
        new Notice(`Error inserting text: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
  }

  private async renderDescriptionsTab(container: HTMLElement) {
    if (!this.result.descriptions) return;

    for (const desc of this.result.descriptions) {
      const descItem = container.createDiv({ cls: 'rolldeo-result-description-item' });
      const descHeader = descItem.createDiv({ cls: 'rolldeo-result-description-header' });
      descHeader.createSpan({ cls: 'rolldeo-result-description-table', text: desc.tableName });
      descHeader.createSpan({ cls: 'rolldeo-result-description-value', text: desc.rolledValue });

      const descContent = descItem.createDiv({ cls: 'rolldeo-result-description-content' });
      await MarkdownRenderer.render(
        this.app,
        desc.description,
        descContent,
        '',
        this.component
      );
    }
  }

  private renderTraceTab(container: HTMLElement, trace: RollTrace) {
    // Trace header with controls
    const traceHeader = container.createDiv({ cls: 'rolldeo-trace-header' });

    const traceTitle = traceHeader.createDiv({ cls: 'rolldeo-trace-title' });
    const traceIcon = traceTitle.createSpan({ cls: 'rolldeo-trace-title-icon' });
    setIcon(traceIcon, 'git-branch');
    traceTitle.createSpan({
      text: `Execution Trace`,
      cls: 'rolldeo-trace-title-text'
    });
    traceTitle.createSpan({
      cls: 'rolldeo-trace-ops',
      text: `(${trace.stats.nodeCount} ops, ${trace.totalTime}ms)`
    });

    // Expand/Collapse controls
    const traceControls = traceHeader.createDiv({ cls: 'rolldeo-trace-controls' });

    const expandAllBtn = traceControls.createEl('button', {
      cls: 'rolldeo-trace-control-btn',
      text: 'Expand all'
    });
    expandAllBtn.onclick = () => {
      this.expandAllNodes(trace.root);
      this.allTraceExpanded = true;
      this.rerenderTraceTree(trace);
    };

    const collapseBtn = traceControls.createEl('button', {
      cls: 'rolldeo-trace-control-btn',
      text: 'Collapse'
    });
    collapseBtn.onclick = () => {
      this.expandedTraceNodes.clear();
      this.allTraceExpanded = false;
      this.rerenderTraceTree(trace);
    };

    // Trace tree
    this.traceTreeContainer = container.createDiv({ cls: 'rolldeo-trace-tree' });
    this.renderTraceNode(this.traceTreeContainer, trace.root, 0, trace);

    // Variables section (if any)
    if (trace.stats.variablesAccessed.length > 0) {
      const varsSection = container.createDiv({ cls: 'rolldeo-trace-vars-section' });
      for (const varName of trace.stats.variablesAccessed) {
        const varItem = varsSection.createDiv({ cls: 'rolldeo-trace-var-item' });
        const varIcon = varItem.createSpan({ cls: 'rolldeo-trace-var-icon' });
        setIcon(varIcon, 'hash');
        varItem.createSpan({ cls: 'rolldeo-trace-var-name', text: varName });
      }
    }

    // Stats footer
    const statsFooter = container.createDiv({ cls: 'rolldeo-trace-stats' });
    statsFooter.createSpan({ text: `Tables: ${trace.stats.tablesAccessed.length}` });
    statsFooter.createSpan({ text: `Variables: ${trace.stats.variablesAccessed.length}` });
    statsFooter.createSpan({ text: `Depth: ${trace.stats.maxDepth}` });
  }

  private rerenderTraceTree(trace: RollTrace) {
    if (!this.traceTreeContainer) return;

    // Save scroll position of the tab content container
    const tabContent = this.traceTreeContainer.closest('.rolldeo-result-tab-content') as HTMLElement;
    const scrollTop = tabContent?.scrollTop || 0;

    // Re-render just the trace tree
    this.traceTreeContainer.empty();
    this.renderTraceNode(this.traceTreeContainer, trace.root, 0, trace);

    // Restore scroll position
    if (tabContent) {
      tabContent.scrollTop = scrollTop;
    }
  }

  private expandAllNodes(node: TraceNode) {
    this.expandedTraceNodes.add(node.id);
    for (const child of node.children) {
      this.expandAllNodes(child);
    }
  }

  private renderTraceNode(container: HTMLElement, node: TraceNode, depth: number, trace: RollTrace) {
    const hasChildren = node.children.length > 0;
    const isExpanded = this.expandedTraceNodes.has(node.id);

    const nodeEl = container.createDiv({
      cls: `rolldeo-trace-node ${hasChildren ? 'has-children' : ''} ${isExpanded ? 'is-expanded' : ''}`,
    });
    nodeEl.style.setProperty('--depth', String(depth));

    // Node header (clickable if has children)
    const nodeHeader = nodeEl.createDiv({ cls: 'rolldeo-trace-node-header' });

    // Collapse indicator
    if (hasChildren) {
      const collapseIcon = nodeHeader.createSpan({ cls: 'rolldeo-trace-collapse-icon' });
      setIcon(collapseIcon, isExpanded ? 'chevron-down' : 'chevron-right');
    } else {
      nodeHeader.createSpan({ cls: 'rolldeo-trace-collapse-spacer' });
    }

    // Node type icon
    const typeIcon = nodeHeader.createSpan({ cls: `rolldeo-trace-type-icon rolldeo-trace-type-${node.type}` });
    setIcon(typeIcon, this.getTraceNodeIcon(node.type));

    // Node label
    nodeHeader.createSpan({ cls: 'rolldeo-trace-node-label', text: node.label });

    // Node output (abbreviated)
    const outputText = String(node.output.value);
    if (outputText && outputText !== node.label) {
      const outputEl = nodeHeader.createSpan({ cls: 'rolldeo-trace-node-output' });
      outputEl.createSpan({ text: '→ ' });
      outputEl.createSpan({ text: outputText.length > 50 ? outputText.slice(0, 50) + '...' : outputText });
    }

    // Duration badge
    if (node.duration !== undefined && node.duration > 0) {
      nodeHeader.createSpan({
        cls: 'rolldeo-trace-node-duration',
        text: `${node.duration}ms`
      });
    }

    // Toggle expansion on click
    if (hasChildren) {
      nodeHeader.onclick = (e) => {
        e.stopPropagation();
        if (this.expandedTraceNodes.has(node.id)) {
          this.expandedTraceNodes.delete(node.id);
        } else {
          this.expandedTraceNodes.add(node.id);
        }
        this.rerenderTraceTree(trace);
      };
    }

    // Node details (shown when selected - for now show inline if expanded)
    if (isExpanded && hasChildren) {
      // Show details panel for selected node
      const detailsPanel = nodeEl.createDiv({ cls: 'rolldeo-trace-node-details' });

      if (node.label !== 'Root') {
        const labelRow = detailsPanel.createDiv({ cls: 'rolldeo-trace-detail-row' });
        labelRow.createSpan({ cls: 'rolldeo-trace-detail-label', text: 'Label:' });
        labelRow.createSpan({ cls: 'rolldeo-trace-detail-value', text: node.label });
      }

      const outputRow = detailsPanel.createDiv({ cls: 'rolldeo-trace-detail-row' });
      outputRow.createSpan({ cls: 'rolldeo-trace-detail-label', text: 'Output:' });
      outputRow.createSpan({ cls: 'rolldeo-trace-detail-value', text: String(node.output.value) });

      const inputRow = detailsPanel.createDiv({ cls: 'rolldeo-trace-detail-row' });
      inputRow.createSpan({ cls: 'rolldeo-trace-detail-label', text: 'Input:' });
      inputRow.createSpan({ cls: 'rolldeo-trace-detail-value', text: node.input.raw || '(none)' });

      const typeRow = detailsPanel.createDiv({ cls: 'rolldeo-trace-detail-row' });
      typeRow.createSpan({ cls: 'rolldeo-trace-detail-label', text: 'Type:' });
      const typeValue = typeRow.createSpan({ cls: 'rolldeo-trace-detail-value rolldeo-trace-type-badge' });
      typeValue.createSpan({ cls: `rolldeo-trace-type-${node.type}`, text: node.type });

      // Children container
      const childrenContainer = nodeEl.createDiv({ cls: 'rolldeo-trace-children' });
      for (const child of node.children) {
        this.renderTraceNode(childrenContainer, child, depth + 1, trace);
      }
    }
  }

  private getTraceNodeIcon(type: TraceNodeType): string {
    const iconMap: Record<TraceNodeType, string> = {
      'root': 'play',
      'table_roll': 'table-2',
      'template_roll': 'file-text',
      'template_ref': 'link',
      'entry_select': 'check-circle-2',
      'expression': 'code',
      'dice_roll': 'dices',
      'math_eval': 'calculator',
      'variable_access': 'hash',
      'placeholder_access': 'at-sign',
      'conditional': 'git-branch',
      'multi_roll': 'repeat',
      'instance': 'box',
      'composite_select': 'layers',
      'collection_merge': 'merge',
      'capture_multi_roll': 'archive',
      'capture_access': 'hash',
      'collect': 'list',
    };
    return iconMap[type] || 'circle';
  }

  private async refreshContent() {
    await this.renderModal();
  }

  onClose() {
    this.component.unload();
    this.contentEl.empty();
  }
}

// ============================================================================
// Table Picker Modal
// ============================================================================

interface TablePickerItem {
  type: 'table' | 'template';
  id: string;
  name: string;
  collectionId: string;
  collectionName: string;
  description?: string;
}

class TablePickerModal extends FuzzySuggestModal<TablePickerItem> {
  plugin: RolldeoPlugin;
  onSelect?: (result: RollResult) => void;

  constructor(app: App, plugin: RolldeoPlugin, onSelect?: (result: RollResult) => void) {
    super(app);
    this.plugin = plugin;
    this.onSelect = onSelect;
    this.setPlaceholder('Search tables and templates...');
  }

  getItems(): TablePickerItem[] {
    const items: TablePickerItem[] = [];

    const collections = this.plugin.engine.listCollections();

    for (const collection of collections) {
      // Add tables
      const tables = this.plugin.engine.listTables(collection.id);
      for (const table of tables) {
        items.push({
          type: 'table',
          id: table.id,
          name: table.name,
          collectionId: collection.id,
          collectionName: collection.name,
          description: table.description,
        });
      }

      // Add templates
      const templates = this.plugin.engine.listTemplates(collection.id);
      for (const template of templates) {
        items.push({
          type: 'template',
          id: template.id,
          name: template.name,
          collectionId: collection.id,
          collectionName: collection.name,
          description: template.description,
        });
      }
    }

    return items;
  }

  getItemText(item: TablePickerItem): string {
    return `${item.name} (${item.collectionName})`;
  }

  renderSuggestion(item: { item: TablePickerItem }, el: HTMLElement) {
    const suggestion = el.createDiv({ cls: 'rolldeo-suggestion' });
    suggestion.createDiv({ cls: 'rolldeo-suggestion-name', text: item.item.name });
    suggestion.createDiv({
      cls: 'rolldeo-suggestion-collection',
      text: `${item.item.type === 'template' ? '📄 ' : '🎲 '}${item.item.collectionName}`,
    });
    if (item.item.description) {
      suggestion.createDiv({
        cls: 'rolldeo-suggestion-desc',
        text: item.item.description,
      });
    }
  }

  onChooseItem(item: TablePickerItem) {
    try {
      let result: RollResult;

      if (item.type === 'template') {
        result = this.plugin.rollTemplate(item.id, item.collectionId);
      } else {
        result = this.plugin.roll(item.id, item.collectionId);
      }

      if (this.onSelect) {
        this.onSelect(result);
      } else {
        // Show result modal instead of toast
        new RollResultModal(
          this.app,
          this.plugin,
          result,
          item.name,
          item.collectionName,
          item.id,
          item.collectionId,
          item.type === 'template'
        ).open();
      }
    } catch (error) {
      console.error('Rolldeo: Error rolling table', error);
      new Notice(`Error rolling "${item.name}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// ============================================================================
// Settings Tab
// ============================================================================

class RolldeoSettingTab extends PluginSettingTab {
  plugin: RolldeoPlugin;

  constructor(app: App, plugin: RolldeoPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Tables folder')
      .setDesc('Only load table files from this folder (leave empty to scan entire vault)')
      .addText((text) =>
        text
          .setPlaceholder('e.g., Tables/')
          .setValue(this.plugin.settings.tablesFolder)
          .onChange(async (value) => {
            this.plugin.settings.tablesFolder = value;
            await this.plugin.saveSettings();
            await this.plugin.loadCollectionsFromVault();
          })
      );

    new Setting(containerEl)
      .setName('History length')
      .setDesc('Number of rolls to keep in history')
      .addSlider((slider) =>
        slider
          .setLimits(10, 100, 10)
          .setValue(this.plugin.settings.historyLength)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.historyLength = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Show descriptions')
      .setDesc('Show entry descriptions in roll history')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showDescriptions)
          .onChange(async (value) => {
            this.plugin.settings.showDescriptions = value;
            await this.plugin.saveSettings();
            this.plugin.refreshView();
          })
      );

    new Setting(containerEl)
      .setName('Enable trace')
      .setDesc('Capture execution traces for debugging (increases memory usage)')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableTrace)
          .onChange(async (value) => {
            this.plugin.settings.enableTrace = value;
            await this.plugin.saveSettings();
          })
      );

    // Stats section
    new Setting(containerEl).setName('Statistics').setHeading();

    const collections = this.plugin.engine.listCollections();
    let totalTables = 0;
    let totalTemplates = 0;

    for (const collection of collections) {
      totalTables += this.plugin.engine.listTables(collection.id).length;
      totalTemplates += this.plugin.engine.listTemplates(collection.id).length;
    }

    containerEl.createEl('p', {
      text: `Loaded: ${collections.length} collections, ${totalTables} tables, ${totalTemplates} templates`,
    });

    // Reload button
    new Setting(containerEl)
      .setName('Reload collections')
      .setDesc('Rescan vault for table files')
      .addButton((button) =>
        button.setButtonText('Reload').onClick(async () => {
          await this.plugin.loadCollectionsFromVault();
          new Notice('Collections reloaded');
          this.display(); // Refresh stats
        })
      );
  }
}
