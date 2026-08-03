/**
 * `@file` expansion.
 *
 * A mention is a shorthand, not a hint: the file's contents are attached to the prompt
 * before it is sent, so the model does not have to spend a tool call fetching something
 * the user already pointed at.
 */

import { readTool, resolveInside } from '@shadow/tools';

/** Matches `@path` bounded by whitespace. Trailing punctuation is not part of the path. */
const MENTION = /(^|\s)@([^\s]+?)([.,;:!?]?)(?=\s|$)/g;

export function findMentions(prompt: string): string[] {
  const paths = new Set<string>();
  for (const match of prompt.matchAll(MENTION)) paths.add(match[2]!);
  return [...paths];
}

const MAX_ATTACHED_CHARS = 60_000;

/**
 * Append the contents of every mentioned file to the prompt.
 *
 * The prompt text is left untouched — the mentions stay visible so the model can see
 * which file the user meant when they wrote it. Unreadable paths are reported inline
 * rather than dropped, so a typo does not silently become a missing attachment.
 */
export async function expandMentions(prompt: string, cwd: string): Promise<string> {
  const paths = findMentions(prompt);
  if (paths.length === 0) return prompt;

  const blocks: string[] = [];
  let budget = MAX_ATTACHED_CHARS;

  for (const path of paths) {
    try {
      resolveInside(cwd, path);
      const content = await readTool.run({ path }, { cwd });
      const clipped =
        content.length > budget ? `${content.slice(0, budget)}\n… (truncated)` : content;
      budget -= clipped.length;
      blocks.push(`<file path="${path}">\n${clipped}\n</file>`);
      if (budget <= 0) break;
    } catch (err) {
      blocks.push(`<file path="${path}" error="${(err as Error).message}" />`);
    }
  }

  return `${prompt}\n\n${blocks.join('\n\n')}`;
}
