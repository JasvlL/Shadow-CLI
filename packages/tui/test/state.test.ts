import { describe, expect, it } from 'vitest';
import {
  applyLeadEvent,
  delegationEnded,
  delegationStarted,
  formatUsage,
  initialState,
  say,
  startTurn,
  type AppState,
} from '../src/state.js';
import type { ShadowEvent } from '@shadow/providers';

function fold(events: ShadowEvent[], from: AppState = initialState()) {
  return events.reduce(applyLeadEvent, from);
}

const init: ShadowEvent = {
  t: 'init',
  provider: 'claude',
  sessionRef: 's1',
  model: 'sonnet',
  tools: [],
};

describe('committed vs live', () => {
  it('holds streamed prose in liveText and commits nothing until the turn ends', () => {
    const state = fold([init, { t: 'text', delta: 'Hola ' }, { t: 'text', delta: 'mundo' }]);
    expect(state.liveText).toBe('Hola mundo');
    expect(state.committed).toHaveLength(0);
  });

  it('commits the prose as one assistant item on done', () => {
    const state = fold([
      init,
      { t: 'text', delta: 'Hola' },
      { t: 'done', text: 'Hola', status: 'ok' },
    ]);
    expect(state.liveText).toBe('');
    expect(state.committed).toEqual([
      { kind: 'assistant', text: 'Hola', provider: 'claude', model: 'sonnet' },
    ]);
    expect(state.busy).toBe(false);
  });

  it('never mutates an already committed item — Static would not repaint it', () => {
    const first = fold([init, { t: 'text', delta: 'a' }, { t: 'done', text: 'a', status: 'ok' }]);
    const committed = first.committed[0];
    const second = fold([{ t: 'text', delta: 'b' }, { t: 'done', text: 'b', status: 'ok' }], first);

    expect(second.committed[0]).toBe(committed);
    expect(second.committed).toHaveLength(2);
  });
});

describe('tool ordering', () => {
  it('flushes prose written before a tool call so order is preserved', () => {
    const state = fold([
      init,
      { t: 'text', delta: 'voy a leer' },
      { t: 'tool_call', id: '1', name: 'Read', input: { file_path: 'a.ts' } },
    ]);
    expect(state.committed).toHaveLength(1);
    expect(state.committed[0]).toMatchObject({ kind: 'assistant', text: 'voy a leer' });
    expect(state.pendingTools).toHaveLength(1);
  });

  it('commits a tool only once its result arrives', () => {
    const called = fold([init, { t: 'tool_call', id: '1', name: 'Read', input: {} }]);
    expect(called.committed).toHaveLength(0);

    const done = fold([{ t: 'tool_result', id: '1', output: 'contents', isError: false }], called);
    expect(done.pendingTools).toHaveLength(0);
    expect(done.committed[0]).toMatchObject({ kind: 'tool', name: 'Read', result: 'contents' });
  });

  it('still commits a tool whose result never arrived', () => {
    const state = fold([
      init,
      { t: 'tool_call', id: '1', name: 'Bash', input: { command: 'ls' } },
      { t: 'done', text: '', status: 'ok' },
    ]);
    expect(state.committed).toHaveLength(1);
    expect(state.committed[0]).toMatchObject({ kind: 'tool', name: 'Bash' });
    // No result field at all, so the renderer knows not to draw an output block.
    expect((state.committed[0] as { result?: string }).result).toBeUndefined();
  });

  it('ignores a result for a tool it never saw called', () => {
    const state = fold([init, { t: 'tool_result', id: 'ghost', output: 'x', isError: false }]);
    expect(state.committed).toHaveLength(0);
  });
});

describe('todos', () => {
  it('extracts the todo list from a TodoWrite call', () => {
    const state = fold([
      init,
      {
        t: 'tool_call',
        id: '1',
        name: 'TodoWrite',
        input: { todos: [{ content: 'do a thing', status: 'in_progress' }] },
      },
    ]);
    expect(state.todos).toEqual([{ content: 'do a thing', status: 'in_progress' }]);
  });

  it('leaves todos alone for other tools and for malformed input', () => {
    const base = fold([init, { t: 'tool_call', id: '1', name: 'Read', input: {} }]);
    expect(base.todos).toEqual([]);

    const bad = fold([{ t: 'tool_call', id: '2', name: 'TodoWrite', input: { todos: 'nope' } }], base);
    expect(bad.todos).toEqual([]);
  });
});

describe('usage, delegations and errors', () => {
  it('accumulates usage per provider, since each bills a separate plan', () => {
    const state = fold([
      init,
      { t: 'usage', input: 100, output: 10, cacheRead: 0, thinking: 0 },
      { t: 'usage', input: 50, output: 5, cacheRead: 0, thinking: 0 },
    ]);
    expect(state.usage.get('claude')).toEqual({ input: 150, output: 15 });
    expect(formatUsage(state.usage)).toContain('150↑');
  });

  it('moves a delegation from running to committed when it ends', () => {
    const record = {
      id: 'd1',
      agent: 'scout',
      provider: 'agy' as const,
      prompt: 'x',
      status: 'ok' as const,
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
    };
    const started = delegationStarted(initialState(), record);
    expect(started.running.size).toBe(1);

    const ended = delegationEnded(started, record);
    expect(ended.running.size).toBe(0);
    expect(ended.committed[0]).toMatchObject({ kind: 'delegation', agent: 'scout', status: 'ok' });
  });

  it('commits an error as a system item and stops the spinner', () => {
    const state = fold([init, { t: 'text', delta: 'partial' }, { t: 'error', message: 'boom' }]);
    expect(state.committed).toEqual([
      { kind: 'assistant', text: 'partial', provider: 'claude', model: 'sonnet' },
      { kind: 'system', text: 'boom', tone: 'error' },
    ]);
    expect(state.busy).toBe(false);
  });

  it('records the user prompt and marks the turn busy', () => {
    const state = startTurn(initialState(), 'hazlo');
    expect(state.committed[0]).toEqual({ kind: 'user', text: 'hazlo' });
    expect(state.busy).toBe(true);
  });

  it('appends system messages', () => {
    expect(say(initialState(), 'nota').committed[0]).toMatchObject({ kind: 'system', text: 'nota' });
  });

  it('formats an empty tally without crashing', () => {
    expect(formatUsage(initialState().usage)).toBe('no tokens yet');
  });
});
