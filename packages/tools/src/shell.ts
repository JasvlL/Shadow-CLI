import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { glob } from 'tinyglobby';
import { ToolError, type ShadowTool, type ToolContext } from './types.js';

/**
 * Commands refused before the permission gate is even consulted.
 *
 * This is defence in depth, not a security boundary: a determined model can obfuscate
 * around any pattern list. It exists to stop the plausible accident — a subagent that
 * decided a force-push or a recursive delete was a reasonable step — not a hostile one.
 * The real boundary is the interactive approve() callback.
 */
export const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf]/i,
  /\brmdir\s+\/s/i,
  /\bRemove-Item\b[^|]*-Recurse/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bgit\s+push\b.*--force/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-zA-Z]*[fd]/i,
  /\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n]*\|\s*(ba)?sh\b/i,
  /\bshutdown\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,
];

export function findDestructivePattern(command: string): RegExp | null {
  return DESTRUCTIVE_PATTERNS.find((re) => re.test(command)) ?? null;
}

const MAX_OUTPUT = 60_000;

export const bashTool: ShadowTool<{ command: string; timeout?: number }> = {
  name: 'run_command',
  description: 'Run a shell command in the workspace and return combined stdout and stderr.',
  mutates: true,
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeout: { type: 'number', description: 'Milliseconds before the command is killed' },
    },
    required: ['command'],
  },
  async run(input, ctx) {
    const blocked = findDestructivePattern(input.command);
    if (blocked) {
      throw new ToolError(
        `command refused: matches destructive pattern ${blocked}. ` +
          'Run it yourself if you truly intend it.',
      );
    }
    if (ctx.approve && !(await ctx.approve('run_command', input))) {
      throw new ToolError('run_command denied by permission gate');
    }

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/sh';
    const args = isWindows
      ? ['-NoProfile', '-NonInteractive', '-Command', input.command]
      : ['-c', input.command];

    return new Promise<string>((resolve) => {
      const child = spawn(shell, args, { cwd: ctx.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const append = (chunk: Buffer) => {
        if (out.length < MAX_OUTPUT) out += chunk.toString('utf8');
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);

      const timer = setTimeout(() => child.kill(), input.timeout ?? 120_000);
      const onAbort = () => child.kill();
      ctx.signal?.addEventListener('abort', onAbort, { once: true });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve(`failed to run command: ${err.message}`);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener('abort', onAbort);
        const body = out.slice(0, MAX_OUTPUT) || '(no output)';
        resolve(code === 0 ? body : `exit ${code}\n${body}`);
      });
    });
  },
};

export const grepTool: ShadowTool<{ pattern: string; glob?: string; limit?: number }> = {
  name: 'grep',
  description: 'Search workspace file contents with a regular expression.',
  mutates: false,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'JavaScript regular expression source' },
      glob: { type: 'string', description: 'Restrict to files matching this glob' },
      limit: { type: 'number', description: 'Maximum matching lines to return' },
    },
    required: ['pattern'],
  },
  async run(input, ctx) {
    let re: RegExp;
    try {
      re = new RegExp(input.pattern);
    } catch (err) {
      throw new ToolError(`invalid regex: ${(err as Error).message}`);
    }

    const files = await glob(input.glob ?? '**/*', {
      cwd: ctx.cwd,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      absolute: true,
    });

    const limit = input.limit ?? 200;
    const hits: string[] = [];
    for (const file of files) {
      if (hits.length >= limit) break;
      const text = await readFile(file, 'utf8').catch(() => null);
      if (text === null) continue; // binary or unreadable — skip silently
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && hits.length < limit; i++) {
        if (re.test(lines[i]!)) hits.push(`${file}:${i + 1}: ${lines[i]!.trim().slice(0, 300)}`);
      }
    }
    return hits.length > 0 ? hits.join('\n') : '(no matches)';
  },
};
