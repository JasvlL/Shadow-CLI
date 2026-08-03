/**
 * Syntax highlighting.
 *
 * Everything here degrades to plain text rather than throwing. A crash in the render
 * layer leaves the terminal in a broken state, which is worse than unhighlighted code.
 */

import { highlight, supportsLanguage } from 'cli-highlight';
import { dim } from './ansi.js';

/** Map common file extensions to the language names cli-highlight knows. */
const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  sh: 'bash',
  bash: 'bash',
  ps1: 'powershell',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  md: 'markdown',
  html: 'xml',
  css: 'css',
  sql: 'sql',
};

export function languageForPath(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? EXTENSION_LANGUAGES[ext] : undefined;
}

/**
 * Highlight a source snippet. An unknown or missing language returns the source
 * untouched — never an error.
 */
export function renderCode(source: string, language?: string): string {
  if (!source) return '';
  const lang = language ? (EXTENSION_LANGUAGES[language] ?? language) : undefined;

  try {
    if (!lang || !supportsLanguage(lang)) return source;
    return highlight(source, { language: lang, ignoreIllegals: true });
  } catch {
    return source;
  }
}

/** Render a fenced block with a dim gutter, as it appears inside assistant prose. */
export function renderCodeBlock(source: string, language?: string, maxLines = 40): string {
  const highlighted = renderCode(source, language);
  const lines = highlighted.split('\n');
  const shown = lines.slice(0, maxLines);
  const hidden = lines.length - shown.length;

  const body = shown.map((line) => `${dim('│ ')}${line}`).join('\n');
  return hidden > 0 ? `${body}\n${dim(`│ … ${hidden} more lines`)}` : body;
}
