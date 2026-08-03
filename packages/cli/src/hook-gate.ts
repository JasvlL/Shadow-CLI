/**
 * `shadow hook-gate` — Shadow's permission policy, enforced on agy's own tools.
 *
 * agy runs its own agent loop in its own process, so `createGate` never sees its tool
 * calls. Its PreToolUse hook is the one place that can: it receives the call on stdin
 * and a `deny` here is a hard block, not advice.
 *
 * Contract (agy customization docs):
 *   stdin  {"toolCall":{"name":"run_command","args":{...}}, "stepIdx":n}
 *   stdout {"decision":"allow"|"deny"|"ask"|"force_ask", "reason"?:string}
 *
 * `ask` is never returned. agy would try to prompt, and a Shadow-spawned agy has no
 * terminal — that stall is the exact bug this file exists alongside. When the IDE is
 * running we ask *it* over loopback and answer allow/deny with the result.
 */

import { createGate, loadPermissionConfig } from '@flick/core';

/** Set by Shadow when it spawns agy. Absent means the user ran agy on their own. */
export const SHADOW_SESSION_ENV = 'SHADOW_SESSION';
export const APPROVAL_PORT_ENV = 'SHADOW_APPROVAL_PORT';
export const APPROVAL_TOKEN_ENV = 'SHADOW_APPROVAL_TOKEN';

interface HookInput {
  toolCall?: { name?: string; args?: Record<string, unknown> };
}

type Decision = { decision: 'allow' | 'deny'; reason?: string };

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    // A hook that never receives input must not hang agy's loop.
    setTimeout(() => resolve(data), 5000).unref();
  });
}

/** Ask the running IDE. Returns null when there is none, or it could not be reached. */
async function askIde(tool: string, detail: string): Promise<boolean | null> {
  const port = process.env[APPROVAL_PORT_ENV];
  const token = process.env[APPROVAL_TOKEN_ENV];
  if (!port || !token) return null;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shadow-token': token },
      body: JSON.stringify({ tool, detail }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { approved?: unknown };
    return typeof body.approved === 'boolean' ? body.approved : null;
  } catch {
    // IDE gone or busy: fall through to the non-interactive policy rather than
    // blocking agy indefinitely.
    return null;
  }
}

/** Where Shadow is working. agy runs hooks from its own config directory, not here. */
export const SHADOW_CWD_ENV = 'SHADOW_CWD';

export async function hookGateCommand(fallbackCwd: string): Promise<number> {
  // agy sets the hook's working directory to wherever hooks.json lives, so
  // process.cwd() points at agy's config, not the project. Reading permissions from
  // there would silently apply the wrong policy.
  const cwd = process.env[SHADOW_CWD_ENV] ?? fallbackCwd;
  const emit = (decision: Decision): number => {
    process.stdout.write(JSON.stringify(decision));
    return 0;
  };

  // Not our session — do not interfere with the user's own agy usage.
  if (!process.env[SHADOW_SESSION_ENV]) return emit({ decision: 'allow' });

  const raw = await readStdin();
  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    // Unparseable input means we cannot reason about the call. Allowing an unknown
    // tool is worse than letting agy proceed under its own rules, but blocking every
    // call on a format change would brick the integration — so allow and stay quiet.
    return emit({ decision: 'allow' });
  }

  const tool = input.toolCall?.name;
  const args = input.toolCall?.args ?? {};
  if (!tool) return emit({ decision: 'allow' });

  let decided: Decision | null = null;

  const gate = createGate({
    config: await loadPermissionConfig(cwd),
    // The gate calls this only when the answer is not already determined by policy.
    prompt: async (name, detail) => {
      const answer = await askIde(name, detail);
      if (answer !== null) return answer;
      // No IDE to ask. Denying is the only safe answer, and the reason travels back to
      // the model so it can say why rather than silently retrying.
      decided = {
        decision: 'deny',
        reason: `${name} needs approval and no Shadow session is attached to ask`,
      };
      return false;
    },
    onDecision: (name, decision, reason) => {
      if (decision === 'deny' && !decided) {
        decided = { decision: 'deny', reason: `blocked by Shadow: ${reason}` };
      }
    },
  });

  const allowed = await gate(tool, args);
  if (allowed) return emit({ decision: 'allow' });
  return emit(decided ?? { decision: 'deny', reason: 'blocked by Shadow' });
}
