import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ModelChoice } from '@shadow/core';
import { dim, shadow, shadowLight, shadowMist } from '@shadow/render';

export interface ModelPickerProps {
  choices: ModelChoice[];
  /** Currently active model id, highlighted so you can see where you are. */
  current?: string;
  currentProvider: string;
  currentEffort?: 'low' | 'medium' | 'high';
  onSelect: (choice: ModelChoice) => void;
  onEffortChange: (effort: 'low' | 'medium' | 'high') => void;
  onCancel: () => void;
}

const TIER_LABEL: Record<ModelChoice['tier'], string> = {
  deep: 'deep',
  balanced: 'balanced',
  fast: 'fast',
};

const EFFORT_CHOICES = ['low', 'medium', 'high'] as const;

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
  currentEffort = 'high',
  onSelect,
  onEffortChange,
  onCancel,
}: ModelPickerProps) {
  const initial = Math.max(
    0,
    choices.findIndex((c) => c.id === current && c.provider === currentProvider),
  );
  const [index, setIndex] = useState(initial);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) return onCancel();
    
    if (key.leftArrow || key.rightArrow) {
      const choice = choices[index];
      const validEfforts = choice?.efforts ?? EFFORT_CHOICES;
      const eIdx = validEfforts.indexOf(currentEffort);
      
      let nextIdx;
      if (eIdx === -1) {
        nextIdx = 0;
      } else {
        nextIdx = key.leftArrow 
          ? (eIdx - 1 + validEfforts.length) % validEfforts.length 
          : (eIdx + 1) % validEfforts.length;
      }
      if (validEfforts.length > 0) {
        onEffortChange(validEfforts[nextIdx]!);
      }
      return;
    }

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
        <Text>{dim('  loading models… (if this persists, run `shadow auth`)')}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>{shadow('◆ select a model (use ◀ ▶ to set effort)')}</Text>
      {choices.map((choice, i) => {
        const active = i === index;
        const isCurrent = choice.id === current && choice.provider === currentProvider;
        const marker = active ? '❯' : isCurrent ? '•' : ' ';
        const name = `${choice.id}`.padEnd(26);
        const plan = choice.provider.padEnd(7);

        let row = `${marker} ${name} ${plan} ${TIER_LABEL[choice.tier].padEnd(9)} ${choice.hint}`;
        
        if (active) {
          row += `   ◀ ${currentEffort} effort ▶`;
        } else if (isCurrent) {
          row += `   [${currentEffort} effort]`;
        }

        return (
          <Text key={`${choice.provider}:${choice.id}`}>
            {active ? shadowLight(row) : isCurrent ? shadowMist(row) : dim(row)}
          </Text>
        );
      })}
      <Text>
        {dim('  ↑↓ move · ◀ ▶ effort · enter select · esc cancel')}
      </Text>
    </Box>
  );
}
