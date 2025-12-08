# Rolldeo - Random Table Roller for Obsidian

Roll on random tables directly within Obsidian. Perfect for tabletop RPG players, game masters, writers, and worldbuilders who want to generate random content from structured JSON table files.

## Features

### Side Panel Browser
- **Collapsible Collections** - Browse all your random table collections in an organized tree view
- **Templates First** - Templates (composite rolls) are shown prominently, with individual tables in a collapsible section
- **Search & Filter** - Quickly find tables by name, description, or tags
- **Two-Action Buttons**:
  - **Roll Icon (left)** - Roll and view the result in a modal
  - **Insert Icon (right)** - Roll and insert directly at your last cursor position

### Roll Result Modal
- **Markdown Rendering** - Results are rendered with full markdown support (bold, italics, lists, headers, etc.)
- **Roll Again** - Re-roll without closing the modal
- **Copy** - Copy the result to clipboard
- **Insert** - Insert at your last cursor position and close

### History Tab
- **Full Roll History** - View all your previous rolls with timestamps
- **Markdown Display** - History entries render markdown properly
- **Quick Actions** - Re-roll, copy, or insert any previous result
- **Clear History** - Start fresh when needed

### Smart Cursor Tracking
- The plugin remembers your last cursor position in any markdown file
- Insert rolls at that position even when the Rolldeo panel is focused
- Falls back to clipboard if no editor is available

### Commands
- **Open roller panel** - Open the Rolldeo side panel
- **Roll on a table** - Open the fuzzy search table picker
- **Roll table and insert at cursor** - Roll and insert directly (editor must be active)
- **Reload all table collections** - Rescan vault for table files

## Table File Format

Rolldeo uses the **Random Table JSON Spec v1.0**. Table files are JSON files with the following structure:

```json
{
  "metadata": {
    "specVersion": "1.0",
    "name": "My Table Collection",
    "description": "A collection of random tables",
    "namespace": "my-tables"
  },
  "tables": {
    "weather": {
      "name": "Weather",
      "description": "Random weather conditions",
      "tags": ["environment", "outdoor"],
      "entries": [
        { "value": "Sunny and clear" },
        { "value": "Overcast with light clouds" },
        { "value": "Heavy rain", "weight": 2 },
        { "value": "Thunderstorm", "description": "Lightning flashes across the sky" }
      ]
    }
  },
  "templates": {
    "scene": {
      "name": "Scene Generator",
      "description": "Generate a complete scene",
      "template": "The weather is {{weather}}. You see {{encounter}}."
    }
  }
}
```

### Key Features of the Spec
- **Weighted Entries** - Use `weight` to make some results more likely
- **Descriptions** - Add detailed descriptions that appear in the result modal
- **Templates** - Combine multiple table rolls with `{{tableName}}` syntax
- **Tags** - Organize and filter tables by tags
- **Cross-File Imports** - Reference tables from other files using namespaces

## Installation

### Manual Installation
1. Download `main.js`, `styles.css`, and `manifest.json` from the latest release
2. Create a folder called `rolldeo` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into this folder
4. Reload Obsidian
5. Enable the plugin in Settings → Community Plugins

### From Source
1. Clone this repository into your vault's `.obsidian/plugins/` directory
2. Run `npm install` to install dependencies
3. Run `npm run build` to compile
4. Reload Obsidian and enable the plugin

## Settings

- **Tables Folder** - Restrict table scanning to a specific folder (leave empty to scan entire vault)
- **History Length** - Number of rolls to keep in history (10-100)
- **Show Descriptions** - Display entry descriptions in roll results
- **Enable Trace** - Capture execution traces for debugging

## Usage Tips

1. **Organize Your Tables** - Put all your `.json` table files in a dedicated folder and set it in settings
2. **Use Templates** - Create templates that combine multiple tables for complex generators
3. **Keyboard Workflow** - Use `Cmd/Ctrl + P` → "Roll on a table" for quick access
4. **Insert While Writing** - Keep the Rolldeo panel open while writing, use the insert button to add rolls inline

## Development

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Watch mode for development
npm run dev
```

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have feature requests, please open an issue on the GitHub repository.
