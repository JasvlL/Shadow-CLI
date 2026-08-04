import { describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../src/orchestrator.js';

/**
 * The PRO gate on delegation.
 *
 * The important part is not just that a free session is refused, but *how*: the refusal
 * has to happen before any bookkeeping, or the UI shows a subagent that starts and
 * instantly dies. These assert the shape of that refusal, not only its text.
 */
describe('delegation PRO gate', () => {
  const cwd = process.cwd();

  it('refuses to delegate without a licence, in-band', async () => {
    const orchestrator = new Orchestrator({ cwd, isPro: () => false });
    const onEvent = vi.fn();
    const withEvents = new Orchestrator({ cwd, isPro: () => false, onEvent });

    const result = await orchestrator.delegate({ agent: 'scout', prompt: 'find things' });

    expect(result).toMatch(/^error:/);
    expect(result).toContain('PRO');
    expect(result).toContain('/login shadow');

    // No delegation_start/end: nothing was ever recorded as running.
    await withEvents.delegate({ agent: 'scout', prompt: 'find things' });
    expect(onEvent).not.toHaveBeenCalled();
    expect([...withEvents.delegations.keys()]).toHaveLength(0);
  });

  it('refuses before resolving the agent, so an unknown name is not the reason', async () => {
    const orchestrator = new Orchestrator({ cwd, isPro: () => false });
    const result = await orchestrator.delegate({ agent: 'no-such-agent', prompt: 'x' });
    // The licence is the blocking fact; the roster is never consulted.
    expect(result).toContain('PRO');
    expect(result).not.toContain('unknown agent');
  });

  it('reads the licence through the getter on every call', async () => {
    // A session that upgrades mid-flight must start working without a restart, which is
    // the whole reason OrchestratorOptions takes a getter rather than a boolean.
    let pro = false;
    const orchestrator = new Orchestrator({ cwd, isPro: () => pro });

    expect(orchestrator.isPro()).toBe(false);
    pro = true;
    expect(orchestrator.isPro()).toBe(true);
  });
});
