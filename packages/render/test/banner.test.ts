import { describe, expect, it } from 'vitest';
import { renderBanner } from '../src/banner.js';
import { PRODUCT, wordmark } from '../src/theme.js';
import { stripAnsi, visibleLength } from '../src/ansi.js';

const info = {
  cwd: '/home/u/proyecto',
  provider: 'claude',
  model: 'sonnet',
  ready: ['claude', 'agy'],
  unavailable: [] as string[],
  agents: 3,
  skills: 8,
  version: '0.1.0',
};

describe('banner', () => {
  it('answers model, cwd and what to type next', () => {
    const out = stripAnsi(renderBanner(info, 80));
    if (process.env.SHADOW_SHOW_FRAME) process.stderr.write(`\n${renderBanner(info, 80)}\n`);

    expect(out).toContain(`Welcome to ${PRODUCT}`);
    expect(out).toContain('sonnet');
    expect(out).toContain('~/proyecto'.replace('~', '')); // path shown either form
    expect(out).toContain('/model');
    expect(out).toContain('@');
  });

  it('names a provider that is not signed in, rather than hiding it', () => {
    const out = stripAnsi(renderBanner({ ...info, ready: ['agy'], unavailable: ['claude'] }, 80));
    expect(out).toMatch(/claude \(not signed in\)/);
  });

  it('reports a resumed session', () => {
    const out = stripAnsi(renderBanner({ ...info, resumedFrom: 'abcdef12-3456' }, 80));
    expect(out).toContain('resumed abcdef12');
  });

  it('omits the loaded row when there is nothing loaded', () => {
    const out = stripAnsi(renderBanner({ ...info, agents: 0, skills: 0 }, 80));
    expect(out).not.toContain('loaded');
  });

  it('falls back to a one-line mark on a narrow terminal', () => {
    expect(wordmark(40).split('\n')).toHaveLength(1);
    expect(stripAnsi(wordmark(40))).toContain(PRODUCT);
    expect(wordmark(80).split('\n').length).toBeGreaterThan(1);
  });

  it('keeps every line inside the terminal width', () => {
    for (const line of renderBanner(info, 80).split('\n')) {
      expect(visibleLength(line)).toBeLessThanOrEqual(80);
    }
  });
});
