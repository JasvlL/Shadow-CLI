import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ModelChoice } from '@flick/core';
import { dim, shadow, shadowLight, shadowMist } from '@flick/render';

export interface ModelPickerProps {
  choices: ModelChoice[];
  /** Currently active model id, highlighted so you can see where you are. */
  current?: string;
  currentProvider: string;
  onSelect: (choice: ModelChoice) => void;
  onCancel: () => void;
}

const TIER_LABEL: Record<ModelChoice['tier'], string> = {
  deep: 'deep',
  balanced: 'balanced',
  fast: 'fast',
};

/**
 * Arrow-key model picker spanning both plans.
 *
 * Switching to a model on the other provider is a provider switch, so the row says
 * which plan it spends — that is the part you actually need to see when one of them is
 * running low.
 */
export function ModelPicker({
  choices,
  current,
  currentProvider,
  onSelect,
  onCancel,
}: ModelPickerProps) {
  const initial = Math.max(
    0,
    choices.findIndex((c) => c.id === current && c.provider === currentProvider),
  );
  const [index, setIndex] = useState(initial);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) return onCancel();
    if (key.upArrow) return setIndex((i) => (i - 1 + choices.length) % choices.length);
    if (key.downArrow) return setIndex((i) => (i + 1) % choices.length);
    if (key.return) {
      const choice = choices[index];
      if (choice) onSelect(choice);
    }
  });

  if (choices.length === 0) {
    // The catalogue loads behind the prompt, so an empty list usually means "not yet"
    // rather than "none" — saying the wrong one sends the user to debug a non-problem.
    return (
      <Box flexDirection="column">
        <Text>{shadow('◆ select a model')}</Text>
        <Text>{dim('  loading models… (if this persists, run `flick auth`)')}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>{shadow('◆ select a model')}</Text>
      {choices.map((choice, i) => {
        const active = i === index;
        const isCurrent = choice.id === current && choice.provider === currentProvider;
        const marker = active ? '❯' : isCurrent ? '•' : ' ';
        const name = `${choice.id}`.padEnd(26);
        const plan = choice.provider.padEnd(7);

        const row = `${marker} ${name} ${plan} ${TIER_LABEL[choice.tier].padEnd(9)} ${choice.hint}`;
        return (
          <Text key={`${choice.provider}:${choice.id}`}>
            {active ? shadowLight(row) : isCurrent ? shadowMist(row) : dim(row)}
          </Text>
        );
      })}
      <Text>
        {dim('  ↑↓ move · enter select · esc cancel — switching plan carries the conversation over')}
      </Text>
    </Box>
  );
}
