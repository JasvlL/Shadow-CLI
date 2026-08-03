/**
 * The startup banner.
 *
 * Shown once per session, before anything else. It answers the three questions you have
 * the moment a terminal agent opens: which model am I talking to, where am I, and what
 * do I type next.
 */

import { bold, dim } from './ansi.js';
import { PRODUCT, shadow, shadowDeep, shadowLight, shadowMist, wordmark } from './theme.js';
import { shortenPath } from './gutter.js';

export interface BannerInfo {
  cwd: string;
  provider: string;
  model: string;
  /**
   * Providers configured for this session. Not health-checked: verifying costs a round
   * trip per plan, and the banner must not delay the prompt. `shadow auth` reports on
   * credentials.
   */
  ready: string[];
  /** Providers known to be unusable, when that is already established. */
  unavailable: string[];
  agents: number;
  skills: number;
  version: string;
  /** Resumed session id, when continuing rather than starting fresh. */
  resumedFrom?: string;
}

/** A labelled line in the banner's info block. */
function row(label: string, value: string): string {
  return `  ${shadowMist(label.padEnd(9))} ${value}`;
}

export function renderBanner(info: BannerInfo, width = 80): string {
  const lines: string[] = ['', wordmark(width), ''];

  lines.push(`  ${shadow('◆')} ${bold(`Welcome to ${PRODUCT}`)} ${dim(`v${info.version}`)}`);
  lines.push('');

  lines.push(row('model', `${shadowLight(info.model)} ${dim(`on ${info.provider}`)}`));
  lines.push(row('cwd', dim(shortenPath(info.cwd))));

  const providers = [
    ...info.ready.map((p) => shadowLight(p)),
    ...info.unavailable.map((p) => dim(`${p} (not signed in)`)),
  ].join(dim(', '));
  lines.push(row('providers', providers || dim('none reachable')));

  const extras: string[] = [];
  if (info.agents > 0) extras.push(`${info.agents} agents`);
  if (info.skills > 0) extras.push(`${info.skills} skills`);
  if (extras.length > 0) lines.push(row('loaded', dim(extras.join(dim(' · ')))));

  if (info.resumedFrom) {
    lines.push(row('session', dim(`resumed ${info.resumedFrom.slice(0, 8)}`)));
  }

  lines.push('');
  lines.push(
    `  ${shadowMist('/help')} ${dim('for commands')}   ` +
      `${shadowMist('/model')} ${dim('to switch model')}   ` +
      `${shadowMist('@')} ${dim('to attach a file')}`,
  );
  lines.push(`  ${shadowDeep('─'.repeat(Math.max(10, Math.min(width, 76))))}`);

  return lines.join('\n');
}
