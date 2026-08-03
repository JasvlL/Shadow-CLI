/**
 * Markdown rendering for assistant prose.
 *
 * Wraps marked + marked-terminal, but every path is guarded: malformed markdown, a wide
 * table, or a library change must degrade to the raw text rather than break the display.
 */

import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { bold, dim, gray, italic } from './ansi.js';
import { shadow, shadowLight } from './theme.js';
import { renderCode } from './code.js';

/** Terminal width, clamped to something readable. */
export function terminalWidth(fallback = 80): number {
  const columns = process.stdout.columns ?? fallback;
  return Math.max(40, Math.min(columns, 120));
}

function buildRenderer(width: number) {
  const marked = new Marked();
  marked.use(
    markedTerminal({
      width,
      reflowText: true,
      tab: 2,
      code: (source: string, lang?: string) => renderCode(source, lang),
      codespan: shadowLight,
      strong: bold,
      em: italic,
      heading: (text: string) => bold(shadow(text)),
      blockquote: (text: string) => dim(text),
      hr: () => gray('─'.repeat(width)),
      link: (href: string) => shadowLight(href),
      // marked-terminal already prefixes list items with its own bullet; adding one
      // here produced a doubled `* •` marker.
      listitem: (text: string) => text,
    }) as never,
  );
  return marked;
}

/**
 * Render markdown to ANSI. Falls back to the input unchanged if anything goes wrong.
 */
export function renderMarkdown(markdown: string, width = terminalWidth()): string {
  if (!markdown.trim()) return '';
  try {
    const out = buildRenderer(width).parse(markdown, { async: false });
    return typeof out === 'string' ? out.replace(/\n+$/, '') : markdown;
  } catch {
    return markdown;
  }
}

/**
 * Streaming-safe variant.
 *
 * A partial response often ends mid-fence or mid-list, and running that through a
 * markdown parser produces shadower as the layout re-flows on every token. During
 * streaming we render raw text and only format once the turn is complete.
 */
export function renderStreamingText(text: string): string {
  return text;
}
