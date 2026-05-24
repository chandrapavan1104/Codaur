# Contributing

Thanks for improving Codaur. Keep changes local-first, privacy-conscious, and explicit about confidence levels.

## Development

```sh
git clone https://github.com/chandrapavan1104/codaur.git
cd codaur
npm test
node ./bin/codaur.mjs --help
```

## Validation

Run these before opening a PR:

```sh
npm test
node ./bin/codaur.mjs --provider all --json --no-limit-refresh
node ./bin/codaur.mjs limits status --no-limit-refresh
```

Use temporary XDG paths when testing commands that write config or cache data:

```sh
XDG_CONFIG_HOME=/tmp/codaur-config XDG_CACHE_HOME=/tmp/codaur-cache node ./bin/codaur.mjs config show
```

## Provider Data Rules

- Prefer native provider percentages when locally available.
- Label local captures as `captured`.
- Label registry-based estimates as `estimated`.
- Return `n/a` when no reliable denominator exists.
- Do not add scraping of authenticated dashboards without a clear user opt-in and documentation.
