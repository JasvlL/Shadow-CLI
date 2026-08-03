/**
 * The orchestrator: runs a lead agent on one provider and lets it delegate work to
 * agents on another.
 *
 * The delegation contract is deliberately narrow — a subagent receives a prompt and
 * returns a single string. That is what makes it useful: the subagent can burn a
 * hundred thousand tokens reading the repo, and the lead only pays for the summary.
 * It is also what makes cross-provider delegation possible at all, since a string is
 * the only thing every backend agrees on.
 */

import { randomUUID } from 'node:crypto';
import { AgyProvider, ClaudeProvider } from '@shadow/providers';
import type { ShadowEvent, Provider, ProviderId, RunRequest } from '@shadow/providers';
import type { AgentDef } from './agents.js';
import { loadAgents } from './agents.js';
import { loadRules } from './rules.js';

export interface DelegationRecord {
  id: string;
  agent: string;
  provider: ProviderId;
  model?: string;
  prompt: string;
  status: 'running' | 'ok' | 'error';
  sessionRef?: string;
  result?: string;
  startedAt: number;
  endedAt?: number;
}

/** Events the orchestrator emits alongside the lead agent's own stream. */
export type OrchestratorEvent =
  | { t: 'lead'; event: ShadowEvent }
  | { t: 'delegation_start'; record: DelegationRecord }
  | { t: 'delegation_event'; id: string; event: ShadowEvent }
  | { t: 'delegation_end'; record: DelegationRecord };

export interface OrchestratorOptions {
  cwd: string;
  /** Which provider runs the lead agent. */
  leadProvider?: ProviderId;
  leadModel?: string;
  /** Max subagents running at once. Both backends are rate-limited; 4 is a safe start. */
  concurrency?: number;
  /** Permission gate. Applied to delegations that declare `writes: true`. */
  approve?: (tool: string, input: unknown) => Promise<boolean>;
  /** Passed through to agy subagents so their PreToolUse hook can ask this session. */
  approvalEndpoint?: { port: number; token: string };
  onEvent?: (event: OrchestratorEvent) => void;
}

/**
 * System prompt for an agent that has no definition file.
 *
 * Kept minimal on purpose: the lead's prompt is the specification, and a heavy persona
 * here would fight it.
 */
const AD_HOC_PROMPT = `You are a subagent working on one self-contained task.

You see none of the wider conversation, so treat the request as complete in itself. Do
exactly what is asked, then report the result and nothing else — no preamble, no summary
of your process, no suggestions for further work.`;

/**
 * Guess the provider from a model id, so "use two gemini-3.6-flash agents" works
 * without the caller also naming the backend.
 */
function inferProvider(model?: string): ProviderId | undefined {
  if (!model) return undefined;
  if (/^gemini|^gpt-oss/i.test(model)) return 'agy';
  if (/^claude|^opus|^sonnet|^haiku/i.test(model)) return 'claude';
  return undefined;
}

/** Bounded-concurrency gate. Kept local — this is the only place shadow needs one. */
class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiting.shift()?.();
    };
  }
}

export class Orchestrator {
  private readonly providers: Record<ProviderId, Provider>;
  private readonly semaphore: Semaphore;
  private agents = new Map<string, AgentDef>();
  private rules = '';
  readonly delegations = new Map<string, DelegationRecord>();

  constructor(private readonly opts: OrchestratorOptions) {
    this.providers = {
      claude: new ClaudeProvider(),
      agy: new AgyProvider({
        env: opts.approvalEndpoint
          ? {
              SHADOW_APPROVAL_PORT: String(opts.approvalEndpoint.port),
              SHADOW_APPROVAL_TOKEN: opts.approvalEndpoint.token,
            }
          : {},
      }),
    };
    this.semaphore = new Semaphore(opts.concurrency ?? 4);
  }

  async init(): Promise<void> {
    this.agents = await loadAgents(this.opts.cwd);
    // Subagents get the same project rules as the lead. Without this, delegated work
    // would quietly ignore the conventions the lead is following.
    this.rules = await loadRules(this.opts.cwd);
  }

  listAgents(): AgentDef[] {
    return [...this.agents.values()];
  }

  getAgent(name: string): AgentDef | undefined {
    return this.agents.get(name);
  }

  providerFor(id: ProviderId): Provider {
    return this.providers[id];
  }

  /**
   * Run one subagent to completion and return only its final text.
   *
   * Never throws: a failed delegation returns a description of the failure so the lead
   * agent can react to it in-band rather than having its own turn aborted.
   */
  async delegate(params: {
    agent: string;
    prompt: string;
    provider?: ProviderId;
    model?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const def = this.agents.get(params.agent);
    if (!def && !params.provider && !params.model) {
      const known = [...this.agents.keys()].join(', ') || '(none defined)';
      return `error: unknown agent '${params.agent}'. Known agents: ${known}. ` +
        `To spin one up on the spot, pass provider and/or model instead.`;
    }

    // An ad-hoc agent is one named in conversation rather than defined in a file —
    // "use two flash-3.6 agents to finish the plan". The name is then just a label.
    const adHoc = !def;
    const provider = params.provider ?? def?.provider ?? inferProvider(params.model) ?? 'claude';
    // Model ids are provider-specific. If the caller redirected the agent to a
    // different backend without naming a model, the agent's own model would be a
    // foreign id there — fall back to that provider's default instead.
    const inheritsModel = provider === def?.provider;
    const model = params.model ?? (inheritsModel ? def?.model : undefined);
    const id = randomUUID();

    const record: DelegationRecord = {
      id,
      agent: params.agent,
      provider,
      model,
      prompt: params.prompt,
      status: 'running',
      startedAt: Date.now(),
    };
    this.delegations.set(id, record);
    this.opts.onEvent?.({ t: 'delegation_start', record });

    const release = await this.semaphore.acquire();
    try {
      if (def?.writes && this.opts.approve) {
        const allowed = await this.opts.approve('delegate:write', {
          agent: params.agent,
          provider,
          prompt: params.prompt,
        });
        if (!allowed) {
          return this.finish(record, 'error', 'delegation denied by permission gate');
        }
      }

      const req: RunRequest = {
        prompt: params.prompt,
        cwd: this.opts.cwd,
        model,
        systemPrompt: [def?.systemPrompt ?? (adHoc ? AD_HOC_PROMPT : ''), this.rules]
          .filter(Boolean)
          .join('\n\n'),
        allowedTools: def?.tools,
        effort: def?.effort,
        // Without this the subagent cannot see the workspace at all — agy sandboxes
        // to nothing unless a directory is granted explicitly.
        addDirs: [this.opts.cwd],
        // A subagent has no terminal, so it can never answer a permission prompt.
        // Leaving prompting on does not make it safer — it makes it silently useless.
        // The real controls are the sandbox below and the gate applied above.
        skipPermissions: true,
        // Read-only agents keep terminal restrictions; only agents declared `writes`
        // get a shell, and those went through the approval gate first.
        sandbox: !def?.writes,
        signal: params.signal,
      };

      let text = '';
      let status: 'ok' | 'error' = 'error';
      let failure = '';

      for await (const ev of this.providers[provider].run(req)) {
        this.opts.onEvent?.({ t: 'delegation_event', id, event: ev });
        if (ev.t === 'init') record.sessionRef = ev.sessionRef;
        if (ev.t === 'text') text += ev.delta;
        if (ev.t === 'done') {
          text = ev.text || text;
          status = ev.status;
        }
        if (ev.t === 'error') failure = ev.message;
      }

      // An empty body is a failure even when the backend reports success. agy returns
      // SUCCESS with no response when it gives up mid-task, and passing that up as a
      // valid answer makes the lead agent believe the work was done.
      if (status === 'ok' && text.trim() === '') {
        return this.finish(
          record,
          'error',
          'subagent finished without producing any text — it may have been blocked ' +
            'from a tool it needed',
        );
      }

      return status === 'ok'
        ? this.finish(record, 'ok', text)
        : this.finish(record, 'error', failure || text || 'subagent produced no output');
    } catch (err) {
      return this.finish(record, 'error', `delegation crashed: ${(err as Error).message}`);
    } finally {
      release();
    }
  }

  /** Run several delegations concurrently, bounded by the semaphore. */
  async delegateAll(
    tasks: Array<{ agent: string; prompt: string; provider?: ProviderId; model?: string }>,
    signal?: AbortSignal,
  ): Promise<string[]> {
    return Promise.all(tasks.map((task) => this.delegate({ ...task, signal })));
  }

  private finish(record: DelegationRecord, status: 'ok' | 'error', result: string): string {
    record.status = status;
    record.result = result;
    record.endedAt = Date.now();
    this.opts.onEvent?.({ t: 'delegation_end', record });
    return status === 'ok' ? result : `error: ${result}`;
  }
}
