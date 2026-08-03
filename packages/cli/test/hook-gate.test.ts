/**
 * `shadow hook-gate` decides whether agy may run a tool.
 *
 * Driven as a real subprocess, because the contract with agy is stdin/stdout and a
 * stray line on stdout would break it just as surely as a wrong decision.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

interface Decision {
  decision: string;
  reason?: string;
}

function runHook(
  toolCall: unknown,
  env: Record<string, string> = {},
  cwd = mkdtempSync(join(tmpdir(), 'shadow-hook-')),
): Promise<Decision> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, 'hook-gate'], {
      cwd,
      env: { ...process.env, SHADOW_SESSION: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', () => {
      try {
        resolve(JSON.parse(out.trim()) as Decision);
      } catch {
        reject(new Error(`hook did not emit a decision: ${JSON.stringify(out)}`));
      }
    });

    child.stdin.write(JSON.stringify(toolCall));
    child.stdin.end();
  });
}

describe('hook-gate', () => {
  it('allows a read-only agy tool without asking', async () => {
    const decision = await runHook({ toolCall: { name: 'view_file', args: { AbsolutePath: 'a.ts' } } });
    expect(decision.decision).toBe('allow');
  }, 30_000);

  it('blocks a destructive command even with no session to ask', async () => {
    const decision = await runHook({
      toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /' } },
    });
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toMatch(/destructive/);
  }, 30_000);

  it('screens agy CommandLine, not just the Claude-style command key', async () => {
    const decision = await runHook({
      toolCall: { name: 'run_command', args: { CommandLine: 'git push --force origin main' } },
    });
    expect(decision.decision).toBe('deny');
  }, 30_000);

  it('denies a mutating tool when there is no IDE to approve it', async () => {
    const decision = await runHook({
      toolCall: { name: 'write_to_file', args: { AbsolutePath: 'a.ts', Content: 'x' } },
    });
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toMatch(/approval|Shadow/i);
  }, 30_000);

  it('stays inert outside a Shadow session, so plain `agy` is untouched', async () => {
    const decision = await new Promise<Decision>((resolve, reject) => {
      const env = { ...process.env };
      delete env.SHADOW_SESSION;
      const child = spawn(process.execPath, [BIN, 'hook-gate'], {
        cwd: process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (c: Buffer) => {
        out += c.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', () => resolve(JSON.parse(out.trim())));
      child.stdin.write(JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /' } } }));
      child.stdin.end();
    });
    // Even the most destructive call is allowed through: it is not our session to police.
    expect(decision.decision).toBe('allow');
  }, 30_000);

  it('allows rather than blocking when the input shape is unrecognized', async () => {
    // A format change upstream must degrade to agy's own behaviour, not brick it.
    expect((await runHook({ unexpected: true })).decision).toBe('allow');
    expect((await runHook('not json at all')).decision).toBe('allow');
  }, 30_000);

  it('never emits "ask", which a spawned agy could not answer', async () => {
    for (const name of ['write_to_file', 'run_command', 'replace_file_content']) {
      const decision = await runHook({ toolCall: { name, args: {} } });
      expect(['allow', 'deny']).toContain(decision.decision);
    }
  }, 60_000);
});
