/**
 * Diff rendering.
 *
 * Today an `Edit` shows up as a bare `→ Edit` and you cannot tell what changed. This
 * reconstructs the change from the tool call's own arguments — no need to re-read the
 * file, which also means it works for a file the model has not written yet.
 */

import { diffLines } from 'diff';
import { bold, dim, green, red, gray } from './ansi.js';
import { languageForPath, renderCode } from './code.js';

export interface DiffOptions {
  /** Unchanged lines kept around each change. */
  context?: number;
  /** Cap on rendered lines; the rest is summarized. */
  maxLines?: number;
  path?: string;
}

interface Row {
  kind: 'add' | 'del' | 'ctx';
  text: string;
}

/** Flatten a line-level diff into rows, one per line. */
function toRows(before: string, after: string): Row[] {
  const rows: Row[] = [];
  for (const part of diffLines(before, after)) {
    const kind: Row['kind'] = part.added ? 'add' : part.removed ? 'del' : 'ctx';
    // diffLines keeps the trailing newline on each chunk; splitting leaves an empty
    // last element that is not a real line.
    const lines = part.value.split('\n');
    if (lines.at(-1) === '') lines.pop();
    for (const text of lines) rows.push({ kind, text });
  }
  return rows;
}

/** Keep only rows within `context` lines of a change. */
function collapseContext(rows: Row[], context: number): Array<Row | 'gap'> {
  const keep = new Set<number>();
  rows.forEach((row, i) => {
    if (row.kind === 'ctx') return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) {
      keep.add(j);
    }
  });

  const out: Array<Row | 'gap'> = [];
  let skipping = false;
  rows.forEach((row, i) => {
    if (keep.has(i)) {
      out.push(row);
      skipping = false;
    } else if (!skipping) {
      out.push('gap');
      skipping = true;
    }
  });
  return out;
}

/**
 * Render a unified-style diff with coloured markers.
 * Returns an empty string when nothing changed. Never throws.
 */
export function renderDiff(before: string, after: string, opts: DiffOptions = {}): string {
  const { context = 3, maxLines = 60, path } = opts;

  try {
    if (before === after) return dim('(no changes)');

    const language = path ? languageForPath(path) : undefined;
    const rows = collapseContext(toRows(before, after), context);

    let added = 0;
    let removed = 0;
    for (const row of rows) {
      if (row === 'gap') continue;
      if (row.kind === 'add') added++;
      if (row.kind === 'del') removed++;
    }

    const shown = rows.slice(0, maxLines);
    const body = shown
      .map((row) => {
        if (row === 'gap') return gray('  ⋯');
        // Highlighting a deleted line would fight the red; only additions and context
        // get syntax colour, and only when we know the language.
        const text = row.kind === 'del' ? row.text : renderCode(row.text, language);
        if (row.kind === 'add') return `${green('+')} ${text}`;
        if (row.kind === 'del') return `${red('-')} ${red(row.text)}`;
        return `${dim(' ')} ${dim(text)}`;
      })
      .join('\n');

    const header = path
      ? `${bold(path)} ${green(`+${added}`)} ${red(`-${removed}`)}`
      : `${green(`+${added}`)} ${red(`-${removed}`)}`;

    const overflow = rows.length - shown.length;
    const footer = overflow > 0 ? `\n${dim(`  … ${overflow} more diff lines`)}` : '';

    return `${header}\n${body}${footer}`;
  } catch {
    // A binary blob or pathological input must not take the UI down.
    return dim('(diff unavailable)');
  }
}

/**
 * Build a diff straight from an Edit/Write tool call's arguments.
 * Returns null when the shape is not one we recognize.
 */
export function diffFromToolInput(name: string, input: unknown): string | null {
  const args = (input ?? {}) as Record<string, unknown>;
  const path = typeof args.file_path === 'string' ? args.file_path : (args.path as string) ?? '';

  // Edit-shaped: a targeted string replacement.
  const oldText = args.old_string ?? args.find;
  const newText = args.new_string ?? args.replace;
  if (typeof oldText === 'string' && typeof newText === 'string') {
    return renderDiff(oldText, newText, { path });
  }

  // Write-shaped: whole-file content, shown as all additions.
  const content = args.content;
  if (typeof content === 'string' && /write/i.test(name)) {
    return renderDiff('', content, { path, context: 0 });
  }

  return null;
}
