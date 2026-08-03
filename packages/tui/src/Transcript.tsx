import React from 'react';
import { Box, Text } from 'ink';
import {
  dim,
  renderDelegation,
  renderGutter,
  renderHeader,
  renderMarkdown,
  renderToolCall,
  renderToolResult,
  terminalWidth,
} from '@shadow/render';
import type { Item } from './state.js';

/**
 * One committed transcript item.
 *
 * Everything is rendered to an ANSI string by `@shadow/render` and handed to a single
 * `<Text>`: Ink cannot lay out arbitrary escape sequences across nested nodes reliably,
 * and one string per item also keeps `<Static>` cheap.
 *
 * The left margin carries the role marker — `❯` for the user, `│` for the assistant —
 * so a long session can be scanned for your own turns without reading the content.
 */
export function TranscriptItem({ item }: { item: Item }) {
  // Two columns are spent on the gutter itself.
  const width = terminalWidth() - 2;

  switch (item.kind) {
    case 'banner':
      return (
        <Box marginBottom={1}>
          <Text>{item.text}</Text>
        </Box>
      );

    case 'header':
      return (
        <Box marginBottom={1}>
          <Text>{renderHeader(item.cwd, item.target, terminalWidth())}</Text>
        </Box>
      );

    case 'user':
      return (
        <Box marginTop={1} marginBottom={1}>
          <Text>{renderGutter(item.text, 'user')}</Text>
        </Box>
      );

    case 'assistant':
      return (
        <Box>
          <Text>{renderGutter(renderMarkdown(item.text, width), 'assistant')}</Text>
        </Box>
      );

    case 'tool': {
      const call = renderToolCall(item.name, item.input, { width });
      // Only failures show their output; a successful tool is noise once you can see
      // the diff or the call itself.
      const result =
        item.result === undefined || !item.isError
          ? ''
          : `\n${renderToolResult(item.result, true)}`;
      return (
        <Box>
          <Text>{renderGutter(`${call}${result}`, 'assistant')}</Text>
        </Box>
      );
    }

    case 'delegation':
      return (
        <Box>
          <Text>
            {renderGutter(
              renderDelegation(item.agent, item.provider, item.model, item.status, item.ms),
              'assistant',
            )}
          </Text>
        </Box>
      );

    case 'system':
      return (
        <Box marginTop={1} marginBottom={1}>
          <Text color={item.tone === 'error' ? 'red' : 'yellow'}>
            {renderGutter(item.text, 'system')}
          </Text>
        </Box>
      );

    default:
      return null;
  }
}

/**
 * The turn in progress.
 *
 * Deliberately outside `<Static>`: this is the only part that repaints. Prose is shown
 * raw rather than markdown-rendered, because re-flowing a half-finished document on
 * every token is what makes a terminal UI shadower.
 */
export function LiveTurn({
  text,
  pendingTools,
}: {
  text: string;
  pendingTools: Array<{ id: string; name: string; input: unknown }>;
}) {
  const width = terminalWidth() - 2;
  if (!text && pendingTools.length === 0) return null;

  return (
    <Box flexDirection="column">
      {text ? <Text>{renderGutter(text, 'assistant')}</Text> : null}
      {pendingTools.map((tool) => (
        <Text key={tool.id}>
          {renderGutter(
            `${renderToolCall(tool.name, tool.input, { width, showDiff: false })} ${dim('…')}`,
            'assistant',
          )}
        </Text>
      ))}
    </Box>
  );
}
