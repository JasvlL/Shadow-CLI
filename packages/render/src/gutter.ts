/**
 * Gutter and column layout.
 *
 * The transcript reads as a stream of blocks with a marker in the left margin: `❯` for
 * what you asked, `│` for what the model answered. That margin is what lets you scan a
 * long session and find where your own turns were without reading anything.
 */

import { dim, green, stripAnsi, truncate, visibleLength } from './ansi.js';
import { PRODUCT, shadow, shadowLight } from './theme.js';

export type Role = 'user' | 'assistant' | 'system';

const MARKERS: Record<Role, string> = {
  user: '❯',
  assistant: '│',
  system: '!',
};

/**
 * Prefix every line with a gutter marker.
 *
 * Only the first line of a user turn carries `❯`; continuation lines get spaces, so a
 * multi-line question reads as one block rather than a list.
 */
export function renderGutter(text: string, role: Role): string {
  const marker = MARKERS[role];
  const paint = role === 'user' ? green : role === 'system' ? shadowLight : dim;
  const lines = text.split('\n');

  return lines
    .map((line, i) => {
      const shown = role === 'user' && i > 0 ? ' ' : marker;
      return `${paint(shown)} ${line}`;
    })
    .join('\n');
}

/**
 * Lay out a label, a detail, and a right-aligned note on one line.
 *
 * Used for tool calls: `⏺ Edit  src/date.ts                    +4 -2`. The note is
 * pushed to the right margin so the eye can scan outcomes down the right-hand side.
 */
export function renderColumns(
  label: string,
  detail: string,
  note: string,
  width: number,
): string {
  const used = visibleLength(label) + visibleLength(note);
  // Two spaces after the label, at least two before the note.
  const room = Math.max(0, width - used - 4);
  const clipped = truncate(detail, room);
  const gap = Math.max(1, room - visibleLength(clipped) + 2);

  return note
    ? `${label}  ${clipped}${' '.repeat(gap)}${note}`
    : `${label}  ${clipped}`;
}

/** Wrap plain text to a width, preserving existing newlines. Never splits mid-word. */
export function wrap(text: string, width: number): string {
  if (width <= 0) return text;

  return text
    .split('\n')
    .map((line) => {
      if (visibleLength(line) <= width) return line;
      const words = line.split(' ');
      const out: string[] = [];
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (visibleLength(candidate) > width && current) {
          out.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) out.push(current);
      return out.join('\n');
    })
    .join('\n');
}

/** Header line: product, working directory, and the model in the right margin. */
export function renderHeader(cwd: string, target: string, width: number): string {
  const left = `${shadow(PRODUCT)}  ${dim(shortenPath(cwd))}`;
  const gap = Math.max(1, width - visibleLength(left) - visibleLength(target));
  return `${left}${' '.repeat(gap)}${dim(target)}`;
}

/** Collapse a home-relative path to `~/…` so the header stays short. */
export function shortenPath(path: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const normalized = path.replace(/\\/g, '/');
  const normalizedHome = home.replace(/\\/g, '/');
  if (normalizedHome && normalized.toLowerCase().startsWith(normalizedHome.toLowerCase())) {
    return `~${normalized.slice(normalizedHome.length)}`;
  }
  return normalized;
}

/** Status bar: segments joined by a middle dot, clipped to the terminal. */
export function renderStatusBar(segments: string[], width: number): string {
  const line = segments.filter(Boolean).join(dim(' · '));
  return stripAnsi(line).length > width ? truncate(line, width) : line;
}
