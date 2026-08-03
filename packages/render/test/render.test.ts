import { describe, expect, it } from 'vitest';
import { stripAnsi, truncate, visibleLength } from '../src/ansi.js';
import { languageForPath, renderCode, renderCodeBlock } from '../src/code.js';
import { diffFromToolInput, renderDiff } from '../src/diff.js';
import { renderMarkdown } from '../src/markdown.js';
import { renderDelegation, renderToolCall, renderToolResult, summarizeToolInput } from '../src/tools.js';

describe('ansi helpers', () => {
  it('measures and truncates by visible length, ignoring escapes', () => {
    const coloured = '\x1b[31mhello\x1b[39m';
    expect(visibleLength(coloured)).toBe(5);
    expect(stripAnsi(coloured)).toBe('hello');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('abc', 10)).toBe('abc');
  });
});

describe('code', () => {
  it('maps file extensions to languages', () => {
    expect(languageForPath('src/a.ts')).toBe('typescript');
    expect(languageForPath('run.ps1')).toBe('powershell');
    expect(languageForPath('noext')).toBeUndefined();
    expect(languageForPath('a.unknownext')).toBeUndefined();
  });

  it('returns source unchanged for an unknown language instead of throwing', () => {
    expect(renderCode('some text', 'brainfuck-9000')).toBe('some text');
    expect(renderCode('', 'typescript')).toBe('');
    expect(renderCode('x = 1')).toBe('x = 1');
  });

  it('highlights a known language without altering the visible text', () => {
    const out = renderCode('const x = 1;', 'typescript');
    expect(stripAnsi(out)).toBe('const x = 1;');
  });

  it('caps a long block and says how much it hid', () => {
    const source = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
    const out = stripAnsi(renderCodeBlock(source, 'typescript', 10));
    expect(out).toContain('… 50 more lines');
  });
});

describe('diff', () => {
  it('marks additions and removals with counts', () => {
    const out = stripAnsi(renderDiff('a\nb\nc\n', 'a\nB\nc\n', { path: 'x.ts' }));
    expect(out).toContain('x.ts');
    expect(out).toContain('+1');
    expect(out).toContain('-1');
    expect(out).toContain('- b');
    expect(out).toContain('+ B');
  });

  it('reports no changes when both sides match', () => {
    expect(stripAnsi(renderDiff('same', 'same'))).toBe('(no changes)');
  });

  it('collapses unchanged regions into a gap marker', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 20', 'CHANGED');
    const out = stripAnsi(renderDiff(before, after, { context: 2 }));
    expect(out).toContain('⋯');
    expect(out).toContain('CHANGED');
    // Far-away context must not survive the collapse.
    expect(out).not.toContain('line 0');
  });

  it('caps very large diffs', () => {
    const after = Array.from({ length: 200 }, (_, i) => `new ${i}`).join('\n');
    const out = stripAnsi(renderDiff('', after, { maxLines: 10 }));
    expect(out).toContain('more diff lines');
  });

  it('builds a diff from an Edit-shaped tool call', () => {
    const out = diffFromToolInput('Edit', {
      file_path: 'a.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    });
    expect(stripAnsi(out!)).toContain('a.ts');
    expect(stripAnsi(out!)).toContain('+ const a = 2;');
  });

  it('builds an all-additions diff from a Write-shaped tool call', () => {
    const out = diffFromToolInput('Write', { file_path: 'new.ts', content: 'hello\nworld' });
    expect(stripAnsi(out!)).toContain('+2');
  });

  it('returns null for a tool call it does not recognize', () => {
    expect(diffFromToolInput('Bash', { command: 'ls' })).toBeNull();
  });
});

describe('markdown', () => {
  it('renders headings, code and emphasis without losing the text', () => {
    const out = stripAnsi(renderMarkdown('# Title\n\nSome **bold** text.\n\n```ts\nconst x = 1;\n```'));
    expect(out).toContain('Title');
    expect(out).toContain('bold');
    expect(out).toContain('const x = 1;');
  });

  it('returns empty for blank input', () => {
    expect(renderMarkdown('   ')).toBe('');
  });

  it('does not throw on malformed markdown', () => {
    for (const bad of ['```unclosed fence', '| broken | table', '[link](', '###']) {
      expect(() => renderMarkdown(bad)).not.toThrow();
    }
  });
});

describe('tool rendering', () => {
  it('picks the argument that matters per tool shape', () => {
    expect(summarizeToolInput('Bash', { command: 'npm test' })).toContain('npm test');
    expect(summarizeToolInput('Read', { file_path: 'src/a.ts' })).toContain('src/a.ts');
    expect(summarizeToolInput('Grep', { pattern: 'foo' })).toContain('foo');
    expect(summarizeToolInput('view_file', { AbsolutePath: 'C:/x/y.ts' })).toContain('y.ts');
  });

  it('flattens a multi-line command onto one line', () => {
    const out = summarizeToolInput('Bash', { command: 'cd x\nnpm test' });
    expect(out).not.toContain('\n');
    expect(out).toContain('⏎');
  });

  it('lists argument names when nothing is quotable', () => {
    expect(stripAnsi(summarizeToolInput('Weird', { a: 1, b: 2 }))).toBe('(a, b)');
    expect(summarizeToolInput('Nothing', {})).toBe('');
  });

  it('appends a diff to an Edit call but not to a Bash call', () => {
    const edit = stripAnsi(
      renderToolCall('Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }),
    );
    expect(edit).toContain('⏺ Edit');
    expect(edit).toContain('+ y');

    const bash = stripAnsi(renderToolCall('Bash', { command: 'ls' }));
    expect(bash.split('\n')).toHaveLength(1);
  });

  it('collapses long tool output and counts the remainder', () => {
    const output = Array.from({ length: 20 }, (_, i) => `row ${i}`).join('\n');
    const out = stripAnsi(renderToolResult(output, false, { maxLines: 3 }));
    expect(out).toContain('row 0');
    expect(out).toContain('… 17 more lines');
  });

  it('handles empty output', () => {
    expect(stripAnsi(renderToolResult('', false))).toContain('(no output)');
  });

  it('renders delegation states', () => {
    expect(stripAnsi(renderDelegation('scout', 'agy', 'gemini-3.6', 'running'))).toContain('running');
    expect(stripAnsi(renderDelegation('scout', 'agy', 'gemini-3.6', 'ok', 6200))).toContain('6.2s');
    expect(stripAnsi(renderDelegation('scout', 'agy', undefined, 'error'))).toContain('failed');
  });
});

describe('nothing in the render layer throws', () => {
  // A crash here leaves the terminal unusable, so every entry point takes junk input.
  const junk = [null, undefined, 0, '', '\x00\x01', '你好', '🎉', { a: { b: { c: 1 } } }];

  it('survives junk input on every entry point', () => {
    for (const value of junk) {
      expect(() => renderCode(String(value ?? ''), 'typescript')).not.toThrow();
      expect(() => renderMarkdown(String(value ?? ''))).not.toThrow();
      expect(() => renderDiff(String(value ?? ''), 'other')).not.toThrow();
      expect(() => renderToolCall('X', value)).not.toThrow();
      expect(() => renderToolResult(String(value ?? ''), false)).not.toThrow();
      expect(() => summarizeToolInput('X', value)).not.toThrow();
    }
  });
});
