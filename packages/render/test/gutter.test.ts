import { describe, expect, it } from 'vitest';
import { stripAnsi, visibleLength } from '../src/ansi.js';
import {
  renderColumns,
  renderGutter,
  renderHeader,
  renderStatusBar,
  shortenPath,
  wrap,
} from '../src/gutter.js';

describe('renderGutter', () => {
  it('marks assistant lines with a bar on every line', () => {
    const out = stripAnsi(renderGutter('uno\ndos', 'assistant'));
    expect(out).toBe('│ uno\n│ dos');
  });

  it('marks only the first line of a user turn, so it reads as one block', () => {
    const out = stripAnsi(renderGutter('pregunta\ncontinua', 'user'));
    expect(out).toBe('❯ pregunta\n  continua');
  });

  it('handles empty text without producing a bare marker line', () => {
    expect(stripAnsi(renderGutter('', 'assistant'))).toBe('│ ');
  });
});

describe('renderColumns', () => {
  it('pushes the note to the right margin', () => {
    const out = stripAnsi(renderColumns('⏺ Edit', 'src/date.ts', '+4 -2', 50));
    expect(out).toMatch(/^⏺ Edit {2}src\/date\.ts {2,}\+4 -2$/);
    expect(out.length).toBeLessThanOrEqual(50);
  });

  it('omits the trailing gap when there is no note', () => {
    expect(stripAnsi(renderColumns('⏺ Read', 'a.ts', '', 40))).toBe('⏺ Read  a.ts');
  });

  it('truncates a long detail rather than overflowing the width', () => {
    const out = stripAnsi(renderColumns('⏺ Bash', 'x'.repeat(200), '+1 -0', 40));
    expect(out.length).toBeLessThanOrEqual(42);
    expect(out).toContain('…');
  });

  it('survives a width smaller than the label', () => {
    expect(() => renderColumns('⏺ VeryLongToolName', 'detail', 'note', 5)).not.toThrow();
  });
});

describe('wrap', () => {
  it('breaks on word boundaries', () => {
    expect(wrap('uno dos tres cuatro', 9)).toBe('uno dos\ntres\ncuatro');
  });

  it('preserves existing newlines', () => {
    expect(wrap('a\nb', 10)).toBe('a\nb');
  });

  it('leaves a word longer than the width intact rather than splitting it', () => {
    expect(wrap('supercalifragilistico', 5)).toBe('supercalifragilistico');
  });

  it('is a no-op for a non-positive width', () => {
    expect(wrap('texto', 0)).toBe('texto');
  });
});

describe('header and status bar', () => {
  it('right-aligns the model in the header', () => {
    const out = stripAnsi(renderHeader('/home/u/proj', 'claude/sonnet-4-5', 60));
    expect(out).toMatch(/^Shadow {2}.*claude\/sonnet-4-5$/);
    expect(visibleLength(out)).toBe(60);
  });

  it('shortens a home-relative path', () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    if (!home) return;
    expect(shortenPath(`${home}/proyecto`)).toBe('~/proyecto');
    expect(shortenPath('/elsewhere/proyecto')).toBe('/elsewhere/proyecto');
  });

  it('joins status segments and drops the empty ones', () => {
    expect(stripAnsi(renderStatusBar(['a', '', 'b'], 80))).toBe('a · b');
  });

  it('clips a status bar wider than the terminal', () => {
    const out = renderStatusBar([Array.from({ length: 60 }, () => 'seg').join(' ')], 40);
    expect(visibleLength(out)).toBeLessThanOrEqual(40);
  });
});
