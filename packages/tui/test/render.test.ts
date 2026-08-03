/**
 * Smoke test: the App mounts and paints a frame against fake streams.
 *
 * This is not a substitute for driving the real TUI by hand, but it catches the
 * failures that would otherwise only show up as a blank terminal — a bad import, a
 * crash in the first render, a hook that throws before anything is drawn.
 */
import { createElement } from 'react';
import { PassThrough } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import { SessionLog } from '@shadow/core';
import { App } from '../src/App.js';

describe('App', () => {
  it('renders a first frame with the header, prompt and usage line', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'shadow-tui-'));
    const stdout = new PassThrough();
    let painted = '';
    stdout.on('data', (chunk: Buffer) => {
      painted += chunk.toString('utf8');
    });

    const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
    // Ink checks isTTY before enabling raw mode; without this it throws on mount.
    (stdin as any).isTTY = true;
    (stdin as any).setRawMode = () => stdin;
    (stdin as any).ref = () => stdin;
    (stdin as any).unref = () => stdin;

    const instance = render(
      createElement(App, {
        cwd,
        provider: 'claude' as const,
        session: SessionLog.create(cwd),
        resume: false,
      }),
      { stdout: stdout as any, stdin, patchConsole: false, exitOnCtrlC: false },
    );

    // The first paint is immediate, but the banner is committed only after agents and
    // skills load, so 50ms was enough by luck and stopped being enough once startup
    // grew. Poll for the thing under test instead of guessing a delay.
    const deadline = Date.now() + 5000;
    while (!painted.includes('Shadow') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    instance.unmount();

    expect(painted).toContain('Shadow');
    expect(painted).toContain('claude');
    expect(painted).toContain('no tokens yet');
  });
});
