import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeProvider } from '../src/claude.js';
import { isClaudeSignedIn } from '../src/signed-in.js';

/**
 * A plan you cannot reach must not advertise models.
 *
 * `models()` used to return a hardcoded list unconditionally, so Claude models showed up
 * in the picker even when signed out — picking one then failed at run time with no
 * explanation. These pin the honest behaviour.
 */
describe('claude sign-in gating', () => {
  const saved = {
    apiKey: process.env.ANTHROPIC_API_KEY,
    oauth: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    assume: process.env.SHADOW_ASSUME_CLAUDE,
    home: process.env.HOME,
    userProfile: process.env.USERPROFILE,
  };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.SHADOW_ASSUME_CLAUDE;
    // Point home at a directory with no .claude/.credentials.json in it.
    process.env.HOME = process.cwd();
    process.env.USERPROFILE = process.cwd();
  });

  afterEach(() => {
    for (const [key, value] of [
      ['ANTHROPIC_API_KEY', saved.apiKey],
      ['CLAUDE_CODE_OAUTH_TOKEN', saved.oauth],
      ['SHADOW_ASSUME_CLAUDE', saved.assume],
      ['HOME', saved.home],
      ['USERPROFILE', saved.userProfile],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('lists no models when there are no credentials', async () => {
    expect(isClaudeSignedIn()).toBe(false);
    expect(await new ClaudeProvider().models()).toEqual([]);
  });

  it('lists models when an API key is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(isClaudeSignedIn()).toBe(true);
    expect(await new ClaudeProvider().models()).toContain('sonnet');
  });

  it('honours the keychain escape hatch', async () => {
    // macOS can keep the token out of the filesystem entirely, so a signed-in user would
    // otherwise see an empty list.
    process.env.SHADOW_ASSUME_CLAUDE = '1';
    expect(isClaudeSignedIn()).toBe(true);
  });

  it('reports signed-out health without spending a query', async () => {
    const health = await new ClaudeProvider().health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('not signed in');
  });
});
