/**
 * Reading a Shadow session log in the browser.
 *
 * This mirrors `turnsFromLines` in packages/core/src/transcript.ts rather than importing
 * it: that package is built for Node and its entry pulls in `node:fs`, which cannot go
 * into a browser bundle. The duplication is deliberate and small — if the log format
 * changes, both sides move together.
 */

export type ProviderId = 'claude' | 'agy';

export interface ToolUse {
  name: string;
  summary: string;
}

export interface TurnRecord {
  role: 'user' | 'assistant';
  text: string;
  provider: ProviderId;
  tools: ToolUse[];
  at: number;
}

function summarizeTool(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  for (const key of [
    'file_path',
    'path',
    'AbsolutePath',
    'command',
    'CommandLine',
    'pattern',
    'agent',
  ]) {
    const value = args[key];
    if (typeof value === 'string' && value) {
      return `${name}(${value.replace(/\s+/g, ' ').slice(0, 120)})`;
    }
  }
  return name;
}

/** Rebuild ordered turns from the raw `.jsonl` session log. */
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
      // A truncated final line is expected if Shadow was killed mid-write.
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
    const provider = entry.provider as ProviderId;
    const at = Number(entry.at ?? 0);
    const event = entry.event as { t?: string; delta?: string; name?: string; input?: unknown; text?: string } | undefined;
    if (!event) continue;

    switch (event.t) {
      case 'text':
        current ??= { role: 'assistant', text: '', provider, tools: [], at };
        current.text += event.delta ?? '';
        break;
      case 'tool_call':
        current ??= { role: 'assistant', text: '', provider, tools: [], at };
        current.tools.push({
          name: event.name ?? 'tool',
          summary: summarizeTool(event.name ?? 'tool', event.input),
        });
        break;
      case 'done':
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

function isTurnArray(value: unknown): value is TurnRecord[] {
  return (
    Array.isArray(value) &&
    value.every((t) => t && typeof t === 'object' && 'role' in t && 'text' in t)
  );
}

/**
 * Accept either file Shadow can produce: the raw `.jsonl` session log, or the array
 * written by `/export json`.
 */
export function parseSessionFile(content: string): TurnRecord[] {
  const trimmed = content.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isTurnArray(parsed)) return parsed;
    } catch {
      // Fall through and try it as a log.
    }
  }
  return turnsFromLines(content.split(/\r?\n/));
}

export interface SessionStats {
  turns: number;
  userTurns: number;
  toolCalls: number;
  providers: ProviderId[];
  startedAt?: number;
  endedAt?: number;
}

export function statsFor(turns: TurnRecord[]): SessionStats {
  const providers = new Set<ProviderId>();
  let toolCalls = 0;
  let userTurns = 0;

  for (const turn of turns) {
    if (turn.provider) providers.add(turn.provider);
    toolCalls += turn.tools.length;
    if (turn.role === 'user') userTurns++;
  }

  // A log written by a killed process can be missing timestamps, so only report a range
  // when there is one.
  const times = turns.map((t) => t.at).filter((n) => Number.isFinite(n) && n > 0);

  return {
    turns: turns.length,
    userTurns,
    toolCalls,
    providers: [...providers],
    startedAt: times.length > 0 ? Math.min(...times) : undefined,
    endedAt: times.length > 0 ? Math.max(...times) : undefined,
  };
}
