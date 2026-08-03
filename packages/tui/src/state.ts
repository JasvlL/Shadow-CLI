/**
 * TUI state, kept outside React so the event plumbing is testable on its own.
 *
 * The central constraint is Ink's `<Static>`: it renders each item exactly once and
 * never revisits it. That is what stops a long transcript from being repainted on every
 * streamed token — but it means committed items must be **immutable and append-only**.
 * So an item is only committed when it can no longer change: assistant prose when the
 * turn ends, a tool when its result arrives.
 */

import type { ShadowEvent, ProviderId } from '@shadow/providers';
import type { DelegationRecord } from '@shadow/core';

export type Item =
  /**
   * The banner. It is a committed item rather than plain markup because everything
   * outside `<Static>` is painted *below* the static region — a header rendered there
   * would drift to the bottom of the screen, under the whole transcript.
   */
  | { kind: 'header'; cwd: string; target: string }
  /** The startup banner, committed once so it stays pinned above the transcript. */
  | { kind: 'banner'; text: string }
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; provider?: ProviderId; model?: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; result?: string; isError?: boolean }
  | { kind: 'delegation'; agent: string; provider: string; model?: string; status: 'ok' | 'error'; ms: number }
  | { kind: 'system'; text: string; tone?: 'info' | 'error' };

export interface PendingApproval {
  tool: string;
  detail: string;
  resolve: (approved: boolean) => void;
}

export interface AppState {
  /** Finished, immutable. Rendered inside `<Static>`. */
  committed: Item[];
  /** Assistant prose for the turn in progress. */
  liveText: string;
  /** Tool calls awaiting their result, in call order. */
  pendingTools: Array<{ id: string; name: string; input: unknown }>;
  /** Subagents currently running, by delegation id. */
  running: Map<string, DelegationRecord>;
  usage: Map<string, { input: number; output: number }>;
  /** Latest todo list, as emitted by the TodoWrite tool. */
  todos: Array<{ content: string; status: string }>;
  busy: boolean;
  approval: PendingApproval | null;
  status: string;
  provider?: ProviderId;
  model?: string;
}

export function initialState(): AppState {
  return {
    committed: [],
    liveText: '',
    pendingTools: [],
    running: new Map(),
    usage: new Map(),
    todos: [],
    busy: false,
    approval: null,
    status: '',
  };
}

function commit(state: AppState, ...items: Item[]): Item[] {
  return items.length > 0 ? [...state.committed, ...items] : state.committed;
}

/** Flush any in-progress assistant prose into the committed list. */
function flushText(state: AppState): { committed: Item[]; liveText: string } {
  if (!state.liveText.trim()) return { committed: state.committed, liveText: '' };
  return {
    committed: commit(state, {
      kind: 'assistant',
      text: state.liveText,
      provider: state.provider,
      model: state.model,
    }),
    liveText: '',
  };
}

/** Extract a todo list from a TodoWrite call, if that is what this is. */
function todosFrom(name: string, input: unknown): AppState['todos'] | null {
  if (!/todo/i.test(name)) return null;
  const todos = (input as { todos?: unknown } | null)?.todos;
  if (!Array.isArray(todos)) return null;
  return todos
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
    .map((t) => ({
      content: String(t.content ?? t.subject ?? ''),
      status: String(t.status ?? 'pending'),
    }));
}

export function applyLeadEvent(state: AppState, ev: ShadowEvent): AppState {
  switch (ev.t) {
    case 'init':
      return { ...state, provider: ev.provider, model: ev.model, status: '' };

    case 'text':
      return { ...state, liveText: state.liveText + ev.delta };

    case 'thinking':
      // Thinking is not committed; it is scaffolding for the answer, and keeping it
      // would double the transcript for no benefit once the answer exists.
      return { ...state, status: 'thinking' };

    case 'tool_call': {
      // Prose written before a tool call belongs above it, so flush first.
      const flushed = flushText(state);
      const todos = todosFrom(ev.name, ev.input);
      return {
        ...state,
        committed: flushed.committed,
        liveText: flushed.liveText,
        pendingTools: [...state.pendingTools, { id: ev.id, name: ev.name, input: ev.input }],
        todos: todos ?? state.todos,
        status: ev.name,
      };
    }

    case 'tool_result': {
      const pending = state.pendingTools.find((t) => t.id === ev.id);
      if (!pending) return state;
      return {
        ...state,
        committed: commit(state, {
          kind: 'tool',
          id: pending.id,
          name: pending.name,
          input: pending.input,
          result: ev.output,
          isError: ev.isError,
        }),
        pendingTools: state.pendingTools.filter((t) => t.id !== ev.id),
        status: '',
      };
    }

    case 'usage': {
      const usage = new Map(state.usage);
      const key = state.provider ?? 'lead';
      const prev = usage.get(key) ?? { input: 0, output: 0 };
      usage.set(key, { input: prev.input + ev.input, output: prev.output + ev.output });
      return { ...state, usage };
    }

    case 'quota':
      // Shown by App as a banner or a note; nothing to commit here.
      return state;

    case 'done': {
      const flushed = flushText(state);
      // Tools whose result never arrived still deserve a line, or the transcript would
      // silently drop work the model did.
      const orphans: Item[] = state.pendingTools.map((t) => ({
        kind: 'tool',
        id: t.id,
        name: t.name,
        input: t.input,
      }));
      return {
        ...state,
        committed: [...flushed.committed, ...orphans],
        liveText: '',
        pendingTools: [],
        busy: false,
        status: '',
      };
    }

    case 'error': {
      const flushed = flushText(state);
      return {
        ...state,
        committed: [...flushed.committed, { kind: 'system', text: ev.message, tone: 'error' }],
        liveText: '',
        pendingTools: [],
        busy: false,
        status: '',
      };
    }

    default:
      return state;
  }
}

export function startTurn(state: AppState, prompt: string): AppState {
  return {
    ...state,
    committed: commit(state, { kind: 'user', text: prompt }),
    busy: true,
    status: 'thinking',
  };
}

export function say(state: AppState, text: string, tone: 'info' | 'error' = 'info'): AppState {
  return { ...state, committed: commit(state, { kind: 'system', text, tone }) };
}

export function delegationStarted(state: AppState, record: DelegationRecord): AppState {
  const running = new Map(state.running);
  running.set(record.id, record);
  return { ...state, running };
}

export function delegationEnded(state: AppState, record: DelegationRecord): AppState {
  const running = new Map(state.running);
  running.delete(record.id);
  return {
    ...state,
    running,
    committed: commit(state, {
      kind: 'delegation',
      agent: record.agent,
      provider: record.provider,
      model: record.model,
      status: record.status === 'ok' ? 'ok' : 'error',
      ms: (record.endedAt ?? Date.now()) - record.startedAt,
    }),
  };
}

export function formatUsage(usage: AppState['usage']): string {
  if (usage.size === 0) return 'no tokens yet';
  return [...usage.entries()].map(([k, v]) => `${k} ${v.input}↑ ${v.output}↓`).join('  ');
}
