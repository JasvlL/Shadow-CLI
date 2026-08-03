/**
 * What `agy` is actually launched with.
 *
 * The flags decide whether a spawned agy can do any work at all: with neither
 * `--dangerously-skip-permissions` nor a hook to answer for it, agy waits in
 * `request-review` mode for a confirmation that can never arrive, then returns an empty
 * success. That failure is silent, which is why it needs a test at the argument level
 * rather than only end to end.
 */
import { describe, expect, it } from 'vitest';
import { AgyProvider } from '../src/agy.js';
import type { RunRequest } from '../src/types.js';

/** Reach the private arg builder — it is the unit under test here. */
function argsFor(req: Partial<RunRequest>, sessionRef: string | null = null): string[] {
  const provider = new AgyProvider();
  return (provider as unknown as {
    buildArgs(r: RunRequest, s: string | null): string[];
  }).buildArgs({ prompt: 'do it', cwd: process.cwd(), ...req }, sessionRef);
}

describe('agy launch flags', () => {
  it('never leaves prompting on, because a spawned agy has nobody to ask', () => {
    // No skipPermissions passed at all — the shape a caller gets when it forgets.
    const args = argsFor({});
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('sandboxes by default, so read-only work stays read-only', () => {
    expect(argsFor({})).toContain('--sandbox');
  });

  it('drops the sandbox only when the caller asks, for agents that write', () => {
    expect(argsFor({ sandbox: false })).not.toContain('--sandbox');
  });

  it('passes the model, the prompt and the workspace', () => {
    const args = argsFor({ model: 'gemini-3.1-pro-low', addDirs: ['/ws'] });
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-3.1-pro-low');
    expect(args).toContain('--add-dir');
    expect(args).toContain('/ws');
  });

  it('resumes a conversation when given a ref', () => {
    const args = argsFor({}, 'conv-123');
    expect(args).toContain('--conversation');
    expect(args[args.indexOf('--conversation') + 1]).toBe('conv-123');
  });

  it('folds the system prompt into the prompt, since agy has no flag for it', () => {
    const args = argsFor({ systemPrompt: 'BE TERSE' });
    const prompt = args[args.indexOf('--print') + 1]!;
    expect(prompt).toContain('BE TERSE');
    expect(prompt).toContain('do it');
  });

  it('asks for plan mode when planning', () => {
    const args = argsFor({ plan: true });
    expect(args).toContain('--mode');
    expect(args[args.indexOf('--mode') + 1]).toBe('plan');
  });
});
