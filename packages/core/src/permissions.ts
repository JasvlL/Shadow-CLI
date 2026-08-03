/**
 * The permission gate.
 *
 * shadow turns off each backend's own prompting, because a subagent has no terminal and
 * a backend that asks for confirmation simply stalls. That makes this file the only
 * thing standing between a model's intent and the filesystem, so it is written to fail
 * closed: anything not positively allowed goes to the user, and if there is no user to
 * ask, it is denied.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findDestructivePattern } from '@shadow/tools';

export type Decision = 'allow' | 'deny' | 'ask';

export interface PermissionConfig {
  /** Tool names auto-approved without asking, e.g. ["read_file", "glob"]. */
  allow: string[];
  /** Tool names always refused. Checked before `allow`. */
  deny: string[];
  /** Approve every mutating tool without asking. Only honoured with an attached TTY. */
  autoApprove?: boolean;
}

export const DEFAULT_CONFIG: PermissionConfig = {
  // Read-only tools cannot damage anything, so asking about them is pure friction.
  // Three naming schemes reach this same gate: Shadow's own tools (snake_case), the
  // Claude SDK's built-ins (PascalCase), and agy's (its own snake_case), which arrive
  // through the PreToolUse hook. Omitting agy's names would block every file read a
  // Gemini lead attempts.
  allow: [
    // Shadow
    'read_file',
    'glob',
    'grep',
    'mcp__shadow__delegate',
    // Claude SDK
    'Read',
    'Glob',
    'Grep',
    'NotebookRead',
    'TodoWrite',
    'ToolSearch',
    'WebFetch',
    'WebSearch',
    // agy
    'view_file',
    'list_dir',
    'grep_search',
    'find_by_name',
    'read_resource',
    'list_resources',
    'list_permissions',
    'command_status',
    'search_web',
    'read_url_content',
    'ask_question',
    'ask_permission',
    'manage_task',
    'call_mcp_tool',
    'invoke_subagent',
    'wait',
    'wait_5_seconds',
    'finish',
  ],
  deny: [],
};

export async function loadPermissionConfig(cwd: string): Promise<PermissionConfig> {
  const path = join(cwd, '.shadow', 'config.json');
  const text = await readFile(path, 'utf8').catch(() => null);
  if (text === null) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(text);
    const perms = parsed.permissions ?? {};
    return {
      allow: Array.isArray(perms.allow) ? perms.allow : DEFAULT_CONFIG.allow,
      deny: Array.isArray(perms.deny) ? perms.deny : [],
      autoApprove: Boolean(perms.autoApprove),
    };
  } catch {
    // A malformed config must not silently widen permissions.
    return DEFAULT_CONFIG;
  }
}

export interface GateOptions {
  config: PermissionConfig;
  /** Ask the user. Omit when nothing is attached — the gate then denies. */
  prompt?: (tool: string, detail: string) => Promise<boolean>;
  /** Called for every decision, so the session log records what was allowed and why. */
  onDecision?: (tool: string, decision: Decision, reason: string) => void;
  /**
   * PreToolUse hooks. Return a blocking reason to refuse the tool, or null to continue.
   * Runs after the deny list and destructive screen, before anything can be allowed —
   * so a hook can veto a tool the config would otherwise wave through.
   */
  preToolUse?: (tool: string, input: unknown) => Promise<string | null>;
}

function describe(tool: string, input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>;
  if (typeof record.command === 'string') return record.command;
  if (typeof record.path === 'string') return String(record.path);
  if (typeof record.agent === 'string') return `agent ${record.agent}`;
  return JSON.stringify(record).slice(0, 200);
}

/**
 * Build the `approve` callback the tools and orchestrator consume.
 *
 * Order matters: deny-list, then destructive screening, then allow-list, then the user.
 * The destructive screen sits above the allow-list on purpose — no config entry should
 * be able to pre-approve `rm -rf`.
 */
export function createGate(opts: GateOptions): (tool: string, input: unknown) => Promise<boolean> {
  const { config, prompt, onDecision, preToolUse } = opts;

  return async (tool, input) => {
    const detail = describe(tool, input);

    const settle = (decision: Decision, reason: string): boolean => {
      onDecision?.(tool, decision, reason);
      return decision === 'allow';
    };

    if (config.deny.includes(tool)) {
      return settle('deny', 'tool is on the deny list');
    }

    // Every shell-shaped argument name across the three tool vocabularies. Missing one
    // would let `rm -rf` through unscreened on that provider — agy names it
    // `CommandLine`, which this originally did not check.
    const record = (input ?? {}) as Record<string, unknown>;
    for (const key of ['command', 'CommandLine', 'cmd']) {
      const value = record[key];
      if (typeof value !== 'string') continue;
      const pattern = findDestructivePattern(value);
      if (pattern) {
        return settle('deny', `command matches destructive pattern ${pattern}`);
      }
    }

    if (preToolUse) {
      const blockedBy = await preToolUse(tool, input);
      if (blockedBy) return settle('deny', `blocked by PreToolUse hook: ${blockedBy}`);
    }

    if (config.allow.includes(tool)) {
      return settle('allow', 'tool is on the allow list');
    }

    if (config.autoApprove && prompt) {
      return settle('allow', 'auto-approve is enabled');
    }

    if (!prompt) {
      // No terminal to ask. Denying is the only safe answer — the alternative is
      // silently granting a subagent write access nobody approved.
      return settle('deny', 'no interactive prompt available');
    }

    const approved = await prompt(tool, detail);
    return settle(approved ? 'allow' : 'deny', approved ? 'user approved' : 'user denied');
  };
}
