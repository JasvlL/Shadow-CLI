/**
 * Tool call and result rendering.
 *
 * A tool call should read as one scannable line: what ran, and on what. The detail that
 * matters differs per tool — a path for Read, the command for Bash — so the summary is
 * argument-aware rather than a generic JSON dump.
 */

import { bold, dim, green, red, truncate } from './ansi.js';
import { shadow } from './theme.js';
import { diffFromToolInput } from './diff.js';
import { renderColumns } from './gutter.js';

/** Pull the one argument worth showing next to the tool name. */
export function summarizeToolInput(name: string, input: unknown, width = 80): string {
  const args = (input ?? {}) as Record<string, unknown>;

  const first = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === 'string' && value) return value;
    }
    return undefined;
  };

  const detail =
    first('command', 'CommandLine') ??
    first('file_path', 'path', 'AbsolutePath', 'notebook_path') ??
    first('pattern', 'Query', 'query') ??
    first('url', 'prompt') ??
    first('agent');

  if (!detail) {
    const keys = Object.keys(args);
    return keys.length > 0 ? dim(`(${keys.join(', ')})`) : '';
  }

  // Collapse multi-line commands so one call stays one line.
  return truncate(detail.replace(/\s*\n\s*/g, ' ⏎ '), Math.max(20, width - name.length - 6));
}

export interface ToolCallOptions {
  width?: number;
  /** Show a diff underneath for Edit/Write-shaped calls. */
  showDiff?: boolean;
}

/**
 * Count the lines an Edit/Write call adds and removes, for the right-margin note.
 * Cheap enough to do inline: it reads the tool arguments, not the file.
 */
function changeNote(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const oldText = args.old_string ?? args.find;
  const newText = args.new_string ?? args.replace ?? args.content;
  if (typeof newText !== 'string') return '';

  const before = typeof oldText === 'string' ? oldText : '';
  const added = newText ? newText.split('\n').length : 0;
  const removed = before ? before.split('\n').length : 0;
  if (!added && !removed) return '';
  void name;
  return `${green(`+${added}`)} ${red(`-${removed}`)}`;
}

/** One line for the call, laid out in columns, optionally followed by a diff. */
export function renderToolCall(name: string, input: unknown, opts: ToolCallOptions = {}): string {
  const { width = 80, showDiff = true } = opts;
  const label = shadow(`⏺ ${name}`);
  const detail = summarizeToolInput(name, input, width);
  const line = renderColumns(label, dim(detail), changeNote(name, input), width);

  if (!showDiff) return line;
  const diff = diffFromToolInput(name, input);
  if (!diff) return line;

  // The diff header repeats the path already shown on the call line, so drop it.
  const body = diff.split('\n').slice(1).join('\n');
  return `${line}\n${indent(body, 2)}`;
}

export interface ToolResultOptions {
  maxLines?: number;
  width?: number;
}

/** Tool output, collapsed to a few lines with a count of what was hidden. */
export function renderToolResult(
  output: string,
  isError: boolean,
  opts: ToolResultOptions = {},
): string {
  const { maxLines = 6 } = opts;
  const text = output.trim();
  if (!text) return dim('  ⎿ (no output)');

  const lines = text.split('\n');
  const shown = lines.slice(0, maxLines);
  const hidden = lines.length - shown.length;

  const paint = isError ? red : dim;
  const body = shown.map((line, i) => `  ${dim(i === 0 ? '⎿' : ' ')} ${paint(line)}`).join('\n');

  return hidden > 0 ? `${body}\n  ${dim(`  … ${hidden} more lines`)}` : body;
}

/** A finished delegation, rendered as a single summary line. */
export function renderDelegation(
  agent: string,
  provider: string,
  model: string | undefined,
  status: 'running' | 'ok' | 'error',
  ms?: number,
): string {
  const target = `${provider}${model ? `/${model}` : ''}`;
  const timing = ms === undefined ? '' : dim(` ${(ms / 1000).toFixed(1)}s`);

  if (status === 'running') return `${dim('┌')} ${bold(agent)} ${dim(target)} ${dim('running…')}`;
  const mark = status === 'ok' ? green('└ done') : red('└ failed');
  return `${mark} ${bold(agent)} ${dim(target)}${timing}`;
}

export function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n');
}
