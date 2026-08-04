import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import type { ShadowEvent, ProviderId } from '@shadow/providers';
import { describeReset, fallbackProvider, isClaudeSignedIn } from '@shadow/providers';
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
  loadLicense,
  validateLicenseKey,
  clearLicense,
  accountStatuses,
  getAccount,
  invalidateAuth,
  ACCOUNTS,
  type AccountId,
  compactTranscript,
  readTranscript,
  renderTranscriptMarkdown,
  findRuleFiles,
  formatRules,
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
import { runInteractive } from './suspend.js';
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
  ['/effort', 'pick reasoning effort'],
  ['/skill', 'manage shadow skills (sync | new <name> | lint)'],
  ['/mcp', 'manage MCP servers for the current provider'],
  ['/plan', 'toggle plan mode — design without executing'],
  ['/usage', 'quota & cost overlay (esc to close)'],
  ['/cost', 'quota & spend so far this session'],
  ['/login', 'sign in: shadow <key> | claude | antigravity'],
  ['/logout', 'sign out of an account'],
  ['/compact', 'summarize the transcript to free up context'],
  ['/config', 'show the current permission config'],
  ['/memory', 'show resolved project rule files'],
  ['/export', 'save the session transcript (md | json)'],
  ['/permissions', 'show the allow/deny/auto-approve gate'],
  ['/add-dir', 'let agents operate in another directory too'],
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
  const [extraDirs, setExtraDirs] = useState<string[]>([]);
  /** Set while another CLI owns the terminal for an interactive login. */
  const [suspended, setSuspended] = useState<AccountId | null>(null);

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
  // The orchestrator is built once, so it has to read the tier through a ref: a value
  // captured in that closure would pin whatever the licence was at startup, and
  // `/login shadow <key>` would appear to do nothing until the next run.
  const licenseRef = useRef<'free' | 'pro'>('free');
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
      const licenseInfo = loadLicense();
      
      if (cancelled) return;
      licenseRef.current = licenseInfo.tier;
      setState((s) => ({ ...s, license: licenseInfo.tier }));

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
        isPro: () => licenseRef.current === 'pro',
        onEvent: (ev) => {
          if (ev.t === 'delegation_start') setState((s) => delegationStarted(s, ev.record));
          if (ev.t === 'delegation_end') setState((s) => delegationEnded(s, ev.record));
        },
      });
      await orchestrator.init();
      if (cancelled) return;

      orchestratorRef.current = orchestrator;
      setHistory(await loadHistory());

      // Only cheap facts go in the banner. `isClaudeSignedIn()` is a file stat, so
      // Claude's state here is real and free. agy's costs a ~2s subprocess, so it stays
      // optimistic and is corrected by the background notice below — same reasoning that
      // keeps `health()` out of the banner: nothing that stalls startup belongs here.
      const skills = await discoverSkillRoots(cwd)
        .then(loadSkills)
        .catch(() => []);
      if (cancelled) return;

      const claudeReady = isClaudeSignedIn();

      const banner = renderBanner(
        {
          cwd,
          provider: initialProvider,
          model: model ?? DEFAULT_MODEL[initialProvider],
          ready: claudeReady ? ['claude', 'agy'] : ['agy'],
          unavailable: claudeReady ? [] : ['claude'],
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

      // A plan you are not signed in to contributes no models, and without this they are
      // simply absent from `/model` with no explanation. Runs behind the prompt because
      // the agy half spawns a subprocess.
      void accountStatuses().then((statuses) => {
        if (cancelled) return;
        for (const { id, grant } of ACCOUNTS) {
          if (grant.kind !== 'models') continue;
          if (statuses.get(id)?.signedIn) continue;
          const plan = grant.provider;
          setState((s) => say(s, `${plan} models hidden — /login ${id}`));
        }
      });

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

  useInput(
    (_char, key) => {
      if (key.escape && state.busy) {
        abortRef.current?.abort();
        setState((s) => ({ ...s, busy: false, status: 'interrupted' }));
      }
    },
    // Every useInput must go quiet while the child owns the terminal. Ink refcounts raw
    // mode and only restores cooked mode once the last hook releases it, so a single
    // active handler here would keep the child from reading input at all.
    { isActive: !suspended },
  );

  /**
   * Hand the terminal to another CLI, then take it back.
   *
   * Deliberately an effect rather than part of the `/login` handler: `setSuspended` is
   * async, and spawning in the same tick would start the child before React had committed
   * and before Ink's `useInput` cleanups had released raw mode.
   */
  useEffect(() => {
    if (!suspended) return;
    // `/login` only suspends for spawn-backed accounts; anything else is a bug upstream.
    const account = getAccount(suspended);
    if (!account || account.signIn.kind === 'license') {
      setSuspended(null);
      return;
    }

    let cancelled = false;
    const { bin, args: binArgs, hint } = account.signIn;
    void (async () => {
      try {
        const result = await runInteractive(bin, binArgs ?? []);
        if (cancelled) return;

        if (result.error) {
          setState((s) => say(s, `could not launch \`${bin}\` — ${hint}`, 'error'));
          return;
        }

        invalidateAuth(account.id);
        const status = await account.status();
        if (cancelled) return;
        setState((s) => say(s, `${account.label}: ${status.detail}`));

        // Signing in changes what the catalogue can offer, so refresh it rather than
        // making the user restart to see their models.
        if (status.signedIn) {
          void listModels()
            .then((choices) => {
              if (!cancelled) setModels(choices);
            })
            .catch(() => {});
        }
      } finally {
        // Unconditional: a failed spawn must never leave the UI with input disabled.
        if (!cancelled) setSuspended(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [suspended]);

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
        
        let nextEffort = state.effort;
        const validEfforts = match.efforts ?? ['low', 'medium', 'high'];
        if (nextEffort && !validEfforts.includes(nextEffort)) {
          nextEffort = validEfforts[0];
          setState((s) => ({ ...s, effort: nextEffort }));
        }
        
        applyModel(match);
        return;
      }
      case 'skill': {
        if (args.length === 0) {
          setState((s) => say(s, 'usage: /skill [sync|new <name>|clone <url>|lint]', 'error'));
          return;
        }
        setState((s) => ({ ...s, busy: true }));
        import('node:child_process').then(({ exec }) => {
          const cmd = `"${process.execPath}" "${process.argv[1]}" skills ${args.join(' ')}`;
          exec(cmd, { cwd }, (error, stdout, stderr) => {
            const out = [stdout, stderr].filter(Boolean).join('\n').trim();
            setState((s) => {
              const s1 = say(s, out || (error ? error.message : 'done'));
              return { ...s1, busy: false };
            });
          });
        });
        return;
      }
      case 'mcp': {
        if (args.length === 0) {
          setState((s) => say(s, `usage: /mcp [add|remove|list] (runs ${provider} mcp)`, 'error'));
          return;
        }
        setState((s) => ({ ...s, busy: true }));
        import('node:child_process').then(({ exec }) => {
          exec(`${provider} mcp ${args.join(' ')}`, { cwd }, (error, stdout, stderr) => {
            const out = [stdout, stderr].filter(Boolean).join('\n').trim();
            setState((s) => {
              const s1 = say(s, out || (error ? error.message : 'done'));
              return { ...s1, busy: false };
            });
          });
        });
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
      case 'login': {
        const target = args[0];
        // Bare `/login` reports all three. Invalidate first so this is a real check
        // rather than a replay — a sign-in from another terminal shows up here.
        if (!target) {
          setState((s) => ({ ...s, busy: true }));
          invalidateAuth();
          void accountStatuses().then((statuses) => {
            const lines = ACCOUNTS.map(
              (a) => `  ${a.label.padEnd(12)} ${statuses.get(a.id)?.detail ?? '?'}`,
            ).join('\n');
            setState((s) => ({ ...say(s, lines), busy: false }));
          });
          return;
        }

        const account = getAccount(target as AccountId);
        if (!account) {
          const names = ACCOUNTS.map((a) => a.id).join(' | ');
          setState((s) => say(s, `usage: /login <${names}>`, 'error'));
          return;
        }

        // shadow's own account is the only one it can grant: everything else lives in
        // another CLI, so those hand the terminal over instead (see the suspend effect).
        if (account.signIn.kind === 'license') {
          const key = args[1];
          if (!key) {
            setState((s) => say(s, 'usage: /login shadow <key>', 'error'));
            return;
          }
          setState((s) => ({ ...s, busy: true }));
          void validateLicenseKey(key).then((result) => {
            invalidateAuth('shadow');
            licenseRef.current = result.tier;
            setState((s) => {
              const s1 = say(
                s,
                result.active
                  ? 'Shadow PRO unlocked — delegation and the quota tracker are on.'
                  : 'invalid license key.',
                result.active ? undefined : 'error',
              );
              return { ...s1, busy: false, license: result.tier };
            });
          });
          return;
        }

        setSuspended(account.id);
        return;
      }
      case 'logout': {
        const target = args[0];
        if (!target) {
          const names = ACCOUNTS.map((a) => a.id).join(' | ');
          setState((s) => say(s, `usage: /logout <${names}>`, 'error'));
          return;
        }
        const account = getAccount(target as AccountId);
        if (!account) {
          setState((s) => say(s, `unknown account "${target}"`, 'error'));
          return;
        }
        if (account.signIn.kind === 'license') {
          clearLicense();
          invalidateAuth('shadow');
          licenseRef.current = 'free';
          setState((s) => ({ ...say(s, 'logged out — back to Shadow Free.'), license: 'free' }));
          return;
        }
        // Not shadow's credentials to drop — say where they actually live.
        const { bin } = account.signIn;
        invalidateAuth(account.id);
        setState((s) =>
          say(s, `shadow does not hold ${account.label} credentials — sign out with \`${bin}\` itself.`),
        );
        return;
      }
      case 'compact': {
        setState((s) => ({ ...s, busy: true }));
        void (async () => {
          const turns = await readTranscript(session.path);
          const result = await compactTranscript(turns, provider, leadModel ?? DEFAULT_MODEL[provider], cwd);
          setState((s) => {
            if (!result) return { ...say(s, 'compact failed — transcript left as-is.', 'error'), busy: false };
            session.setSummary(result);
            return { ...say(s, `transcript compacted (${result.covers} turns summarized by ${result.by}).`), busy: false };
          });
        })();
        return;
      }
      case 'config': {
        void loadPermissionConfig(cwd).then((config) => {
          setState((s) =>
            say(
              s,
              [
                `config: ${cwd}/.shadow/config.json`,
                `allow: ${config.allow.join(', ') || '(none)'}`,
                `deny: ${config.deny.join(', ') || '(none)'}`,
                `autoApprove: ${config.autoApprove ? 'on' : 'off'}`,
              ].join('\n'),
            ),
          );
        });
        return;
      }
      case 'memory': {
        void findRuleFiles(cwd).then((files) => {
          setState((s) =>
            say(
              s,
              files.length === 0
                ? 'no rule files found (SHADOW.md / AGENTS.md / CLAUDE.md / GEMINI.md)'
                : formatRules(files),
            ),
          );
        });
        return;
      }
      case 'export': {
        const format = args[0] === 'json' ? 'json' : 'md';
        setState((s) => ({ ...s, busy: true }));
        void (async () => {
          const turns = await readTranscript(session.path);
          const content = format === 'json' ? JSON.stringify(turns, null, 2) : renderTranscriptMarkdown(turns);
          const { writeFile } = await import('node:fs/promises');
          const path = await import('node:path');
          const outPath = path.join(cwd, `shadow-export-${session.id}.${format}`);
          await writeFile(outPath, content, 'utf8');
          setState((s) => ({ ...say(s, `exported to ${outPath}`), busy: false }));
        })();
        return;
      }
      case 'permissions': {
        void loadPermissionConfig(cwd).then((config) => {
          setState((s) =>
            say(
              s,
              [
                `allow: ${config.allow.join(', ') || '(none)'}`,
                `deny: ${config.deny.join(', ') || '(none)'}`,
                `autoApprove: ${config.autoApprove ? 'on' : 'off'}`,
                `edit these in ${cwd}/.shadow/config.json`,
              ].join('\n'),
            ),
          );
        });
        return;
      }
      case 'add-dir': {
        const target = args[0];
        if (!target) {
          setState((s) => say(s, 'usage: /add-dir <path>', 'error'));
          return;
        }
        void (async () => {
          const path = await import('node:path');
          const fs = await import('node:fs');
          const resolved = path.isAbsolute(target) ? target : path.join(cwd, target);
          if (!fs.existsSync(resolved)) {
            setState((s) => say(s, `no such directory: ${resolved}`, 'error'));
            return;
          }
          setExtraDirs((dirs) => (dirs.includes(resolved) ? dirs : [...dirs, resolved]));
          setState((s) => say(s, `added ${resolved} — agents can now operate there too`));
        })();
        return;
      }
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
        addDirs: extraDirs,
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
    if (!orchestratorRef.current) return;

    setHistory((h) => [...h, prompt]);
    void appendHistory(prompt);

    if (prompt.startsWith('/')) {
      handleSlash(prompt);
      return;
    }

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
    return <UsageOverlay usage={state.usage} license={state.license} onClose={() => setShowUsage(false)} />;
  }

  // While another CLI owns the terminal, render only the committed scrollback. Those
  // lines were written to stdout once and are never repainted, so the child cannot
  // corrupt them; dropping the live region below means Ink erases its frame and stays
  // silent, and the child's output lands cleanly underneath. This also guarantees the
  // pickers and the approval prompt are unmounted, so no useInput is left holding raw
  // mode. On resume a fresh live region is painted below the child's output.
  if (suspended) {
    return (
      <Static items={state.committed}>
        {(item, i) => <TranscriptItem key={i} item={item} />}
      </Static>
    );
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
            let nextEffort = state.effort;
            const validEfforts = choice.efforts ?? ['low', 'medium', 'high'];
            if (nextEffort && !validEfforts.includes(nextEffort)) {
              nextEffort = validEfforts[0];
            }
            setState((s) => ({ ...s, effort: nextEffort }));
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
            disabled={state.busy || !!suspended}
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
