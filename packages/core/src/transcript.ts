/**
 * The canonical transcript.
 *
 * Until now the conversation lived inside each backend: agy remembered it under a
 * `--conversation` id, Claude under an SDK session id. That made switching provider
 * mid-session equivalent to starting over, which is exactly what has to stop working
 * that way — running out of quota on one plan should not cost you the thread.
 *
 * So shadow reconstructs the conversation from its own session log. The JSONL already
 * records every event with the provider that produced it; nothing about the format
 * changes here, it is only read back.
 */

import { readFile } from 'node:fs/promises';
import type { ShadowEvent, ProviderId } from '@shadow/providers';

export interface ToolUse {
  name: string;
  /** What the call did, in a few words — never the raw output. */
  summary: string;
}

export interface TurnRecord {
  role: 'user' | 'assistant';
  text: string;
  provider: ProviderId;
  tools: ToolUse[];
  at: number;
}

interface LoggedEvent {
  kind: 'event';
  provider: ProviderId;
  at: number;
  event: ShadowEvent;
}

/** One line of the tool call, so a handoff says *what was done*, not what was printed. */
function summarizeTool(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  for (const key of ['file_path', 'path', 'AbsolutePath', 'command', 'CommandLine', 'pattern', 'agent']) {
    const value = args[key];
    if (typeof value === 'string' && value) {
      return `${name}(${value.replace(/\s+/g, ' ').slice(0, 120)})`;
    }
  }
  return name;
}

/**
 * Rebuild ordered turns from a session log.
 *
 * User turns are not in the event stream — they are the prompts shadow sent — so they
 * are recorded separately as `{kind:'prompt'}` entries and interleaved here by time.
 */
export function turnsFromLines(lines: string[]): TurnRecord[] {
  const turns: TurnRecord[] = [];
  let current: TurnRecord | null = null;

  const flush = () => {
    if (current && (current.text.trim() || current.tools.length > 0)) turns.push(current);
    current = null;
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      // A truncated final line is expected if shadow was killed mid-write.
      continue;
    }

    if (entry.kind === 'prompt') {
      flush();
      turns.push({
        role: 'user',
        text: String(entry.text ?? ''),
        provider: (entry.provider as ProviderId) ?? 'claude',
        tools: [],
        at: Number(entry.at ?? 0),
      });
      continue;
    }

    if (entry.kind !== 'event') continue;
    const { provider, at, event } = entry as unknown as LoggedEvent;
    if (!event) continue;

    switch (event.t) {
      case 'text':
        current ??= { role: 'assistant', text: '', provider, tools: [], at };
        current.text += event.delta;
        break;
      case 'tool_call':
        current ??= { role: 'assistant', text: '', provider, tools: [], at };
        current.tools.push({ name: event.name, summary: summarizeTool(event.name, event.input) });
        break;
      case 'done':
        // A backend that did not stream produces its whole reply here, with no
        // preceding `text` event — without this the turn would vanish from the
        // transcript and the handoff would skip it.
        current ??= { role: 'assistant', text: '', provider, tools: [], at };
        if (!current.text.trim() && event.text) current.text = event.text;
        flush();
        break;
      default:
        break;
    }
  }

  flush();
  return turns;
}

export async function readTranscript(path: string): Promise<TurnRecord[]> {
  const text = await readFile(path, 'utf8').catch(() => '');
  return turnsFromLines(text.split(/\r?\n/));
}

/** Render the full transcript as human-readable Markdown, for `/export`. */
export function renderTranscriptMarkdown(turns: TurnRecord[]): string {
  const sections = turns.map((turn) => {
    const heading = turn.role === 'user' ? '## User' : `## Assistant (${turn.provider})`;
    const tools =
      turn.tools.length > 0
        ? `\n\n_Tools: ${turn.tools.map((t) => t.summary).join(', ')}_`
        : '';
    return `${heading}\n\n${turn.text.trim()}${tools}`;
  });
  return sections.join('\n\n---\n\n');
}

/** Render turns as plain dialogue, newest last, within a character budget. */
export function formatTurns(turns: TurnRecord[], budget = 12_000): string {
  const blocks = turns.map((turn) => {
    const who = turn.role === 'user' ? 'User' : `Assistant (${turn.provider})`;
    const tools =
      turn.tools.length > 0 ? `\n  [tools: ${turn.tools.map((t) => t.summary).join(', ')}]` : '';
    return `${who}: ${turn.text.trim()}${tools}`;
  });

  // Keep the most recent turns: they are the ones the next reply depends on.
  const kept: string[] = [];
  let used = 0;
  for (const block of [...blocks].reverse()) {
    if (used + block.length > budget && kept.length > 0) break;
    kept.unshift(block);
    used += block.length;
  }
  return kept.join('\n\n');
}
