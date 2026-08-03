import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRuleFiles, formatRules, loadRules } from '../src/rules.js';

/** A temp tree with a `.git` marker, so the walk stops where a real repo would. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'shadow-rules-'));
  mkdirSync(join(root, '.git'), { recursive: true });
  return root;
}

describe('findRuleFiles', () => {
  it('finds a rule file at the repo root', async () => {
    const root = makeRepo();
    writeFileSync(join(root, 'SHADOW.md'), 'Always answer in Catalan.');

    const files = await findRuleFiles(root);
    expect(files).toHaveLength(1);
    expect(files[0]!.content).toBe('Always answer in Catalan.');
  });

  it('prefers SHADOW.md over the other names in the same directory', async () => {
    const root = makeRepo();
    writeFileSync(join(root, 'CLAUDE.md'), 'claude rules');
    writeFileSync(join(root, 'AGENTS.md'), 'agents rules');
    writeFileSync(join(root, 'SHADOW.md'), 'shadow rules');

    const files = await findRuleFiles(root);
    expect(files).toHaveLength(1);
    expect(files[0]!.content).toBe('shadow rules');
  });

  it('accepts the other CLIs’ filenames, so an existing repo works unchanged', async () => {
    const root = makeRepo();
    writeFileSync(join(root, 'AGENTS.md'), 'from agents');
    expect((await findRuleFiles(root))[0]!.content).toBe('from agents');
  });

  it('collects rules up the tree, outermost first', async () => {
    const root = makeRepo();
    const nested = join(root, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'SHADOW.md'), 'root rule');
    writeFileSync(join(nested, 'SHADOW.md'), 'nested rule');

    const files = await findRuleFiles(nested);
    expect(files.map((f) => f.content)).toEqual(['root rule', 'nested rule']);
  });

  it('stops at the repo root and does not escape into parent directories', async () => {
    const outer = mkdtempSync(join(tmpdir(), 'shadow-outer-'));
    writeFileSync(join(outer, 'SHADOW.md'), 'SHOULD NOT BE READ');
    const repo = join(outer, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, 'SHADOW.md'), 'repo rule');

    const files = await findRuleFiles(repo);
    expect(files.map((f) => f.content)).toEqual(['repo rule']);
  });

  it('ignores empty rule files', async () => {
    const root = makeRepo();
    writeFileSync(join(root, 'SHADOW.md'), '   \n\n');
    expect(await findRuleFiles(root)).toEqual([]);
  });

  it('returns nothing when there are no rule files', async () => {
    expect(await loadRules(makeRepo())).toBe('');
  });
});

describe('formatRules', () => {
  it('fences each file with its path so the model can attribute a rule', () => {
    const out = formatRules([{ path: '/repo/SHADOW.md', content: 'be terse' }]);
    expect(out).toContain('<rules from="/repo/SHADOW.md">');
    expect(out).toContain('be terse');
  });

  it('is empty for no files', () => {
    expect(formatRules([])).toBe('');
  });

  it('drops the outermost files first when over budget, keeping the most specific', () => {
    const big = 'x'.repeat(20_000);
    const out = formatRules([
      { path: '/repo/SHADOW.md', content: big },
      { path: '/repo/app/SHADOW.md', content: big },
    ]);
    // Only one fits; it must be the nearest one.
    expect(out).toContain('/repo/app/SHADOW.md');
    expect(out).not.toContain('<rules from="/repo/SHADOW.md">');
  });
});
