/**
 * Concurrency regression test. The orchestrator runs subagents in parallel, so
 * AgyProvider must survive several simultaneous spawns without losing output.
 * Live: costs quota, gated behind FLICK_LIVE=1.
 */
import { describe, expect, it } from 'vitest';
import { AgyProvider } from '../src/agy.js';
import { collectText } from '../src/types.js';

describe.skipIf(process.env.FLICK_LIVE !== '1')('AgyProvider under concurrency (live)', () => {
  it(
    'returns each run its own complete output when three run at once',
    async () => {
      const provider = new AgyProvider();
      const results = await Promise.all(
        [1, 2, 3].map((n) =>
          collectText(
            provider.run({
              prompt: `Reply with exactly: RESP${n}`,
              cwd: process.cwd(),
              model: 'gemini-3.6-flash-medium',
            }),
          ),
        ),
      );

      expect(results[0]).toMatch(/RESP1/);
      expect(results[1]).toMatch(/RESP2/);
      expect(results[2]).toMatch(/RESP3/);
    },
    240_000,
  );
});
