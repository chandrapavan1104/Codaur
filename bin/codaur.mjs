#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DAYS = 30;
const DEFAULT_THREAD_LIMIT = 5;
const WATCH_INTERVAL_MS = 60_000;
const LIMIT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDERS = ['codex', 'claude', 'gemini', 'antigravity'];
const VERSION = '0.1.0';
const CLI_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = dirname(dirname(CLI_PATH));
const DEFAULT_LIMITS_FILE = join(PROJECT_ROOT, 'data', 'limits.default.json');
const CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
const CACHE_HOME = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
const CONFIG_DIR = join(CONFIG_HOME, 'codaur');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const CACHE_DIR = join(CACHE_HOME, 'codaur');
const LIMITS_CACHE_FILE = join(CACHE_DIR, 'limits.json');
const CLAUDE_CAPTURE_DIR = join(CACHE_DIR, 'claude');
const CLAUDE_CAPTURE_FILE = join(CLAUDE_CAPTURE_DIR, 'rate-limits.json');

function usage() {
  return `Usage: codaur [command] [options]

Commands:
  report                 Show usage report. Default command.
  limits refresh         Refresh cached public limit metadata.
  limits status          Show limit registry cache status.
  config show            Show Codaur user config.
  config set-plan <provider> <plan>
                         Set provider plan used for estimated percentages.
  integrate claude       Install opt-in Claude statusLine capture integration.

Options:
  --provider <name>      Provider to report: codex, claude, gemini, antigravity, all. Default: codex.
  --today                Show only today's period rows.
  --days <n>             Number of recent days to report. Default: ${DEFAULT_DAYS}.
  --project <path>       Limit project-aware totals to a project path.
  --json                 Print machine-readable JSON.
  --watch                Refresh once per minute.
  --refresh-limits       Force public limit metadata refresh before reporting.
  --no-limit-refresh     Do not use the network during this run.
  -v, --version          Show the version.
  -h, --help             Show this help.
`;
}

function parseArgs(argv) {
  const options = {
    command: 'report',
    commandArgs: [],
    provider: 'codex',
    days: DEFAULT_DAYS,
    today: false,
    project: null,
    json: false,
    watch: false,
    help: false,
    version: false,
    refreshLimits: false,
    noLimitRefresh: false,
  };

  const commands = new Set(['report', 'limits', 'config', 'integrate', 'capture']);
  if (argv[0] && commands.has(argv[0])) {
    options.command = argv.shift();
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--today') {
      options.today = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--watch') {
      options.watch = true;
    } else if (arg === '--refresh-limits') {
      options.refreshLimits = true;
    } else if (arg === '--no-limit-refresh') {
      options.noLimitRefresh = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--version') {
      options.version = true;
    } else if (arg === '--provider') {
      options.provider = parseProvider(argv[++i]);
    } else if (arg.startsWith('--provider=')) {
      options.provider = parseProvider(arg.slice('--provider='.length));
    } else if (arg === '--days') {
      options.days = parsePositiveInt(argv[++i], '--days');
    } else if (arg.startsWith('--days=')) {
      options.days = parsePositiveInt(arg.slice('--days='.length), '--days');
    } else if (arg === '--project') {
      options.project = parseProject(argv[++i]);
    } else if (arg.startsWith('--project=')) {
      options.project = parseProject(arg.slice('--project='.length));
    } else {
      options.commandArgs.push(arg);
    }
  }

  if (options.today) {
    options.days = 1;
  }

  return options;
}

function parseProvider(value) {
  if (!value) {
    throw new Error('--provider requires a value');
  }

  const provider = value.toLowerCase().replace('-', '');
  if (provider === 'all' || PROVIDERS.includes(provider)) {
    return provider;
  }

  throw new Error(`Unknown provider: ${value}`);
}

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseProject(value) {
  if (!value) {
    throw new Error('--project requires a path');
  }

  return resolve(value.replace(/^~(?=$|\/)/, homedir()));
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqliteJson(db, sql) {
  const raw = execFileSync('sqlite3', ['-json', db, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  return raw ? JSON.parse(raw) : [];
}

function fmtInt(value) {
  if (value == null) {
    return 'n/a';
  }

  return Math.round(value).toLocaleString('en-US');
}

function fmtPct(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : 'n/a';
}

function fmtReset(value) {
  if (!value) {
    return 'n/a';
  }

  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? 'n/a' : date.toLocaleString();
}

function localDay(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayLocalDay() {
  return localDay(new Date());
}

function dayCutoff(days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

function nextLocalMidnightEpochSeconds() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return Math.floor(next.getTime() / 1000);
}

function isWithinReportWindow(timestamp, options) {
  const day = localDay(timestamp);
  if (!day) {
    return false;
  }

  if (options.today) {
    return day === todayLocalDay();
  }

  return new Date(timestamp) >= dayCutoff(options.days);
}

function matchesProject(cwd, project) {
  if (!project) {
    return true;
  }

  return cwd === project || cwd?.startsWith(`${project}/`);
}

function safeReadJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonl(path) {
  const rows = [];
  const lines = readFileSync(path, 'utf8').split('\n');

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      rows.push(JSON.parse(line));
    } catch {
      // Ignore partial or corrupt log lines.
    }
  }

  return rows;
}

function collectFiles(root, predicate) {
  const files = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && predicate(path, entry.name)) {
        files.push(path);
      }
    }
  }

  if (existsSync(root)) {
    walk(root);
  }

  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

function blankUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    toolTokens: 0,
    totalTokens: 0,
  };
}

function addUsage(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += Number(source?.[key] ?? 0);
  }
}

function defaultConfig() {
  return {
    codex: { plan: null },
    claude: { plan: null },
    gemini: { plan: null },
    antigravity: { plan: null, customLimits: [] },
  };
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return base;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = deepMerge(base[key] ?? {}, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function loadConfig() {
  return deepMerge(defaultConfig(), safeReadJson(CONFIG_FILE, {}));
}

function saveConfig(config) {
  writeJsonFile(CONFIG_FILE, config);
}

function bundledRegistryFallback() {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    refreshIntervalDays: 7,
    providers: {
      codex: {
        sourceUrl: 'https://developers.openai.com/codex/pricing',
        plans: {},
        notes: ['Codex exposes native local percentage snapshots in session JSONL when available.'],
      },
      claude: {
        sourceUrl: 'https://code.claude.com/docs/en/statusline',
        plans: {},
        notes: ['Claude Code can expose five_hour and seven_day percentage snapshots through statusLine JSON.'],
      },
      gemini: {
        sourceUrl: 'https://developers.google.com/gemini-code-assist/resources/quotas',
        plans: {
          free: { label: 'For individuals (free)', quotas: { dailyRequests: 1000 } },
          aiPro: { label: 'Google AI Pro', quotas: { dailyRequests: 1500 } },
          aiUltra: { label: 'Google AI Ultra', quotas: { dailyRequests: 2000 } },
          standard: { label: 'Standard', quotas: { dailyRequests: 1500 } },
          enterprise: { label: 'Enterprise', quotas: { dailyRequests: 2000 } },
        },
      },
      antigravity: {
        sourceUrl: 'https://antigravity.google/docs/plans',
        plans: {},
        notes: ['Antigravity documents plan-dependent work-based limits without numeric baseline quotas.'],
      },
    },
  };
}

function loadDefaultRegistry() {
  return deepMerge(bundledRegistryFallback(), safeReadJson(DEFAULT_LIMITS_FILE, {}));
}

function mergeRegistry(defaultRegistry, cachedRegistry) {
  return deepMerge(defaultRegistry, cachedRegistry ?? {});
}

function cacheAgeMs() {
  try {
    return Date.now() - statSync(LIMITS_CACHE_FILE).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isCacheFresh() {
  return cacheAgeMs() < LIMIT_REFRESH_MS;
}

function httpsHead(url) {
  return new Promise((resolvePromise) => {
    const request = get(url, { method: 'HEAD', timeout: 8000 }, (response) => {
      response.resume();
      resolvePromise({
        url,
        ok: response.statusCode >= 200 && response.statusCode < 400,
        statusCode: response.statusCode,
        lastModified: response.headers['last-modified'] ?? null,
        etag: response.headers.etag ?? null,
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', (error) => {
      resolvePromise({ url, ok: false, error: error.message });
    });
  });
}

async function refreshLimitsCache(defaultRegistry = loadDefaultRegistry()) {
  const checks = [];
  for (const provider of Object.values(defaultRegistry.providers ?? {})) {
    if (provider.sourceUrl) {
      checks.push(httpsHead(provider.sourceUrl));
    }
  }

  const sourceChecks = await Promise.all(checks);
  const refreshed = {
    ...defaultRegistry,
    updatedAt: new Date().toISOString(),
    sourceChecks,
  };

  writeJsonFile(LIMITS_CACHE_FILE, refreshed);
  return refreshed;
}

async function loadLimitsRegistry(options) {
  const defaults = loadDefaultRegistry();
  const cached = safeReadJson(LIMITS_CACHE_FILE, null);

  if (options.noLimitRefresh) {
    return mergeRegistry(defaults, cached);
  }

  if (options.refreshLimits || !cached || !isCacheFresh()) {
    try {
      return await refreshLimitsCache(defaults);
    } catch (error) {
      const merged = mergeRegistry(defaults, cached);
      merged.refreshError = error.message;
      return merged;
    }
  }

  return mergeRegistry(defaults, cached);
}

function limitEntry({ window, unit, used = null, limit = null, usedPercent = null, resetsAt = null, source, confidence, note }) {
  const normalizedPercent = typeof usedPercent === 'number' ? usedPercent : used != null && limit ? (used / limit) * 100 : null;
  return {
    window,
    unit,
    used,
    limit,
    usedPercent: normalizedPercent,
    resetsAt,
    source,
    confidence,
    note,
  };
}

function unknownLimit(window, unit, note) {
  return limitEntry({ window, unit, source: 'unknown', confidence: 'unknown', note });
}

function makeBaseReport(provider, dataHome, dataSources, options) {
  return {
    provider,
    generatedAt: new Date().toISOString(),
    dataHome,
    dataSources,
    filters: {
      today: options.today,
      days: options.days,
      project: options.project,
    },
    totals: {
      threads: 0,
      events: 0,
      tokens: null,
      todayTokens: null,
      usage: blankUsage(),
      todayUsage: blankUsage(),
    },
    latestRateLimitSnapshot: null,
    limitUsage: [],
    recentDailyTotals: [],
    recentThreads: [],
    warnings: [],
  };
}

function summarizeEvents(events, report, options) {
  const seenThreads = new Set();
  const byThread = new Map();
  const daily = new Map();

  for (const event of events) {
    seenThreads.add(event.threadId);
    report.totals.events += 1;
    addUsage(report.totals.usage, event.usage);

    if (localDay(event.timestamp) === todayLocalDay()) {
      addUsage(report.totals.todayUsage, event.usage);
    }

    if (isWithinReportWindow(event.timestamp, options)) {
      const day = localDay(event.timestamp);
      if (!daily.has(day)) {
        daily.set(day, { day, threads: new Set(), events: 0, usage: blankUsage() });
      }
      const dayRow = daily.get(day);
      dayRow.threads.add(event.threadId);
      dayRow.events += 1;
      addUsage(dayRow.usage, event.usage);
    }

    if (!options.today || localDay(event.timestamp) === todayLocalDay()) {
      if (!byThread.has(event.threadId)) {
        byThread.set(event.threadId, {
          id: event.threadId,
          updated: event.timestamp,
          created: event.created ?? event.timestamp,
          model: event.model ?? null,
          cwd: event.cwd ?? null,
          tokens: 0,
          usage: blankUsage(),
          source: event.source,
        });
      }

      const thread = byThread.get(event.threadId);
      addUsage(thread.usage, event.usage);
      thread.tokens = thread.usage.totalTokens;

      if (Date.parse(event.timestamp) > Date.parse(thread.updated)) {
        thread.updated = event.timestamp;
        thread.model = event.model ?? thread.model;
        thread.cwd = event.cwd ?? thread.cwd;
        thread.source = event.source ?? thread.source;
      }

      if (Date.parse(event.created ?? event.timestamp) < Date.parse(thread.created)) {
        thread.created = event.created ?? event.timestamp;
      }
    }
  }

  report.totals.threads = seenThreads.size;
  report.totals.tokens = report.totals.usage.totalTokens;
  report.totals.todayTokens = report.totals.todayUsage.totalTokens;
  report.recentDailyTotals = [...daily.values()]
    .map((row) => ({
      day: row.day,
      threads: row.threads.size,
      events: row.events,
      tokens: row.usage.totalTokens,
      usage: row.usage,
    }))
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, options.days);
  report.recentThreads = [...byThread.values()]
    .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))
    .slice(0, DEFAULT_THREAD_LIMIT);
}

function collectJsonlFiles(root) {
  return collectFiles(root, (_path, name) => name.endsWith('.jsonl'));
}

function codexWindowName(windowMinutes) {
  if (windowMinutes === 300) {
    return '5h';
  }
  if (windowMinutes === 10080) {
    return '7d';
  }
  return windowMinutes ? `${windowMinutes}m` : 'unknown';
}

function findLatestCodexTokenEvent(sessionsDir) {
  let latest = null;

  for (const file of collectJsonlFiles(sessionsDir)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.includes('"token_count"')) {
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (parsed?.payload?.type !== 'token_count') {
        continue;
      }

      const event = {
        timestamp: parsed.timestamp,
        path: file,
        totalTokenUsage: parsed.payload.info?.total_token_usage ?? null,
        lastTokenUsage: parsed.payload.info?.last_token_usage ?? null,
        modelContextWindow: parsed.payload.info?.model_context_window ?? null,
        primary: parsed.payload.rate_limits?.primary ?? null,
        secondary: parsed.payload.rate_limits?.secondary ?? null,
        planType: parsed.payload.rate_limits?.plan_type ?? null,
        rateLimitReachedType: parsed.payload.rate_limits?.rate_limit_reached_type ?? null,
      };

      if (!latest || Date.parse(event.timestamp) > Date.parse(latest.timestamp)) {
        latest = event;
      }
    }

    if (latest && Date.now() - statSync(file).mtimeMs > 1000 * 60 * 60 * 24 * 30) {
      break;
    }
  }

  return latest;
}

function codexLimitUsage(snapshot) {
  if (!snapshot) {
    return [unknownLimit('current', 'percent', 'No Codex rate-limit snapshot found in local session logs.')];
  }

  return [
    snapshot.primary
      ? limitEntry({
          window: codexWindowName(snapshot.primary.window_minutes),
          unit: 'percent',
          usedPercent: snapshot.primary.used_percent,
          resetsAt: snapshot.primary.resets_at ?? null,
          source: 'native',
          confidence: 'exact',
          note: 'Codex local primary rate-limit snapshot.',
        })
      : unknownLimit('primary', 'percent', 'Codex primary rate-limit snapshot is absent.'),
    snapshot.secondary
      ? limitEntry({
          window: codexWindowName(snapshot.secondary.window_minutes),
          unit: 'percent',
          usedPercent: snapshot.secondary.used_percent,
          resetsAt: snapshot.secondary.resets_at ?? null,
          source: 'native',
          confidence: 'exact',
          note: 'Codex local secondary rate-limit snapshot.',
        })
      : unknownLimit('secondary', 'percent', 'Codex secondary rate-limit snapshot is absent.'),
  ];
}

function buildCodexWhere(options, columnPrefix = '') {
  const clauses = [];
  const cwdColumn = `${columnPrefix}cwd`;
  const createdColumn = `${columnPrefix}created_at`;

  if (options.project) {
    const project = sqlString(options.project);
    const projectPrefix = sqlString(`${options.project}/`);
    clauses.push(`(${cwdColumn} = ${project} or instr(${cwdColumn}, ${projectPrefix}) = 1)`);
  }

  if (options.today) {
    clauses.push(`date(${createdColumn},'unixepoch','localtime') = date('now','localtime')`);
  }

  return clauses.length ? `where ${clauses.join(' and ')}` : '';
}

function buildCodexDailyWhere(options) {
  const clauses = [];

  if (options.project) {
    const project = sqlString(options.project);
    const projectPrefix = sqlString(`${options.project}/`);
    clauses.push(`(cwd = ${project} or instr(cwd, ${projectPrefix}) = 1)`);
  }

  if (options.today) {
    clauses.push("date(created_at,'unixepoch','localtime') = date('now','localtime')");
  } else {
    clauses.push(`created_at >= strftime('%s','now','-${options.days} days')`);
  }

  return `where ${clauses.join(' and ')}`;
}

function collectCodexUsage(options) {
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  const stateDb = join(codexHome, 'state_5.sqlite');
  const sessionsDir = join(codexHome, 'sessions');
  const report = makeBaseReport('codex', codexHome, { stateDb, sessionsDir }, options);

  if (!existsSync(stateDb)) {
    report.warnings.push(`Codex state DB not found at ${stateDb}`);
    report.limitUsage = [unknownLimit('current', 'percent', 'Codex state DB was not found.')];
    return report;
  }

  const totalsWhere = buildCodexWhere({ ...options, today: false });
  const recentWhere = buildCodexWhere(options);
  const dailyWhere = buildCodexDailyWhere(options);

  const totals = sqliteJson(
    stateDb,
    `
      select
        count(*) as threads,
        coalesce(sum(tokens_used), 0) as tokens,
        coalesce(sum(case
          when date(created_at,'unixepoch','localtime') = date('now','localtime')
          then tokens_used else 0 end), 0) as today_tokens
      from threads
      ${totalsWhere};
    `,
  )[0] ?? { threads: 0, tokens: 0, today_tokens: 0 };

  const daily = sqliteJson(
    stateDb,
    `
      select
        date(created_at,'unixepoch','localtime') as day,
        count(*) as threads,
        coalesce(sum(tokens_used), 0) as tokens
      from threads
      ${dailyWhere}
      group by day
      order by day desc
      limit ${options.days};
    `,
  );

  const recentThreads = sqliteJson(
    stateDb,
    `
      select
        id,
        datetime(updated_at,'unixepoch','localtime') as updated,
        datetime(created_at,'unixepoch','localtime') as created,
        model,
        cwd,
        tokens_used
      from threads
      ${recentWhere}
      order by updated_at desc
      limit ${DEFAULT_THREAD_LIMIT};
    `,
  );

  report.totals.threads = Number(totals.threads ?? 0);
  report.totals.events = report.totals.threads;
  report.totals.tokens = Number(totals.tokens ?? 0);
  report.totals.todayTokens = Number(totals.today_tokens ?? 0);
  report.totals.usage.totalTokens = report.totals.tokens;
  report.totals.todayUsage.totalTokens = report.totals.todayTokens;
  report.latestRateLimitSnapshot = findLatestCodexTokenEvent(sessionsDir);
  report.limitUsage = codexLimitUsage(report.latestRateLimitSnapshot);
  report.recentDailyTotals = daily.map((row) => ({
    day: row.day,
    threads: Number(row.threads ?? 0),
    events: Number(row.threads ?? 0),
    tokens: Number(row.tokens ?? 0),
    usage: { ...blankUsage(), totalTokens: Number(row.tokens ?? 0) },
  }));
  report.recentThreads = recentThreads.map((row) => ({
    id: row.id,
    updated: row.updated,
    created: row.created,
    model: row.model,
    cwd: row.cwd,
    tokens: Number(row.tokens_used ?? 0),
    usage: { ...blankUsage(), totalTokens: Number(row.tokens_used ?? 0) },
    source: stateDb,
  }));

  return report;
}

function claudeUsageFromRow(row) {
  const usage = row?.message?.usage;
  if (!usage) {
    return null;
  }

  const normalized = {
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    cachedTokens: Number(usage.cache_read_input_tokens ?? 0),
    cacheCreationTokens: Number(usage.cache_creation_input_tokens ?? 0),
    cacheReadTokens: Number(usage.cache_read_input_tokens ?? 0),
    reasoningTokens: 0,
    toolTokens: 0,
    totalTokens: 0,
  };
  normalized.totalTokens =
    normalized.inputTokens +
    normalized.outputTokens +
    normalized.cacheCreationTokens +
    normalized.cacheReadTokens;
  return normalized;
}

function loadClaudeCapturedLimits() {
  const captured = safeReadJson(CLAUDE_CAPTURE_FILE, null);
  if (!captured?.rate_limits) {
    return null;
  }
  return captured;
}

function claudeLimitUsage() {
  const captured = loadClaudeCapturedLimits();
  if (!captured) {
    return [unknownLimit('5h/7d', 'percent', 'No Claude captured rate-limit snapshot found. Run `codaur integrate claude` and use Claude Code once to capture native percentages.')];
  }

  const entries = [];
  const fiveHour = captured.rate_limits.five_hour;
  const sevenDay = captured.rate_limits.seven_day;

  if (fiveHour) {
    entries.push(
      limitEntry({
        window: '5h',
        unit: 'percent',
        usedPercent: Number(fiveHour.used_percentage ?? fiveHour.usedPercent),
        resetsAt: fiveHour.resets_at ?? fiveHour.resetsAt ?? null,
        source: 'captured',
        confidence: 'exact',
        note: `Captured from Claude Code statusLine at ${captured.capturedAt}.`,
      }),
    );
  }

  if (sevenDay) {
    entries.push(
      limitEntry({
        window: '7d',
        unit: 'percent',
        usedPercent: Number(sevenDay.used_percentage ?? sevenDay.usedPercent),
        resetsAt: sevenDay.resets_at ?? sevenDay.resetsAt ?? null,
        source: 'captured',
        confidence: 'exact',
        note: `Captured from Claude Code statusLine at ${captured.capturedAt}.`,
      }),
    );
  }

  return entries.length ? entries : [unknownLimit('5h/7d', 'percent', 'Claude captured snapshot did not include rate_limits windows.')];
}

function collectClaudeUsage(options) {
  const claudeHome = process.env.CLAUDE_HOME || join(homedir(), '.claude');
  const projectsDir = join(claudeHome, 'projects');
  const report = makeBaseReport('claude', claudeHome, { projectsDir, capturedLimits: CLAUDE_CAPTURE_FILE }, options);
  const events = [];
  const seen = new Set();

  if (!existsSync(projectsDir)) {
    report.warnings.push(`Claude projects directory not found at ${projectsDir}`);
    report.limitUsage = claudeLimitUsage();
    return report;
  }

  for (const file of collectJsonlFiles(projectsDir)) {
    for (const row of readJsonl(file)) {
      if (row?.type !== 'assistant') {
        continue;
      }

      const usage = claudeUsageFromRow(row);
      if (!usage) {
        continue;
      }

      const cwd = row.cwd ?? null;
      if (!matchesProject(cwd, options.project)) {
        continue;
      }

      const messageId = row.message?.id ?? row.uuid ?? '';
      const key = `${row.sessionId ?? basename(file)}:${row.requestId ?? ''}:${messageId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      events.push({
        threadId: row.sessionId ?? basename(file, '.jsonl'),
        timestamp: row.timestamp,
        created: row.timestamp,
        model: row.message?.model ?? null,
        cwd,
        usage,
        source: file,
      });
    }
  }

  summarizeEvents(events, report, options);
  report.limitUsage = claudeLimitUsage();
  if (report.limitUsage.every((entry) => entry.source === 'unknown')) {
    report.warnings.push('Claude local transcripts expose token usage, but rate-limit percentages require opt-in statusLine capture.');
  }
  return report;
}

function loadGeminiProjectMap(geminiHome) {
  const raw = safeReadJson(join(geminiHome, 'projects.json'), { projects: {} });
  const slugToPath = new Map();

  for (const [projectPath, slug] of Object.entries(raw.projects ?? {})) {
    slugToPath.set(slug, projectPath);
  }

  return slugToPath;
}

function geminiUsageFromRow(row) {
  const tokens = row?.tokens;
  if (!tokens) {
    return null;
  }

  return {
    inputTokens: Number(tokens.input ?? 0),
    outputTokens: Number(tokens.output ?? 0),
    cachedTokens: Number(tokens.cached ?? 0),
    cacheCreationTokens: 0,
    cacheReadTokens: Number(tokens.cached ?? 0),
    reasoningTokens: Number(tokens.thoughts ?? 0),
    toolTokens: Number(tokens.tool ?? 0),
    totalTokens: Number(tokens.total ?? 0),
  };
}

function geminiLimitUsage(report, config, registry) {
  const plan = config.gemini?.plan;
  const planInfo = plan ? registry.providers?.gemini?.plans?.[plan] : null;
  const limit = planInfo?.quotas?.dailyRequests;
  const todayEvents = report.recentDailyTotals.find((row) => row.day === todayLocalDay())?.events ?? 0;

  if (!plan) {
    return [unknownLimit('1d', 'requests', 'Gemini plan is not configured. Run `codaur config set-plan gemini <free|aiPro|aiUltra|standard|enterprise>`.')];
  }

  if (!limit) {
    return [unknownLimit('1d', 'requests', `Gemini plan '${plan}' has no daily request limit in the registry.`)];
  }

  return [
    limitEntry({
      window: '1d',
      unit: 'requests',
      used: todayEvents,
      limit,
      resetsAt: nextLocalMidnightEpochSeconds(),
      source: 'registry',
      confidence: 'estimated',
      note: `Estimated from local Gemini CLI event rows against ${planInfo.label ?? plan} daily request quota. One prompt can produce multiple provider requests, so this is an approximation.`,
    }),
  ];
}

function collectGeminiUsage(options, config, registry) {
  const geminiHome = process.env.GEMINI_HOME || join(homedir(), '.gemini');
  const tmpDir = join(geminiHome, 'tmp');
  const projectMap = loadGeminiProjectMap(geminiHome);
  const report = makeBaseReport('gemini', geminiHome, { tmpDir, projects: join(geminiHome, 'projects.json') }, options);
  const events = [];

  if (!existsSync(tmpDir)) {
    report.warnings.push(`Gemini tmp directory not found at ${tmpDir}`);
    report.limitUsage = geminiLimitUsage(report, config, registry);
    return report;
  }

  for (const file of collectJsonlFiles(tmpDir)) {
    const projectSlug = basename(dirname(dirname(file)));
    const cwd = projectMap.get(projectSlug) ?? null;
    if (!matchesProject(cwd, options.project)) {
      continue;
    }

    const threadId = basename(file, '.jsonl');
    for (const row of readJsonl(file)) {
      const usage = geminiUsageFromRow(row);
      if (!usage) {
        continue;
      }

      events.push({
        threadId,
        timestamp: row.timestamp,
        created: row.timestamp,
        model: row.model ?? null,
        cwd,
        usage,
        source: file,
      });
    }
  }

  summarizeEvents(events, report, options);
  report.limitUsage = geminiLimitUsage(report, config, registry);
  if (report.limitUsage.every((entry) => entry.source === 'unknown')) {
    report.warnings.push('Gemini CLI local logs expose token usage, but request-limit percentage needs a configured plan.');
  }
  return report;
}

function antigravityLimitUsage(report, config) {
  const customLimits = config.antigravity?.customLimits;
  if (Array.isArray(customLimits) && customLimits.length > 0) {
    return customLimits.map((custom) =>
      limitEntry({
        window: custom.window ?? 'custom',
        unit: custom.unit ?? 'events',
        used: report.totals.events,
        limit: Number(custom.limit),
        resetsAt: custom.resetsAt ?? null,
        source: 'custom',
        confidence: 'estimated',
        note: custom.note ?? 'Custom Antigravity limit configured by the user.',
      }),
    );
  }

  return [unknownLimit('plan', 'work', 'Antigravity public docs describe plan-dependent work-based limits but do not publish numeric quotas.')];
}

function collectAntigravityUsage(options, config) {
  const geminiHome = process.env.GEMINI_HOME || join(homedir(), '.gemini');
  const antigravityHome = process.env.ANTIGRAVITY_HOME || join(geminiHome, 'antigravity');
  const conversationsDir = join(antigravityHome, 'conversations');
  const report = makeBaseReport('antigravity', antigravityHome, { conversationsDir }, options);

  if (!existsSync(conversationsDir)) {
    report.warnings.push(`Antigravity conversations directory not found at ${conversationsDir}`);
    report.limitUsage = antigravityLimitUsage(report, config);
    return report;
  }

  if (options.project) {
    report.warnings.push('Antigravity local protobuf conversations do not expose a reliable project path for filtering.');
  }

  const conversations = collectFiles(conversationsDir, (_path, name) => name.endsWith('.pb'))
    .map((file) => {
      const stat = statSync(file);
      const updated = stat.mtime.toISOString();
      return {
        id: basename(file, '.pb'),
        updated,
        created: stat.birthtime.toISOString(),
        model: null,
        cwd: null,
        tokens: null,
        usage: null,
        source: file,
      };
    })
    .filter((row) => !options.today || localDay(row.updated) === todayLocalDay());

  const daily = new Map();
  for (const row of conversations) {
    const day = localDay(row.updated);
    if (!isWithinReportWindow(row.updated, options)) {
      continue;
    }
    if (!daily.has(day)) {
      daily.set(day, { day, threads: 0, events: 0, tokens: null, usage: null });
    }
    const dailyRow = daily.get(day);
    dailyRow.threads += 1;
    dailyRow.events += 1;
  }

  report.totals.threads = conversations.length;
  report.totals.events = conversations.length;
  report.totals.tokens = null;
  report.totals.todayTokens = null;
  report.recentDailyTotals = [...daily.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, options.days);
  report.recentThreads = conversations.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated)).slice(0, DEFAULT_THREAD_LIMIT);
  report.limitUsage = antigravityLimitUsage(report, config);
  report.warnings.push('Antigravity stores conversations as protobuf files; no readable local token counters were found.');
  report.warnings.push('Antigravity local logs show model polling/auth activity but not per-turn token usage or rate-limit snapshots.');
  return report;
}

function collectUsage(options, config, registry) {
  const collectors = {
    codex: (providerOptions) => collectCodexUsage(providerOptions),
    claude: (providerOptions) => collectClaudeUsage(providerOptions),
    gemini: (providerOptions) => collectGeminiUsage(providerOptions, config, registry),
    antigravity: (providerOptions) => collectAntigravityUsage(providerOptions, config),
  };

  if (options.provider === 'all') {
    return {
      provider: 'all',
      generatedAt: new Date().toISOString(),
      filters: {
        today: options.today,
        days: options.days,
        project: options.project,
      },
      limitRegistry: registryMetadata(registry),
      reports: PROVIDERS.map((provider) => collectors[provider](options)),
    };
  }

  const report = collectors[options.provider](options);
  report.limitRegistry = registryMetadata(registry);
  return report;
}

function registryMetadata(registry) {
  return {
    updatedAt: registry.updatedAt ?? null,
    cacheFile: LIMITS_CACHE_FILE,
    refreshError: registry.refreshError ?? null,
  };
}

function printRateLimit(snapshot) {
  if (!snapshot) {
    console.log('Latest rate-limit snapshot: n/a');
    return;
  }

  console.log('Latest rate-limit snapshot');
  console.log(`Captured: ${new Date(snapshot.timestamp).toLocaleString()}`);
  console.log(`Plan: ${snapshot.planType ?? 'n/a'}`);
  console.log(`Primary: ${fmtPct(snapshot.primary?.used_percent)} used, resets ${fmtReset(snapshot.primary?.resets_at)}`);
  console.log(`Secondary: ${fmtPct(snapshot.secondary?.used_percent)} used, resets ${fmtReset(snapshot.secondary?.resets_at)}`);
  console.log(`Last turn tokens: ${fmtInt(snapshot.lastTokenUsage?.total_tokens)}`);
  console.log(`Session total tokens: ${fmtInt(snapshot.totalTokenUsage?.total_tokens)}`);
}

function printLimitUsage(entries) {
  console.log('Usage limits');
  if (!entries?.length) {
    console.log('n/a');
    return;
  }

  for (const entry of entries) {
    const percent = fmtPct(entry.usedPercent);
    const usedLimit = entry.used != null || entry.limit != null ? ` (${fmtInt(entry.used)} / ${fmtInt(entry.limit)} ${entry.unit})` : '';
    const reset = entry.resetsAt ? `, resets ${fmtReset(entry.resetsAt)}` : '';
    const label = `${entry.window}: ${percent}${usedLimit}${reset}`;
    console.log(`${label} [${entry.source}, ${entry.confidence}]`);
    if (entry.note) {
      console.log(`  ${entry.note}`);
    }
  }
}

function printablePath(path) {
  return path ? path.replace(homedir(), '~') : 'n/a';
}

function printOneReport(report) {
  console.log(`${report.provider[0].toUpperCase()}${report.provider.slice(1)} local usage`);
  console.log(`Data home: ${report.dataHome}`);
  if (report.filters.project) {
    console.log(`Project: ${report.filters.project}`);
  }
  console.log(`Threads tracked: ${fmtInt(report.totals.threads)}`);
  console.log(`Events counted: ${fmtInt(report.totals.events)}`);
  console.log(`Tokens today: ${fmtInt(report.totals.todayTokens)}`);
  console.log(`Tokens all time: ${fmtInt(report.totals.tokens)}`);

  if (report.totals.usage && report.totals.tokens != null && report.provider !== 'codex') {
    console.log(
      `Breakdown: input ${fmtInt(report.totals.usage.inputTokens)}, output ${fmtInt(
        report.totals.usage.outputTokens,
      )}, cached ${fmtInt(report.totals.usage.cachedTokens)}, reasoning ${fmtInt(
        report.totals.usage.reasoningTokens,
      )}`,
    );
  }

  console.log('');
  printLimitUsage(report.limitUsage);

  console.log('');
  printRateLimit(report.latestRateLimitSnapshot);

  console.log('');
  console.log(report.filters.today ? "Today's totals" : `Recent daily totals (${report.filters.days} days)`);
  if (report.recentDailyTotals.length === 0) {
    console.log('No matching usage found.');
  }
  for (const row of report.recentDailyTotals) {
    const tokens = row.tokens == null ? 'n/a'.padStart(12) : fmtInt(row.tokens).padStart(12);
    console.log(`${row.day}  ${tokens} tokens  ${row.threads} thread(s)`);
  }

  console.log('');
  console.log('Recent threads');
  if (report.recentThreads.length === 0) {
    console.log('No matching threads found.');
  }
  for (const row of report.recentThreads) {
    const updated = row.updated?.replace('T', ' ').replace(/\.\d+Z$/, '') ?? 'n/a';
    const tokens = row.tokens == null ? 'n/a'.padStart(12) : fmtInt(row.tokens).padStart(12);
    console.log(`${updated}  ${tokens}  ${row.model ?? 'unknown'}  ${printablePath(row.cwd)}`);
  }

  if (report.warnings.length) {
    console.log('');
    console.log('Notes');
    for (const warning of report.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function printText(report) {
  if (report.provider === 'all') {
    report.reports.forEach((providerReport, index) => {
      if (index > 0) {
        console.log('');
        console.log('---');
        console.log('');
      }
      printOneReport(providerReport);
    });
    return;
  }

  printOneReport(report);
}

async function printReport(options) {
  const config = loadConfig();
  const registry = await loadLimitsRegistry(options);
  const report = collectUsage(options, config, registry);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
}

function clearForWatch(options) {
  if (!options.json && process.stdout.isTTY) {
    process.stdout.write('\x1b[2J\x1b[H');
  }
}

function printConfig(options) {
  const config = loadConfig();
  if (options.json) {
    console.log(JSON.stringify({ configFile: CONFIG_FILE, config }, null, 2));
    return;
  }

  console.log(`Config file: ${CONFIG_FILE}`);
  console.log(JSON.stringify(config, null, 2));
}

function setProviderPlan(provider, plan) {
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  if (!plan) {
    throw new Error('Missing plan value.');
  }

  const config = loadConfig();
  config[provider] = config[provider] ?? {};
  config[provider].plan = plan;
  saveConfig(config);
  console.log(`Set ${provider}.plan to ${plan}`);
  console.log(`Config file: ${CONFIG_FILE}`);
}

async function handleLimitsCommand(options) {
  const [subcommand] = options.commandArgs;
  if (subcommand === 'refresh') {
    const registry = await refreshLimitsCache(loadDefaultRegistry());
    if (options.json) {
      console.log(JSON.stringify({ cacheFile: LIMITS_CACHE_FILE, registry }, null, 2));
    } else {
      console.log(`Refreshed limits cache: ${LIMITS_CACHE_FILE}`);
      console.log(`Updated at: ${registry.updatedAt}`);
    }
    return;
  }

  if (subcommand === 'status' || !subcommand) {
    const cached = safeReadJson(LIMITS_CACHE_FILE, null);
    const age = cacheAgeMs();
    const status = {
      defaultFile: DEFAULT_LIMITS_FILE,
      cacheFile: LIMITS_CACHE_FILE,
      cacheExists: Boolean(cached),
      cacheUpdatedAt: cached?.updatedAt ?? null,
      cacheAgeHours: Number.isFinite(age) ? age / (1000 * 60 * 60) : null,
      cacheFresh: Boolean(cached) && isCacheFresh(),
      refreshIntervalDays: 7,
    };

    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(`Default registry: ${status.defaultFile}`);
      console.log(`Cache file: ${status.cacheFile}`);
      console.log(`Cache exists: ${status.cacheExists}`);
      console.log(`Cache updated: ${status.cacheUpdatedAt ?? 'n/a'}`);
      console.log(`Cache fresh: ${status.cacheFresh}`);
    }
    return;
  }

  throw new Error(`Unknown limits command: ${subcommand}`);
}

function handleConfigCommand(options) {
  const [subcommand, provider, plan] = options.commandArgs;
  if (subcommand === 'show' || !subcommand) {
    printConfig(options);
    return;
  }

  if (subcommand === 'set-plan') {
    setProviderPlan(provider, plan);
    return;
  }

  throw new Error(`Unknown config command: ${subcommand}`);
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function installClaudeIntegration() {
  const claudeHome = process.env.CLAUDE_HOME || join(homedir(), '.claude');
  const settingsFile = join(claudeHome, 'settings.json');
  mkdirSync(claudeHome, { recursive: true });
  const settings = safeReadJson(settingsFile, {});

  if (existsSync(settingsFile)) {
    const backupFile = join(claudeHome, `settings.json.codaur-backup-${timestampForFile()}`);
    copyFileSync(settingsFile, backupFile);
    console.log(`Backed up Claude settings to ${backupFile}`);
  }

  settings.statusLine = {
    ...(settings.statusLine ?? {}),
    type: 'command',
    command: `node ${JSON.stringify(CLI_PATH)} capture claude-statusline`,
  };
  writeJsonFile(settingsFile, settings);
  mkdirSync(CLAUDE_CAPTURE_DIR, { recursive: true });
  console.log(`Installed Claude statusLine capture in ${settingsFile}`);
  console.log(`Captured rate limits will be stored at ${CLAUDE_CAPTURE_FILE}`);
}

function handleIntegrateCommand(options) {
  const [provider] = options.commandArgs;
  if (provider === 'claude') {
    installClaudeIntegration();
    return;
  }

  throw new Error(`Unknown integration target: ${provider ?? 'missing'}`);
}

function formatStatusLineRateLimits(rateLimits) {
  const parts = [];
  const five = rateLimits?.five_hour;
  const seven = rateLimits?.seven_day;
  if (five?.used_percentage != null) {
    parts.push(`5h ${Math.round(Number(five.used_percentage))}%`);
  }
  if (seven?.used_percentage != null) {
    parts.push(`7d ${Math.round(Number(seven.used_percentage))}%`);
  }
  return parts.join(' | ');
}

function handleCaptureCommand(options) {
  const [target] = options.commandArgs;
  if (target !== 'claude-statusline') {
    throw new Error(`Unknown capture target: ${target ?? 'missing'}`);
  }

  const input = readFileSync(0, 'utf8');
  let payload = null;
  try {
    payload = JSON.parse(input || '{}');
  } catch {
    payload = null;
  }

  if (payload?.rate_limits) {
    writeJsonFile(CLAUDE_CAPTURE_FILE, {
      capturedAt: new Date().toISOString(),
      sessionId: payload.session_id ?? null,
      model: payload.model ?? null,
      cwd: payload.workspace?.current_dir ?? null,
      rate_limits: payload.rate_limits,
    });
  }

  const model = payload?.model?.display_name ?? payload?.model?.name ?? 'Claude';
  const limitText = formatStatusLineRateLimits(payload?.rate_limits);
  console.log(limitText ? `[${model}] ${limitText}` : `[${model}]`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.version) {
    console.log(VERSION);
    return;
  }

  if (options.command === 'limits') {
    await handleLimitsCommand(options);
    return;
  }

  if (options.command === 'config') {
    handleConfigCommand(options);
    return;
  }

  if (options.command === 'integrate') {
    handleIntegrateCommand(options);
    return;
  }

  if (options.command === 'capture') {
    handleCaptureCommand(options);
    return;
  }

  if (!options.watch) {
    await printReport(options);
    return;
  }

  clearForWatch(options);
  await printReport(options);
  setInterval(() => {
    clearForWatch(options);
    printReport(options).catch((error) => {
      console.error(error.message);
    });
  }, WATCH_INTERVAL_MS);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  console.error('');
  console.error(usage());
  process.exitCode = 1;
}
