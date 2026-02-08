# OpenCode Plugins

This repository contains OpenCode plugins that extend the agent with custom functionality.

## Available Plugins

- [knowledge-graph](/knowledge-graph/) - Maintains project context and knowledge across sessions

## Installation

Install plugins by copying them to your OpenCode plugins directory:

```bash
# Project-level plugins
mkdir -p .opencode/plugins/
cp -r <plugin-name>/* .opencode/plugins/<plugin-name>/

# Global plugins
mkdir -p ~/.config/opencode/plugins/
cp -r <plugin-name>/* ~/.config/opencode/plugins/<plugin-name>/
```

## Plugin Structure

Each plugin is a self-contained module with:

```
plugin-name/
├── plugin.js          # Main plugin entry point
├── package.json       # Dependencies (if needed)
└── README.md          # Plugin documentation
```

## Development

See [AGENTS.md](/AGENTS.md) for full documentation on:
- Plugin locations and structure
- Event hooks
- Custom tools
- TypeScript support
- Configuration

## Requirements

- OpenCode agent
- Bun runtime (required for plugin execution)