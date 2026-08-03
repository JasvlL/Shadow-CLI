/**
 * Keystroke tests for the model picker. Interactive components do not ship here
 * without one.
 */
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import type { ModelChoice } from '@flick/core';
import { ModelPicker } from '../src/ModelPicker.js';

const CHOICES: ModelChoice[] = [
  { id: 'opus', provider: 'claude', label: 'Opus', hint: 'hard reasoning', tier: 'deep' },
  { id: 'sonnet', provider: 'claude', label: 'Sonnet', hint: 'everyday coding', tier: 'balanced' },
  { id: 'haiku', provider: 'claude', label: 'Haiku', hint: 'quick lookups', tier: 'fast' },
  {
    id: 'gemini-3.1-pro-high',
    provider: 'agy',
    label: 'Gemini Pro',
    hint: 'hard reasoning',
    tier: 'deep',
  },
  {
    id: 'gemini-3.6-flash-low',
    provider: 'agy',
    label: 'Gemini Flash',
    hint: 'quick lookups',
    tier: 'fast',
  },
];

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const DOWN = '[B';
const UP = '[A';
const ENTER = '\r';
const ESC = '\x1b';

function mount(onSelect = () => {}, onCancel = () => {}) {
  return render(
    <ModelPicker
      choices={CHOICES}
      current="sonnet"
      currentProvider="claude"
      onSelect={onSelect}
      onCancel={onCancel}
    />,
  );
}

describe('model picker', () => {
  it('lists every model from both plans, with the plan named', async () => {
    const { lastFrame } = mount();
    await settle();
    const frame = lastFrame()!;

    expect(frame).toContain('opus');
    expect(frame).toContain('gemini-3.6-flash-low');
    expect(frame).toContain('claude');
    expect(frame).toContain('agy');
  });

  it('starts on the model currently in use', async () => {
    const picked: ModelChoice[] = [];
    const { stdin } = mount((c) => picked.push(c));
    await settle();
    stdin.write(ENTER);
    await settle();
    expect(picked[0]!.id).toBe('sonnet');
  });

  it('moves down and selects the next model', async () => {
    const picked: ModelChoice[] = [];
    const { stdin } = mount((c) => picked.push(c));
    await settle();
    stdin.write(DOWN);
    await settle();
    stdin.write(ENTER);
    await settle();
    expect(picked[0]!.id).toBe('haiku');
  });

  it('moves up, wrapping past the top of the list', async () => {
    const picked: ModelChoice[] = [];
    const { stdin } = mount((c) => picked.push(c));
    await settle();
    stdin.write(UP);
    await settle();
    stdin.write(ENTER);
    await settle();
    expect(picked[0]!.id).toBe('opus');
  });

  it('can reach a model on the other plan', async () => {
    const picked: ModelChoice[] = [];
    const { stdin } = mount((c) => picked.push(c));
    await settle();
    for (let i = 0; i < 2; i++) {
      stdin.write(DOWN);
      await settle(30);
    }
    stdin.write(ENTER);
    await settle();
    expect(picked[0]).toMatchObject({ id: 'gemini-3.1-pro-high', provider: 'agy' });
  });

  it('cancels on escape without selecting', async () => {
    let cancelled = false;
    const picked: ModelChoice[] = [];
    const { stdin } = mount(
      (c) => picked.push(c),
      () => {
        cancelled = true;
      },
    );
    await settle();
    stdin.write(ESC);
    await settle();
    expect(cancelled).toBe(true);
    expect(picked).toHaveLength(0);
  });

  it('says so when no plan is reachable, instead of showing an empty box', async () => {
    const { lastFrame } = render(
      <ModelPicker choices={[]} currentProvider="claude" onSelect={() => {}} onCancel={() => {}} />,
    );
    await settle();
    expect(lastFrame()).toContain('loading models');
  });
});
