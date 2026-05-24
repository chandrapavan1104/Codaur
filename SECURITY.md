# Security Policy

## Reporting Security Issues

Please do not open public issues for security vulnerabilities. Email the maintainer or use GitHub private vulnerability reporting if enabled on the repository.

## Privacy Model

Codaur reads local usage files and prints summaries. Normal reports do not upload transcripts or token logs. The limits registry refresh checks official provider documentation URLs and writes metadata to `~/.cache/codaur/limits.json`. Use `--no-limit-refresh` for fully local runs.

## Sensitive Files

Avoid sharing raw provider JSONL logs in issues. They may contain prompts, file paths, project names, and account metadata. Prefer redacted snippets that preserve structure but remove content.
