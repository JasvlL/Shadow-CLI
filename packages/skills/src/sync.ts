/**
 * Wiring every discovered skill root into both backends, natively.
 *
 * The point of this file: a skill you wrote for Claude becomes usable by a Gemini lead,
 * and vice versa, **without copying files**. Each CLI keeps loading skills its own way,
 * with its own progressive disclosure; flick only tells each one where to look.
 *
 * - agy reads `~/.gemini/config/skills.json` → `{"entries":[{"path":"..."}]}`.
 * - Claude discovers `~/.claude/skills` and its plugins on its own; flick's own skills
 *   reach it as a generated local plugin passed via the SDK's `plugins` option.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SkillRoot } from './discover.js';

function flickHome(): string {
  return process.env.FLICK_HOME ?? homedir();
}

export function agySkillsConfigPath(): string {
  const dir = process.env.AGY_CONFIG_DIR ?? join(flickHome(), '.gemini', 'config');
  return join(dir, 'skills.json');
}

/** Directory of the generated plugin that exposes flick's own skills to Claude. */
export function flickPluginDir(): string {
  return join(flickHome(), '.flick');
}

export interface SyncResult {
  path: string;
  action: 'created' | 'updated' | 'unchanged';
  added: string[];
  kept: string[];
}

/**
 * Point agy at every root flick knows about.
 *
 * Merges: entries the user added by hand are preserved, and roots already present are
 * not duplicated. Never rewrites the file when nothing would change.
 */
export async function syncToAgy(roots: SkillRoot[], dryRun = false): Promise<SyncResult> {
  const path = agySkillsConfigPath();
  const existing = await readFile(path, 'utf8').catch(() => null);

  let config: { entries?: Array<{ path: string }>; [k: string]: unknown } = {};
  if (existing !== null && existing.trim() !== '') {
    try {
      config = JSON.parse(existing);
    } catch {
      throw new Error(
        `${path} exists but is not valid JSON. Fix or remove it before syncing skills.`,
      );
    }
  }

  const entries = Array.isArray(config.entries) ? config.entries : [];
  const known = new Set(entries.map((e) => String(e.path).toLowerCase()));

  const added: string[] = [];
  for (const root of roots) {
    // agy discovers agy's own roots already; adding them would be noise.
    if (root.origin === 'project') continue;
    if (known.has(root.path.toLowerCase())) continue;
    entries.push({ path: root.path });
    known.add(root.path.toLowerCase());
    added.push(root.path);
  }

  const kept = entries.filter((e) => !added.includes(e.path)).map((e) => e.path);

  if (added.length === 0) return { path, action: 'unchanged', added, kept };
  if (dryRun) return { path, action: existing === null ? 'created' : 'updated', added, kept };

  config.entries = entries;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  return { path, action: existing === null ? 'created' : 'updated', added, kept };
}

/**
 * Generate the manifest that makes `~/.flick` a loadable Claude plugin.
 *
 * Claude finds `~/.claude/skills` by itself, so this exists purely so that skills
 * written under `~/.flick/skills` — flick's own home — are visible to Claude too.
 */
export async function writeClaudePluginManifest(): Promise<string> {
  const dir = flickPluginDir();
  const manifestPath = join(dir, '.claude-plugin', 'plugin.json');
  const manifest = {
    name: 'flick',
    version: '0.1.0',
    description: "Skills shared across flick's model providers.",
  };

  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

/**
 * Skill bodies that name tools only one provider has.
 *
 * The file format is portable between the two CLIs; the *content* is not always. A
 * skill that tells the model to "use the Edit tool" is a dead end on agy, which calls
 * that `replace_file_content`. This does not rewrite anything — it reports, so the
 * author can decide.
 */
const CLAUDE_ONLY_TOOLS = /\b(Read|Edit|Write|Glob|Grep|Bash|WebFetch|NotebookEdit|TodoWrite)\b/;
const AGY_ONLY_TOOLS =
  /\b(view_file|replace_file_content|multi_replace_file_content|run_command|grep_search|find_by_name|write_to_file)\b/;

export interface LintFinding {
  skill: string;
  issue: string;
}

export function lintSkillBody(name: string, body: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const claudeOnly = CLAUDE_ONLY_TOOLS.test(body);
  const agyOnly = AGY_ONLY_TOOLS.test(body);

  if (claudeOnly && !agyOnly) {
    findings.push({
      skill: name,
      issue: 'names Claude-only tools (Read/Edit/Bash…); a Gemini lead has no such tools',
    });
  }
  if (agyOnly && !claudeOnly) {
    findings.push({
      skill: name,
      issue: 'names agy-only tools (view_file/run_command…); a Claude lead has no such tools',
    });
  }
  return findings;
}
