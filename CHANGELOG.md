# Changelog

## 0.2.0

- Added local Qwen/Ollama as a first-class provider.
- Reads exact prompt/generated token metrics recorded by Code-as-a-chat without
  storing prompt or reply content.
- Supports `--provider qwen`, `--project`, daily totals, recent turns, JSON, and
  aggregate `--provider all` reports; correctly labels the model as local with
  no quota.

## 0.1.0

- Initial Codaur CLI.
- Local usage reports for Codex Desktop, Claude Code, Gemini CLI, and Antigravity.
- Usage-limit percentage reporting with native, captured, registry, custom, and unknown sources.
- Weekly limits registry cache.
- Claude statusLine capture integration.
- JSON output and watch mode.
