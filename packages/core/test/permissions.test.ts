import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, createGate } from '../src/permissions.js';

const config = { ...DEFAULT_CONFIG, deny: ['forbidden_tool'] };

describe('permission gate', () => {
  it('allows read-only tools without asking', async () => {
    const prompt = vi.fn();
    const gate = createGate({ config, prompt });
    expect(await gate('read_file', { path: 'a.ts' })).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('refuses deny-listed tools without asking', async () => {
    const prompt = vi.fn();
    const gate = createGate({ config, prompt });
    expect(await gate('forbidden_tool', {})).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('asks the user about a mutating tool and honours the answer', async () => {
    const yes = createGate({ config, prompt: async () => true });
    const no = createGate({ config, prompt: async () => false });
    expect(await yes('write_file', { path: 'a.ts' })).toBe(true);
    expect(await no('write_file', { path: 'a.ts' })).toBe(false);
  });

  it('denies when there is no prompt to ask — a headless run must not self-approve', async () => {
    const gate = createGate({ config });
    expect(await gate('write_file', { path: 'a.ts' })).toBe(false);
    expect(await gate('run_command', { command: 'ls' })).toBe(false);
  });

  it('refuses a destructive command even when the user would approve it', async () => {
    const prompt = vi.fn(async () => true);
    const gate = createGate({ config, prompt });
    expect(await gate('run_command', { command: 'rm -rf /' })).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('refuses a destructive command even when auto-approve is on', async () => {
    const gate = createGate({
      config: { ...config, autoApprove: true },
      prompt: async () => true,
    });
    expect(await gate('run_command', { command: 'git push --force origin main' })).toBe(false);
    // A harmless command still passes under auto-approve.
    expect(await gate('run_command', { command: 'npm test' })).toBe(true);
  });

  it('ignores auto-approve when nothing is attached to confirm with', async () => {
    const gate = createGate({ config: { ...config, autoApprove: true } });
    expect(await gate('write_file', { path: 'a.ts' })).toBe(false);
  });

  it('reports every decision with a reason', async () => {
    const decisions: string[] = [];
    const gate = createGate({
      config,
      prompt: async () => false,
      onDecision: (tool, decision, reason) => decisions.push(`${tool}:${decision}:${reason}`),
    });
    await gate('read_file', { path: 'a.ts' });
    await gate('run_command', { command: 'rm -rf /tmp/x' });
    await gate('write_file', { path: 'a.ts' });

    expect(decisions[0]).toMatch(/^read_file:allow:/);
    expect(decisions[1]).toMatch(/^run_command:deny:command matches destructive/);
    expect(decisions[2]).toBe('write_file:deny:user denied');
  });
});
