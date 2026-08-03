/**
 * Visual snapshot of a representative session.
 *
 * Set `SHADOW_SHOW_FRAME=1` to print the frame to stderr and eyeball the layout;
 * otherwise it asserts the structural properties that make the transcript readable.
 */
import React from 'react';
import { Box, Static, Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { dim, renderStatusBar, stripAnsi } from '@shadow/render';
import { TranscriptItem } from '../src/Transcript.js';
import type { Item } from '../src/state.js';

const items: Item[] = [
  { kind: 'header', cwd: '/home/u/proyecto', target: 'claude/sonnet-4-5' },
  { kind: 'user', text: 'arregla el parser de fechas' },
  { kind: 'assistant', text: 'Busco el parser primero.' },
  {
    kind: 'tool',
    id: '1',
    name: 'Grep',
    input: { pattern: 'parseDate' },
    result: 'src/date.ts:12',
    isError: false,
  },
  {
    kind: 'tool',
    id: '2',
    name: 'Edit',
    input: {
      file_path: 'src/date.ts',
      old_string: 'const d = new Date(s)',
      new_string: 'const d = parseISO(s)',
    },
    result: 'ok',
    isError: false,
  },
  {
    kind: 'delegation',
    agent: 'scout',
    provider: 'agy',
    model: 'gemini-3.6-flash-medium',
    status: 'ok',
    ms: 1800,
  },
  {
    kind: 'assistant',
    text: 'Listo. `src/date.ts:12` ahora usa `parseISO`.\n\n- Cambio mínimo\n- Sin tocar tests',
  },
];

function Session() {
  return (
    <Box flexDirection="column">
      <Static items={items}>{(item, i) => <TranscriptItem key={i} item={item} />}</Static>
      <Box>
        <Text>{'❯ █'}</Text>
      </Box>
      <Text>{renderStatusBar([dim('claude 1.2k↑ 340↓'), dim('agy 45k↑ 2k↓')], 76)}</Text>
    </Box>
  );
}

describe('transcript layout', () => {
  it('reads as a gutter-marked session', async () => {
    const { lastFrame } = render(<Session />);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const frame = lastFrame()!;

    if (process.env.SHADOW_SHOW_FRAME) {
      process.stderr.write(`\n===FRAME===\n${frame}\n===END===\n`);
    }

    const plain = stripAnsi(frame);
    const lines = plain.split('\n').filter((l) => l.trim());

    // The header must be the first thing on screen. Anything outside <Static> paints
    // below it, so this is what proves the header is committed rather than dynamic.
    expect(lines[0]).toContain('Shadow');
    expect(lines[0]).toContain('claude/sonnet-4-5');

    // The user turn carries its own marker; assistant output carries the bar.
    expect(plain).toContain('❯ arregla el parser de fechas');
    expect(plain).toContain('│ Busco el parser primero.');

    // Tool calls are one line, with the change count pushed to the right margin.
    const editLine = lines.find((l) => l.includes('⏺ Edit'))!;
    expect(editLine).toMatch(/⏺ Edit\s+src\/date\.ts\s+\+1 -1/);

    // The diff hangs under its call, indented past the gutter.
    expect(plain).toContain('- const d = new Date(s)');
    expect(plain).toContain('+ const d = parseISO(s)');

    // A finished delegation is a single summary line.
    expect(plain).toMatch(/└ done\s+scout/);

    // Markdown lists render with one bullet, not a doubled `* •`.
    expect(plain).not.toMatch(/\*\s+•/);
    expect(plain).toContain('Cambio mínimo');
  });
});
