import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import type { ShadowEvent, ProviderId } from '@shadow/providers';
import { describeReset, fallbackProvider } from '@shadow/providers';
import {
  Orchestrator,
  SessionLog,
  createGate,
  listModels,
  loadHooks,
  loadPermissionConfig,
  recordUsage,
  resolveModel,
  runHooks,
  runLead,
  type ModelChoice,
} from '@shadow/core';
import { discoverSkillRoots, loadSkills } from '@shadow/skills';
import { renderBanner } from '@shadow/render';
import { ModelPicker } from './ModelPicker.js';
import { startApprovalServer, type ApprovalServer } from './approval-server.js';
import {
  dim,
  renderDelegation,
  renderGutter,
  renderStatusBar,
  terminalWidth,
} from '@shadow/render';
import { LiveTurn, TranscriptItem } from './Transcript.js';
import { Prompt } from './Prompt.js';
import { appendHistory, loadHistory } from './history.js';
import { expandMentions } from './mentions.js';
import { UsageOverlay } from './Usage.js';
import { EffortPicker } from './EffortPicker.js';
import {
  applyLeadEvent,
  delegationEnded,
  delegationStarted,
  formatUsage,
  initialState,
  say,
  startTurn,
  type AppState,
  type PendingApproval,
} from './state.js';

export interface AppProps {
  cwd: string;
  provider: ProviderId;
  model?: string;
  session: SessionLog;
  resume: boolean;
  version?: string;
}

/** Shown in the banner when no model was named on the command line. */
const DEFAULT_MODEL: Record<ProviderId, string> = {
  claude: 'sonnet',
  agy: 'gemini-3.1-pro-high',
};

const SLASH_COMMANDS: Array<[string, string]> = [
  ['/agents', 'list agents and their providers'],
  ['/provider', 'switch lead provider (claude | agy)'],
  ['/model', 'pick a model and reasoning effort'],
  ['/plan', 'toggle plan mode — design without executing'],
  ['/usage', 'quota & cost overlay (esc to close)'],
  ['/clear', 'clear the transcript'],
  ['/help', 'this list'],
  ['/exit', 'quit'],
];

export function App({
  cwd,
  provider: initialProvider,
  model,
  session,
  resume,
  version: VERSION = '0.1.0',
}: AppProps) {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>(initialState);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState<ProviderId>(initialProvider);
  const [leadModel, setLeadModel] = useState(model);
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [planMode, setPlanMode] = useState(false);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [pickingModel, setPickingModel] = useState(false);
  const [pickingEffort, setPickingEffort] = useState(false);
  const [showUsage, setShowUsage] = useState(false);

  /**
   * Apply a model choice. Selecting one on the other plan is a provider switch, and
   * runLead turns that into a handoff rather than a fresh start.
   */
  const applyModel = (choice: ModelChoice) => {
    setLeadModel(choice.id);
    if (choice.provider !== provider) {
      setProvider(choice.provider);
      setState((s) =>
        say(s, `switching to ${choice.id} on ${choice.provider} — the conversation carries over`),
      );
    } else {
      setState((s) => say(s, `model is now ${choice.id}`));
    }
  };

  const orchestratorRef = useRef<Orchestrator | null>(null);
  const gateRef = useRef<((tool: string, input: unknown) => Promise<boolean>) | null>(null);
  const approvalRef = useRef<ApprovalServer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resumedRef = useRef(resume);

  // The gate has no terminal of its own, so it asks by parking a promise here; the
  // approval banner resolves it when the user answers.
  const requestApproval = useCallback(
    (tool: string, detail: string) =>
      new Promise<boolean>((resolve) => {
        setState((s) => ({ ...s, approval: { tool, detail, resolve } as PendingApproval }));
      }),
    [],
  );

  useEffect(() => {
    // Re-assert the terminal title to ensure VS Code and other emulators catch it
    process.title = 'shadow';
    process.stdout.write('\x1b]0;Shadow\x07');

    let cancelled = false;
    void (async () => {
      const config = await loadPermissionConfig(cwd);
      const hooks = await loadHooks(cwd).catch(() => ({}));
      if (cancelled) return;

      const gate = createGate({
        config,
        prompt: requestApproval,
        preToolUse: async (tool, input) => {
          const outcomes = await runHooks(hooks, 'PreToolUse', cwd, {
            toolName: tool,
            toolInput: input,
          });
          const blocking = outcomes.find((o) => o.blocked);
          return blocking ? blocking.output || blocking.command : null;
        },
        onDecision: (tool, decision, reason) =>
          session.write({ kind: 'permission', tool, decision, reason, at: Date.now() }),
      });
      gateRef.current = gate;

      // agy runs in its own process, so its PreToolUse hook asks through here instead
      // of calling the gate directly. Same banner, same decision, different transport.
      const approvals = await startApprovalServer(requestApproval).catch(() => null);
      if (cancelled) {
        approvals?.close();
        return;
      }
      approvalRef.current = approvals;

      const orchestrator = new Orchestrator({
        cwd,
        approve: gate,
        approvalEndpoint: approvals ?? undefined,
        onEvent: (ev) => {
          if (ev.t === 'delegation_start') setState((s) => delegationStarted(s, ev.record));
          if (ev.t === 'delegation_end') setState((s) => delegationEnded(s, ev.record));
        },
      });
      await orchestrator.init();
      if (cancelled) return;

      orchestratorRef.current = orchestrator;
      setHistory(await loadHistory());

      // Only local, cheap facts go in the banner. Verifying a plan is reachable means a
      // round trip per provider — Claude's health check runs a whole query — and making
      // the banner wait on that would stall startup for seconds. `flick auth` is where
      // you check credentials; this is where you see your setup.
      const skills = await discoverSkillRoots(cwd)
        .then(loadSkills)
        .catch(() => []);
      if (cancelled) return;

      const banner = renderBanner(
        {
          cwd,
          provider: initialProvider,
          model: model ?? DEFAULT_MODEL[initialProvider],
          ready: ['claude', 'agy'],
          unavailable: [],
          agents: orchestrator.listAgents().length,
          skills: skills.length,
          version: VERSION,
          resumedFrom: resume ? session.id : undefined,
        },
        terminalWidth(),
      );

      // Committed first, so it stays pinned above everything. `<Static>` is append-only:
      // items can never be inserted before one already written.
      setState((s) =>
        s.committed.length === 0 ? { ...s, committed: [{ kind: 'banner', text: banner }] } : s,
      );
      setReady(true);

      // The catalogue is only needed when the picker opens, so it loads behind the
      // prompt rather than in front of it.
      void listModels()
        .then((choices) => {
          if (!cancelled) setModels(choices);
        })
        .catch(() => {});
    })();
    return () => {
      cancelled = true;
      // The endpoint grants permissions; it must not outlive the session that answers.
      approvalRef.current?.close();
      approvalRef.current = null;
    };
  }, [cwd, requestApproval, session, initialProvider, model, resume]);

  useInput((_char, key) => {
    if (key.escape && state.busy) {
      abortRef.current?.abort();
      setState((s) => ({ ...s, busy: false, status: 'interrupted' }));
    }
  });

  const answerApproval = (approved: boolean) => {
    const pending = state.approval;
    if (!pending) return;
    setState((s) => ({ ...s, approval: null }));
    pending.resolve(approved);
  };

  const handleSlash = (command: string) => {
    const [name, ...args] = command.slice(1).split(/\s+/);

    switch (name) {
      case 'help':
        setState((s) =>
          say(s, SLASH_COMMANDS.map(([cmd, desc]) => `  ${cmd.padEnd(12)} ${desc}`).join('\n')),
        );
        return;
      case 'agents': {
        const agents = orchestratorRef.current?.listAgents() ?? [];
        setState((s) =>
          say(
            s,
            agents.length === 0
              ? 'no agents defined — add markdown files to ~/.flick/agents/'
              : agents
                  .map(
                    (a) =>
                      `  ${a.name.padEnd(12)} ${a.provider}${a.model ? '/' + a.model : ''}  ${a.writes ? 'rw' : 'ro'}`,
                  )
                  .join('\n'),
          ),
        );
        return;
      }
      case 'provider': {
        const next = args[0];
        if (next !== 'claude' && next !== 'agy') {
          setState((s) => say(s, 'usage: /provider claude|agy', 'error'));
          return;
        }
        // Show a quick cost summary before switching so the user knows what each plan spent
        const cur = state.usage.get(provider) ?? { input: 0, output: 0 };
        const curCost = provider === 'claude'
          ? (cur.input * 3 / 1_000_000 + cur.output * 15 / 1_000_000)
          : (cur.input * 3.5 / 1_000_000 + cur.output * 10.5 / 1_000_000);
        setState((s) => say(
          s,
          `${provider} this session: ~$${curCost.toFixed(4)} · switching to ${next} — conversation carries over`,
        ));
        setProvider(next);
        return;
      }
      case 'model': {
        // Bare `/model` opens the picker; `/model <name>` resolves directly, so the
        // fast path stays available once you know what you want.
        if (!args[0]) {
          setPickingModel(true);
          return;
        }
        const match = resolveModel(models, args[0]);
        if (!match) {
          setState((s) => say(s, `no model matches "${args[0]}" — try /model`, 'error'));
          return;
        }
        applyModel(match);
        return;
      }
      case 'effort': {
        setPickingEffort(true);
        return;
      }
      case 'plan':
        setPlanMode((on) => {
          setState((s) => say(s, on ? 'plan mode off — tools will execute' : 'plan mode on — nothing will execute'));
          return !on;
        });
        return;
      case 'cost':
        setState((s) => say(s, formatUsage(s.usage)));
        return;
      case 'usage':
        setShowUsage((on) => !on);
        return;
      case 'clear':
        // Keep the header: it is a committed item, and dropping it would leave the
        // session with no banner until restart.
        setState((s) => ({
          ...initialState(),
          usage: s.usage,
          committed: [{ kind: 'header', cwd, target: `${provider}${leadModel ? '/' + leadModel : ''}` }],
        }));
        return;
      case 'exit':
      case 'quit':
        exit();
        return;
      default:
        setState((s) => say(s, `unknown command /${name} — try /help`, 'error'));
    }
  };

  /**
   * Run one turn on a given provider. Returns the quota event if the plan ran dry, so
   * the caller can offer the other provider and retry the same prompt.
   */
  const runTurn = async (
    text: string,
    on: ProviderId,
    model: string | undefined,
    reason: 'manual' | 'quota',
  ): Promise<Extract<ShadowEvent, { t: 'quota' }> | null> => {
    const orchestrator = orchestratorRef.current!;
    const controller = new AbortController();
    abortRef.current = controller;
    let exhausted: Extract<ShadowEvent, { t: 'quota' }> | null = null;

    try {
      const stream = runLead(text, {
        cwd,
        provider: on,
        model,
        effort: state.effort,
        session,
        orchestrator,
        resume: resumedRef.current,
        approve: gateRef.current ?? undefined,
        plan: planMode,
        stream: true,
        handoffReason: reason,
        approvalEndpoint: approvalRef.current ?? undefined,
        onHandoff: ({ from, to, tokens }) =>
          setState((s) => say(s, `context carried from ${from} to ${to} (~${tokens} tokens)`)),
        signal: controller.signal,
      });

      for await (const ev of stream) {
        if (ev.t === 'quota') {
          if (ev.status === 'exhausted') exhausted = ev;
          else setState((s) => say(s, `${ev.provider}: ${ev.detail}`));
          continue;
        }
        if (ev.t === 'usage') {
           recordUsage(on, ev.input, ev.output, ev.cacheRead);
        }
        setState((s) => applyLeadEvent(s, ev));
      }
      resumedRef.current = true;
    } finally {
      abortRef.current = null;
    }
    return exhausted;
  };

  const submit = async (value: string) => {
    const prompt = value.trim();
    setInput('');
    if (!prompt || state.busy) return;
    if (prompt.startsWith('/')) {
      handleSlash(prompt);
      return;
    }
    if (!orchestratorRef.current) return;

    setHistory((h) => [...h, prompt]);
    void appendHistory(prompt);
    setState((s) => startTurn(s, prompt));

    try {
      // `@file` mentions become attached contents; the visible prompt keeps the mention.
      const expanded = await expandMentions(prompt, cwd);
      const exhausted = await runTurn(expanded, provider, leadModel, 'manual');
      if (!exhausted) return;

      // The plan ran out mid-turn. Offer the other provider rather than losing the work:
      // the conversation carries over, so continuing costs one handoff, not a restart.
      const to = fallbackProvider(exhausted.provider);
      const at = describeReset(exhausted.resetsAt);
      const approved = await requestApproval(
        `continue on ${to}?`,
        `${exhausted.provider} is out of quota${at ? ` (resets ${at})` : ''} — ${exhausted.detail}`,
      );
      if (!approved) {
        setState((s) => say(s, `stopped. /provider ${to} will continue when you want.`, 'error'));
        setState((s) => ({ ...s, busy: false }));
        return;
      }

      setProvider(to);
      setLeadModel(undefined);
      setState((s) => say(s, `switching to ${to} and retrying`));
      await runTurn(expanded, to, undefined, 'quota');
    } catch (err) {
      setState((s) => say(s, `error: ${(err as Error).message}`, 'error'));
      setState((s) => ({ ...s, busy: false }));
    }
  };

  const running = [...state.running.values()];
  const width = terminalWidth();

  // The usage overlay is a true full-screen modal: when it's open we render
  // ONLY the overlay, so it never interferes with the chat scroll area or
  // causes the live area to jump from unexpected height changes.
  if (showUsage) {
    return <UsageOverlay usage={state.usage} onClose={() => setShowUsage(false)} />;
  }

  return (
    <Box flexDirection="column">
      {/* Committed items are written once and never repainted. The header is the
          first of them, because anything outside Static paints below it. */}
      <Static items={state.committed}>
        {(item, i) => <TranscriptItem key={i} item={item} />}
      </Static>

      <LiveTurn text={state.liveText} pendingTools={state.pendingTools} />

      {running.map((d) => (
        <Text key={d.id}>
          {renderGutter(renderDelegation(d.agent, d.provider, d.model, 'running'), 'assistant')}
        </Text>
      ))}

      {state.todos.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {state.todos.map((todo, i) => (
            <Text key={i} dimColor={todo.status === 'completed'}>
              {`  ${todo.status === 'completed' ? '✔' : todo.status === 'in_progress' ? '▸' : '○'} ${todo.content}`}
            </Text>
          ))}
        </Box>
      )}

      {pickingModel ? (
        <ModelPicker
          choices={models}
          current={leadModel}
          currentProvider={provider}
          currentEffort={state.effort}
          onSelect={(choice) => {
            setPickingModel(false);
            applyModel(choice);
          }}
          onEffortChange={(effort) => {
            setState((s) => ({ ...s, effort }));
          }}
          onCancel={() => setPickingModel(false)}
        />
      ) : pickingEffort ? (
        <EffortPicker
          current={state.effort}
          onSelect={(choice) => {
            setPickingEffort(false);
            setState((s) => ({ ...s, effort: choice }));
            setState((s) => say(s, `reasoning effort set to ${choice}`));
          }}
          onCancel={() => setPickingEffort(false)}
        />
      ) : state.approval ? (
        <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
          <Text color="yellow" bold>{`allow ${state.approval.tool}?`}</Text>
          <Text dimColor>{state.approval.detail}</Text>
          <Box>
            <Text>{'y/n › '}</Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={(v) => {
                setInput('');
                answerApproval(v.trim().toLowerCase().startsWith('y'));
              }}
            />
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text dimColor>{'─'.repeat(width)}</Text>
          {state.busy && (
            <Text color="yellow">
              <Spinner type="dots" />
              {dim(' working — esc to interrupt')}
            </Text>
          )}
          <Prompt
            value={input}
            onChange={setInput}
            onSubmit={submit}
            placeholder={ready ? 'ask anything · @file · /help' : 'loading agents…'}
            commands={SLASH_COMMANDS}
            cwd={cwd}
            disabled={state.busy}
            history={history}
          />
        </Box>
      )}

      <Box>
        <Text>
          {renderStatusBar(
            [
              planMode ? '\x1b[33mPLAN\x1b[39m' : '',
              dim(formatUsage(state.usage)),
              state.status ? dim(state.status) : '',
              state.busy ? dim('esc to interrupt') : '',
              dim(`${leadModel ?? provider} · ${state.effort ?? 'high'}`),
            ],
            width,
          )}
        </Text>
      </Box>
    </Box>
  );
}
