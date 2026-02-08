# OpenCode Plugins

This repository contains OpenCode plugins that extend the agent with custom functionality.

## Available Plugins

| Plugin | Description |
|--------|-------------|
| [api-docs](/api-docs/) | Generate API documentation from code |
| [bundle-analyzer](/bundle-analyzer/) | Analyze bundle size and dependencies |
| [code-quality](/code-quality/) | Enforce code quality standards |
| [dependency-audit](/dependency-audit/) | Audit dependencies for vulnerabilities |
| [env-validator](/env-validator/) | Validate environment configuration |
| [git-hygiene](/git-hygiene/) | Enforce git commit standards |
| [health-check](/health-check/) | System health monitoring |
| [knowledge-graph](/knowledge-graph/) | Maintain project context across sessions |
| [readme-validator](/readme-validator/) | Validate README completeness |
| [security-scanner](/security-scanner/) | Security vulnerability scanning |
| [test-coverage](/test-coverage/) | Track and report test coverage |

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