/**
 * The `<Static>` guarantee.
 *
 * This is the fix that makes a long session usable: committed transcript items must be
 * written to the terminal exactly once, no matter how many times the live area updates.
 * The test drives the same component shape App uses and counts how often each item
 * appears in the raw output stream.
 */
import { createElement } from 'react';
import { PassThrough } from 'node:stream';
import { Box, Static, Text, render } from 'ink';
import { describe, expect, it } from 'vitest';
import { applyLeadEvent, initialState, type AppState } from '../src/state.js';
import type { FlickEvent } from '@flick/providers';

function Harness({ committed, live }: { committed: string[]; live: string }) {
  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(Static, { items: committed }, (item: string, i: number) =>
      createElement(Text, { key: i }, item),
    ),
    createElement(Text, null, live),
  );
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('<Static> usage', () => {
  it('writes each committed item once across many live-area updates', async () => {
    const stdout = new PassThrough();
    let painted = '';
    stdout.on('data', (chunk: Buffer) => {
      painted += chunk.toString('utf8');
    });

    const instance = render(createElement(Harness, { committed: [], live: '' }), {
      stdout: stdout as never,
      patchConsole: false,
      exitOnCtrlC: false,
    });

    const committed: string[] = [];
    for (let turn = 0; turn < 10; turn++) {
      committed.push(`COMMITTED_ITEM_${turn}`);
      // Several live updates per turn, as a streaming response would produce.
      for (let tick = 0; tick < 5; tick++) {
        instance.rerender(createElement(Harness, { committed: [...committed], live: `tick ${tick}` }));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    instance.unmount();

    for (let turn = 0; turn < 10; turn++) {
      expect(countOccurrences(painted, `COMMITTED_ITEM_${turn}`)).toBe(1);
    }
  }, 30_000);

  it('keeps committed item identity stable, which is what makes Static safe', () => {
    // If a fold ever replaced an existing item object, Static would not repaint it and
    // the transcript would silently show stale content.
    const events: FlickEvent[] = [
      { t: 'init', provider: 'claude', sessionRef: 's', model: 'm', tools: [] },
      { t: 'text', delta: 'one' },
      { t: 'done', text: 'one', status: 'ok' },
      { t: 'text', delta: 'two' },
      { t: 'tool_call', id: '1', name: 'Read', input: {} },
      { t: 'tool_result', id: '1', output: 'x', isError: false },
      { t: 'done', text: '', status: 'ok' },
    ];

    const snapshots: AppState[] = [];
    events.reduce((state, ev) => {
      const next = applyLeadEvent(state, ev);
      snapshots.push(next);
      return next;
    }, initialState());

    const final = snapshots.at(-1)!;
    // Every prefix of the final committed list must be identical, by reference, to what
    // that prefix was when it was first committed.
    for (const snapshot of snapshots) {
      snapshot.committed.forEach((item, i) => {
        expect(final.committed[i]).toBe(item);
      });
    }
  });
});
