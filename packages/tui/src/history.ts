/**
 * Prompt history, persisted across sessions.
 *
 * One line per prompt in `~/.flick/history`. Multi-line prompts are stored escaped so
 * the file stays line-oriented and a partial write cannot corrupt earlier entries.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MAX_ENTRIES = 500;

export function historyPath(): string {
  return join(process.env.FLICK_HOME ?? homedir(), '.flick', 'history');
}

const encode = (text: string) => text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
const decode = (line: string) => line.replace(/\\n/g, '\n').replace(/\\\\/g, '\\');

/** Oldest first, so ↑ from the end walks backwards through time. */
export async function loadHistory(): Promise<string[]> {
  const text = await readFile(historyPath(), 'utf8').catch(() => '');
  const entries = text.split(/\r?\n/).filter(Boolean).map(decode);
  return entries.slice(-MAX_ENTRIES);
}

export async function appendHistory(prompt: string): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  const path = historyPath();
  await mkdir(dirname(path), { recursive: true });
  // Failure to record history must never interrupt a turn.
  await appendFile(path, `${encode(trimmed)}\n`, 'utf8').catch(() => {});
}
