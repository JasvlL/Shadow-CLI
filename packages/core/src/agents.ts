/**
 * Agent registry.
 *
 * An agent is a markdown file with YAML-ish frontmatter, deliberately mirroring the
 * `.claude/agents/` convention so the mental model carries over. The one field that
 * matters for flick specifically is `provider`, which decides whether the agent runs
 * on the Anthropic subscription or the Google one.
 */

import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderId } from '@flick/providers';

export interface AgentDef {
  name: string;
  /** Shown to the orchestrator so it can decide what to delegate here. */
  description: string;
  provider: ProviderId;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  /** Tool names this agent may use. Omit for the provider default. */
  tools?: string[];
  /** True when the agent may modify files, which forces worktree isolation. */
  writes: boolean;
  /** Markdown body — becomes the agent's system prompt. */
  systemPrompt: string;
  source: string;
}

interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

/**
 * Minimal frontmatter reader.
 *
 * Handles `key: value`, `key: [a, b]`, and YAML block scalars (`>`, `>-`, `|`, `|-`).
 * Block scalars matter: real SKILL.md files in the wild write their `description` as a
 * folded block, and reading only the first line would capture the `>-` marker instead
 * of the text the model uses to decide whether to load the skill.
 *
 * Still not a YAML parser — nested maps and anchors are out of scope, and neither
 * agent nor skill frontmatter uses them.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { fields: {}, body: text.trim() };

  const fields: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[i]!);
    if (!kv) continue;

    const key = kv[1]!;
    const raw = kv[2]!.trim();

    const blockScalar = /^([|>])([-+]?)$/.exec(raw);
    if (blockScalar) {
      // Consume the indented lines that follow, until dedent or end of frontmatter.
      const collected: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        if (next.trim() !== '' && !/^\s/.test(next)) break;
        collected.push(next.trim());
        i++;
      }
      while (collected.at(-1) === '') collected.pop();
      // `>` folds newlines into spaces; `|` keeps them.
      fields[key] = blockScalar[1] === '>' ? collected.join(' ').trim() : collected.join('\n');
      continue;
    }

    fields[key] = raw.replace(/^["']|["']$/g, '');
  }

  return { fields, body: (match[2] ?? '').trim() };
}

function toList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

export function parseAgent(text: string, source: string): AgentDef | null {
  const { fields, body } = parseFrontmatter(text);
  if (!fields.name) return null;

  const provider = fields.provider === 'agy' ? 'agy' : 'claude';
  return {
    name: fields.name,
    description: fields.description ?? '',
    provider,
    model: fields.model,
    effort: (['low', 'medium', 'high'] as const).find((e) => e === fields.effort),
    tools: toList(fields.tools),
    writes: fields.writes === 'true',
    systemPrompt: body,
    source,
  };
}

/**
 * Directories searched for agents, nearest-wins: user-level first, then the project,
 * so a project agent shadows a user agent of the same name.
 *
 * `FLICK_HOME` overrides the user-level location. Tests set it to keep the developer's
 * real agents out of the results.
 */
export function agentDirs(cwd: string): string[] {
  const home = process.env.FLICK_HOME ?? homedir();
  return [join(home, '.flick', 'agents'), join(cwd, '.flick', 'agents')];
}

export async function loadAgents(cwd: string): Promise<Map<string, AgentDef>> {
  const agents = new Map<string, AgentDef>();
  for (const dir of agentDirs(cwd)) {
    const entries = await readdir(dir).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const path = join(dir, entry);
      const text = await readFile(path, 'utf8').catch(() => null);
      if (text === null) continue;
      const agent = parseAgent(text, path);
      // Project agents intentionally shadow user-level ones with the same name.
      if (agent) agents.set(agent.name, agent);
    }
  }
  return agents;
}
