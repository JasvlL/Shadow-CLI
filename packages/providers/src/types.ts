/**
 * The single contract every model backend implements.
 *
 * Everything above this layer — orchestrator, TUI, session log — depends only on
 * `ShadowEvent` and `Provider`. That is what lets a Claude orchestrator delegate to a
 * Gemini subagent without either side knowing about the other.
 */

export type ProviderId = 'claude' | 'agy';

export type ShadowEvent =
  /** Emitted once, as soon as the backend hands us a resumable session handle. */
  | { t: 'init'; provider: ProviderId; sessionRef: string; model: string; tools: string[] }
  /** A chunk of assistant-visible prose. */
  | { t: 'text'; delta: string }
  /** A chunk of reasoning the user may want collapsed. */
  | { t: 'thinking'; delta: string }
  | { t: 'tool_call'; id: string; name: string; input: unknown }
  | { t: 'tool_result'; id: string; output: string; isError: boolean }
  | { t: 'usage'; input: number; output: number; cacheRead: number; thinking: number }
  /**
   * The plan behind this provider is running low or has run out. `warning` means the
   * turn still completed; `exhausted` means it did not and the work needs another
   * provider. `resetsAt` is an epoch in milliseconds when known.
   */
  | { t: 'quota'; provider: ProviderId; status: 'warning' | 'exhausted'; resetsAt?: number; detail: string }
  /** Terminal event on the happy path. `text` is the full final response. */
  | { t: 'done'; text: string; status: 'ok' | 'error'; sessionRef?: string }
  /** Terminal event when the backend itself failed (spawn error, auth, timeout). */
  | { t: 'error'; message: string };

export interface RunRequest {
  prompt: string;
  model?: string;
  /** Extra instructions prepended to the backend's own system prompt. */
  systemPrompt?: string;
  cwd: string;
  /**
   * Restrict the backend to this tool subset. Omit for the backend default.
   *
   * Careful with the Claude SDK: a bare name here auto-approves that tool before the
   * permission gate is consulted. Prefer `disallowedTools` whenever a gate is in play.
   */
  allowedTools?: string[];
  /** Withhold these tools entirely. Safe to combine with a permission gate. */
  disallowedTools?: string[];
  /** Enable skills. `'all'` turns on everything the backend discovers. */
  skills?: string[] | 'all';
  /** Extra local plugin directories to load skills and commands from. */
  pluginPaths?: string[];
  /** Plan first, execute nothing. Both backends support this natively. */
  plan?: boolean;
  /** Additional directories the backend may read. */
  addDirs?: string[];
  /** Reasoning effort, where the backend supports it. */
  effort?: 'low' | 'medium' | 'high';
  /**
   * When true, shadow has already gated this work and the child must not prompt.
   * Required for any headless run: with no terminal attached, a backend that asks for
   * confirmation simply stalls and returns nothing.
   */
  skipPermissions?: boolean;
  /**
   * Restrict the backend's terminal access. Independent of `skipPermissions` — a
   * read-only subagent wants both: no prompting, and no shell.
   * Defaults to true for backends that support it.
   */
  sandbox?: boolean;
  /**
   * shadow's permission gate. When supplied, the backend routes its own tool calls
   * through it instead of prompting on its own — that is what lets one gate cover both
   * the lead's tools and its subagents' delegations.
   */
  approve?: (tool: string, input: unknown) => Promise<boolean>;
  signal?: AbortSignal;
}

export interface HealthResult {
  ok: boolean;
  detail: string;
}

export interface Provider {
  readonly id: ProviderId;
  /** Model ids this backend accepts, best-effort. Empty array if undiscoverable. */
  models(): Promise<string[]>;
  run(req: RunRequest): AsyncIterable<ShadowEvent>;
  /** Continue a prior conversation identified by a `sessionRef` from an `init` event. */
  resume(sessionRef: string, req: RunRequest): AsyncIterable<ShadowEvent>;
  health(): Promise<HealthResult>;
}

/** Convenience: drain a run to its final text, discarding intermediate events. */
export async function collectText(stream: AsyncIterable<ShadowEvent>): Promise<string> {
  let buffered = '';
  for await (const ev of stream) {
    if (ev.t === 'text') buffered += ev.delta;
    if (ev.t === 'done') return ev.text || buffered;
    if (ev.t === 'error') throw new Error(ev.message);
  }
  return buffered;
}
