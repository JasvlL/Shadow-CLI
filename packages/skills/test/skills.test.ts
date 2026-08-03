import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverSkillRoots, loadSkills } from '../src/discover.js';
import { lintSkillBody, syncToAgy, agySkillsConfigPath } from '../src/sync.js';

let home: string;
const savedHome = process.env.FLICK_HOME;

function writeSkill(root: string, name: string, frontmatter: string, body = 'Do the thing.') {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}\n`);
  return dir;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'flick-skills-home-'));
  process.env.FLICK_HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.FLICK_HOME;
  else process.env.FLICK_HOME = savedHome;
});

describe('discovery', () => {
  it('finds flick, Claude user, and project roots', async () => {
    mkdirSync(join(home, '.flick', 'skills'), { recursive: true });
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    const cwd = mkdtempSync(join(tmpdir(), 'flick-skills-cwd-'));
    mkdirSync(join(cwd, '.agents', 'skills'), { recursive: true });

    const roots = await discoverSkillRoots(cwd);
    const origins = roots.map((r) => r.origin);
    expect(origins).toContain('flick');
    expect(origins).toContain('claude-user');
    expect(origins).toContain('project');
  });

  it('finds skills nested inside Claude plugin caches at unknown depth', async () => {
    const pluginSkills = join(
      home,
      '.claude',
      'plugins',
      'cache',
      'marketplace',
      'my-plugin',
      '1.2.3',
      'skills',
    );
    mkdirSync(pluginSkills, { recursive: true });

    const roots = await discoverSkillRoots(home);
    const plugin = roots.find((r) => r.origin === 'claude-plugin');
    expect(plugin).toBeDefined();
    expect(plugin!.plugin).toBe('my-plugin');
  });

  it('returns nothing rather than failing when no roots exist', async () => {
    expect(await discoverSkillRoots(mkdtempSync(join(tmpdir(), 'empty-')))).toEqual([]);
  });
});

describe('loading', () => {
  it('reads name and description, and falls back to the directory name', async () => {
    const root = join(home, '.flick', 'skills');
    writeSkill(root, 'named', 'name: explicit\ndescription: A described skill.');
    writeSkill(root, 'unnamed', 'description: No name field.');

    const skills = await loadSkills(await discoverSkillRoots(home));
    expect(skills.map((s) => s.name).sort()).toEqual(['explicit', 'unnamed']);
    expect(skills.find((s) => s.name === 'explicit')!.description).toBe('A described skill.');
  });

  it('reads a folded block description, which is what real SKILL.md files use', async () => {
    const root = join(home, '.flick', 'skills');
    writeSkill(
      root,
      'folded',
      'name: folded\ndescription: >-\n  Use this when the user asks for something\n  that spans two lines.',
    );

    const skills = await loadSkills(await discoverSkillRoots(home));
    expect(skills[0]!.description).toBe(
      'Use this when the user asks for something that spans two lines.',
    );
  });

  it('skips directories without a SKILL.md', async () => {
    const root = join(home, '.flick', 'skills');
    mkdirSync(join(root, 'not-a-skill'), { recursive: true });
    writeSkill(root, 'real', 'name: real\ndescription: d');

    const skills = await loadSkills(await discoverSkillRoots(home));
    expect(skills.map((s) => s.name)).toEqual(['real']);
  });
});

describe('sync to agy', () => {
  it('creates the config with every non-project root', async () => {
    mkdirSync(join(home, '.flick', 'skills'), { recursive: true });
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    mkdirSync(join(home, '.gemini', 'config'), { recursive: true });

    const roots = await discoverSkillRoots(home);
    const result = await syncToAgy(roots);

    expect(result.action).toBe('created');
    const written = JSON.parse(readFileSync(agySkillsConfigPath(), 'utf8'));
    expect(written.entries).toHaveLength(result.added.length);
  });

  it('preserves entries the user added by hand', async () => {
    const configDir = join(home, '.gemini', 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'skills.json'),
      JSON.stringify({ entries: [{ path: '/my/own/skills' }], somethingElse: true }),
    );
    mkdirSync(join(home, '.flick', 'skills'), { recursive: true });

    await syncToAgy(await discoverSkillRoots(home));

    const written = JSON.parse(readFileSync(agySkillsConfigPath(), 'utf8'));
    expect(written.entries.map((e: { path: string }) => e.path)).toContain('/my/own/skills');
    expect(written.somethingElse).toBe(true);
  });

  it('is idempotent — a second sync changes nothing', async () => {
    mkdirSync(join(home, '.flick', 'skills'), { recursive: true });
    const roots = await discoverSkillRoots(home);

    await syncToAgy(roots);
    const second = await syncToAgy(roots);
    expect(second.action).toBe('unchanged');
    expect(second.added).toEqual([]);
  });

  it('writes nothing when asked for a dry run', async () => {
    mkdirSync(join(home, '.flick', 'skills'), { recursive: true });
    const result = await syncToAgy(await discoverSkillRoots(home), true);

    expect(result.added.length).toBeGreaterThan(0);
    expect(() => readFileSync(agySkillsConfigPath(), 'utf8')).toThrow();
  });

  it('refuses to clobber a corrupt config', async () => {
    const configDir = join(home, '.gemini', 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'skills.json'), '{ not json');
    mkdirSync(join(home, '.flick', 'skills'), { recursive: true });

    await expect(syncToAgy(await discoverSkillRoots(home))).rejects.toThrow(/not valid JSON/);
  });
});

describe('portability lint', () => {
  it('flags a skill that only names Claude tools', () => {
    const findings = lintSkillBody('x', 'Use the Read tool then Edit the file.');
    expect(findings[0]!.issue).toMatch(/Claude-only/);
  });

  it('flags a skill that only names agy tools', () => {
    const findings = lintSkillBody('x', 'Call view_file and then run_command.');
    expect(findings[0]!.issue).toMatch(/agy-only/);
  });

  it('stays quiet for a portable skill, or one that covers both', () => {
    expect(lintSkillBody('x', 'Summarize the findings in a table.')).toEqual([]);
    expect(lintSkillBody('x', 'Use Read (or view_file on agy).')).toEqual([]);
  });
});
