# Configuration Guide

Codaur stores user config at `~/.config/codaur/config.json` and cache data at `~/.cache/codaur`.

## Show Config

```sh
codaur config show
codaur config show --json
```

## Set Provider Plans

Plan values are only used when Codaur needs a denominator for estimated percentages. Unknown plans report `n/a`; Codaur does not assume a default paid or free tier.

```sh
codaur config set-plan gemini free
codaur config set-plan gemini aiPro
codaur config set-plan gemini aiUltra
codaur config set-plan gemini standard
codaur config set-plan gemini enterprise
```

## Claude Status Line Capture

```sh
codaur integrate claude
```

The integration backs up `~/.claude/settings.json` and adds a Claude Code `statusLine` command. Captured rate-limit snapshots are stored at `~/.cache/codaur/claude/rate-limits.json`.

## Antigravity Custom Limits

Antigravity public docs do not publish numeric quotas. If you know your own limit, add a custom limit manually:

```json
{
  "antigravity": {
    "customLimits": [
      {
        "window": "1d",
        "unit": "events",
        "limit": 100,
        "note": "My manually configured local estimate."
      }
    ]
  }
}
```

## Limits Registry

```sh
codaur limits status
codaur limits refresh
```

Normal reports refresh cached public limit metadata at most once every 7 days. Use `--no-limit-refresh` to skip all network checks.
