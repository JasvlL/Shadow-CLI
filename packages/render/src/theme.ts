/**
 * Shadow's palette.
 *
 * Built on the 256-colour cube rather than truecolor: every terminal worth supporting
 * handles 256 colours, while 24-bit is still uneven over SSH and inside multiplexers.
 * A wrong-looking purple is better than an escape sequence printed as literal text.
 *
 * Deep purple is the identity colour; the lighter shades exist so a highlight can be
 * read against it without switching hue.
 */

const enabled = (): boolean => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
};

const color256 = (code: number) => (text: string) =>
  enabled() ? `\x1b[38;5;${code}m${text}\x1b[39m` : text;

const bg256 = (code: number) => (text: string) =>
  enabled() ? `\x1b[48;5;${code}m${text}\x1b[49m` : text;

/** Deep purple — the brand colour, used for the mark and primary chrome. */
export const shadow = color256(93);
/** Darker still, for rules and inactive edges. */
export const shadowDeep = color256(55);
/** Lighter, for text that must stay legible next to the deep tones. */
export const shadowLight = color256(141);
/** Softest tint, for hints and secondary labels. */
export const shadowMist = color256(183);
/** Selected row background. */
export const shadowSelected = bg256(54);

export const THEME = {
  /** Brand mark and headings. */
  primary: shadow,
  /** Secondary chrome: gutters, separators. */
  secondary: shadowDeep,
  /** Emphasis inside brand-coloured regions. */
  accent: shadowLight,
  /** Hints and metadata. */
  muted: shadowMist,
  selected: shadowSelected,
} as const;

/** The name shown to the user. The binary keeps its own name. */
export const PRODUCT = 'Shadow';

/**
 * Wordmark, drawn small enough to survive an 80-column terminal.
 * Falls back to plain text when the terminal is narrow.
 */
export function wordmark(width = 80): string {
  if (width < 54) return shadow(`◆ ${PRODUCT}`);

  const lines = [
    ' ▄▄▄· ▄ .▄ ▄▄▄· ·▄▄▄▄   ▄▄▄· ▄▄▌ ▐ ▄▌',
    '▐█ ▄███▪▐█▐█ ▀█ ██▪ ██ ▐█ ▀█ ██· █▌▐█',
    ' ██▀·██▀▐█▄█▀▀█ ▐█· ▐█▌▄█▀▀█ ██▪▐█▐▐▌',
    '▐█▪·•██▌▐▀▐█ ▪▐▌██. ██ ▐█ ▪▐▌▐█▌██▐█▌',
    '.▀   ▀▀▀ · ▀  ▀ ▀▀▀▀▀•  ▀  ▀  ▀▀▀▀ ▀▪',
  ];

  return lines
    .map((line, i) => (i < 2 ? shadowLight(line) : i < 4 ? shadow(line) : shadowDeep(line)))
    .join('\n');
}
