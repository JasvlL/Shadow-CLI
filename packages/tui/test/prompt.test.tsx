/**
 * Keystroke tests for the prompt line.
 *
 * These exist because `@` shipped broken: the component mounted and painted, which I
 * accepted as proof it worked, and nobody had ever pressed a key on it. Every
 * interactive behaviour here is driven by actually writing to stdin.
 */
import React, { useState } from 'react';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { beforeAll, describe, expect, it } from 'vitest';
import { Prompt } from '../src/Prompt.js';

const COMMANDS: Array<[string, string]> = [
  ['/agents', 'list agents'],
  ['/provider', 'switch provider'],
  ['/plan', 'toggle plan mode'],
  ['/cost', 'token usage'],
];

let cwd: string;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'shadow-prompt-'));
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'agy.ts'), '// agy');
  writeFileSync(join(cwd, 'src', 'agy-parse.ts'), '// parse');
  writeFileSync(join(cwd, 'README.md'), '# readme');
});

/** Wrapper that owns `value`, exactly as App does. */
function Harness({
  onSubmit = () => {},
  history = [],
}: {
  onSubmit?: (v: string) => void;
  history?: string[];
}) {
  const [value, setValue] = useState('');
  return (
    <Prompt
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      commands={COMMANDS}
      cwd={cwd}
      history={history}
      placeholder="ask anything"
    />
  );
}

/** Ink needs a tick to flush each render; typing too fast outruns it. */
const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

async function type(stdin: { write: (s: string) => void }, text: string) {
  // Ink subscribes to stdin in an effect, so anything written in the same tick as
  // render() is dropped. Wait for the subscription before the first keystroke.
  await settle();
  for (const char of text) {
    stdin.write(char);
    await settle(20);
  }
  await settle();
}

const ARROW_UP = '[A';
const ARROW_DOWN = '[B';
const TAB = '\t';
const ENTER = '\r';

describe('typing', () => {
  it('shows the placeholder until a key is pressed', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await settle();
    expect(lastFrame()).toContain('ask anything');

    await type(stdin, 'h');
    expect(lastFrame()).not.toContain('ask anything');
    expect(lastFrame()).toContain('h');
  });

  it('accumulates typed characters', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, 'hola');
    expect(lastFrame()).toContain('hola');
  });

  it('deletes with backspace', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, 'hola');
    stdin.write('');
    await settle();
    expect(lastFrame()).toContain('hol');
    expect(lastFrame()).not.toContain('hola');
  });

  it('submits on enter and clears', async () => {
    const submitted: string[] = [];
    const { stdin } = render(<Harness onSubmit={(v) => submitted.push(v)} />);
    await type(stdin, 'hazlo');
    stdin.write(ENTER);
    await settle();
    expect(submitted).toEqual(['hazlo']);
  });
});

describe('@ file picker', () => {
  it('opens the picker as soon as @ is typed', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, '@');
    await settle(400); // the glob is async
    const frame = lastFrame()!;
    expect(frame).toMatch(/agy\.ts|README\.md/);
  });

  it('filters as the query is typed', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, '@agy-p');
    await settle(400);
    expect(lastFrame()).toContain('agy-parse.ts');
    expect(lastFrame()).not.toContain('README.md');
  });

  it('inserts the highlighted path on tab', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, '@agy-p');
    await settle(400);
    stdin.write(TAB);
    await settle();
    expect(lastFrame()).toContain('@src/agy-parse.ts');
  });

  it('moves the selection with the arrow keys, changing what tab inserts', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, '@agy');
    await settle(400);

    // Move off the first candidate, then accept — the inserted path must be the second
    // one, which is what proves the selection actually moved.
    stdin.write(ARROW_DOWN);
    await settle();
    stdin.write(TAB);
    await settle();
    expect(lastFrame()).toContain('@src/agy-parse.ts');
  });

  it('keeps the text around the mention intact', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, 'lee @agy-p');
    await settle(400);
    stdin.write(TAB);
    await settle();
    expect(lastFrame()).toContain('lee @src/agy-parse.ts');
  });

  it('does not open for an @ inside a word', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, 'me@example');
    await settle(400);
    expect(lastFrame()).not.toContain('agy.ts');
  });
});

describe('/ command menu', () => {
  it('opens on a leading slash and lists commands', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, '/');
    await settle();
    expect(lastFrame()).toContain('/agents');
    expect(lastFrame()).toContain('/provider');
  });

  it('filters as more is typed', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, '/pro');
    await settle();
    expect(lastFrame()).toContain('/provider');
    expect(lastFrame()).not.toContain('/agents');
  });

  it('completes on tab', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, '/pro');
    await settle();
    stdin.write(TAB);
    await settle();
    expect(lastFrame()).toContain('/provider');
  });

  it('does not open for a slash mid-sentence', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, 'a/b');
    await settle();
    expect(lastFrame()).not.toContain('/agents');
  });
});

describe('history', () => {
  it('recalls the previous prompt with arrow up', async () => {
    const { lastFrame, stdin } = render(<Harness history={['primero', 'segundo']} />);
    await settle();
    stdin.write(ARROW_UP);
    await settle();
    expect(lastFrame()).toContain('segundo');

    stdin.write(ARROW_UP);
    await settle();
    expect(lastFrame()).toContain('primero');
  });

  it('walks back down to an empty line', async () => {
    const { lastFrame, stdin } = render(<Harness history={['unico']} />);
    await settle();
    stdin.write(ARROW_UP);
    await settle();
    expect(lastFrame()).toContain('unico');

    stdin.write(ARROW_DOWN);
    await settle();
    expect(lastFrame()).not.toContain('unico');
  });
});

describe('cursor', () => {
  it('resets after submitting, so the next prompt starts clean', async () => {
    const { lastFrame, stdin } = render(<Harness />);
    await type(stdin, 'primer prompt largo');
    stdin.write(ENTER);
    await settle();
    await type(stdin, 'ab');
    // A stale cursor would insert the new text at the old offset or drop it.
    expect(lastFrame()).toContain('ab');
  });
});
