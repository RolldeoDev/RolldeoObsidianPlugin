/**
 * Mock for the obsidian module
 * Provides minimal stubs for testing engine code that doesn't depend on Obsidian
 */

export class Plugin {}
export class PluginSettingTab {}
export class Modal {}
export class Notice {}
export class ItemView {}
export class WorkspaceLeaf {}
export class TFile {}
export class TAbstractFile {}
export class Component {}
export class MarkdownView {}
export class FuzzySuggestModal<T> {}
export class Setting {}
export class Editor {}
export class App {}
export class Menu {}

export const MarkdownRenderer = {
  render: jest.fn(),
};

export function setIcon() {}
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  _delay: number,
  _immediate?: boolean
): T {
  return fn;
}
