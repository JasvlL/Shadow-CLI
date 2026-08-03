/**
 * Recognising "this plan is out".
 *
 * The two backends signal exhaustion very differently. Claude's SDK is explicit: a
 * `rate_limit_event` carries a status and a reset time, and assistant messages can be
 * tagged `rate_limit` or `billing_error`. agy says nothing structured at all — its
 * failure arrives as free text in a non-success result, so there we are pattern
 * matching and should be honest that it is best-effort.
 */

import type { FlickEvent, ProviderId } from './types.js';

/** Assistant-message error codes from the Claude SDK that mean "cannot continue". */
const CLAUDE_FATAL_ERRORS = new Set(['rate_limit', 'billing_error']);
/** Transient; the turn failed but the plan is not spent. */
const CLAUDE_TRANSIENT_ERRORS = new Set(['overloaded', 'server_error']);

export function quotaFromClaudeError(error: string | undefined): FlickEvent | null {
  if (!error) return null;
  if (CLAUDE_FATAL_ERRORS.has(error)) {
    return {
      t: 'quota',
      provider: 'claude',
      status: 'exhausted',
      detail: error === 'billing_error' ? 'billing limit reached' : 'rate limit reached',
    };
  }
  if (CLAUDE_TRANSIENT_ERRORS.has(error)) {
    return { t: 'quota', provider: 'claude', status: 'warning', detail: error };
  }
  return null;
}

/** Translate the SDK's `rate_limit_event` payload. */
export function quotaFromRateLimitInfo(info: {
  status?: string;
  resetsAt?: number;
}): FlickEvent | null {
  if (!info?.status || info.status === 'allowed') return null;

  // `resetsAt` is seconds in the SDK payload; FlickEvent uses milliseconds.
  const resetsAt = typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : undefined;

  if (info.status === 'rejected') {
    return { t: 'quota', provider: 'claude', status: 'exhausted', resetsAt, detail: 'plan limit reached' };
  }
  return {
    t: 'quota',
    provider: 'claude',
    status: 'warning',
    resetsAt,
    detail: 'approaching plan limit',
  };
}

/**
 * agy has no structured signal, so this reads its failure text.
 *
 * Deliberately narrow: a false positive would offer to switch provider over an ordinary
 * error, which is more annoying than missing a real exhaustion the user can resolve with
 * `/provider claude` themselves.
 */
const AGY_EXHAUSTED =
  /\b(quota|rate.?limit(ed)?|resource.?exhausted|too many requests|billing|insufficient.{0,20}(credit|balance)|429)\b/i;

export function quotaFromAgyFailure(text: string | undefined): FlickEvent | null {
  if (!text || !AGY_EXHAUSTED.test(text)) return null;
  return {
    t: 'quota',
    provider: 'agy',
    status: 'exhausted',
    detail: text.replace(/\s+/g, ' ').trim().slice(0, 200),
  };
}

/** The provider to fall back to. There are only two, so this is a swap. */
export function fallbackProvider(from: ProviderId): ProviderId {
  return from === 'claude' ? 'agy' : 'claude';
}

export function describeReset(resetsAt?: number): string {
  if (!resetsAt) return '';
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
