/**
 * AgyProvider — wraps the Google Antigravity CLI (`agy`) as a shadow Provider.
 *
 * We drive the CLI in print mode with NDJSON output rather than calling a Google API
 * directly, so the user's existing agy subscription is what pays for the tokens. That
 * means every run is a process spawn; `resume()` reuses agy's own conversation store
 * via `--conversation`, so context is not re-sent.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ShadowEvent, HealthResult, Provider, RunRequest } from './types.js';
import { newAgyParseState, parseAgyLine } from './agy-parse.js';

export interface AgyProviderOptions {
  /** Path to the agy executable. Defaults to `agy` on PATH. */
  bin?: string;
  defaultModel?: string;
  /** How long agy may run before it aborts itself. Passed as `--print-timeout`. */
  printTimeout?: string;
  /** Sink for lines that failed to parse. Defaults to a no-op. */
  onUnparsed?: (line: string) => void;
  /**
   * Extra environment for the spawned agy. Shadow uses this to mark the session and to
   * tell agy's PreToolUse hook where to reach the running IDE for approvals.
   */
  env?: Record<string, string>;
}

export class AgyProvider implements Provider {
  readonly id = 'agy' as const;
  private readonly bin: string;
  private readonly defaultModel: string;
  private readonly printTimeout: string;
  private readonly onUnparsed: (line: string) => void;
  private readonly env: Record<string, string>;

  constructor(opts: AgyProviderOptions = {}) {
    this.bin = opts.bin ?? 'agy';
    this.defaultModel = opts.defaultModel ?? 'gemini-3.1-pro-high';
    this.printTimeout = opts.printTimeout ?? '10m';
    this.onUnparsed = opts.onUnparsed ?? (() => {});
    this.env = opts.env ?? {};
  }

  async models(): Promise<string[]> {
    const { stdout, code } = await this.exec(['models']);
    if (code !== 0) return [];
    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.includes(' '));
  }

  async health(): Promise<HealthResult> {
    try {
      const models = await this.models();
      return models.length > 0
        ? { ok: true, detail: `agy ready, ${models.length} models` }
        : { ok: false, detail: 'agy responded but listed no models — check `agy` login' };
    } catch (err) {
      return { ok: false, detail: `agy unavailable: ${(err as Error).message}` };
    }
  }

  run(req: RunRequest): AsyncIterable<ShadowEvent> {
    return this.stream(this.buildArgs(req, null), req.signal);
  }

  resume(sessionRef: string, req: RunRequest): AsyncIterable<ShadowEvent> {
    return this.stream(this.buildArgs(req, sessionRef), req.signal);
  }

  private buildArgs(req: RunRequest, sessionRef: string | null): string[] {
    // agy exposes no system-prompt flag, so an agent's persona has to ride along in
    // the prompt itself. Fenced and labelled so the model treats it as instructions
    // rather than as part of the task text.
    const prompt = req.systemPrompt
      ? `<instructions>\n${req.systemPrompt}\n</instructions>\n\n${req.prompt}`
      : req.prompt;

    const args = [
      '--print',
      prompt,
      '--output-format',
      'stream-json',
      '--model',
      req.model ?? this.defaultModel,
      '--print-timeout',
      this.printTimeout,
    ];
    if (sessionRef) args.push('--conversation', sessionRef);
    if (req.plan) args.push('--mode', 'plan');
    if (req.effort) args.push('--effort', req.effort);
    for (const dir of req.addDirs ?? []) args.push('--add-dir', dir);
    // Prompting is always off, without exception. A spawned agy has no terminal, so
    // 'request-review' mode waits for a confirmation that can never arrive and then
    // returns an empty success — a silent failure, not a safe default. Leaving this to
    // the caller is what broke the agy lead in the TUI, where `!process.stdin.isTTY`
    // evaluated to false and left prompting on.
    //
    // Containment comes from the sandbox below and from the PreToolUse hook, which can
    // actually answer.
    args.push('--dangerously-skip-permissions');
    if (req.sandbox !== false) args.push('--sandbox');
    return args;
  }

  private async *stream(args: string[], signal?: AbortSignal): AsyncIterable<ShadowEvent> {
    const child = spawn(this.bin, args, {
      cwd: process.cwd(),
      // The marker in here is what makes agy's PreToolUse hook active: without it the
      // hook allows everything, so a user's own `agy` session is untouched.
      env: { ...process.env, SHADOW_SESSION: '1', SHADOW_CWD: process.cwd(), ...this.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // agy.exe is a native binary; no shell needed and avoiding it dodges quoting bugs
      // with prompts containing quotes or newlines.
      shell: false,
    });

    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, { once: true });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const state = newAgyParseState();
    const queue: ShadowEvent[] = [];
    // Held in an object so TypeScript's control-flow analysis cannot narrow the
    // callback away across the async boundaries below.
    const waiter: { wake: (() => void) | null } = { wake: null };
    let finished = false;
    let spawnError: Error | null = null;
    let sawDone = false;

    const wake = () => {
      const fn = waiter.wake;
      waiter.wake = null;
      fn?.();
    };

    const push = (ev: ShadowEvent) => {
      queue.push(ev);
      wake();
    };

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const events = parseAgyLine(line, state);
      if (events.length === 0 && line.trim()) this.onUnparsed(line);
      for (const ev of events) {
        if (ev.t === 'done') sawDone = true;
        push(ev);
      }
    });

    child.on('error', (err) => {
      spawnError = err;
      finished = true;
      wake();
    });

    const closed = new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? 0));
    });

    void (async () => {
      const code = await closed;
      // The `result` event is the authoritative terminus. If the process died without
      // one, synthesize an error so consumers always see a terminal event.
      if (!sawDone && !spawnError) {
        push({
          t: 'error',
          message:
            code === 0
              ? 'agy exited without a result event'
              : `agy exited ${code}: ${stderr.trim().slice(0, 500) || 'no stderr'}`,
        });
      }
      finished = true;
      wake();
    })();

    try {
      while (true) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        if (finished) break;
        await new Promise<void>((resolve) => {
          waiter.wake = resolve;
        });
      }
      while (queue.length > 0) yield queue.shift()!;
      if (spawnError) {
        yield {
          t: 'error',
          message: `failed to launch '${this.bin}': ${(spawnError as Error).message}`,
        };
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      rl.close();
      if (child.exitCode === null) child.kill();
    }
  }

  private exec(args: string[]): Promise<{ stdout: string; code: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, { stdio: ['ignore', 'pipe', 'ignore'], shell: false });
      let stdout = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (c: string) => {
        stdout += c;
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ stdout, code: code ?? 0 }));
    });
  }
}
