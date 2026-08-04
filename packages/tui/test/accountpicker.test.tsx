/**
 * Keystroke tests for the account picker. Interactive components do not ship here
 * without one.
 */
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ACCOUNTS, type AccountId, type AccountStatus } from '@shadow/core';
import { AccountPicker } from '../src/AccountPicker.js';

const STATUSES = new Map<AccountId, AccountStatus>([
  ['shadow', { signedIn: false, detail: 'free' }],
  ['claude', { signedIn: true, detail: 'signed in' }],
  ['antigravity', { signedIn: false, detail: 'not signed in' }],
]);

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
// The sequences a real terminal sends, ESC prefix included.
const DOWN = '\x1b[B';
const UP = '\x1b[A';
const ENTER = '\r';
const ESC = '\x1b';

function mount(onSelect = (_id: AccountId) => {}, onCancel = () => {}) {
  return render(
    <AccountPicker
      accounts={ACCOUNTS}
      statuses={STATUSES}
      onSelect={onSelect}
      onCancel={onCancel}
    />,
  );
}

describe('account picker', () => {
  it('lists every plan with its sign-in state', async () => {
    const { lastFrame } = mount();
    await settle();
    const frame = lastFrame() ?? '';
    for (const account of ACCOUNTS) {
      expect(frame).toContain(account.label);
    }
    expect(frame).toContain('signed in');
    expect(frame).toContain('free');
  });

  it('selects the highlighted account on enter', async () => {
    const onSelect = vi.fn();
    const { stdin } = mount(onSelect);
    await settle();
    stdin.write(ENTER);
    await settle();
    expect(onSelect).toHaveBeenCalledWith(ACCOUNTS[0]!.id);
  });

  it('moves the selection with the arrow keys', async () => {
    const onSelect = vi.fn();
    const { stdin } = mount(onSelect);
    await settle();
    stdin.write(DOWN);
    await settle();
    stdin.write(ENTER);
    await settle();
    expect(onSelect).toHaveBeenCalledWith(ACCOUNTS[1]!.id);
  });

  it('wraps around the ends rather than stopping', async () => {
    const onSelect = vi.fn();
    const { stdin } = mount(onSelect);
    await settle();
    stdin.write(UP);
    await settle();
    stdin.write(ENTER);
    await settle();
    expect(onSelect).toHaveBeenCalledWith(ACCOUNTS[ACCOUNTS.length - 1]!.id);
  });

  it('cancels on escape without selecting', async () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const { stdin } = mount(onSelect, onCancel);
    await settle();
    stdin.write(ESC);
    await settle();
    expect(onCancel).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('says the checks are still running rather than showing a wrong state', async () => {
    // agy's status costs a subprocess, so the picker opens before it has landed.
    const { lastFrame } = render(
      <AccountPicker accounts={ACCOUNTS} onSelect={() => {}} onCancel={() => {}} />,
    );
    await settle();
    expect(lastFrame()).toContain('checking');
  });
});
