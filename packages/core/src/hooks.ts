/**
 * Lifecycle hooks.
 *
 * Run by flick rather than by either backend, so the same hook fires whichever provider
 * is leading. A `PreToolUse` hook that exits non-zero blocks the tool, which makes this
 * part of the permission path — see `createGate` in permissions.ts.
 *
 * ⚠️ A hook is arbitrary command execution described by a file in the project. That is
 * the whole point of hooks, and also the whole risk. Two deliberate limits:
 *   - loaded only from `<cwd>/.flick/hooks.json`, never inherited from parent
 *     directories, so opening a subdirectory of someone else's repo cannot run their
 *     hooks without you having opened that repo;
 *   - `flick --no-hooks` disables them outright.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionEnd';

export interface HookDef {
  /** Regex matched against the tool name. Omit to match every tool. */
  matcher?: string;
  command: string;
  /** Milliseconds before the hook is killed. */
  timeout?: number;
}

export type HookConfig = Partial<Record<HookEvent, HookDef[]>>;

export interface HookOutcome {
  command: string;
  exitCode: number;
  output: string;
  /** True when a PreToolUse hook refused the tool. */
  blocked: boolean;
}

export async function loadHooks(cwd: string, enabled = true): Promise<HookConfig> {
  if (!enabled) return {};

  const path = join(cwd, '.flick', 'hooks.json');
  const text = await readFile(path, 'utf8').catch(() => null);
  if (text === null || !text.trim()) return {};

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const config: HookConfig = {};
    for (const event of ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd'] as const) {
      const list = parsed[event];
      if (!Array.isArray(list)) continue;
      config[event] = list
        .filter((h): h is HookDef => Boolean(h) && typeof (h as HookDef).command === 'string')
        .map((h) => ({ matcher: h.matcher, command: h.command, timeout: h.timeout }));
    }
    return config;
  } catch {
    // A malformed hooks file must not silently run nothing *or* run something odd.
    throw new Error(`${path} is not valid JSON`);
  }
}

function matches(hook: HookDef, toolName: string): boolean {
  if (!hook.matcher) return true;
  try {
    return new RegExp(hook.matcher).test(toolName);
  } catch {
    // An invalid matcher matches nothing, rather than everything.
    return false;
  }
}

const DEFAULT_TIMEOUT = 30_000;

function runCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
  timeout: number,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/sh';
    const args = isWindows
      ? ['-NoProfile', '-NonInteractive', '-Command', command]
      : ['-c', command];

    const child = spawn(shell, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const append = (chunk: Buffer) => {
      if (output.length < 10_000) output += chunk.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const timer = setTimeout(() => child.kill(), timeout);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, output: `hook failed to start: ${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, output: output.trim() });
    });
  });
}

/**
 * Run every hook registered for an event.
 *
 * For `PreToolUse`, a non-zero exit blocks the tool and short-circuits the rest.
 */
export async function runHooks(
  config: HookConfig,
  event: HookEvent,
  cwd: string,
  context: { toolName?: string; toolInput?: unknown } = {},
): Promise<HookOutcome[]> {
  const hooks = (config[event] ?? []).filter(
    (hook) => !context.toolName || matches(hook, context.toolName),
  );
  if (hooks.length === 0) return [];

  const env: Record<string, string> = {
    FLICK_HOOK_EVENT: event,
    FLICK_TOOL_NAME: context.toolName ?? '',
    FLICK_TOOL_INPUT: context.toolInput === undefined ? '' : JSON.stringify(context.toolInput),
  };

  const outcomes: HookOutcome[] = [];
  for (const hook of hooks) {
    const { code, output } = await runCommand(hook.command, cwd, env, hook.timeout ?? DEFAULT_TIMEOUT);
    const blocked = event === 'PreToolUse' && code !== 0;
    outcomes.push({ command: hook.command, exitCode: code, output, blocked });
    if (blocked) break;
  }
  return outcomes;
}
