import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAgents, parseAgent, parseFrontmatter } from '../src/agents.js';

// Point the user-level agent directory at an empty temp dir, so these tests see only
// what they create and not whatever the developer has installed in their home.
const savedHome = process.env.SHADOW_HOME;
beforeAll(() => {
  process.env.SHADOW_HOME = mkdtempSync(join(tmpdir(), 'shadow-home-'));
});
afterAll(() => {
  if (savedHome === undefined) delete process.env.SHADOW_HOME;
  else process.env.SHADOW_HOME = savedHome;
});

describe('frontmatter', () => {
  it('splits fields from the body', () => {
    const { fields, body } = parseFrontmatter('---\nname: scout\nprovider: agy\n---\nDo the thing.');
    expect(fields).toEqual({ name: 'scout', provider: 'agy' });
    expect(body).toBe('Do the thing.');
  });

  it('treats a file without frontmatter as all body', () => {
    expect(parseFrontmatter('just prose')).toEqual({ fields: {}, body: 'just prose' });
  });
});

describe('parseAgent', () => {
  it('reads provider, model, effort, tools and writes', () => {
    const agent = parseAgent(
      '---\nname: r\ndescription: d\nprovider: agy\nmodel: gemini-3.1-pro-high\n' +
        'effort: high\ntools: [read_file, grep]\nwrites: true\n---\nBody here.',
      'x.md',
    );
    expect(agent).toMatchObject({
      name: 'r',
      description: 'd',
      provider: 'agy',
      model: 'gemini-3.1-pro-high',
      effort: 'high',
      tools: ['read_file', 'grep'],
      writes: true,
      systemPrompt: 'Body here.',
    });
  });

  it('defaults to the claude provider and to read-only', () => {
    const agent = parseAgent('---\nname: x\n---\nbody', 'x.md');
    expect(agent).toMatchObject({ provider: 'claude', writes: false });
  });

  it('rejects a file with no name', () => {
    expect(parseAgent('---\ndescription: d\n---\nbody', 'x.md')).toBeNull();
  });
});

describe('loadAgents', () => {
  it('picks up user-level agents as well as project ones', async () => {
    const home = process.env.SHADOW_HOME!;
    const userDir = join(home, '.shadow', 'agents');
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'u.md'), '---\nname: shared\nmodel: from-user\n---\nU');

    const cwd = mkdtempSync(join(tmpdir(), 'shadow-shadow-'));
    const projectDir = join(cwd, '.shadow', 'agents');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'p.md'), '---\nname: shared\nmodel: from-project\n---\nP');

    // Project agents shadow user agents of the same name.
    const agents = await loadAgents(cwd);
    expect(agents.get('shared')!.model).toBe('from-project');

    rmSync(userDir, { recursive: true, force: true });
  });

  it('loads every markdown agent in the workspace', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'shadow-agents-'));
    const dir = join(cwd, '.shadow', 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.md'), '---\nname: alpha\nprovider: agy\n---\nA');
    writeFileSync(join(dir, 'b.md'), '---\nname: beta\n---\nB');
    writeFileSync(join(dir, 'notes.txt'), 'ignored');

    const agents = await loadAgents(cwd);
    expect([...agents.keys()].sort()).toEqual(['alpha', 'beta']);
    expect(agents.get('alpha')!.provider).toBe('agy');
  });

  it('returns empty rather than failing when no agent directory exists', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'shadow-noagents-'));
    expect((await loadAgents(cwd)).size).toBe(0);
  });
});
