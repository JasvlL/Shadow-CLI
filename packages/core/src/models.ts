/**
 * The unified model catalogue.
 *
 * Switching model and switching provider are the same action here — picking
 * `gemini-3.1-pro-high` while Claude is leading moves the conversation to agy, handoff
 * included. So the picker has to show both plans in one list, and say which plan each
 * entry spends.
 */

import { AgyProvider, ClaudeProvider } from '@shadow/providers';
import type { ProviderId } from '@shadow/providers';

export interface ModelChoice {
  id: string;
  provider: ProviderId;
  /** Short human label, e.g. "Gemini 3.1 Pro". */
  label: string;
  /** One-line hint about when to reach for it. */
  hint: string;
  /** Rough speed/cost tier, used for ordering and for the picker's grouping. */
  tier: 'fast' | 'balanced' | 'deep';
  /** Valid efforts for this model. */
  efforts?: ('low' | 'medium' | 'high')[];
}

/** Recognise a model id well enough to describe it without hardcoding a full table. */
function describe(id: string, provider: ProviderId): ModelChoice {
  const lower = id.toLowerCase();

  // Family first, effort second: `gemini-3.1-pro-low` is a Pro model turned down, not a
  // small one, so matching on `low` before the family would misfile it.
  const tier: ModelChoice['tier'] = /flash|haiku|oss/.test(lower)
    ? 'fast'
    : /opus|thinking|pro-high/.test(lower)
      ? 'deep'
      : 'balanced';

  const label = id
    .replace(/^gemini-/, 'Gemini ')
    .replace(/^claude-/, 'Claude ')
    .replace(/^gpt-oss-/, 'GPT-OSS ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const hint =
    tier === 'fast'
      ? 'quick lookups, bulk search, cheap subagents'
      : tier === 'deep'
        ? 'hard reasoning, reviews, tricky bugs'
        : 'everyday coding';

  return { id, provider, label, hint, tier };
}

const TIER_ORDER: Record<ModelChoice['tier'], number> = { deep: 0, balanced: 1, fast: 2 };

/**
 * Every model reachable right now, from both plans.
 *
 * A provider that fails to answer contributes nothing rather than breaking the list —
 * being signed out of one plan must not stop you choosing a model on the other.
 */
export async function listModels(): Promise<ModelChoice[]> {
  let [agy, claude] = await Promise.all([
    new AgyProvider().models().catch(() => [] as string[]),
    new ClaudeProvider().models().catch(() => [] as string[]),
  ]);

  // Parse Agy models to extract their base ID and supported efforts
  const agyEfforts = new Map<string, ('low' | 'medium' | 'high')[]>();
  for (const id of agy) {
    const match = id.match(/-(low|medium|high|xhigh|max)$/i);
    const baseId = match ? id.slice(0, match.index) : id;
    const effort = match ? match[1].toLowerCase() : 'medium';
    if (['low', 'medium', 'high'].includes(effort)) {
      if (!agyEfforts.has(baseId)) agyEfforts.set(baseId, []);
      if (!agyEfforts.get(baseId)!.includes(effort as any)) {
        agyEfforts.get(baseId)!.push(effort as any);
      }
    }
  }

  const choices: ModelChoice[] = [
    ...claude.map((id) => describe(id, 'claude')),
    ...Array.from(agyEfforts.keys()).map((id) => {
      const choice = describe(id, 'agy');
      choice.efforts = agyEfforts.get(id);
      return choice;
    }),
  ];

  // Claude's aliases (`opus`, `sonnet`, `haiku`) and its full ids describe the same
  // models; the aliases are what people type, so they stay and the long forms go.
  const aliases = new Set(['opus', 'sonnet', 'haiku']);
  const filtered = choices.filter(
    (c) => !(c.provider === 'claude' && /^claude-\w+-\d/.test(c.id) && aliases.size > 0),
  );

  return filtered.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider === 'claude' ? -1 : 1;
    return TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.id.localeCompare(b.id);
  });
}

/** Resolve free text from `/model <name>` to a catalogue entry. */
export function resolveModel(choices: ModelChoice[], query: string): ModelChoice | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;

  return (
    choices.find((c) => c.id.toLowerCase() === needle) ??
    choices.find((c) => c.id.toLowerCase().startsWith(needle)) ??
    choices.find((c) => c.id.toLowerCase().includes(needle)) ??
    choices.find((c) => c.label.toLowerCase().includes(needle))
  );
}
