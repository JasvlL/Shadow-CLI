import { describe, expect, it } from 'vitest';
import {
  describeReset,
  fallbackProvider,
  quotaFromAgyFailure,
  quotaFromClaudeError,
  quotaFromRateLimitInfo,
} from '../src/quota.js';
import { newAgyParseState, parseAgyLine } from '../src/agy-parse.js';

describe('claude signals', () => {
  it('treats a rate limit or billing error as exhausted', () => {
    expect(quotaFromClaudeError('rate_limit')).toMatchObject({ status: 'exhausted' });
    expect(quotaFromClaudeError('billing_error')).toMatchObject({
      status: 'exhausted',
      detail: 'billing limit reached',
    });
  });

  it('treats an overload as a warning, since the plan is not spent', () => {
    expect(quotaFromClaudeError('overloaded')).toMatchObject({ status: 'warning' });
  });

  it('ignores unrelated errors and absent errors', () => {
    expect(quotaFromClaudeError('invalid_request')).toBeNull();
    expect(quotaFromClaudeError(undefined)).toBeNull();
  });

  it('translates a rejected rate_limit_event, converting the reset to milliseconds', () => {
    const event = quotaFromRateLimitInfo({ status: 'rejected', resetsAt: 1_700_000_000 });
    expect(event).toMatchObject({ status: 'exhausted', resetsAt: 1_700_000_000_000 });
  });

  it('warns ahead of the limit rather than only after it', () => {
    expect(quotaFromRateLimitInfo({ status: 'allowed_warning' })).toMatchObject({
      status: 'warning',
    });
  });

  it('stays quiet while the plan is healthy', () => {
    expect(quotaFromRateLimitInfo({ status: 'allowed' })).toBeNull();
    expect(quotaFromRateLimitInfo({})).toBeNull();
  });
});

describe('agy signals (best effort)', () => {
  it.each([
    'Error: quota exceeded for this project',
    'RESOURCE_EXHAUSTED: too many requests',
    'HTTP 429 rate limited',
    'billing account not configured',
  ])('recognizes %s', (text) => {
    expect(quotaFromAgyFailure(text)).toMatchObject({ provider: 'agy', status: 'exhausted' });
  });

  it.each([
    'file not found',
    'the model refused to answer',
    'timeout while reading the file',
    '',
  ])('does not misread %s as a quota failure', (text) => {
    expect(quotaFromAgyFailure(text)).toBeNull();
  });

  it('surfaces through the NDJSON parser on a failed result', () => {
    const state = newAgyParseState();
    const events = parseAgyLine(
      '{"event":"result","result":{"conversation_id":"c1","status":"FAILED","error":"RESOURCE_EXHAUSTED: quota"}}',
      state,
    );
    expect(events.find((e) => e.t === 'quota')).toMatchObject({ status: 'exhausted' });
    expect(events.at(-1)).toMatchObject({ t: 'done', status: 'error' });
  });

  it('does not emit quota for an ordinary failure', () => {
    const state = newAgyParseState();
    const events = parseAgyLine(
      '{"event":"result","result":{"conversation_id":"c1","status":"FAILED","error":"file not found"}}',
      state,
    );
    expect(events.find((e) => e.t === 'quota')).toBeUndefined();
  });
});

describe('fallback', () => {
  it('swaps between the two providers', () => {
    expect(fallbackProvider('claude')).toBe('agy');
    expect(fallbackProvider('agy')).toBe('claude');
  });

  it('formats a reset time, and nothing when unknown', () => {
    expect(describeReset(undefined)).toBe('');
    expect(describeReset(Date.now())).toMatch(/\d/);
  });
});
