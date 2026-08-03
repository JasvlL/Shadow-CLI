/**
 * Completion logic for the prompt line, kept free of React so it can be tested directly.
 *
 * Two triggers: `/` at the start of the line opens the command menu, and `@` anywhere
 * opens a file picker. Both operate on the token under the cursor, so completing does
 * not disturb text the user already typed around it.
 */

export type CompletionKind = 'command' | 'file' | null;

export interface CompletionContext {
  kind: CompletionKind;
  /** Text between the trigger character and the cursor. */
  query: string;
  /** Index of the trigger character in the line. */
  start: number;
}

/** Decide what, if anything, the cursor position is currently completing. */
export function completionContext(value: string, cursor: number): CompletionContext {
  const before = value.slice(0, cursor);

  // A slash command only makes sense as the whole line, not mid-sentence.
  if (/^\/[\w-]*$/.test(before)) {
    return { kind: 'command', query: before.slice(1), start: 0 };
  }

  // `@` picks a file. Bounded by whitespace so an email address does not trigger it.
  const at = before.lastIndexOf('@');
  if (at !== -1) {
    const isTokenStart = at === 0 || /\s/.test(before[at - 1]!);
    const query = before.slice(at + 1);
    if (isTokenStart && !/\s/.test(query)) {
      return { kind: 'file', query, start: at };
    }
  }

  return { kind: null, query: '', start: -1 };
}

/**
 * Replace the token being completed with `replacement`.
 * Returns the new line and where the cursor should land.
 */
export function applyCompletion(
  value: string,
  cursor: number,
  context: CompletionContext,
  replacement: string,
): { value: string; cursor: number } {
  if (context.kind === null) return { value, cursor };

  const prefix = value.slice(0, context.start);
  const suffix = value.slice(cursor);
  const token = context.kind === 'file' ? `@${replacement}` : replacement;
  // A trailing space so the user can keep typing — unless the text after the cursor
  // already begins with one, which would otherwise leave a double space behind.
  const separator = /^\s/.test(suffix) ? '' : ' ';
  const inserted = `${token}${separator}`;

  return { value: `${prefix}${inserted}${suffix}`, cursor: prefix.length + inserted.length };
}

/**
 * Rank candidates against a query.
 *
 * Prefix matches first, then substring, then subsequence — so typing `agp` still finds
 * `agy-parse.ts` while exact prefixes stay on top.
 */
export function rankCandidates(candidates: string[], query: string, limit = 8): string[] {
  if (!query) return candidates.slice(0, limit);
  const needle = query.toLowerCase();

  const scored: Array<{ value: string; score: number }> = [];
  for (const candidate of candidates) {
    const haystack = candidate.toLowerCase();
    const base = haystack.split(/[/\\]/).pop() ?? haystack;

    let score: number;
    if (base.startsWith(needle)) score = 0;
    else if (haystack.startsWith(needle)) score = 1;
    else if (base.includes(needle)) score = 2;
    else if (haystack.includes(needle)) score = 3;
    else if (isSubsequence(needle, haystack)) score = 4;
    else continue;

    // Shorter matches are usually the ones meant.
    scored.push({ value: candidate, score: score * 1000 + candidate.length });
  }

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.value);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const char of haystack) {
    if (char === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}
