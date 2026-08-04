import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateLicenseKey } from '../src/billing.js';

/**
 * The development bypass must not be a free PRO key.
 *
 * `TEST-PRO-KEY` is readable by anyone browsing this repo, so it is only honoured when
 * SHADOW_DEV is set — and never by the server, which is the actual source of truth.
 */
describe('licence validation', () => {
  const savedDev = process.env.SHADOW_DEV;
  const savedUrl = process.env.SHADOW_API_URL;

  beforeEach(() => {
    delete process.env.SHADOW_DEV;
    // Somewhere that refuses instantly, so the offline path is exercised without a wait.
    process.env.SHADOW_API_URL = 'http://127.0.0.1:1';
  });

  afterEach(() => {
    if (savedDev === undefined) delete process.env.SHADOW_DEV;
    else process.env.SHADOW_DEV = savedDev;
    if (savedUrl === undefined) delete process.env.SHADOW_API_URL;
    else process.env.SHADOW_API_URL = savedUrl;
    vi.restoreAllMocks();
  });

  it('does not honour the test key without SHADOW_DEV', async () => {
    const result = await validateLicenseKey('TEST-PRO-KEY');
    expect(result.active).toBe(false);
    expect(result.tier).toBe('free');
  });

  it('fails closed when the server is unreachable', async () => {
    // Going offline must not be a way to unlock PRO.
    const result = await validateLicenseKey('SHADOW-PRO-WHATEVER');
    expect(result.active).toBe(false);
    expect(result.tier).toBe('free');
  });

  // Deliberately no "valid key unlocks PRO" case here: the success path calls
  // saveLicense(), which writes to ~/.shadow/license.json — a test must not clobber the
  // real licence on the machine running it. That path is covered end-to-end instead.
});
