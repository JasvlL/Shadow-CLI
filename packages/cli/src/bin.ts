import { parseArgs } from 'node:util';
import { AgyProvider, ClaudeProvider } from '@flick/providers';
import type { FlickEvent, Provider, ProviderId } from '@flick/providers';
import {
  Orchestrator,
  SessionLog,
  createGate,
  listModels,
  loadHooks,
  loadPermissionConfig,
  runHooks,
  runLead,
} from '@flick/core';
import { dim } from '@flick/render';
import { flickPluginDir } from '@flick/skills';
import { UsageTally, renderLead, renderOrchestratorEvent } from './render.js';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';

const VERSION = '0.1.0';

const USAGE = `flick ${VERSION} — multi-agent, multi-provider terminal IDE

Usage:
  flick                        Open the interactive IDE
  flick -p <prompt>            Run one lead turn (delegation enabled)
  flick raw <provider> <text>  Stream a single provider run, no orchestration
  flick init                   Create FLICK.md and .flick/ in this project
  flick agents                 List agents defined in .flick/agents
  flick skills [sync|new|lint] Skills shared across both providers
  flick models [provider]      List models a provider accepts
  flick sessions               List sessions in this workspace
  flick doctor                 Check that each provider is reachable
  flick auth                   Show credential status for both providers
  flick mcp                    Run the MCP bridge on stdio (agy calls this)
  flick bridge install         Register the bridge in agy's MCP config

Options:
  -p, --prompt <text>   Prompt for the lead agent
  --provider <id>       Lead provider: claude (default) or agy
  --model <id>          Model for this run
  --effort <level>      low | medium | high
  --continue            Resume the most recent session
  --resume <id>         Resume a specific session (or provider conversation, with raw)
  --json                Emit raw FlickEvent NDJSON
  -y, --yes             Approve every tool without asking (destructive
                        commands are still refused)
  --plan                Plan the work without executing anything
  --no-hooks            Ignore .flick/hooks.json for this run
  -v, --version
  -h, --help
`;

function providerFor(name: string): Provider {
  switch (name) {
    case 'agy':
      return new AgyProvider({
        onUnparsed: (line) => {
          if (process.env.FLICK_DEBUG) process.stderr.write(`[unparsed] ${line}\n`);
        },
      });
    case 'claude':
      return new ClaudeProvider();
    default:
      throw new Error(`unknown provider '${name}' (known: agy, claude)`);
  }
}

async function renderRaw(stream: AsyncIterable<FlickEvent>, asJson: boolean): Promise<number> {
  return renderLead(stream, { json: asJson, tally: new UsageTally(), provider: 'raw' });
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
      prompt: { type: 'string', short: 'p' },
      provider: { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      resume: { type: 'string' },
      continue: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      'dry-run': { type: 'boolean' },
      plan: { type: 'boolean' },
      'no-hooks': { type: 'boolean' },
    },
  });

  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const cwd = process.cwd();
  const [command, ...rest] = positionals;

  // `flick -p "..."` with no subcommand is the primary entry point.
  if (values.prompt && !command) {
    return runOneShot(String(values.prompt), cwd, values);
  }

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  // Bare `flick` opens the IDE, but only with a real terminal to draw on.
  if (!command && !values.prompt) {
    if (!process.stdin.isTTY) {
      process.stdout.write(USAGE);
      return 1;
    }
    return runInteractive(cwd, values);
  }

  switch (command) {
    case 'raw': {
      const [providerName, ...promptParts] = rest;
      const prompt = promptParts.join(' ');
      if (!providerName || !prompt) {
        process.stderr.write('usage: flick raw <provider> <prompt>\n');
        return 1;
      }
      const provider = providerFor(providerName);
      const req = {
        prompt,
        cwd,
        model: values.model as string | undefined,
        effort: values.effort as 'low' | 'medium' | 'high' | undefined,
      };
      const stream = values.resume
        ? provider.resume(String(values.resume), req)
        : provider.run(req);
      return renderRaw(stream, Boolean(values.json));
    }

    case 'agents': {
      const orchestrator = new Orchestrator({ cwd });
      await orchestrator.init();
      const agents = orchestrator.listAgents();
      if (agents.length === 0) {
        process.stdout.write('no agents defined — add markdown files to .flick/agents/\n');
        return 0;
      }
      for (const a of agents) {
        const target = `${a.provider}${a.model ? `/${a.model}` : ''}`;
        process.stdout.write(
          `${a.name.padEnd(12)} ${target.padEnd(28)} ${a.writes ? 'rw' : 'ro'}  ${a.description}\n`,
        );
      }
      return 0;
    }

    case 'init': {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      const rulesPath = join(cwd, 'FLICK.md');

      if (existsSync(rulesPath)) {
        process.stderr.write(`${rulesPath} already exists\n`);
        return 1;
      }
      await mkdir(join(cwd, '.flick', 'agents'), { recursive: true });
      await writeFile(
        rulesPath,
        `# Project rules\n\nConventions every agent must follow in this repository, whichever provider\nis leading. flick also reads AGENTS.md, CLAUDE.md and GEMINI.md, so an existing\nrepo works unchanged.\n\n## Conventions\n\n- \n\n## Commands\n\n- Build: \n- Test: \n`,
        'utf8',
      );
      process.stdout.write(`created ${rulesPath}\n`);
      process.stdout.write(`created ${join(cwd, '.flick', 'agents')}\n`);
      return 0;
    }

    case 'skills': {
      const { skillsCommand } = await import('./skills-cmd.js');
      return skillsCommand(rest, cwd, { dryRun: Boolean(values['dry-run']) });
    }

    case 'models': {
      // No argument lists both plans together, because choosing a model and choosing a
      // plan are the same decision here.
      if (rest[0]) {
        for (const model of await providerFor(rest[0]).models()) {
          process.stdout.write(`${model}\n`);
        }
        return 0;
      }
      for (const choice of await listModels()) {
        process.stdout.write(
          `${choice.id.padEnd(28)} ${dim(choice.provider.padEnd(7))} ${dim(choice.tier.padEnd(9))} ${dim(choice.hint)}\n`,
        );
      }
      return 0;
    }

    case 'sessions': {
      const latest = await SessionLog.latest(cwd);
      process.stdout.write(latest ? `latest: ${latest}\n` : 'no sessions in this workspace\n');
      return 0;
    }

    case 'hook-gate': {
      // Invoked by agy for every tool call. Anything written to stdout other than the
      // decision would corrupt the contract, so nothing else may print here.
      const { hookGateCommand } = await import('./hook-gate.js');
      return hookGateCommand(cwd);
    }

    case 'mcp': {
      // Nothing may be written to stdout here except MCP frames.
      const { startMcpBridge } = await import('@flick/mcp');
      await startMcpBridge({ cwd });
      // The transport owns the process from here; resolve only when stdin closes.
      await new Promise<void>((resolve) => process.stdin.on('end', resolve));
      return 0;
    }

    case 'bridge': {
      if (rest[0] !== 'install') {
        process.stderr.write('usage: flick bridge install\n');
        return 1;
      }
      const { installBridge, installHook } = await import('./bridge-install.js');
      const bridge = await installBridge(cwd);
      process.stdout.write(`${bridge.action} ${bridge.path}\n`);

      const hook = await installHook();
      process.stdout.write(`${hook.action} ${hook.path}\n`);

      process.stdout.write(
        "agy can now call Shadow's delegate tool, and its own tool calls go through\n" +
          "Shadow's permission gate. The hook stays inert in agy sessions Shadow did\n" +
          'not start.\n',
      );
      return 0;
    }

    case 'auth': {
      // flick stores no credentials of its own — it reuses what each CLI already has,
      // so "auth" is really a report on those two, plus how to fix each one.
      const results = await Promise.all(
        (['agy', 'claude'] as const).map(async (name) => ({
          name,
          health: await providerFor(name).health(),
        })),
      );
      let allOk = true;
      for (const { name, health } of results) {
        allOk &&= health.ok;
        process.stdout.write(`${health.ok ? 'ok  ' : 'FAIL'} ${name}: ${health.detail}\n`);
        if (!health.ok) {
          process.stdout.write(
            name === 'agy'
              ? '     fix: run `agy` once and sign in to your Google account\n'
              : '     fix: run `claude` once and sign in, or set ANTHROPIC_API_KEY\n',
          );
        }
      }
      return allOk ? 0 : 1;
    }

    case 'doctor': {
      let allOk = true;
      for (const name of ['agy', 'claude']) {
        const health = await providerFor(name).health();
        allOk &&= health.ok;
        process.stdout.write(`${health.ok ? 'ok  ' : 'FAIL'} ${name}: ${health.detail}\n`);
      }
      return allOk ? 0 : 1;
    }

    default:
      process.stderr.write(`unknown command '${command}'\n\n${USAGE}`);
      return 1;
  }
}

/** Ask the user on the terminal. Only wired when stdin is a TTY. */
async function askOnTerminal(tool: string, detail: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`\n  allow ${tool}?  ${detail}\n  [y/N] `);
    return answer.trim().toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
}

/** Resolve the session to use from --resume / --continue, creating one if neither applies. */
async function resolveSession(
  cwd: string,
  values: Record<string, unknown>,
): Promise<{ session: SessionLog; resuming: boolean }> {
  let session: SessionLog | null = null;
  if (values.resume) session = SessionLog.open(cwd, String(values.resume));
  else if (values.continue) {
    const latest = await SessionLog.latest(cwd);
    if (latest) session = SessionLog.open(cwd, latest);
  }
  const resuming = session !== null;
  return { session: session ?? SessionLog.create(cwd), resuming };
}

async function runInteractive(cwd: string, values: Record<string, unknown>): Promise<number> {
  const { startTui } = await import('@flick/tui');
  const { session, resuming } = await resolveSession(cwd, values);
  await startTui({
    cwd,
    provider: ((values.provider as string) ?? 'claude') as ProviderId,
    model: values.model as string | undefined,
    session,
    resume: resuming,
    version: VERSION,
  });
  return 0;
}

async function runOneShot(
  prompt: string,
  cwd: string,
  values: Record<string, unknown>,
): Promise<number> {
  const provider = ((values.provider as string) ?? 'claude') as ProviderId;
  const tally = new UsageTally();
  const skipPermissions = Boolean(values.yes);

  // With a terminal we can ask; without one the gate denies mutating tools, which is
  // why `-y` exists for scripted runs.
  const hooks = await loadHooks(cwd, !values['no-hooks']);
  const preToolUse = async (tool: string, input: unknown): Promise<string | null> => {
    const outcomes = await runHooks(hooks, 'PreToolUse', cwd, { toolName: tool, toolInput: input });
    const blocking = outcomes.find((o) => o.blocked);
    return blocking ? blocking.output || blocking.command : null;
  };

  // Hooks still run under `-y`: they are the project's own guardrails, and skipping
  // permission prompts is not the same as consenting to skip a repo's checks.
  const gate = skipPermissions
    ? hooks.PreToolUse?.length
      ? createGate({ config: { allow: [], deny: [], autoApprove: true }, prompt: async () => true, preToolUse })
      : undefined
    : createGate({
        config: await loadPermissionConfig(cwd),
        prompt: process.stdin.isTTY ? askOnTerminal : undefined,
        preToolUse,
      });

  const orchestrator = new Orchestrator({
    cwd,
    approve: gate,
    onEvent: (ev) => renderOrchestratorEvent(ev, tally),
  });
  await orchestrator.init();

  const { session, resuming } = await resolveSession(cwd, values);

  const stream = runLead(prompt, {
    cwd,
    provider,
    model: values.model as string | undefined,
    session,
    orchestrator,
    resume: resuming,
    approve: gate,
    skipPermissions: skipPermissions && !gate,
    plan: Boolean(values.plan),
    pluginPaths: [flickPluginDir()],
  });

  const code = await renderLead(stream, { json: Boolean(values.json), tally, provider });
  if (!values.json) process.stderr.write(`\x1b[2msession ${session.id}\x1b[0m\n`);
  return code;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: Error) => {
    process.stderr.write(`flick: ${err.message}\n`);
    process.exitCode = 1;
  });
