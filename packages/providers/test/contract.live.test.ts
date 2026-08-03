/**
 * Cross-provider contract test. Hits the real backends, so it costs quota and is
 * skipped unless SHADOW_LIVE=1. Run with: SHADOW_LIVE=1 npx vitest run contract.live
 */
import { describe, expect, it } from 'vitest';
import { AgyProvider } from '../src/agy.js';
import { ClaudeProvider } from '../src/claude.js';
import type { ShadowEvent, Provider } from '../src/types.js';

const live = process.env.SHADOW_LIVE === '1';

const cases: Array<[string, () => Provider, string | undefined]> = [
  ['agy', () => new AgyProvider(), 'gemini-3.6-flash-low'],
  ['claude', () => new ClaudeProvider(), 'haiku'],
];

describe.skipIf(!live)('provider contract (live)', () => {
  for (const [name, make, model] of cases) {
    it(
      `${name} emits init -> text -> done for the same prompt`,
      async () => {
        const events: ShadowEvent[] = [];
        for await (const ev of make().run({
          prompt: 'Reply with exactly: PONG',
          cwd: process.cwd(),
          model,
        })) {
          events.push(ev);
        }

        const kinds = events.map((e) => e.t);
        expect(kinds).toContain('init');
        expect(kinds.at(-1)).toBe('done');

        const init = events.find((e) => e.t === 'init');
        expect(init).toMatchObject({ provider: name });
        expect((init as any).sessionRef).toBeTruthy();

        const done = events.at(-1) as Extract<ShadowEvent, { t: 'done' }>;
        expect(done.status).toBe('ok');
        expect(done.text).toMatch(/PONG/i);
      },
      180_000,
    );
  }
});
