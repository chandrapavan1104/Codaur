# Codaur

**Cod**ing-**a**gent **u**sage **r**eport - a local CLI for tracking coding-agent usage, tokens, and limit percentages across Codex, Claude Code, Gemini CLI, and Antigravity.

Codaur reads local usage files from your machine. It does not scrape dashboards during normal reports and does not send your transcripts to a remote service.

## Features

- One command for Codex, Claude Code, Gemini CLI, and Antigravity local usage.
- Token totals, recent daily totals, and recent sessions.
- Usage-limit percentages when providers expose reliable data.
- Weekly refreshed limits registry for public plan metadata.
- JSON output for scripts and dashboards.
- Runs from any directory after install.

## Quick Start

Run directly with npm:

```sh
npx codaur --provider all
```

Install globally:

```sh
npm install -g codaur
codaur --provider all
```

Install from a local checkout:

```sh
git clone https://github.com/chandrapavan1104/codaur.git
cd codaur
npm link
codaur --provider all
```

## Supported Providers

| Provider | Local source | Limit percentage support |
| --- | --- | --- |
| Codex Desktop | `~/.codex/state_5.sqlite`, `~/.codex/sessions/**/*.jsonl` | Native local primary/secondary snapshots when present |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Opt-in statusLine capture via `codaur integrate claude` |
| Gemini CLI | `~/.gemini/tmp/**/chats/*.jsonl`, `~/.gemini/projects.json` | Estimated daily request percentage from configured plan |
| Antigravity | `~/.gemini/antigravity/conversations` | `n/a` by default unless custom limits are configured |

## Common Commands

```sh
codaur
codaur --provider codex
codaur --provider claude
codaur --provider gemini
codaur --provider antigravity
codaur --provider all
codaur --json
codaur --watch
```

Configuration and limits:

```sh
codaur config show
codaur config set-plan gemini aiPro
codaur limits status
codaur limits refresh
codaur integrate claude
```

Useful filters:

```sh
codaur --today
codaur --days 30
codaur --project /path/to/project
codaur --no-limit-refresh
codaur --refresh-limits
```

## Usage Limits

Every report includes a `Usage limits` section and JSON `limitUsage` entries. Codaur uses this precedence:

1. Native provider percentage.
2. Locally captured provider percentage.
3. Estimated percentage from configured plan limits.
4. `n/a` with a reason.

Codaur does not invent a denominator. If a plan is unknown or the provider does not publish a numeric quota, the report stays `n/a`.

Example JSON shape:

```json
{
  "window": "1d",
  "unit": "requests",
  "used": 12,
  "limit": 1000,
  "usedPercent": 1.2,
  "resetsAt": 1779606000,
  "source": "registry",
  "confidence": "estimated",
  "note": "Estimated from local Gemini CLI event rows against the configured daily request quota."
}
```

## Configuration

User config lives at `~/.config/codaur/config.json`. Cache files live at `~/.cache/codaur`.

Set a Gemini plan before relying on Gemini percentages:

```sh
codaur config set-plan gemini free
codaur config set-plan gemini aiPro
codaur config set-plan gemini aiUltra
codaur config set-plan gemini standard
codaur config set-plan gemini enterprise
```

Claude percentages require the opt-in statusLine integration:

```sh
codaur integrate claude
```

That command backs up and merges `~/.claude/settings.json`; it does not overwrite unrelated settings.

## Documentation

- [Installation Guide](docs/INSTALLATION.md)
- [Configuration Guide](docs/CONFIGURATION.md)
- [Provider Notes](docs/PROVIDERS.md)
- [Contributing](CONTRIBUTING.md)

## Environment Variables

Use these to read from non-default data directories:

```sh
CODEX_HOME=/path/to/.codex codaur --provider codex
CLAUDE_HOME=/path/to/.claude codaur --provider claude
GEMINI_HOME=/path/to/.gemini codaur --provider gemini
ANTIGRAVITY_HOME=/path/to/antigravity codaur --provider antigravity
```

Use `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` to redirect Codaur config and cache paths during tests or automation.

## Requirements

- Node.js 18 or newer
- `sqlite3` on `PATH` for Codex Desktop reports

## License

MIT
