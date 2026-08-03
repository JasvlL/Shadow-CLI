import type { ShadowEvent } from '@shadow/providers';
import { describeReset, fallbackProvider } from '@shadow/providers';
import type { OrchestratorEvent } from '@shadow/core';
import {
  dim,
  indent,
  red,
  renderDelegation,
  renderToolCall,
  renderToolResult,
  terminalWidth,
} from '@shadow/render';

/** Running token totals, kept per provider because they bill against separate plans. */
export class UsageTally {
  private readonly byProvider = new Map<string, { input: number; output: number }>();

  add(provider: string, input: number, output: number): void {
    const entry = this.byProvider.get(provider) ?? { input: 0, output: 0 };
    entry.input += input;
    entry.output += output;
    this.byProvider.set(provider, entry);
  }

  format(): string {
    if (this.byProvider.size === 0) return '';
    return [...this.byProvider.entries()]
      .map(([p, u]) => `${p} in=${u.input} out=${u.output}`)
      .join('  |  ');
  }
}

export function renderOrchestratorEvent(ev: OrchestratorEvent, tally: UsageTally): void {
  switch (ev.t) {
    case 'delegation_start':
      process.stderr.write(
        `${indent(renderDelegation(ev.record.agent, ev.record.provider, ev.record.model, 'running'), 2)}\n`,
      );
      break;
    case 'delegation_event':
      if (ev.event.t === 'usage') {
        tally.add('subagent', ev.event.input, ev.event.output);
      }
      break;
    case 'delegation_end': {
      const ms = (ev.record.endedAt ?? Date.now()) - ev.record.startedAt;
      const line = renderDelegation(
        ev.record.agent,
        ev.record.provider,
        ev.record.model,
        ev.record.status === 'ok' ? 'ok' : 'error',
        ms,
      );
      process.stderr.write(`${indent(line, 2)}\n`);
      break;
    }
  }
}

/** Render a lead stream to stdout. Returns a nonzero code if the run failed. */
export async function renderLead(
  stream: AsyncIterable<ShadowEvent>,
  opts: { json?: boolean; tally: UsageTally; provider: string },
): Promise<number> {
  let failed = false;

  for await (const ev of stream) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(ev)}\n`);
      if (ev.t === 'error' || (ev.t === 'done' && ev.status === 'error')) failed = true;
      continue;
    }

    switch (ev.t) {
      case 'init':
        process.stderr.write(`${dim(`· ${ev.provider}/${ev.model} [${ev.sessionRef.slice(0, 8)}]`)}\n`);
        break;
      case 'text':
        process.stdout.write(ev.delta);
        break;
      case 'tool_call':
        // Diffs go to stderr alongside the call, so piping stdout still yields clean prose.
        process.stderr.write(`${renderToolCall(ev.name, ev.input, { width: terminalWidth() })}\n`);
        break;
      case 'tool_result':
        if (ev.isError) process.stderr.write(`${renderToolResult(ev.output, true)}\n`);
        break;
      case 'usage':
        opts.tally.add(opts.provider, ev.input, ev.output);
        break;
      case 'done':
        process.stdout.write('\n');
        if (ev.status === 'error') failed = true;
        break;
      case 'quota': {
        const at = describeReset(ev.resetsAt);
        const other = fallbackProvider(ev.provider);
        process.stderr.write(
          `${red(`${ev.provider} quota: ${ev.detail}${at ? ` (resets ${at})` : ''}`)}\n`,
        );
        if (ev.status === 'exhausted') {
          // No terminal here to ask on, so point at the command that continues with the
          // conversation intact rather than leaving the user to guess.
          process.stderr.write(
            dim(`  continue with: shadow --continue --provider ${other} -p "…"\n`),
          );
        }
        break;
      }
      case 'error':
        process.stderr.write(red(`error: ${ev.message}\n`));
        failed = true;
        break;
    }
  }

  const usage = opts.tally.format();
  if (usage && !opts.json) process.stderr.write(dim(`${usage}\n`));
  return failed ? 1 : 0;
}
