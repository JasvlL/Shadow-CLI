/**
 * quota-reader.ts
 *
 * Reads REAL usage data from Claude CLI's local JSONL session files.
 *
 * Claude CLI stores per-project sessions at:
 *   ~/.claude/projects/<project-slug>/<session-id>.jsonl
 *
 * Each JSONL line of type "assistant" contains:
 *   { type: "assistant", timestamp: "ISO", message: { usage: {
 *     input_tokens, output_tokens,
 *     cache_read_input_tokens, cache_creation_input_tokens
 *   }}}
 *
 * We scan ALL project JSONL files, extract assistant messages from the last
 * 7 days, and sum up the tokens by day — exactly matching what Claude CLI
 * shows in its own /usage panel.
 *
 * Agy does NOT expose quota % in its NDJSON stream. We derive bars from
 * the tokens Shadow has observed, relative to documented plan limits.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ──────────────────────────────── Types ────────────────────────────────────

export interface QuotaBar {
  label: string;
  /** 0–100 percentage USED */
  pct: number;
  /** Human-readable status line */
  detail: string;
  color: 'green' | 'yellow' | 'red';
}

export interface ProviderQuotaData {
  provider: 'claude' | 'agy';
  section: string;
  bars: QuotaBar[];
}

export interface LiveQuotaData {
  sections: ProviderQuotaData[];
  fetchedAt: string;
  stale?: string;
}

// ──────────────────────────── Cache helpers ─────────────────────────────────

const SHADOW_DIR = path.join(os.homedir(), '.shadow');
const QUOTA_CACHE = path.join(SHADOW_DIR, 'quota-cache.json');

export function readCache(): LiveQuotaData | null {
  try {
    return JSON.parse(fs.readFileSync(QUOTA_CACHE, 'utf8')) as LiveQuotaData;
  } catch {
    return null;
  }
}

function writeCache(data: LiveQuotaData): void {
  try {
    if (!fs.existsSync(SHADOW_DIR)) fs.mkdirSync(SHADOW_DIR, { recursive: true });
    fs.writeFileSync(QUOTA_CACHE, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* best-effort */ }
}

function barColor(pct: number): 'green' | 'yellow' | 'red' {
  return pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green';
}

// ─────────────────── Read JSONL session files ────────────────────────────────

interface AssistantUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

interface JournalLine {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    usage?: AssistantUsage;
  };
}

/** Recursively walk a directory and yield all .jsonl file paths. */
function* walkJsonl(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkJsonl(full);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield full;
  }
}

interface TokenBucket {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  model: string;
}

/**
 * Parse all Claude CLI JSONL session files.
 * Returns a map of { "YYYY-MM-DD" → { model → TokenBucket } }.
 * Only processes lines with timestamps >= cutoff.
 */
function parseClaudeJSONL(cutoff: Date): Map<string, Map<string, TokenBucket>> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const projectsDir = path.join(claudeDir, 'projects');
  const byDay = new Map<string, Map<string, TokenBucket>>();

  if (!fs.existsSync(projectsDir)) return byDay;

  for (const filePath of walkJsonl(projectsDir)) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const rawLine of content.split('\n')) {
      if (!rawLine.trim()) continue;
      let line: JournalLine;
      try {
        line = JSON.parse(rawLine) as JournalLine;
      } catch {
        continue;
      }

      if (line.type !== 'assistant') continue;
      if (!line.timestamp || !line.message?.usage) continue;

      const ts = new Date(line.timestamp);
      if (Number.isNaN(ts.getTime()) || ts < cutoff) continue;

      const dayKey = ts.toISOString().slice(0, 10); // "YYYY-MM-DD"
      const model = line.message.model ?? 'unknown';
      const u = line.message.usage;

      if (!byDay.has(dayKey)) byDay.set(dayKey, new Map());
      const dayMap = byDay.get(dayKey)!;
      if (!dayMap.has(model)) {
        dayMap.set(model, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, model });
      }
      const bucket = dayMap.get(model)!;
      bucket.input += u.input_tokens ?? 0;
      bucket.output += u.output_tokens ?? 0;
      bucket.cacheRead += u.cache_read_input_tokens ?? 0;
      bucket.cacheWrite += u.cache_creation_input_tokens ?? 0;
    }
  }

  return byDay;
}

// ─────────────────── Claude CLI quota bars ──────────────────────────────────

async function fetchClaudeQuota(): Promise<ProviderQuotaData[]> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 3600 * 1000);
  const oneDayAgo = new Date(now - 24 * 3600 * 1000);

  const byDay = parseClaudeJSONL(sevenDaysAgo);

  // Aggregate totals
  let weeklyInput = 0, weeklyOutput = 0, weeklyCache = 0;
  let todayInput = 0, todayOutput = 0;
  const modelWeekly: Record<string, number> = {};

  for (const [dayKey, modelMap] of byDay) {
    const dayDate = new Date(dayKey + 'T00:00:00Z');
    for (const [model, bucket] of modelMap) {
      const total = bucket.input + bucket.output + bucket.cacheRead;
      weeklyInput += bucket.input;
      weeklyOutput += bucket.output;
      weeklyCache += bucket.cacheRead;
      modelWeekly[model] = (modelWeekly[model] ?? 0) + total;
      if (dayDate >= oneDayAgo) {
        todayInput += bucket.input;
        todayOutput += bucket.output;
      }
    }
  }

  const weeklyTokens = weeklyInput + weeklyOutput;
  const todayTokens = todayInput + todayOutput;

  if (weeklyTokens === 0 && todayTokens === 0) return [];

  // Claude Pro: ~5M tokens/week (conservative). Claude Pro Max: ~10M.
  // We try to detect Pro Max by checking if weekly > 5M (which would mean Pro Max).
  const WEEKLY_LIMIT = weeklyTokens > 4_000_000 ? 10_000_000 : 5_000_000;
  const DAILY_LIMIT = WEEKLY_LIMIT / 7;

  const weeklyPct = Math.min(100, (weeklyTokens / WEEKLY_LIMIT) * 100);
  const todayPct = Math.min(100, (todayTokens / DAILY_LIMIT) * 100);

  // Top 3 models this week
  const topModels = Object.entries(modelWeekly)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m, t]) => `${m.replace('claude-', '')}: ${(t / 1000).toFixed(0)}k`)
    .join(' · ');

  // Compute "resets in X days" — Claude Pro resets 7 days after the oldest
  // entry in the current rolling window.
  const sortedDays = [...byDay.keys()].sort();
  const oldestDayInWindow = sortedDays[0];
  let resetsInText = '';
  if (oldestDayInWindow) {
    const resetDate = new Date(new Date(oldestDayInWindow + 'T00:00:00Z').getTime() + 7 * 24 * 3600 * 1000);
    const diffMs = resetDate.getTime() - now;
    if (diffMs > 0) {
      const diffH = Math.round(diffMs / 3600000);
      resetsInText = diffH >= 24 ? `Refreshes in ${Math.floor(diffH / 24)}d ${diffH % 24}h` : `Refreshes in ${diffH}h`;
    }
  }

  const bars: QuotaBar[] = [
    {
      label: 'Current Week (all models)',
      pct: weeklyPct,
      detail: [
        `${weeklyTokens.toLocaleString()} / ~${(WEEKLY_LIMIT / 1_000_000).toFixed(0)}M tokens`,
        resetsInText,
      ].filter(Boolean).join(' · '),
      color: barColor(weeklyPct),
    },
    {
      label: "Today's Usage",
      pct: todayPct,
      detail: `${todayTokens.toLocaleString()} / ~${(DAILY_LIMIT / 1_000_000).toFixed(1)}M tokens today${topModels ? '\n         ' + topModels : ''}`,
      color: barColor(todayPct),
    },
  ];

  return [{ provider: 'claude', section: 'CLAUDE CLI MODELS', bars }];
}

// ─────────────────── Agy token tracking ─────────────────────────────────────

function buildAgyBars(weeklyUsed: number, sessionUsed: number): ProviderQuotaData[] {
  const limitsPath = path.join(SHADOW_DIR, 'agy-limits.json');
  let limits = { weeklyTokens: 5_000_000, fiveHourTokens: 1_000_000 };
  try {
    Object.assign(limits, JSON.parse(fs.readFileSync(limitsPath, 'utf8')));
  } catch { /* use defaults */ }

  const weeklyPct = Math.min(100, (weeklyUsed / limits.weeklyTokens) * 100);
  const fiveHourPct = Math.min(100, (sessionUsed / limits.fiveHourTokens) * 100);

  return [{
    provider: 'agy',
    section: 'AGY USAGE (TRACKED IN SHADOW)',
    bars: [
      {
        label: 'Weekly Limit (Est.)',
        pct: weeklyPct,
        detail: `${(100 - weeklyPct).toFixed(1)}% remaining · ${weeklyUsed.toLocaleString()} / ${(limits.weeklyTokens / 1_000_000).toFixed(0)}M tokens\n         (True quota is hidden by Agy; type /usage inside 'agy' for exact global account limits)`,
        color: barColor(weeklyPct),
      },
      {
        label: 'Five Hour Limit (Est.)',
        pct: fiveHourPct,
        detail: `${(100 - fiveHourPct).toFixed(1)}% remaining · ${sessionUsed.toLocaleString()} / ${(limits.fiveHourTokens / 1_000_000).toFixed(0)}M tokens this session`,
        color: barColor(fiveHourPct),
      },
    ],
  }];
}

// ────────────────────────── Public API ──────────────────────────────────────

export interface FetchOptions {
  agySessionTokens?: number;
  agyWeeklyTokens?: number;
}

export async function fetchLiveQuota(opts: FetchOptions = {}): Promise<LiveQuotaData> {
  const cache = readCache();
  try {
    const [claudeData] = await Promise.all([fetchClaudeQuota()]);
    const agyData = buildAgyBars(opts.agyWeeklyTokens ?? 0, opts.agySessionTokens ?? 0);

    const sections = [...claudeData, ...agyData];
    const result: LiveQuotaData = { sections, fetchedAt: new Date().toISOString() };
    writeCache(result);
    return result;
  } catch (err) {
    if (cache) return { ...cache, stale: (err as Error).message };
    return { sections: [], fetchedAt: new Date().toISOString(), stale: (err as Error).message };
  }
}

export function getCachedQuota(): LiveQuotaData | null {
  return readCache();
}
