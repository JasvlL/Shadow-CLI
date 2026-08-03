/**
 * The rolling conversation summary.
 *
 * The timing decision here is the whole point. A summary built *at the moment of
 * handoff* would have to be written by the model that just ran out of quota — the one
 * that can no longer answer. So shadow keeps the summary current **during** the session,
 * and always generates it on the provider that is *not* leading, with that provider's
 * cheapest model. The result: switching is free of the dying plan, and the summary never
 * eats the quota you are about to need.
 */

import { AgyProvider, ClaudeProvider, collectText } from '@shadow/providers';
import type { ProviderId } from '@shadow/providers';
import type { TurnRecord } from './transcript.js';
import { formatTurns } from './transcript.js';

/** Cheapest usable model per provider — this is background work, not the main answer. */
const SUMMARY_MODEL: Record<ProviderId, string> = {
  agy: 'gemini-3.6-flash-low',
  claude: 'haiku',
};

/** Which provider writes the summary: always the one not currently leading. */
export function summarizerFor(lead: ProviderId): ProviderId {
  return lead === 'claude' ? 'agy' : 'claude';
}

const PROMPT = `Summarize this coding conversation so another AI model can pick it up mid-task.

Keep, in this order:
- what the user is ultimately trying to achieve
- decisions already made, and why
- files touched and what changed in each
- anything still open or explicitly deferred

Use exact names for files, functions and identifiers — a paraphrase is useless to whoever
continues. Do not add advice, and do not describe the conversation itself. Under 400 words.

CONVERSATION:
`;

export interface SummaryResult {
  text: string;
  /** Provider that produced it, so the cost can be attributed correctly. */
  by: ProviderId;
  /** Number of turns covered, so the caller knows what still needs to be sent verbatim. */
  covers: number;
}

/**
 * Summarize everything except the most recent `keepVerbatim` turns.
 *
 * Returns null when there is nothing worth summarizing, or when the summarizing
 * provider is unavailable — a failed summary degrades the handoff to verbatim-only,
 * it does not break it.
 */
export async function summarize(
  turns: TurnRecord[],
  lead: ProviderId,
  opts: { keepVerbatim?: number; cwd?: string; signal?: AbortSignal } = {},
): Promise<SummaryResult | null> {
  const { keepVerbatim = 6, cwd = process.cwd() } = opts;
  const older = turns.slice(0, Math.max(0, turns.length - keepVerbatim));
  if (older.length === 0) return null;

  const by = summarizerFor(lead);
  const provider = by === 'agy' ? new AgyProvider() : new ClaudeProvider();

  try {
    const text = await collectText(
      provider.run({
        prompt: `${PROMPT}${formatTurns(older, 40_000)}`,
        cwd,
        model: SUMMARY_MODEL[by],
        // Pure text work: no tools, no shell, nothing to approve.
        skipPermissions: true,
        sandbox: true,
        disallowedTools: ['Bash', 'Write', 'Edit', 'Task', 'Agent'],
        signal: opts.signal,
      }),
    );
    const trimmed = text.trim();
    return trimmed ? { text: trimmed, by, covers: older.length } : null;
  } catch {
    return null;
  }
}

/** How many turns must accumulate past the verbatim window before re-summarizing. */
export const SUMMARY_REFRESH_EVERY = 4;

export function shouldRefreshSummary(
  turnCount: number,
  covered: number,
  keepVerbatim = 6,
): boolean {
  const summarizable = Math.max(0, turnCount - keepVerbatim);
  return summarizable > 0 && summarizable - covered >= SUMMARY_REFRESH_EVERY;
}
