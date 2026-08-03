import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { globTool } from '@flick/tools';
import { applyCompletion, completionContext, rankCandidates } from './completion.js';

export interface PromptProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  /** Slash commands offered by the `/` menu, as [name, description]. */
  commands: Array<[string, string]>;
  cwd: string;
  disabled?: boolean;
  /** Previously submitted prompts, newest last. Navigated with ↑/↓. */
  history: string[];
}

/**
 * The prompt line.
 *
 * Written against `useInput` rather than ink-text-input because completion needs the
 * cursor position, which that component does not expose.
 */
export function Prompt({
  value,
  onChange,
  onSubmit,
  placeholder,
  commands,
  cwd,
  disabled,
  history,
}: PromptProps) {
  const [cursor, setCursor] = useState(value.length);
  const [files, setFiles] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const scanStarted = useRef(false);
  const [selected, setSelected] = useState(0);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  const context = completionContext(value, cursor);

  // Load the file list lazily, the first time an `@` is typed. One glob for the session
  // is cheap; re-globbing per keystroke on a large repo is not.
  useEffect(() => {
    // The guard lives in a ref, not in state: putting `scanning` in the dependency list
    // would re-run this effect the moment it flips, and the cleanup below would cancel
    // the very glob it just started.
    if (context.kind !== 'file' || files.length > 0 || scanStarted.current) return;
    scanStarted.current = true;
    let cancelled = false;
    setScanning(true);
    void globTool
      .run({ pattern: '**/*', limit: 4000 }, { cwd })
      .then((out) => {
        if (cancelled) return;
        setFiles(out === '(no matches)' ? [] : out.split('\n').filter(Boolean));
      })
      .catch(() => {
        // A failed glob just means no suggestions; typing a path by hand still works.
      })
      .finally(() => {
        if (!cancelled) setScanning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [context.kind, files.length, cwd]);

  const candidates =
    context.kind === 'command'
      ? rankCandidates(
          commands.map(([name]) => name),
          `/${context.query}`.slice(1),
        )
      : context.kind === 'file'
        ? rankCandidates(files, context.query)
        : [];

  const menuOpen = candidates.length > 0 && context.kind !== null;

  useEffect(() => {
    setSelected(0);
  }, [context.kind, context.query]);

  const setBoth = (next: string, nextCursor: number) => {
    onChange(next);
    setCursor(Math.max(0, Math.min(nextCursor, next.length)));
  };

  const accept = (choice: string) => {
    const result = applyCompletion(value, cursor, context, choice);
    setBoth(result.value, result.cursor);
  };

  useInput(
    (input, key) => {
      if (disabled) return;

      if (menuOpen && (key.upArrow || key.downArrow)) {
        setSelected((i) =>
          key.upArrow
            ? (i - 1 + candidates.length) % candidates.length
            : (i + 1) % candidates.length,
        );
        return;
      }

      if (menuOpen && key.tab) {
        accept(candidates[selected]!);
        return;
      }

      if (key.return) {
        // Enter accepts the highlighted completion rather than submitting a half-typed
        // path — unless what is typed already *is* a complete candidate, in which case
        // re-completing it does nothing visible and the app just feels broken.
        const typed = context.kind === 'command' ? `/${context.query}` : context.query;
        const alreadyComplete = candidates.some((c) => c === typed);
        if (menuOpen && !alreadyComplete) {
          accept(candidates[selected]!);
          return;
        }
        onSubmit(value);
        setCursor(0);
        setHistoryIndex(null);
        return;
      }

      if (key.upArrow || key.downArrow) {
        if (history.length === 0) return;
        const next =
          key.upArrow
            ? historyIndex === null
              ? history.length - 1
              : Math.max(0, historyIndex - 1)
            : historyIndex === null
              ? null
              : historyIndex + 1 >= history.length
                ? null
                : historyIndex + 1;
        setHistoryIndex(next);
        const text = next === null ? '' : history[next]!;
        setBoth(text, text.length);
        return;
      }

      if (key.leftArrow) return setCursor((c) => Math.max(0, c - 1));
      if (key.rightArrow) return setCursor((c) => Math.min(value.length, c + 1));

      if (key.backspace || key.delete) {
        if (cursor === 0) return;
        setBoth(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
        return;
      }

      // Ignore control chords; they are handled by the app (esc, ctrl-c).
      if (key.ctrl || key.meta || key.escape || !input) return;

      setBoth(value.slice(0, cursor) + input + value.slice(cursor), cursor + input.length);
    },
    { isActive: !disabled },
  );

  const shown = value || placeholder || '';
  const isPlaceholder = !value && Boolean(placeholder);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={disabled ? 'yellow' : 'green'}>{'❯ '}</Text>
        {isPlaceholder ? (
          <Text dimColor>{shown}</Text>
        ) : (
          <Text>
            {value.slice(0, cursor)}
            <Text inverse>{value[cursor] ?? ' '}</Text>
            {value.slice(cursor + 1)}
          </Text>
        )}
      </Box>

      {/* Without this, a slow glob on a large repo reads as "@ does nothing". */}
      {context.kind === 'file' && scanning && files.length === 0 && (
        <Box marginLeft={2}>
          <Text dimColor>scanning files…</Text>
        </Box>
      )}

      {context.kind === 'file' && !scanning && files.length > 0 && candidates.length === 0 && (
        <Box marginLeft={2}>
          <Text dimColor>{`no file matches "${context.query}"`}</Text>
        </Box>
      )}

      {menuOpen && (
        <Box flexDirection="column" marginLeft={2}>
          {candidates.map((candidate, i) => {
            const description =
              context.kind === 'command'
                ? (commands.find(([name]) => name === candidate)?.[1] ?? '')
                : '';
            return (
              <Text key={candidate} inverse={i === selected} dimColor={i !== selected}>
                {`${candidate}${description ? `  ${description}` : ''}`}
              </Text>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
