import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'codaur-qwen-'));
const usageFile = join(dir, 'qwen.jsonl');
writeFileSync(usageFile, `${JSON.stringify({
  id: 'turn-1', sessionId: 'app:test', timestamp: new Date().toISOString(),
  model: 'qwen2.5:3b', cwd: '/Projects/demo', source: 'gajala',
  inputTokens: 12, outputTokens: 8, totalTokens: 20,
})}\n`);

const raw = execFileSync(process.execPath, ['./bin/codaur.mjs', '--provider', 'qwen',
  '--project', '/Projects/demo', '--json', '--no-limit-refresh'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, QWEN_USAGE_FILE: usageFile },
  encoding: 'utf8',
});
const report = JSON.parse(raw);
assert.equal(report.provider, 'qwen');
assert.equal(report.totals.tokens, 20);
assert.equal(report.totals.usage.inputTokens, 12);
assert.equal(report.totals.usage.outputTokens, 8);
assert.equal(report.recentThreads[0].cwd, '/Projects/demo');
assert.equal(report.limitUsage[0].usedPercent, null);
