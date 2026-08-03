/**
 * Registers flick's MCP bridge in agy's own config, so a Gemini lead can delegate back
 * into Claude subagents.
 *
 * Writes to agy's user-level MCP config. The file is shared with anything else the user
 * has configured, so this merges rather than replaces, and never drops unknown keys.
 */

import { readFile, writeFile, mkdir, rm, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Where agy reads its MCP servers from.
 *
 * Verified on this machine: agy (Antigravity CLI) shares the Gemini CLI's config tree
 * at ~/.gemini/config/, not a directory of its own. `AGY_CONFIG_DIR` overrides it in
 * case a future release moves.
 */
export function agyConfigPath(): string {
  const dir = process.env.AGY_CONFIG_DIR ?? join(homedir(), '.gemini', 'config');
  return join(dir, 'mcp_config.json');
}

export interface InstallResult {
  path: string;
  action: 'created' | 'updated' | 'unchanged';
  entry: Record<string, unknown>;
}

export function agyHooksPath(): string {
  const dir = process.env.AGY_CONFIG_DIR ?? join(homedir(), '.gemini', 'config');
  return join(dir, 'hooks.json');
}

/**
 * Register Shadow's permission gate as an agy PreToolUse hook.
 *
 * This is the only way Shadow can enforce anything on a Gemini lead: agy runs its own
 * loop in its own process, and a `deny` from this hook is a hard block.
 *
 * The hook lives in agy's *global* config, so it also fires for sessions the user
 * starts themselves. `shadow hook-gate` handles that by allowing immediately when the
 * marker environment variable Shadow sets is absent — the hook is inert outside Shadow.
 */
/** Name of Shadow's entry inside agy's named-hook map. */
const HOOK_NAME = 'shadow-gate';

/**
 * agy's JSON reader rejects Windows paths even when the backslashes are correctly
 * escaped — it reports `invalid escape sequence \U` and then loads no hooks at all,
 * silently. Forward slashes parse, and both cmd and node accept them.
 */
function portablePath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Where the generated launcher script lives.
 *
 * agy runs hook commands via `cmd /c <string>` on Windows, and cmd's quote parsing does
 * not reconstruct `"node" "bin.js" hook-gate` the way `sh -c` would — it mis-splits on
 * the space inside `Program Files` and fails with exit 1 before the hook ever runs
 * (confirmed by reproducing the exact invocation directly against `cmd /c`). The fix is
 * to give cmd a single unquoted token: a batch file whose own path has no spaces, which
 * does the real quoting internally as an ordinary script.
 */
function launcherPath(): string {
  return join(homedir(), '.flick', 'bin', process.platform === 'win32' ? 'hook-gate.cmd' : 'hook-gate.sh');
}

async function writeLauncher(): Promise<string> {
  const path = launcherPath();
  const node = process.execPath;
  const bin = process.argv[1] ?? '';

  const script =
    process.platform === 'win32'
      ? `@echo off\r\n"${node}" "${bin}" hook-gate %*\r\n`
      : `#!/bin/sh\nexec "${node}" "${bin}" hook-gate "$@"\n`;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, script, 'utf8');
  if (process.platform !== 'win32') {
    await chmod(path, 0o755);
  }
  return path;
}

export async function installHook(): Promise<InstallResult> {
  const path = agyHooksPath();
  const launcher = await writeLauncher();

  // The file is a map of *named* hooks, each holding its event lists — not the events
  // at the top level. Getting this wrong logs `loaded 0 named hooks` and nothing runs.
  const entry = {
    PreToolUse: [
      {
        // `matcher` is mandatory here. `*` on purpose: a policy hook that covers only
        // some tools is trivially routed around by using a different one — which is
        // exactly what happened when this was first tried with a narrow matcher.
        matcher: '*',
        hooks: [
          {
            type: 'command',
            // A single unquoted path — no embedded quoting for cmd/sh to mis-parse.
            command: portablePath(launcher),
            timeout: 60,
          },
        ],
      },
    ],
  };

  const existing = await readFile(path, 'utf8').catch(() => null);
  let config: Record<string, any> = {};
  if (existing !== null && existing.trim() !== '') {
    try {
      config = JSON.parse(existing);
    } catch {
      throw new Error(
        `${path} exists but is not valid JSON. Fix or remove it before installing the hook.`,
      );
    }
  }

  if (JSON.stringify(config[HOOK_NAME] ?? null) === JSON.stringify(entry)) {
    return { path, action: 'unchanged', entry };
  }

  // Other named hooks are the user's; only Shadow's own entry is replaced.
  config[HOOK_NAME] = entry;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { path, action: existing === null ? 'created' : 'updated', entry };
}

export async function installBridge(cwd: string): Promise<InstallResult> {
  const path = agyConfigPath();
  const entry = {
    // argv[1] is the resolved bin.js, which is correct whether flick is run from the
    // repo, via npm link, or from a global install.
    command: process.execPath,
    args: [process.argv[1] ?? '', 'mcp'],
    cwd,
  };

  const existing = await readFile(path, 'utf8').catch(() => null);
  let config: Record<string, any> = {};
  // agy ships this file empty on a fresh install, which is not valid JSON but also not
  // a corrupt config — treat blank as "nothing configured yet".
  if (existing !== null && existing.trim() !== '') {
    try {
      config = JSON.parse(existing);
    } catch {
      throw new Error(
        `${path} exists but is not valid JSON. Fix or remove it before installing the bridge.`,
      );
    }
  }

  config.mcpServers ??= {};
  const before = JSON.stringify(config.mcpServers.flick ?? null);
  config.mcpServers.flick = entry;

  if (before === JSON.stringify(entry)) {
    return { path, action: 'unchanged', entry };
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { path, action: existing === null ? 'created' : 'updated', entry };
}
