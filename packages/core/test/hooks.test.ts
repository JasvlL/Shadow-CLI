import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadHooks, runHooks } from '../src/hooks.js';
import { createGate } from '../src/permissions.js';

function repo(hooks?: unknown): string {
  const cwd = mkdtempSync(join(tmpdir(), 'flick-hooks-'));
  if (hooks !== undefined) {
    mkdirSync(join(cwd, '.flick'), { recursive: true });
    writeFileSync(join(cwd, '.flick', 'hooks.json'), JSON.stringify(hooks));
  }
  return cwd;
}

/** Exit non-zero on every platform the test suite runs on. */
const FAIL = process.platform === 'win32' ? 'exit 1' : 'exit 1';
const OK = process.platform === 'win32' ? 'exit 0' : 'exit 0';

describe('loadHooks', () => {
  it('reads hooks from .flick/hooks.json', async () => {
    const cwd = repo({ PreToolUse: [{ matcher: 'Bash', command: 'echo hi' }] });
    const config = await loadHooks(cwd);
    expect(config.PreToolUse).toHaveLength(1);
    expect(config.PreToolUse![0]!.matcher).toBe('Bash');
  });

  it('returns nothing when there is no hooks file', async () => {
    expect(await loadHooks(repo())).toEqual({});
  });

  it('returns nothing when disabled, which is what --no-hooks does', async () => {
    const cwd = repo({ PreToolUse: [{ command: 'echo hi' }] });
    expect(await loadHooks(cwd, false)).toEqual({});
  });

  it('refuses a malformed hooks file rather than silently running nothing', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flick-hooks-'));
    mkdirSync(join(cwd, '.flick'), { recursive: true });
    writeFileSync(join(cwd, '.flick', 'hooks.json'), '{ broken');
    await expect(loadHooks(cwd)).rejects.toThrow(/not valid JSON/);
  });

  it('ignores entries without a command', async () => {
    const cwd = repo({ PreToolUse: [{ matcher: 'X' }, { command: 'echo ok' }] });
    expect((await loadHooks(cwd)).PreToolUse).toHaveLength(1);
  });
});

describe('runHooks', () => {
  it('runs only hooks whose matcher matches the tool', async () => {
    const cwd = repo();
    const config = {
      PreToolUse: [
        { matcher: 'Bash', command: OK },
        { matcher: 'Write', command: OK },
      ],
    };
    const outcomes = await runHooks(config, 'PreToolUse', cwd, { toolName: 'Bash' });
    expect(outcomes).toHaveLength(1);
  });

  it('runs every hook when no matcher is set', async () => {
    const outcomes = await runHooks({ PreToolUse: [{ command: OK }] }, 'PreToolUse', repo(), {
      toolName: 'Anything',
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.blocked).toBe(false);
  });

  it('marks a non-zero PreToolUse hook as blocking and stops there', async () => {
    const config = { PreToolUse: [{ command: FAIL }, { command: OK }] };
    const outcomes = await runHooks(config, 'PreToolUse', repo(), { toolName: 'Bash' });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.blocked).toBe(true);
  });

  it('does not treat a failing PostToolUse hook as blocking', async () => {
    const outcomes = await runHooks({ PostToolUse: [{ command: FAIL }] }, 'PostToolUse', repo(), {
      toolName: 'Write',
    });
    expect(outcomes[0]!.blocked).toBe(false);
  });

  it('treats an invalid matcher as matching nothing, not everything', async () => {
    const config = { PreToolUse: [{ matcher: '[unclosed', command: FAIL }] };
    expect(await runHooks(config, 'PreToolUse', repo(), { toolName: 'Bash' })).toEqual([]);
  });
});

describe('hooks inside the permission gate', () => {
  const config = { allow: ['Read'], deny: ['Forbidden'] };

  it('blocks a tool the allow list would otherwise wave through', async () => {
    const gate = createGate({
      config,
      prompt: async () => true,
      preToolUse: async () => 'policy says no',
    });
    expect(await gate('Read', { path: 'a.ts' })).toBe(false);
  });

  it('lets the tool through when no hook objects', async () => {
    const gate = createGate({ config, prompt: async () => true, preToolUse: async () => null });
    expect(await gate('Read', { path: 'a.ts' })).toBe(true);
  });

  it('still refuses destructive commands before any hook runs', async () => {
    let hookRan = false;
    const gate = createGate({
      config,
      prompt: async () => true,
      preToolUse: async () => {
        hookRan = true;
        return null;
      },
    });
    expect(await gate('run_command', { command: 'rm -rf /' })).toBe(false);
    expect(hookRan).toBe(false);
  });

  it('records the hook as the reason for the denial', async () => {
    const decisions: string[] = [];
    const gate = createGate({
      config,
      prompt: async () => true,
      preToolUse: async () => 'lint failed',
      onDecision: (tool, decision, reason) => decisions.push(`${tool}:${decision}:${reason}`),
    });
    await gate('Write', { path: 'a.ts' });
    expect(decisions[0]).toMatch(/Write:deny:blocked by PreToolUse hook: lint failed/);
  });
});
