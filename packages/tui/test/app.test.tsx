/**
 * Keystroke tests for the whole App.
 *
 * The Prompt works in isolation, so if `@` is broken in the real IDE the fault is in how
 * App wires it up — two `useInput` subscriptions, state owned one level higher, the
 * approval branch swapping the input out. That is what these cover.
 */
import React from 'react';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { beforeAll, describe, expect, it } from 'vitest';
import { SessionLog } from '@shadow/core';
import { App } from '../src/App.js';

let cwd: string;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'shadow-app-'));
  mkdirSync(join(cwd, 'src'), { recursive: true });
  mkdirSync(join(cwd, '.shadow', 'agents'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'widget.ts'), '// widget');
  writeFileSync(join(cwd, 'src', 'gadget.ts'), '// gadget');
  // SHADOW_HOME keeps the developer's real agents and history out of the test.
  process.env.SHADOW_HOME = cwd;
});

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

async function type(stdin: { write: (s: string) => void }, text: string) {
  await settle();
  for (const char of text) {
    stdin.write(char);
    await settle(25);
  }
  await settle();
}

function mount() {
  return render(
    <App cwd={cwd} provider="claude" session={SessionLog.create(cwd)} resume={false} />,
  );
}

describe('App input wiring', () => {
  it('shows a ready prompt once agents have loaded', async () => {
    const { lastFrame } = mount();
    await settle(600);
    expect(lastFrame()).toContain('ask anything');
  });

  it('accepts typed characters', async () => {
    const { lastFrame, stdin } = mount();
    await settle(600);
    await type(stdin, 'hola mundo');
    expect(lastFrame()).toContain('hola mundo');
  });

  it('opens the @ picker through the full app, not just the bare component', async () => {
    const { lastFrame, stdin } = mount();
    await settle(600);
    await type(stdin, '@wid');
    await settle(500);
    expect(lastFrame()).toContain('widget.ts');
  });

  it('opens the / menu through the full app', async () => {
    const { lastFrame, stdin } = mount();
    await settle(600);
    await type(stdin, '/pro');
    await settle();
    expect(lastFrame()).toContain('/provider');
  });

  it('runs a slash command and reports it in the transcript', async () => {
    const { lastFrame, stdin } = mount();
    await settle(600);
    await type(stdin, '/agents');
    stdin.write('\r');
    await settle(300);
    // No agents are defined in the temp workspace, so it should say exactly that.
    expect(lastFrame()).toMatch(/no agents defined/);
  });

  it('keeps the escape handler from swallowing ordinary typing', async () => {
    const { lastFrame, stdin } = mount();
    await settle(600);
    await type(stdin, 'abc');
    expect(lastFrame()).toContain('abc');
  });
});
