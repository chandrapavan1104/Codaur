#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const registryFile = join(root, 'data', 'limits.default.json');

function readRegistry() {
  if (!existsSync(registryFile)) {
    throw new Error(`Missing registry file: ${registryFile}`);
  }
  return JSON.parse(readFileSync(registryFile, 'utf8'));
}

function head(url) {
  return new Promise((resolve) => {
    const request = get(url, { method: 'HEAD', timeout: 10000 }, (response) => {
      response.resume();
      resolve({
        url,
        ok: response.statusCode >= 200 && response.statusCode < 400,
        statusCode: response.statusCode,
        lastModified: response.headers['last-modified'] ?? null,
        etag: response.headers.etag ?? null,
        checkedAt: new Date().toISOString(),
      });
    });

    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error) => resolve({ url, ok: false, error: error.message, checkedAt: new Date().toISOString() }));
  });
}

async function main() {
  const registry = readRegistry();
  const sourceUrls = [...new Set(Object.values(registry.providers ?? {}).map((provider) => provider.sourceUrl).filter(Boolean))];
  const sourceChecks = await Promise.all(sourceUrls.map((url) => head(url)));

  const nextRegistry = {
    ...registry,
    updatedAt: new Date().toISOString(),
    sourceChecks,
  };

  writeFileSync(registryFile, `${JSON.stringify(nextRegistry, null, 2)}\n`);
  console.log(`Updated ${registryFile}`);
  for (const check of sourceChecks) {
    const status = check.ok ? check.statusCode : check.error ?? check.statusCode ?? 'failed';
    console.log(`- ${check.url}: ${status}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
