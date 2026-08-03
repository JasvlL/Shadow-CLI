/**
 * Minimal ANSI helpers.
 *
 * Deliberately not a dependency: the render layer must never fail, and a colour library
 * that misbehaves on a dumb terminal is one more thing that can break the display.
 * Honours NO_COLOR and a non-TTY stdout.
 */

const enabled = (): boolean => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
};

const wrap = (open: number, close: number) => (text: string) =>
  enabled() ? `\x1b[${open}m${text}\x1b[${close}m` : text;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const italic = wrap(3, 23);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);

/** Strip ANSI so widths and snapshots can be computed on plain text. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Visible length, ignoring escape sequences. */
export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

/** Truncate to `max` visible characters, appending an ellipsis when it had to cut. */
export function truncate(text: string, max: number): string {
  const plain = stripAnsi(text);
  if (plain.length <= max) return text;
  return `${plain.slice(0, Math.max(0, max - 1))}…`;
}
