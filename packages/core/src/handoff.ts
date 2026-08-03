/**
 * The handoff block.
 *
 * What one model sends to another so the conversation continues instead of restarting.
 * Hybrid by design: a summary of the older stretch, plus the most recent turns word for
 * word — paraphrasing the last exchange is what makes a continuation feel like it lost
 * the plot, while replaying everything verbatim is what makes it unaffordable.
 */

import type { ProviderId } from '@flick/providers';
import type { TurnRecord } from './transcript.js';
import { formatTurns } from './transcript.js';

export interface HandoffOptions {
  /** Turns replayed word for word. */
  keepVerbatim?: number;
  /** Character budget for the verbatim section. */
  budget?: number;
  from: ProviderId;
  to: ProviderId;
  reason?: 'manual' | 'quota';
}

export function buildHandoff(
  turns: TurnRecord[],
  summary: string | null,
  opts: HandoffOptions,
): string {
  const { keepVerbatim = 6, budget = 12_000, from, to, reason = 'manual' } = opts;

  const recent = turns.slice(-keepVerbatim);
  const older = turns.slice(0, Math.max(0, turns.length - keepVerbatim));

  const sections: string[] = [];

  sections.push(
    `You are taking over an in-progress conversation from ${from}. ` +
      `Continue it as if it had always been yours: do not greet the user, do not ` +
      `re-introduce yourself, and do not restate what was already established. ` +
      (reason === 'quota'
        ? `The switch happened because ${from} ran out of quota, not because anything went wrong.`
        : `The user asked to switch models.`),
  );

  if (summary) {
    sections.push(`<earlier_conversation_summary>\n${summary}\n</earlier_conversation_summary>`);
  } else if (older.length > 0) {
    // No summary available — say so rather than letting the model assume the recent
    // turns are the whole story.
    sections.push(
      `<note>${older.length} earlier turns could not be summarized and are not included. ` +
        `Ask the user if you need something from before the excerpt below.</note>`,
    );
  }

  if (recent.length > 0) {
    sections.push(`<recent_turns>\n${formatTurns(recent, budget)}\n</recent_turns>`);
  }

  sections.push(`Now continue. The next message is the user speaking to you, ${to}.`);

  return `<handoff>\n${sections.join('\n\n')}\n</handoff>`;
}

/** Rough token estimate, for showing the user what a switch costs. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
