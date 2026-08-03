/**
 * `flick skills` — list, sync, scaffold and lint skills across both providers.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  discoverSkillRoots,
  flickPluginDir,
  lintSkillBody,
  loadSkills,
  syncToAgy,
  writeClaudePluginManifest,
} from '@flick/skills';
import { bold, dim, green, red, truncate, yellow } from '@flick/render';

const ORIGIN_LABEL: Record<string, string> = {
  flick: 'flick',
  'claude-user': 'claude',
  'claude-plugin': 'plugin',
  project: 'project',
};

export interface SkillsCommandFlags {
  /** Report what sync would change without writing anything. */
  dryRun?: boolean;
}

export async function skillsCommand(
  args: string[],
  cwd: string,
  flags: SkillsCommandFlags = {},
): Promise<number> {
  const [subcommand, ...rest] = args;

  switch (subcommand ?? 'list') {
    case 'list':
      return listSkills(cwd);
    case 'sync':
      // The flag arrives parsed, not as a positional — parseArgs strips options out of
      // `positionals`, so scanning `rest` for it would silently never match.
      return syncSkills(cwd, Boolean(flags.dryRun));
    case 'new':
      return newSkill(rest[0], cwd);
    case 'lint':
      return lintSkills(cwd);
    default:
      process.stderr.write('usage: flick skills [list|sync|new <name>|lint]\n');
      return 1;
  }
}

async function listSkills(cwd: string): Promise<number> {
  const roots = await discoverSkillRoots(cwd);
  const skills = await loadSkills(roots);

  if (skills.length === 0) {
    process.stdout.write('no skills found — create one with `flick skills new <name>`\n');
    return 0;
  }

  for (const skill of skills) {
    const origin = ORIGIN_LABEL[skill.origin] ?? skill.origin;
    const tag = skill.plugin ? `${origin}:${skill.plugin}` : origin;
    process.stdout.write(
      `${bold(skill.name.padEnd(22))} ${dim(tag.padEnd(18))} ${truncate(skill.description.replace(/\s+/g, ' '), 70)}\n`,
    );
  }
  process.stdout.write(
    dim(`\n${skills.length} skills from ${roots.length} roots. \`flick skills sync\` shares them with agy.\n`),
  );
  return 0;
}

async function syncSkills(cwd: string, dryRun: boolean): Promise<number> {
  const roots = await discoverSkillRoots(cwd);
  const result = await syncToAgy(roots, dryRun);

  if (result.action === 'unchanged') {
    process.stdout.write(`already in sync (${result.kept.length} roots registered)\n`);
  } else {
    process.stdout.write(`${dryRun ? 'would write' : result.action} ${result.path}\n`);
    for (const path of result.added) process.stdout.write(`  ${green('+')} ${path}\n`);
    for (const path of result.kept) process.stdout.write(`  ${dim('=')} ${dim(path)}\n`);
  }

  if (!dryRun) {
    const manifest = await writeClaudePluginManifest();
    process.stdout.write(dim(`claude plugin manifest at ${manifest}\n`));
  }
  return 0;
}

async function newSkill(name: string | undefined, cwd: string): Promise<number> {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    process.stderr.write('usage: flick skills new <lowercase-hyphenated-name>\n');
    return 1;
  }

  const dir = join(process.env.FLICK_HOME ?? homedir(), '.flick', 'skills', name);
  const file = join(dir, 'SKILL.md');
  if (existsSync(file)) {
    process.stderr.write(`${file} already exists\n`);
    return 1;
  }

  // Frontmatter written in the folded form both CLIs use, so the description can grow
  // past one line without breaking discovery.
  const template = `---
name: ${name}
description: >-
  Describe when the agent should use this skill, in third person. State what it does and
  when to reach for it — this text is what the model reads to decide.
---

# ${name}

Step-by-step instructions for the agent.

## Steps

1. First step.
2. Second step.

## Verification

How the agent can tell the work succeeded.
`;

  await mkdir(dir, { recursive: true });
  await writeFile(file, template, 'utf8');
  process.stdout.write(`created ${file}\n`);
  process.stdout.write(dim('run `flick skills sync` to share it with agy\n'));
  void cwd;
  return 0;
}

async function lintSkills(cwd: string): Promise<number> {
  const skills = await loadSkills(await discoverSkillRoots(cwd));
  let issues = 0;

  for (const skill of skills) {
    if (!skill.description.trim()) {
      issues++;
      process.stdout.write(`${yellow('warn')} ${skill.name}: no description — the model cannot tell when to use it\n`);
    }
    for (const finding of lintSkillBody(skill.name, skill.body)) {
      issues++;
      process.stdout.write(`${yellow('warn')} ${finding.skill}: ${finding.issue}\n`);
    }
  }

  if (issues === 0) {
    process.stdout.write(`${green('ok')} ${skills.length} skills, no portability issues\n`);
    return 0;
  }
  process.stdout.write(dim(`\n${issues} issue(s). These are warnings — a skill can still be useful on one provider.\n`));
  void red;
  return 0;
}
