import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { newAgyParseState, parseAgyLine } from '../src/agy-parse.js';
import type { ShadowEvent } from '../src/types.js';

function runFixture(name: string): ShadowEvent[] {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const state = newAgyParseState();
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .flatMap((line) => parseAgyLine(line, state));
}

describe('parseAgyLine', () => {
  it('translates a real agy session into init -> text -> done', () => {
    const events = runFixture('hello.ndjson');
    const kinds = events.map((e) => e.t);

    expect(kinds[0]).toBe('init');
    expect(kinds).toContain('text');
    expect(kinds.at(-1)).toBe('done');

    const init = events[0];
    expect(init).toMatchObject({
      t: 'init',
      provider: 'agy',
      sessionRef: '448f009c-300b-4dd0-a7ab-83ac1b6fb785',
      model: 'gemini-3.6-flash-low',
    });

    const done = events.at(-1);
    expect(done).toMatchObject({
      t: 'done',
      status: 'ok',
      text: 'OK\n',
      sessionRef: '448f009c-300b-4dd0-a7ab-83ac1b6fb785',
    });
  });

  it('only emits usage when a counter actually moved', () => {
    const events = runFixture('hello.ndjson').filter((e) => e.t === 'usage');
    // Three usage blocks in the fixture are non-zero; the user_input step carries none.
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ t: 'usage', input: 18322, output: 1 });
  });

  it('reports a tool step as one call and one result, not two calls', () => {
    const events = runFixture('toolrun.ndjson');
    const calls = events.filter((e) => e.t === 'tool_call');
    const results = events.filter((e) => e.t === 'tool_result');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      t: 'tool_call',
      name: 'view_file',
      input: { AbsolutePath: 'C:/ws/types.ts' },
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ t: 'tool_result', isError: false });
    // Both edges of the same step must share an id so a UI can pair them.
    expect((calls[0] as any).id).toBe((results[0] as any).id);
  });

  it('announces a tool once even when agy repeats the ACTIVE edge', () => {
    const state = newAgyParseState();
    const active =
      '{"event":"step_update","step_update":{"step_index":3,"state":"ACTIVE",' +
      '"step_type":"tool","tool_name":"grep_search","tool_info":{"parameters":{"Query":"x"}}}}';
    expect(parseAgyLine(active, state)).toHaveLength(1);
    expect(parseAgyLine(active, state)).toHaveLength(0);
  });

  it('stitches a response split across the ACTIVE and DONE edges of one step', () => {
    const events = runFixture('toolrun.ndjson');
    const text = events
      .filter((e) => e.t === 'text')
      .map((e) => (e as any).delta)
      .join('');
    expect(text).toBe('La interfaz esta en la linea 48.');
  });

  it('ignores malformed, empty, and non-JSON lines without throwing', () => {
    const state = newAgyParseState();
    for (const bad of ['', '   ', 'not json at all', '{"event":', '[]', 'null']) {
      expect(() => parseAgyLine(bad, state)).not.toThrow();
      expect(parseAgyLine(bad, state)).toEqual([]);
    }
  });

  it('ignores unknown event kinds so an upstream format change degrades, not crashes', () => {
    const state = newAgyParseState();
    expect(parseAgyLine('{"event":"brand_new_thing","payload":{}}', state)).toEqual([]);
  });

  it('surfaces prose from unrecognized step types as thinking rather than dropping it', () => {
    const state = newAgyParseState();
    const events = parseAgyLine(
      '{"event":"step_update","step_update":{"step_type":"mystery","text_delta":"hmm"}}',
      state,
    );
    expect(events).toEqual([{ t: 'thinking', delta: 'hmm' }]);
  });

  it('falls back to accumulated text when result.response is empty', () => {
    const state = newAgyParseState();
    parseAgyLine(
      '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"partial"}}',
      state,
    );
    const events = parseAgyLine(
      '{"event":"result","result":{"conversation_id":"c1","status":"SUCCESS","response":""}}',
      state,
    );
    expect(events.at(-1)).toMatchObject({ t: 'done', text: 'partial' });
  });

  it('marks a non-SUCCESS result as an error status', () => {
    const state = newAgyParseState();
    const events = parseAgyLine(
      '{"event":"result","result":{"conversation_id":"c1","status":"FAILED","response":"boom"}}',
      state,
    );
    expect(events.at(-1)).toMatchObject({ t: 'done', status: 'error' });
  });
});
