/**
 * `installHook` writes agy's hooks.json. Two real bugs lived here before this test
 * existed: the top level must be a map of *named* hooks (a flat PreToolUse array loads
 * silently as "0 named hooks"), and the launcher command must be a single unquoted
 * token — `cmd /c "node" "bin.js" hook-gate` fails outright on a path containing a
 * space, because cmd's quote parsing does not reconstruct it the way `sh -c` would.
 */
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agyHooksPath, installHook } from '../src/bridge-install.js';

let configDir: string;
const savedConfigDir = process.env.AGY_CONFIG_DIR;
const savedHome = process.env.SHADOW_HOME;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'shadow-agyconfig-'));
  process.env.AGY_CONFIG_DIR = configDir;
  process.env.SHADOW_HOME = mkdtempSync(join(tmpdir(), 'shadow-home-'));
});

afterEach(() => {
  if (savedConfigDir === undefined) delete process.env.AGY_CONFIG_DIR;
  else process.env.AGY_CONFIG_DIR = savedConfigDir;
  if (savedHome === undefined) delete process.env.SHADOW_HOME;
  else process.env.SHADOW_HOME = savedHome;
});

describe('installHook', () => {
  it('writes a map of named hooks, not a flat PreToolUse array', async () => {
    await installHook();
    const config = JSON.parse(readFileSync(agyHooksPath(), 'utf8'));

    // agy's parser reads top-level keys as hook *names*; each name owns its own event
    // lists. A bare {"PreToolUse":[...]} at the top level parses but loads zero hooks.
    expect(config['shadow-gate']).toBeDefined();
    expect(config['shadow-gate'].PreToolUse).toBeInstanceOf(Array);
    expect(config.PreToolUse).toBeUndefined();
  });

  it('sets a matcher, since PreToolUse groups without one never fire', async () => {
    await installHook();
    const config = JSON.parse(readFileSync(agyHooksPath(), 'utf8'));
    expect(config['shadow-gate'].PreToolUse[0].matcher).toBeTruthy();
  });

  it('points at a launcher path with no spaces and no embedded quotes', async () => {
    await installHook();
    const config = JSON.parse(readFileSync(agyHooksPath(), 'utf8'));
    const command = config['shadow-gate'].PreToolUse[0].hooks[0].command as string;

    expect(command).not.toContain(' ');
    expect(command).not.toContain('"');
    expect(command).not.toContain('\\'); // forward slashes only — agy rejects backslashes
  });

  it('writes a launcher script that itself carries the real quoting', async () => {
    await installHook();
    const config = JSON.parse(readFileSync(agyHooksPath(), 'utf8'));
    const command = (config['shadow-gate'].PreToolUse[0].hooks[0].command as string).replace(
      /\//g,
      require('node:path').sep,
    );
    const script = readFileSync(command, 'utf8');
    expect(script).toContain('hook-gate');
  });

  it('is idempotent — a second install changes nothing', async () => {
    await installHook();
    const first = readFileSync(agyHooksPath(), 'utf8');
    const result = await installHook();
    expect(result.action).toBe('unchanged');
    expect(readFileSync(agyHooksPath(), 'utf8')).toBe(first);
  });

  it('preserves named hooks the user configured themselves', async () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      agyHooksPath(),
      JSON.stringify({ 'my-lint-hook': { PostToolUse: [{ matcher: 'run_command', hooks: [] }] } }),
    );

    await installHook();
    const config = JSON.parse(readFileSync(agyHooksPath(), 'utf8'));
    expect(config['my-lint-hook']).toBeDefined();
    expect(config['shadow-gate']).toBeDefined();
  });

  it('refuses to clobber a corrupt hooks.json', async () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(agyHooksPath(), '{ not json');
    await expect(installHook()).rejects.toThrow(/not valid JSON/);
  });
});
