/**
 * ClaudeProvider — wraps @anthropic-ai/claude-agent-sdk as a shadow Provider.
 *
 * The SDK already owns the agent loop, tool execution, MCP clients and permission
 * plumbing, and it reuses the credentials the `claude` CLI already stored. shadow's job
 * here is only translation: SDKMessage in, ShadowEvent out, so the orchestrator can treat
 * a Claude run and an agy run identically.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ShadowEvent, HealthResult, Provider, RunRequest } from './types.js';
import { quotaFromClaudeError, quotaFromRateLimitInfo } from './quota.js';

export interface ClaudeProviderOptions {
  defaultModel?: string;
  /**
   * Emit text token-by-token instead of one chunk per assistant message.
   * Off by default: a one-shot consumer only wants the final text, and partial events
   * roughly double the message volume.
   */
  stream?: boolean;
  /** Subagent definitions handed to the SDK, keyed by agent name. */
  agents?: Options['agents'];
  mcpServers?: Options['mcpServers'];
  /** Custom in-process tools exposed to the model, e.g. shadow's `delegate`. */
  extraOptions?: Partial<Options>;
}

export class ClaudeProvider implements Provider {
  readonly id = 'claude' as const;
  private readonly defaultModel: string;
  private readonly opts: ClaudeProviderOptions;

  constructor(opts: ClaudeProviderOptions = {}) {
    this.defaultModel = opts.defaultModel ?? 'claude-sonnet-4-5';
    this.opts = opts;
  }

  async models(): Promise<string[]> {
    // The SDK does not expose a model listing endpoint; these are the ids it accepts.
    return ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'opus', 'sonnet', 'haiku'];
  }

  async health(): Promise<HealthResult> {
    try {
      let sawInit = false;
      for await (const ev of this.run({ prompt: 'ok', cwd: process.cwd() })) {
        if (ev.t === 'init') sawInit = true;
        if (ev.t === 'error') return { ok: false, detail: ev.message };
        if (ev.t === 'done') break;
      }
      return sawInit
        ? { ok: true, detail: 'claude agent sdk ready' }
        : { ok: false, detail: 'sdk produced no init — check `claude` login or ANTHROPIC_API_KEY' };
    } catch (err) {
      return { ok: false, detail: `claude sdk unavailable: ${(err as Error).message}` };
    }
  }

  run(req: RunRequest): AsyncIterable<ShadowEvent> {
    return this.stream(req, undefined);
  }

  resume(sessionRef: string, req: RunRequest): AsyncIterable<ShadowEvent> {
    return this.stream(req, sessionRef);
  }

  private buildOptions(req: RunRequest, resume?: string): Options {
    const controller = new AbortController();
    req.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    const options: Options = {
      model: req.model ?? this.defaultModel,
      cwd: req.cwd,
      abortController: controller,
      ...(this.opts.stream ? { includePartialMessages: true } : {}),
      ...this.opts.extraOptions,
    };

    if (req.systemPrompt) {
      // Append rather than replace: the claude_code preset carries the tool-use
      // conventions the SDK's own tools rely on.
      options.systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
        append: req.systemPrompt,
      };
    }
    if (req.allowedTools) options.allowedTools = req.allowedTools;
    if (req.disallowedTools) options.disallowedTools = req.disallowedTools;
    if (req.skills) {
      options.skills = req.skills;
      // Skills live under ~/.claude and are only discovered when the user settings
      // source is loaded; 'project' additionally brings in CLAUDE.md.
      options.settingSources = ['user', 'project'];
    }
    if (req.pluginPaths?.length) {
      options.plugins = req.pluginPaths.map((path) => ({ type: 'local' as const, path }));
    }
    if (req.addDirs?.length) options.additionalDirectories = req.addDirs;
    if (resume) options.resume = resume;
    if (this.opts.agents) options.agents = this.opts.agents;
    if (this.opts.mcpServers) options.mcpServers = this.opts.mcpServers;

    // Plan mode outranks the others: the point is that nothing executes, so neither a
    // permission bypass nor a gate should be able to let a tool through.
    if (req.plan) {
      options.permissionMode = 'plan';
    } else if (req.skipPermissions) {
      options.permissionMode = 'bypassPermissions';
    } else if (req.approve) {
      // Route the SDK's own tool calls through shadow's gate. Without this the SDK has
      // no way to ask — there is no terminal attached to it — so it answers the model
      // with "needs permission" and the turn stalls having done half the work.
      const approve = req.approve;
      options.canUseTool = async (toolName, input) => {
        const allowed = await approve(toolName, input);
        return allowed
          ? { behavior: 'allow' as const, updatedInput: input }
          : { behavior: 'deny' as const, message: `${toolName} denied by shadow` };
      };
    }

    return options;
  }

  private async *stream(req: RunRequest, resume?: string): AsyncIterable<ShadowEvent> {
    let sessionRef = resume ?? '';
    let buffered = '';
    const streaming = Boolean(this.opts.stream);

    try {
      const stream = query({ prompt: req.prompt, options: this.buildOptions(req, resume) });

      for await (const msg of stream as AsyncIterable<SDKMessage>) {
        switch (msg.type) {
          case 'system': {
            if (msg.subtype !== 'init') break;
            sessionRef = msg.session_id;
            yield {
              t: 'init',
              provider: 'claude',
              sessionRef,
              model: msg.model,
              tools: msg.tools ?? [],
            };
            break;
          }

          case 'stream_event': {
            // Token-level deltas. Only present when includePartialMessages is on, in
            // which case the completed `assistant` message repeats the same prose —
            // see the guard below that stops it being emitted twice.
            const event: any = (msg as any).event;
            if (event?.type !== 'content_block_delta') break;
            const delta = event.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              buffered += delta.text;
              yield { t: 'text', delta: delta.text };
            } else if (delta?.type === 'thinking_delta' && delta.thinking) {
              yield { t: 'thinking', delta: delta.thinking };
            }
            break;
          }

          case 'rate_limit_event': {
            const quota = quotaFromRateLimitInfo((msg as any).rate_limit_info ?? {});
            if (quota) yield quota;
            break;
          }

          case 'assistant': {
            sessionRef ||= msg.session_id;
            // The SDK tags the message rather than throwing, so a quota failure would
            // otherwise look like an ordinary short answer.
            const quota = quotaFromClaudeError((msg as any).error);
            if (quota) yield quota;
            for (const block of msg.message.content ?? []) {
              if (block.type === 'text' && block.text) {
                // Already streamed as deltas; emitting again would duplicate the turn.
                if (streaming) continue;
                buffered += block.text;
                yield { t: 'text', delta: block.text };
              } else if (block.type === 'thinking' && block.thinking) {
                if (streaming) continue;
                yield { t: 'thinking', delta: block.thinking };
              } else if (block.type === 'tool_use') {
                yield { t: 'tool_call', id: block.id, name: block.name, input: block.input };
              }
            }
            break;
          }

          case 'user': {
            // Tool results come back wrapped in a synthetic user message.
            const content = msg.message.content;
            if (!Array.isArray(content)) break;
            for (const block of content) {
              if (block.type !== 'tool_result') continue;
              const output =
                typeof block.content === 'string'
                  ? block.content
                  : (block.content ?? [])
                      .map((c: any) => (c.type === 'text' ? c.text : `[${c.type}]`))
                      .join('');
              yield {
                t: 'tool_result',
                id: block.tool_use_id,
                output,
                isError: Boolean(block.is_error),
              };
            }
            break;
          }

          case 'result': {
            sessionRef ||= msg.session_id;
            const usage: any = (msg as any).usage;
            if (usage) {
              yield {
                t: 'usage',
                input: usage.input_tokens ?? 0,
                output: usage.output_tokens ?? 0,
                cacheRead: usage.cache_read_input_tokens ?? 0,
                thinking: 0,
              };
            }
            const text = msg.subtype === 'success' ? msg.result : buffered;
            yield {
              t: 'done',
              text: text || buffered,
              status: msg.subtype === 'success' && !msg.is_error ? 'ok' : 'error',
              sessionRef,
            };
            return;
          }

          default:
            break;
        }
      }

      // The SDK stream ended without a result message.
      yield { t: 'done', text: buffered, status: 'ok', sessionRef };
    } catch (err) {
      const message = (err as Error).message;
      // A thrown rate limit still has to surface as a quota event, or the UI would
      // report a generic failure and never offer the other provider.
      const quota = /rate.?limit|quota|429|billing/i.test(message)
        ? ({ t: 'quota', provider: 'claude', status: 'exhausted', detail: message } as const)
        : null;
      if (quota) yield quota;
      yield { t: 'error', message: `claude sdk: ${message}` };
    }
  }
}
