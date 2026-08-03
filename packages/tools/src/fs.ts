import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { glob } from 'tinyglobby';
import { ToolError, type ShadowTool, type ToolContext } from './types.js';

/**
 * Resolve a user-supplied path against the workspace and refuse to leave it.
 * Every filesystem tool goes through here — this is the containment boundary.
 */
export function resolveInside(cwd: string, path: string): string {
  const abs = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const rel = relative(resolve(cwd), abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ToolError(`path escapes the workspace: ${path}`);
  }
  return abs;
}

const MAX_READ_BYTES = 400_000;

export const readTool: ShadowTool<{ path: string; offset?: number; limit?: number }> = {
  name: 'read_file',
  description: 'Read a UTF-8 text file from the workspace, optionally a line range.',
  mutates: false,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to the workspace root' },
      offset: { type: 'number', description: '1-indexed first line to return' },
      limit: { type: 'number', description: 'Maximum number of lines to return' },
    },
    required: ['path'],
  },
  async run(input, ctx) {
    const abs = resolveInside(ctx.cwd, input.path);
    const info = await stat(abs).catch(() => null);
    if (!info) throw new ToolError(`no such file: ${input.path}`);
    if (info.isDirectory()) throw new ToolError(`${input.path} is a directory`);
    if (info.size > MAX_READ_BYTES) {
      throw new ToolError(`${input.path} is ${info.size} bytes, over the ${MAX_READ_BYTES} limit`);
    }

    const text = await readFile(abs, 'utf8');
    if (input.offset === undefined && input.limit === undefined) return text;

    const lines = text.split(/\r?\n/);
    const start = Math.max(0, (input.offset ?? 1) - 1);
    const end = input.limit === undefined ? lines.length : start + input.limit;
    return lines.slice(start, end).join('\n');
  },
};

export const writeTool: ShadowTool<{ path: string; content: string }> = {
  name: 'write_file',
  description: 'Create or overwrite a file in the workspace.',
  mutates: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  async run(input, ctx) {
    const abs = resolveInside(ctx.cwd, input.path);
    if (ctx.approve && !(await ctx.approve('write_file', input))) {
      throw new ToolError('write_file denied by permission gate');
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, input.content, 'utf8');
    return `wrote ${input.content.length} chars to ${input.path}`;
  },
};

export const editTool: ShadowTool<{ path: string; find: string; replace: string; all?: boolean }> = {
  name: 'edit_file',
  description:
    'Replace an exact string in a file. Fails unless the string occurs exactly once, ' +
    'unless `all` is true.',
  mutates: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      find: { type: 'string', description: 'Exact text to replace, including indentation' },
      replace: { type: 'string' },
      all: { type: 'boolean', description: 'Replace every occurrence instead of requiring one' },
    },
    required: ['path', 'find', 'replace'],
  },
  async run(input, ctx) {
    const abs = resolveInside(ctx.cwd, input.path);
    const before = await readFile(abs, 'utf8').catch(() => {
      throw new ToolError(`no such file: ${input.path}`);
    });

    const occurrences = before.split(input.find).length - 1;
    if (occurrences === 0) throw new ToolError(`string not found in ${input.path}`);
    if (occurrences > 1 && !input.all) {
      throw new ToolError(
        `string occurs ${occurrences} times in ${input.path}; pass all:true or add context`,
      );
    }

    if (ctx.approve && !(await ctx.approve('edit_file', input))) {
      throw new ToolError('edit_file denied by permission gate');
    }

    const after = input.all
      ? before.split(input.find).join(input.replace)
      : before.replace(input.find, input.replace);
    await writeFile(abs, after, 'utf8');
    return `replaced ${input.all ? occurrences : 1} occurrence(s) in ${input.path}`;
  },
};

export const globTool: ShadowTool<{ pattern: string; limit?: number }> = {
  name: 'glob',
  description: 'List workspace files matching a glob pattern, e.g. "src/**/*.ts".',
  mutates: false,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['pattern'],
  },
  async run(input, ctx) {
    const matches = await glob(input.pattern, {
      cwd: ctx.cwd,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      dot: false,
    });
    const limited = matches.slice(0, input.limit ?? 300);
    return limited.length > 0 ? limited.join('\n') : '(no matches)';
  },
};
