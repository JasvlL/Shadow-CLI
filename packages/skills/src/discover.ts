/**
 * Skill discovery.
 *
 * Both backends already speak the same format — a `skills/<name>/SKILL.md` directory
 * with `name` and `description` frontmatter — so shadow does not need a skill format of
 * its own. What it needs is to know *where every skill root is*, so it can point both
 * backends at all of them. Nothing is copied.
 *
 * Verified layouts on Windows:
 *   ~/.shadow/skills/<name>/SKILL.md                              (shadow's own)
 *   ~/.claude/skills/<name>/SKILL.md                             (Claude user-level)
 *   ~/.claude/plugins/cache/<mp>/<plugin>/<ver>/skills/<name>/   (Claude plugins)
 *   <cwd>/.shadow/skills, <cwd>/.claude/skills, <cwd>/.agents/skills  (project)
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter } from '@shadow/core';

export type SkillOrigin = 'shadow' | 'claude-user' | 'claude-plugin' | 'project';

export interface SkillRoot {
  /** Directory containing one subdirectory per skill. */
  path: string;
  origin: SkillOrigin;
  /** Plugin name, when the root came from a Claude plugin. */
  plugin?: string;
}

export interface SkillDef {
  name: string;
  description: string;
  /** Directory holding SKILL.md. */
  dir: string;
  origin: SkillOrigin;
  plugin?: string;
  /** Body of SKILL.md, without frontmatter. */
  body: string;
}

function shadowHome(): string {
  return process.env.SHADOW_HOME ?? homedir();
}

async function isDir(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return Boolean(info?.isDirectory());
}

/**
 * Claude caches plugins at an unstable depth
 * (`cache/<marketplace>/<plugin>/<version>/skills`), so walk a bounded number of levels
 * looking for a `skills` directory rather than hardcoding the shape.
 */
async function findPluginSkillRoots(cacheDir: string, maxDepth = 4): Promise<SkillRoot[]> {
  const roots: SkillRoot[] = [];

  async function walk(dir: string, depth: number, plugin: string | undefined): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = join(dir, entry.name);
      if (entry.name === 'skills') {
        roots.push({ path: child, origin: 'claude-plugin', plugin });
        continue; // do not descend into a skills dir
      }
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      // The first level under cache/ is the marketplace; the second is the plugin name.
      await walk(child, depth + 1, depth === 1 ? entry.name : plugin);
    }
  }

  if (await isDir(cacheDir)) await walk(cacheDir, 0, undefined);
  return roots;
}

/** Every directory on this machine that holds skills, deduplicated. */
export async function discoverSkillRoots(cwd: string): Promise<SkillRoot[]> {
  const home = shadowHome();

  const candidates: SkillRoot[] = [
    { path: join(home, '.shadow', 'skills'), origin: 'shadow' },
    { path: join(home, '.claude', 'skills'), origin: 'claude-user' },
    { path: join(cwd, '.shadow', 'skills'), origin: 'project' },
    { path: join(cwd, '.claude', 'skills'), origin: 'project' },
    { path: join(cwd, '.agents', 'skills'), origin: 'project' },
  ];

  const found: SkillRoot[] = [];
  for (const candidate of candidates) {
    if (await isDir(candidate.path)) found.push(candidate);
  }

  found.push(...(await findPluginSkillRoots(join(home, '.claude', 'plugins', 'cache'))));

  const seen = new Set<string>();
  return found.filter((root) => {
    const key = root.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Read every SKILL.md under the given roots. Later roots win on name collisions. */
export async function loadSkills(roots: SkillRoot[]): Promise<SkillDef[]> {
  const byName = new Map<string, SkillDef>();

  for (const root of roots) {
    const entries = await readdir(root.path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(root.path, entry.name);
      const text = await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => null);
      if (text === null) continue;

      const { fields, body } = parseFrontmatter(text);
      // Directory name is the fallback identity, matching what both CLIs do.
      const name = fields.name || entry.name;
      byName.set(name, {
        name,
        description: fields.description ?? '',
        dir,
        origin: root.origin,
        plugin: root.plugin,
        body,
      });
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
