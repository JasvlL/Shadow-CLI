/**
 * Cheap "is this plan reachable" checks.
 *
 * Deliberately not `health()`: that runs a real query on Claude's side, which is far too
 * expensive for anything on the startup path — the banner comment in the TUI says as
 * much. These answer the weaker question "are there credentials at all", which is what
 * the model list and the account status actually need.
 *
 * Nothing here reads a token. Existence of the credentials file is the whole signal, so
 * shadow never handles the secret it is asking about.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Whether the `claude` CLI has credentials shadow can ride on.
 *
 * Caveat: on macOS the CLI may keep its OAuth token in the Keychain instead of on disk,
 * so a signed-in user can have no `.credentials.json`. `SHADOW_ASSUME_CLAUDE=1` is the
 * escape hatch for that case — without it those users would see an empty model list.
 */
export function isClaudeSignedIn(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return true;
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  if (process.env.SHADOW_ASSUME_CLAUDE === '1') return true;
  return existsSync(join(homedir(), '.claude', '.credentials.json'));
}
