# Installation Guide

## Requirements

- Node.js 18 or newer.
- npm, pnpm, yarn, or another Node package manager.
- `sqlite3` on `PATH` if you want Codex Desktop reports.

## Run Without Installing

```sh
npx codaur --provider all
```

## Global npm Install

```sh
npm install -g codaur
codaur --provider all
```

After global install, `codaur` runs from any directory because npm places the executable on your shell `PATH`.

## Local Checkout Install

```sh
git clone https://github.com/chandrapavan1104/codaur.git
cd codaur
npm link
codaur --provider all
```

If `codaur` is not found after `npm link`, check npm's global bin directory:

```sh
npm bin -g
echo $PATH
```

## Verify

```sh
codaur --version
codaur --help
codaur limits status
```

## Fully Local Runs

Use `--no-limit-refresh` to prevent network access during a report:

```sh
codaur --provider all --no-limit-refresh
```
