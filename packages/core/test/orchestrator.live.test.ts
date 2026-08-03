/**
 * Live orchestrator tests. Gated behind FLICK_LIVE=1 because they spend real quota
 * on both providers.
 */
import { describe, expect, it } from 'vitest';
import { Orchestrator } from '../src/orchestrator.js';

const repoRoot = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

describe.skipIf(process.env.FLICK_LIVE !== '1')('orchestrator delegation (live)', () => {
  it(
    'delegates three scouts in parallel and each returns non-empty text',
    async () => {
      const seen: string[] = [];
      const orchestrator = new Orchestrator({
        cwd: repoRoot,
        onEvent: (ev) => {
          if (ev.t === 'delegation_end') {
            seen.push(`${ev.record.agent}:${ev.record.status}:${(ev.record.result ?? '').length}`);
          }
        },
      });
      await orchestrator.init();
      expect(orchestrator.getAgent('scout')).toBeDefined();

      const results = await orchestrator.delegateAll([
        { agent: 'scout', prompt: 'Which file defines the class AgyProvider? Answer path:line.' },
        { agent: 'scout', prompt: 'Which file defines the class Orchestrator? Answer path:line.' },
        { agent: 'scout', prompt: 'Which file defines readTool? Answer path:line.' },
      ]);

      // Surfaced on failure so an empty result is diagnosable from the report alone.
      expect(seen.join(' | ')).toBeTruthy();
      for (const result of results) {
        expect(result.trim()).not.toBe('');
        expect(result).not.toMatch(/^error:/);
      }
      expect(results[0]).toMatch(/agy\.ts/);
      expect(results[1]).toMatch(/orchestrator\.ts/);
      expect(results[2]).toMatch(/fs\.ts/);
    },
    300_000,
  );
});
