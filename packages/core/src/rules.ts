/**
 * Project rules.
 *
 * Both CLIs read rule files, but not the same ones: Claude looks for `CLAUDE.md`, agy
 * for `AGENTS.md` / `GEMINI.md`. Left alone, the same prompt would obey different rules
 * depending on which backend happened to lead — which defeats the point of running them
 * under one orchestrator.
 *
 * So shadow resolves the files itself and injects the result into both system prompts.
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';

/** Checked in order within each directory; the first that exists wins for that level. */
export const RULE_FILENAMES = ['SHADOW.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] as const;

export interface RuleFile {
  path: string;
  content: string;
}

async function readIfFile(path: string): Promise<string | null> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  return readFile(path, 'utf8').catch(() => null);
}

/** True once we reach a repository root, so the walk does not escape the project. */
async function isRepoRoot(dir: string): Promise<boolean> {
  for (const marker of ['.git', '.hg', '.shadow']) {
    if (await stat(join(dir, marker)).catch(() => null)) return true;
  }
  return false;
}

/**
 * Walk from `cwd` up to the repo root (or filesystem root) collecting rule files.
 *
 * Returned outermost-first, so a rule closer to the working directory appears later and
 * therefore takes precedence when the model reads them in order.
 */
export async function findRuleFiles(cwd: string, maxLevels = 12): Promise<RuleFile[]> {
  const found: RuleFile[] = [];
  const root = parse(cwd).root;

  let dir = cwd;
  for (let level = 0; level < maxLevels; level++) {
    for (const filename of RULE_FILENAMES) {
      const path = join(dir, filename);
      const content = await readIfFile(path);
      if (content !== null && content.trim()) {
        found.push({ path, content: content.trim() });
        break; // one rule file per directory
      }
    }

    if (await isRepoRoot(dir)) break;
    const parent = dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }

  return found.reverse();
}

const MAX_RULES_CHARS = 32_000;

/**
 * Render the rule files as one block for a system prompt.
 * Returns an empty string when there is nothing to say.
 */
export function formatRules(files: RuleFile[]): string {
  if (files.length === 0) return '';

  const sections = files.map((file) => `<rules from="${file.path}">\n${file.content}\n</rules>`);
  const joined = sections.join('\n\n');

  if (joined.length <= MAX_RULES_CHARS) return joined;

  // Rules closest to the working directory are the most specific, so when the budget
  // runs out drop the outermost ones rather than truncating mid-sentence.
  const kept: string[] = [];
  let used = 0;
  for (const section of [...sections].reverse()) {
    if (used + section.length > MAX_RULES_CHARS) break;
    kept.unshift(section);
    used += section.length;
  }
  return kept.join('\n\n');
}

/** Convenience: resolve and format in one call. */
export async function loadRules(cwd: string): Promise<string> {
  return formatRules(await findRuleFiles(cwd));
}
