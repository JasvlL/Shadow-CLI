import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionLog } from '../src/session.js';
import { formatTurns, turnsFromLines, type TurnRecord } from '../src/transcript.js';
import { buildHandoff, estimateTokens } from '../src/handoff.js';
import { shouldRefreshSummary, summarizerFor } from '../src/summary.js';

const line = (o: unknown) => JSON.stringify(o);

describe('transcript reconstruction', () => {
  it('interleaves user prompts with assistant turns in order', () => {
    const turns = turnsFromLines([
      line({ kind: 'header', id: 's', refs: {} }),
      line({ kind: 'prompt', text: 'hola', provider: 'claude', at: 1 }),
      line({ kind: 'event', provider: 'claude', at: 2, event: { t: 'text', delta: 'que ' } }),
      line({ kind: 'event', provider: 'claude', at: 3, event: { t: 'text', delta: 'tal' } }),
      line({ kind: 'event', provider: 'claude', at: 4, event: { t: 'done', text: '', status: 'ok' } }),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: 'user', text: 'hola' });
    expect(turns[1]).toMatchObject({ role: 'assistant', text: 'que tal', provider: 'claude' });
  });

  it('summarizes tool calls instead of copying their output', () => {
    const turns = turnsFromLines([
      line({
        kind: 'event',
        provider: 'claude',
        at: 1,
        event: { t: 'tool_call', id: '1', name: 'Edit', input: { file_path: 'src/a.ts' } },
      }),
      line({ kind: 'event', provider: 'claude', at: 2, event: { t: 'done', text: 'listo', status: 'ok' } }),
    ]);

    expect(turns[0]!.tools).toEqual([{ name: 'Edit', summary: 'Edit(src/a.ts)' }]);
  });

  it('falls back to the done text when nothing streamed', () => {
    const turns = turnsFromLines([
      line({ kind: 'event', provider: 'agy', at: 1, event: { t: 'done', text: 'solo final', status: 'ok' } }),
    ]);
    expect(turns[0]!.text).toBe('solo final');
  });

  it('skips a truncated final line without losing the rest', () => {
    const turns = turnsFromLines([
      line({ kind: 'prompt', text: 'hola', provider: 'claude', at: 1 }),
      '{"kind":"event","prov',
    ]);
    expect(turns).toHaveLength(1);
  });

  it('keeps the newest turns when over budget', () => {
    const turns: TurnRecord[] = Array.from({ length: 20 }, (_, i) => ({
      role: 'user',
      text: `turno ${i} ${'x'.repeat(200)}`,
      provider: 'claude',
      tools: [],
      at: i,
    }));
    const out = formatTurns(turns, 600);
    expect(out).toContain('turno 19');
    expect(out).not.toContain('turno 0 ');
  });
});

describe('handoff block', () => {
  const turns: TurnRecord[] = [
    { role: 'user', text: 'recuerda TORNILLO-8842', provider: 'claude', tools: [], at: 1 },
    { role: 'assistant', text: 'anotado', provider: 'claude', tools: [], at: 2 },
  ];

  it('tells the new model to continue, not to restart', () => {
    const out = buildHandoff(turns, null, { from: 'claude', to: 'agy' });
    expect(out).toContain('taking over');
    expect(out).toMatch(/do not greet|do not re-introduce/i);
    expect(out).toContain('TORNILLO-8842');
  });

  it('says why the switch happened when it was a quota failure', () => {
    const out = buildHandoff(turns, null, { from: 'claude', to: 'agy', reason: 'quota' });
    expect(out).toMatch(/ran out of quota/);
  });

  it('includes the summary when one exists', () => {
    const out = buildHandoff(turns, 'Se decidio usar parseISO.', { from: 'claude', to: 'agy' });
    expect(out).toContain('<earlier_conversation_summary>');
    expect(out).toContain('parseISO');
  });

  it('admits the gap when older turns exist but no summary does', () => {
    const many: TurnRecord[] = Array.from({ length: 12 }, (_, i) => ({
      role: 'user',
      text: `t${i}`,
      provider: 'claude',
      tools: [],
      at: i,
    }));
    const out = buildHandoff(many, null, { from: 'claude', to: 'agy', keepVerbatim: 2 });
    expect(out).toMatch(/could not be summarized/);
    expect(out).toContain('t11');
    expect(out).not.toContain('<earlier_conversation_summary>');
  });

  it('estimates a cost the UI can show', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('summary policy', () => {
  it('always summarizes on the provider that is not leading', () => {
    expect(summarizerFor('claude')).toBe('agy');
    expect(summarizerFor('agy')).toBe('claude');
  });

  it('waits for enough new turns before re-summarizing', () => {
    expect(shouldRefreshSummary(6, 0)).toBe(false); // all still verbatim
    expect(shouldRefreshSummary(10, 0)).toBe(true); // 4 turns past the window
    expect(shouldRefreshSummary(10, 4)).toBe(false); // already covered
    expect(shouldRefreshSummary(14, 4)).toBe(true);
  });
});

describe('session provider tracking', () => {
  it('remembers which provider ran last, across reopen', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'shadow-session-'));
    const session = SessionLog.create(cwd);
    expect(session.lastProvider()).toBeUndefined();

    session.setLastProvider('claude');
    session.setSummary({ text: 'resumen', by: 'agy', covers: 4 });

    const reopened = SessionLog.open(cwd, session.id)!;
    expect(reopened.lastProvider()).toBe('claude');
    expect(reopened.getSummary()).toEqual({ text: 'resumen', by: 'agy', covers: 4 });
  });

  it('records prompts so the transcript has both sides', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'shadow-session-'));
    const session = SessionLog.create(cwd);
    session.recordPrompt('haz algo', 'claude');

    const { readTranscript } = await import('../src/transcript.js');
    const turns = await readTranscript(session.path);
    expect(turns[0]).toMatchObject({ role: 'user', text: 'haz algo' });
  });
});
