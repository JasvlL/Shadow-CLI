import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { dim, shadow, shadowLight, shadowMist } from '@shadow/render';

export interface EffortPickerProps {
  current?: 'low' | 'medium' | 'high';
  onSelect: (choice: 'low' | 'medium' | 'high') => void;
  onCancel: () => void;
}

const EFFORT_CHOICES = ['low', 'medium', 'high'] as const;

export function EffortPicker({
  current = 'high',
  onSelect,
  onCancel,
}: EffortPickerProps) {
  const initial = Math.max(
    0,
    EFFORT_CHOICES.findIndex((c) => c === current),
  );
  const [index, setIndex] = useState(initial);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) return onCancel();
    if (key.upArrow) return setIndex((i) => (i - 1 + EFFORT_CHOICES.length) % EFFORT_CHOICES.length);
    if (key.downArrow) return setIndex((i) => (i + 1) % EFFORT_CHOICES.length);
    if (key.return) {
      const choice = EFFORT_CHOICES[index];
      if (choice) onSelect(choice);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{shadow('◆ select an effort level (Agy only)')}</Text>
      {EFFORT_CHOICES.map((choice, i) => {
        const active = i === index;
        const isCurrent = choice === current;
        const marker = active ? '❯' : isCurrent ? '•' : ' ';
        const name = `${choice}`.padEnd(26);

        const row = `${marker} ${name}`;
        return (
          <Text key={choice}>
            {active ? shadowLight(row) : isCurrent ? shadowMist(row) : dim(row)}
          </Text>
        );
      })}
      <Text>
        {dim('  ↑↓ move · enter select · esc cancel')}
      </Text>
    </Box>
  );
}
