import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCompletion, completionContext, rankCandidates } from '../src/completion.js';
import { expandMentions, findMentions } from '../src/mentions.js';

describe('completionContext', () => {
  it('opens the command menu for a slash at the start of the line', () => {
    expect(completionContext('/pro', 4)).toEqual({ kind: 'command', query: 'pro', start: 0 });
    expect(completionContext('/', 1)).toEqual({ kind: 'command', query: '', start: 0 });
  });

  it('does not treat a mid-sentence slash as a command', () => {
    expect(completionContext('use a/b path', 12).kind).toBeNull();
  });

  it('opens the file picker for an @ at a token boundary', () => {
    expect(completionContext('look at @src/a', 14)).toMatchObject({
      kind: 'file',
      query: 'src/a',
    });
    expect(completionContext('@a', 2).kind).toBe('file');
  });

  it('ignores an @ inside a word, so an email does not trigger it', () => {
    expect(completionContext('me@example.com', 14).kind).toBeNull();
  });

  it('closes the picker once the token ends', () => {
    expect(completionContext('@src/a.ts and then', 18).kind).toBeNull();
  });
});

describe('applyCompletion', () => {
  it('replaces the token and leaves surrounding text alone', () => {
    const context = completionContext('read @src/a and stop', 11);
    const out = applyCompletion('read @src/a and stop', 11, context, 'src/agy.ts');
    expect(out.value).toBe('read @src/agy.ts and stop');
    expect(out.value.slice(0, out.cursor)).toBe('read @src/agy.ts');
  });

  it('adds a separator only when the following text needs one', () => {
    const atEnd = completionContext('read @src/a', 11);
    expect(applyCompletion('read @src/a', 11, atEnd, 'src/agy.ts').value).toBe('read @src/agy.ts ');
  });

  it('completes a command without the leading slash being doubled', () => {
    const context = completionContext('/pro', 4);
    expect(applyCompletion('/pro', 4, context, '/provider').value).toBe('/provider ');
  });

  it('is a no-op when nothing is being completed', () => {
    const context = completionContext('plain text', 10);
    expect(applyCompletion('plain text', 10, context, 'x').value).toBe('plain text');
  });
});

describe('rankCandidates', () => {
  const files = ['src/agy.ts', 'src/agy-parse.ts', 'test/agy-parse.test.ts', 'README.md'];

  it('puts basename prefix matches first', () => {
    expect(rankCandidates(files, 'agy')[0]).toBe('src/agy.ts');
  });

  it('finds subsequence matches when nothing else fits', () => {
    expect(rankCandidates(files, 'agp')).toContain('src/agy-parse.ts');
  });

  it('returns the head of the list for an empty query', () => {
    expect(rankCandidates(files, '', 2)).toEqual(['src/agy.ts', 'src/agy-parse.ts']);
  });

  it('returns nothing when nothing matches', () => {
    expect(rankCandidates(files, 'zzzz')).toEqual([]);
  });
});

describe('@file expansion', () => {
  it('finds mentions and ignores trailing punctuation', () => {
    expect(findMentions('check @a.ts and @dir/b.ts.')).toEqual(['a.ts', 'dir/b.ts']);
  });

  it('attaches file contents while keeping the prompt text intact', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flick-mentions-'));
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = 1;');

    const out = await expandMentions('explain @src/a.ts please', cwd);
    expect(out).toContain('explain @src/a.ts please');
    expect(out).toContain('<file path="src/a.ts">');
    expect(out).toContain('export const a = 1;');
  });

  it('reports an unreadable path inline rather than dropping it silently', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flick-mentions-'));
    const out = await expandMentions('look at @nope.ts', cwd);
    expect(out).toContain('error=');
  });

  it('refuses a path outside the workspace', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'flick-mentions-'));
    const out = await expandMentions('read @../../secrets.txt', cwd);
    expect(out).toContain('error=');
    expect(out).not.toContain('<file path="../../secrets.txt">\n');
  });

  it('leaves a prompt without mentions untouched', async () => {
    expect(await expandMentions('no mentions here', process.cwd())).toBe('no mentions here');
  });
});
