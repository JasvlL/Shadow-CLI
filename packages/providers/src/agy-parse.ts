/**
 * Pure translation of agy's `--output-format stream-json` NDJSON into ShadowEvents.
 *
 * Kept free of child_process so it can be tested against captured fixtures.
 *
 * Observed shape (agy Antigravity CLI):
 *   {"event":"init","conversation_id":"…","init":{model,cwd,tools[],permission_mode}}
 *   {"event":"step_update","step_update":{conversation_id,step_index,state,step_type,
 *                                         text_delta?,duration_seconds?,usage?}}
 *   {"event":"result","result":{conversation_id,status,response,duration_seconds,usage}}
 *
 * Robustness rule: an unrecognized line degrades to nothing. A format change upstream
 * must not crash shadow, so every field access is defensive.
 */

import type { ShadowEvent } from './types.js';
import { quotaFromAgyFailure } from './quota.js';

interface AgyUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
}

/** Mutable state the parser threads across lines of a single run. */
export interface AgyParseState {
  sessionRef: string;
  /** Accumulated agent_response text, used as fallback when `result.response` is empty. */
  text: string;
  sawInit: boolean;
  /** Tool step ids already announced, so a repeated ACTIVE edge is not double-reported. */
  announcedTools: Set<string>;
}

export function newAgyParseState(): AgyParseState {
  return { sessionRef: '', text: '', sawInit: false, announcedTools: new Set() };
}

function usageEvent(u: AgyUsage | undefined): ShadowEvent | null {
  if (!u) return null;
  // agy reports a usage block on most steps; only surface ones that moved a counter.
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const thinking = u.thinking_tokens ?? 0;
  const cacheRead = u.cache_read_tokens ?? 0;
  if (!input && !output && !thinking && !cacheRead) return null;
  return { t: 'usage', input, output, cacheRead, thinking };
}

/**
 * Translate one NDJSON line. Returns zero or more ShadowEvents.
 * Never throws — malformed input yields `[]` and is the caller's cue to log.
 */
export function parseAgyLine(line: string, state: AgyParseState): ShadowEvent[] {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return [];

  let msg: any;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!msg || typeof msg !== 'object') return [];

  const out: ShadowEvent[] = [];

  switch (msg.event) {
    case 'init': {
      const init = msg.init ?? {};
      state.sessionRef = String(msg.conversation_id ?? '');
      state.sawInit = true;
      out.push({
        t: 'init',
        provider: 'agy',
        sessionRef: state.sessionRef,
        model: String(init.model ?? 'unknown'),
        tools: Array.isArray(init.tools) ? init.tools.map(String) : [],
      });
      break;
    }

    case 'step_update': {
      const step = msg.step_update ?? {};
      if (!state.sessionRef && step.conversation_id) {
        state.sessionRef = String(step.conversation_id);
      }
      const delta = typeof step.text_delta === 'string' ? step.text_delta : '';
      const type = String(step.step_type ?? '');

      if (delta) {
        if (type === 'agent_response') {
          state.text += delta;
          out.push({ t: 'text', delta });
        } else if (type === 'thinking' || type === 'reasoning') {
          out.push({ t: 'thinking', delta });
        } else {
          // Unknown step type carrying prose. Surface it as thinking rather than
          // dropping it — losing model output is worse than mislabeling it.
          out.push({ t: 'thinking', delta });
        }
      }

      // agy models tool activity as a step of type "tool", reported twice: once
      // ACTIVE when it starts and once DONE when it finishes. Only the ACTIVE edge
      // becomes a tool_call, so a single invocation is not announced twice.
      if (type === 'tool') {
        const id = `${state.sessionRef}:${step.step_index ?? 0}`;
        const info = step.tool_info ?? {};
        const name = String(step.tool_name ?? info.name ?? 'unknown');
        if (String(step.state ?? '') === 'DONE') {
          out.push({
            t: 'tool_result',
            id,
            output: String(info.result ?? info.output ?? ''),
            isError: Boolean(info.error),
          });
        } else if (!state.announcedTools.has(id)) {
          // agy can repeat the ACTIVE edge as a tool makes progress.
          state.announcedTools.add(id);
          out.push({ t: 'tool_call', id, name, input: info.parameters ?? null });
        }
      }

      const usage = usageEvent(step.usage);
      if (usage) out.push(usage);
      break;
    }

    case 'result': {
      const result = msg.result ?? {};
      if (result.conversation_id) state.sessionRef = String(result.conversation_id);
      const usage = usageEvent(result.usage);
      if (usage) out.push(usage);
      const status = String(result.status ?? '').toUpperCase() === 'SUCCESS' ? 'ok' : 'error';
      if (status === 'error') {
        // agy has no structured quota signal; this reads its failure text and is
        // documented as best-effort.
        const quota = quotaFromAgyFailure(
          String(result.error ?? result.message ?? result.response ?? ''),
        );
        if (quota) out.push(quota);
      }
      out.push({
        t: 'done',
        text: typeof result.response === 'string' && result.response ? result.response : state.text,
        status,
        sessionRef: state.sessionRef,
      });
      break;
    }

    default:
      // Unknown event kind. Ignore.
      break;
  }

  return out;
}
