/**
 * The account registry.
 *
 * shadow sits on top of plans it does not own. Claude's credentials belong to the
 * `claude` CLI and Antigravity's to `agy`; the only account shadow issues itself is the
 * licence. So "logging in" means three different things, and the point of this module is
 * that callers do not have to know which is which — the TUI and the CLI both walk the
 * same list.
 *
 * Adding a future subscription that ships models is one more entry in `ACCOUNTS`.
 */

import { AgyProvider, isClaudeSignedIn } from '@shadow/providers';
import type { ProviderId } from '@shadow/providers';
import { loadLicense } from './billing.js';

export type AccountId = 'shadow' | 'claude' | 'antigravity';

/** What having this account gets you. */
export type Grant =
  | { kind: 'entitlement'; entitlement: 'pro' }
  /** Signing in makes this provider's models selectable. */
  | { kind: 'models'; provider: ProviderId };

/** How you sign in, which decides what the `/login` router does with the argument. */
export type SignIn =
  /** shadow's own: takes a licence key. */
  | { kind: 'license' }
  /** Someone else's: hand the terminal to their CLI and let them do it. */
  | { kind: 'spawn'; bin: string; args?: string[]; hint: string };

export interface AccountStatus {
  signedIn: boolean;
  /**
   * State only — never the command that fixes it. What to do about being signed out
   * differs per surface (a picker already has a footer, `shadow auth` prints a `fix:`
   * line), so that belongs to the caller, not here.
   */
  detail: string;
  /** Tier, customer name — anything worth showing next to the status. */
  extra?: string;
}

export interface Account {
  id: AccountId;
  label: string;
  grant: Grant;
  signIn: SignIn;
  status(): Promise<AccountStatus>;
}

/**
 * Cache for the two provider checks only.
 *
 * `agy` costs a process spawn (~200-400ms) that the banner, the model catalogue and the
 * picker would each pay separately. There is deliberately no TTL: a timer would re-spawn
 * `agy` at unpredictable moments mid-session and make the UI non-deterministic.
 * Invalidation is explicit instead — see `invalidateAuth`.
 *
 * The licence is never cached. It is a local file read, and `/login shadow <key>` has to
 * show up immediately.
 */
const cache = new Map<AccountId, { status: AccountStatus; models?: string[] }>();

/**
 * Forget a cached check, so the next one really runs.
 *
 * Called after an interactive login exits and after `/logout`. Bare `/login` and
 * `shadow auth` invalidate everything first, which is what makes "show me my status" an
 * honest answer rather than a replay. The consequence is that signing in from another
 * terminal is noticed when you type `/login`, not before.
 */
export function invalidateAuth(id?: AccountId): void {
  if (id) cache.delete(id);
  else cache.clear();
}

async function cached(
  id: AccountId,
  check: () => Promise<{ status: AccountStatus; models?: string[] }>,
): Promise<AccountStatus> {
  const hit = cache.get(id);
  if (hit) return hit.status;
  const fresh = await check();
  cache.set(id, fresh);
  return fresh.status;
}

/** Models `agy` reported during its status check, so the catalogue need not ask twice. */
export function cachedAgyModels(): string[] | undefined {
  return cache.get('antigravity')?.models;
}

export const ACCOUNTS: Account[] = [
  {
    id: 'shadow',
    label: 'shadow',
    grant: { kind: 'entitlement', entitlement: 'pro' },
    signIn: { kind: 'license' },
    async status() {
      const license = loadLicense();
      return {
        signedIn: license.active,
        detail: license.active ? 'PRO' : 'free',
        extra: license.customerName,
      };
    },
  },
  {
    id: 'claude',
    label: 'claude',
    grant: { kind: 'models', provider: 'claude' },
    signIn: {
      kind: 'spawn',
      bin: 'claude',
      hint: 'run `claude` once and sign in, or set ANTHROPIC_API_KEY',
    },
    async status() {
      return cached('claude', async () => {
        const signedIn = isClaudeSignedIn();
        return { status: { signedIn, detail: signedIn ? 'signed in' : 'not signed in' } };
      });
    },
  },
  {
    id: 'antigravity',
    label: 'antigravity',
    grant: { kind: 'models', provider: 'agy' },
    signIn: {
      kind: 'spawn',
      bin: 'agy',
      hint: 'run `agy` once and sign in to your Google account',
    },
    async status() {
      return cached('antigravity', async () => {
        const models = await new AgyProvider().models().catch(() => [] as string[]);
        const signedIn = models.length > 0;
        return {
          status: {
            signedIn,
            detail: signedIn ? `signed in, ${models.length} models` : 'not signed in',
          },
          models,
        };
      });
    },
  },
];

export function getAccount(id: AccountId): Account | undefined {
  return ACCOUNTS.find((a) => a.id === id);
}

/** Status of every account at once, for `/login` and `shadow auth`. */
export async function accountStatuses(): Promise<Map<AccountId, AccountStatus>> {
  const entries = await Promise.all(
    ACCOUNTS.map(async (a) => [a.id, await a.status()] as const),
  );
  return new Map(entries);
}

/** Whether a provider's models should be offered at all. */
export async function isProviderUnlocked(provider: ProviderId): Promise<boolean> {
  const account = ACCOUNTS.find(
    (a) => a.grant.kind === 'models' && a.grant.provider === provider,
  );
  if (!account) return true;
  return (await account.status()).signedIn;
}

/**
 * Whether PRO features are unlocked. Sync on purpose: the delegation guard runs on a hot
 * path and a local file read is cheap enough to do per call, which is also what lets a
 * mid-session `/login shadow` take effect without restarting anything.
 */
export function isPro(): boolean {
  return loadLicense().tier === 'pro';
}
