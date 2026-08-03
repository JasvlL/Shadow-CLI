/**
 * The lead run: one turn of the top-level agent, with the delegate tool wired in.
 *
 * Everything the TUI and the one-shot CLI render comes through here, so both surfaces
 * see identical behaviour.
 */

import { ClaudeProvider, AgyProvider } from '@shadow/providers';
import type { ShadowEvent, ProviderId } from '@shadow/providers';
import { Orchestrator, type OrchestratorEvent } from './orchestrator.js';
import { loadRules } from './rules.js';
import { readTranscript } from './transcript.js';
import { buildHandoff, estimateTokens } from './handoff.js';
import { shouldRefreshSummary, summarize } from './summary.js';
import { buildDelegateServer } from './delegate-tool.js';
import type { SessionLog } from './session.js';

export interface LeadOptions {
  cwd: string;
  provider: ProviderId;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  session: SessionLog;
  orchestrator: Orchestrator;
  /** Continue the provider conversation recorded in the session. */
  resume?: boolean;
  /** shadow's permission gate, applied to the lead's own tools as well as delegations. */
  approve?: (tool: string, input: unknown) => Promise<boolean>;
  /** Skip the gate entirely. Only for an explicit `--yes` run. */
  skipPermissions?: boolean;
  /** Emit text token-by-token. The TUI wants this; a piped one-shot does not. */
  stream?: boolean;
  /** Enable skills for the lead. Defaults to every skill the backend discovers. */
  skills?: string[] | 'all';
  /** Local plugin dirs, used to surface shadow's own skills to Claude. */
  pluginPaths?: string[];
  /** Resolved project rules, appended to the lead system prompt. Set by runLead. */
  systemPromptExtra?: string;
  /** Plan first, execute nothing. */
  plan?: boolean;
  /** Why the provider changed, which the handoff block states explicitly. */
  handoffReason?: 'manual' | 'quota';
  /** Set false to skip the background summary — used by tests and one-shot runs. */
  rollingSummary?: boolean;
  /**
   * Where agy's PreToolUse hook can reach this session to ask for approval. Without it
   * the hook falls back to the non-interactive policy and denies anything that would
   * need a question.
   */
  approvalEndpoint?: { port: number; token: string };
  /** Fired when a turn had to carry a handoff, so the UI can show what it cost. */
  onHandoff?: (info: { from: ProviderId; to: ProviderId; tokens: number }) => void;
  onOrchestratorEvent?: (event: OrchestratorEvent) => void;
  signal?: AbortSignal;
}

const LEAD_SYSTEM_PROMPT = `You are the lead agent in shadow, a multi-provider terminal IDE.
Always respond in the same language the user uses to speak to you.

Delegation works through one tool: mcp__shadow__delegate. It is the only way to reach a
subagent here. Subagents may run on a different model provider than you (Anthropic or
Google); each starts with an empty context and returns only its final answer.

Delegate when a task would otherwise flood your context: sweeping searches across many
files, reading large amounts of code to answer one question, or an independent review.
Do the work yourself when it is small, or when it needs the conversation history you
already hold. Issue several delegate calls in one turn to run them in parallel.

When the user names an agent, call mcp__shadow__delegate with that name. If the name is
not in the tool's roster, say so — do not substitute a different mechanism.`;

/**
 * Tools withheld from the Claude lead.
 *
 * \`Task\`/\`Agent\` is the important one: leaving it in gives the model two delegation
 * mechanisms, and it reliably picks the built-in one, which can only reach Anthropic
 * models. Cross-provider delegation only happens if shadow's tool is the sole option.
 *
 * This is a deny-list rather than an allow-list on purpose. Bare names in the SDK's
 * \`allowedTools\` auto-approve a tool *before* \`canUseTool\` runs, which silently
 * bypasses shadow's permission gate — the SDK warns about exactly this. Withholding
 * instead leaves every remaining tool falling through to the gate.
 */
const LEAD_DISALLOWED_TOOLS = ['Task', 'Agent'];

/** Append project rules below shadow's own instructions, clearly fenced. */
function withExtra(base: string, extra?: string): string {
  return extra ? `${base}\n\n${extra}` : base;
}

/**
 * Run one lead turn. Yields the lead's own events; delegation activity arrives out of
 * band through \`onOrchestratorEvent\` because it is concurrent with this stream.
 */
export async function* runLead(
  prompt: string,
  opts: LeadOptions,
): AsyncIterable<ShadowEvent> {
  const { session, orchestrator, cwd, provider } = opts;

  // Resolved here rather than left to each backend: Claude reads CLAUDE.md and agy reads
  // AGENTS.md, so without this the same prompt would obey different rules depending on
  // which provider happened to lead.
  const rules = await loadRules(cwd);
  const withRules: LeadOptions = rules
    ? { ...opts, systemPromptExtra: rules }
    : opts;

  session.recordPrompt(prompt, provider);

  // A provider change means the new backend holds none of this conversation. Rather
  // than starting over, replay it: summary of the older stretch plus the last few turns
  // verbatim. After this turn the new provider has its own thread and resumes natively.
  const previous = session.lastProvider();
  const switching = previous !== undefined && previous !== provider;

  let outbound = prompt;
  let resume = opts.resume;

  if (switching) {
    const turns = await readTranscript(session.path);
    // The prompt just recorded is the one being sent; it must not appear twice.
    const history = turns.slice(0, -1);
    const stored = session.getSummary();
    const handoff = buildHandoff(history, stored?.text ?? null, {
      from: previous,
      to: provider,
      reason: opts.handoffReason ?? 'manual',
    });
    outbound = `${handoff}\n\n${prompt}`;
    // The new provider has no thread for this session yet.
    resume = false;
    opts.onHandoff?.({ from: previous, to: provider, tokens: estimateTokens(handoff) });
  }

  session.setLastProvider(provider);
  const turnOpts: LeadOptions = { ...withRules, resume };

  const stream =
    provider === 'claude'
      ? runClaudeLead(outbound, turnOpts)
      : runAgyLead(outbound, turnOpts);

  for await (const ev of stream) {
    if (ev.t === 'init' || (ev.t === 'done' && ev.sessionRef)) {
      const ref = ev.t === 'init' ? ev.sessionRef : ev.sessionRef!;
      session.setRef(provider, ref);
    }
    session.write({ kind: 'event', provider, at: Date.now(), event: ev });
    yield ev;
  }

  // Refresh the rolling summary after the turn, on the *other* provider. Deliberately
  // not awaited: it must never delay the next prompt, and if it fails the handoff
  // simply falls back to verbatim-only.
  if (opts.rollingSummary !== false) void refreshSummary(session, provider, cwd);

  void orchestrator;
}

/**
 * Keep the stored summary current.
 *
 * Runs on the provider that is not leading, so the plan you are about to exhaust never
 * pays for it — and so the summary already exists by the time that plan runs dry.
 */
async function refreshSummary(
  session: SessionLog,
  lead: ProviderId,
  cwd: string,
): Promise<void> {
  try {
    const turns = await readTranscript(session.path);
    const stored = session.getSummary();
    if (!shouldRefreshSummary(turns.length, stored?.covers ?? 0)) return;

    const result = await summarize(turns, lead, { cwd });
    if (result) session.setSummary(result);
  } catch {
    // Background work; a failure here must not surface as a turn error.
  }
}

function runClaudeLead(prompt: string, opts: LeadOptions): AsyncIterable<ShadowEvent> {
  const claude = new ClaudeProvider({
    stream: opts.stream,
    extraOptions: {
      mcpServers: { shadow: buildDelegateServer(opts.orchestrator) },
    },
  });

  const req = {
    prompt,
    cwd: opts.cwd,
    model: opts.model,
    systemPrompt: withExtra(LEAD_SYSTEM_PROMPT, opts.systemPromptExtra),
    disallowedTools: LEAD_DISALLOWED_TOOLS,
    skills: opts.skills ?? 'all',
    pluginPaths: opts.pluginPaths,
    plan: opts.plan,
    approve: opts.approve,
    skipPermissions: opts.skipPermissions,
    signal: opts.signal,
  };

  const ref = opts.resume ? opts.session.refFor('claude') : undefined;
  return ref ? claude.resume(ref, req) : claude.run(req);
}

/**
 * agy as lead. It cannot call shadow's in-process tools directly — it reaches them
 * through the MCP bridge, which must be registered in agy's own config.
 */
function runAgyLead(prompt: string, opts: LeadOptions): AsyncIterable<ShadowEvent> {
  const agy = new AgyProvider({
    env: opts.approvalEndpoint
      ? {
          SHADOW_APPROVAL_PORT: String(opts.approvalEndpoint.port),
          SHADOW_APPROVAL_TOKEN: opts.approvalEndpoint.token,
        }
      : {},
  });
  const req = {
    prompt,
    cwd: opts.cwd,
    model: opts.model,
    effort: opts.effort,
    systemPrompt: withExtra(LEAD_SYSTEM_PROMPT, opts.systemPromptExtra),
    addDirs: [opts.cwd],
    // AgyProvider always disables agy's own prompting — a spawned process cannot ask.
    // Permissions for this lead are enforced by the PreToolUse hook instead.
    sandbox: false,
    plan: opts.plan,
    signal: opts.signal,
  };

  const ref = opts.resume ? opts.session.refFor('agy') : undefined;
  return ref ? agy.resume(ref, req) : agy.run(req);
}
