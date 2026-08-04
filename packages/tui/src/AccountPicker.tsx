import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { dim, shadow, shadowLight, shadowMist } from '@shadow/render';
import type { Account, AccountId, AccountStatus } from '@shadow/core';

export interface AccountPickerProps {
  accounts: Account[];
  /** Undefined while the checks are still running — agy's costs a subprocess. */
  statuses?: Map<AccountId, AccountStatus>;
  onSelect: (id: AccountId) => void;
  onCancel: () => void;
}

/**
 * Pick which plan to sign in to.
 *
 * Shadow reaches models through plans it does not own, so this is the one place that
 * shows all of them at once: what you are signed in to, and therefore which models you
 * can actually pick in `/model`.
 */
export function AccountPicker({ accounts, statuses, onSelect, onCancel }: AccountPickerProps) {
  const [index, setIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) return onCancel();
    if (key.upArrow) return setIndex((i) => (i - 1 + accounts.length) % accounts.length);
    if (key.downArrow) return setIndex((i) => (i + 1) % accounts.length);
    if (key.return) {
      const choice = accounts[index];
      if (choice) onSelect(choice.id);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{shadow('◆ sign in to a plan')}</Text>
      {accounts.map((account, i) => {
        const status = statuses?.get(account.id);
        const active = i === index;
        // A signed-in account is the equivalent of the "current" row in the other
        // pickers: still selectable, since signing in again is how you switch account.
        const marker = active ? '❯' : status?.signedIn ? '•' : ' ';
        const name = account.label.padEnd(14);
        const state = statuses ? (status?.detail ?? '?') : 'checking…';

        const row = `${marker} ${name} ${state}`;
        return (
          <Text key={account.id}>
            {active ? shadowLight(row) : status?.signedIn ? shadowMist(row) : dim(row)}
          </Text>
        );
      })}
      <Text>{dim('  ↑↓ move · enter sign in · esc cancel')}</Text>
    </Box>
  );
}
