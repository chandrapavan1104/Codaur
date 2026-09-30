# Provider Notes

## Codex Desktop

Codaur reads `~/.codex/state_5.sqlite` for thread token totals and `~/.codex/sessions/**/*.jsonl` for the latest local `token_count` rate-limit snapshot. When primary and secondary percentages are present, Codaur reports them as `source: native` and `confidence: exact`.

## Claude Code

Codaur reads `~/.claude/projects/**/*.jsonl` for local token usage. Claude rate-limit percentages require opt-in statusLine capture:

```sh
codaur integrate claude
```

After Claude Code runs with that statusLine command, Codaur reads `rate_limits.five_hour.used_percentage` and `rate_limits.seven_day.used_percentage` from the captured payload.

## Gemini CLI

Codaur reads Gemini CLI chat logs from `~/.gemini/tmp/**/chats/*.jsonl` and project mapping from `~/.gemini/projects.json`. Gemini limit percentages are estimated from today's local event count and the configured plan's daily request quota.

## Antigravity

Codaur currently reports local Antigravity conversation activity from protobuf conversation files. It does not parse per-turn token usage from those protobuf files, and public Antigravity plan pages do not publish numeric default quotas. Usage percentage is `n/a` unless you configure custom limits.

## Qwen / Ollama

Ollama returns exact `prompt_eval_count` and `eval_count` values with each
response but does not expose a historical usage API. Code-as-a-chat records
that metrics envelope to `~/.codeasachat/qwen_usage.jsonl`; prompts and replies
are deliberately excluded. Codaur reports input, generated, total, daily, and
per-project Qwen tokens from this file. Qwen is local and has no provider quota,
so its percentage remains `n/a` rather than inventing a limit.
